import secrets
import json
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Set, Union
from urllib.parse import urlencode

from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, AliasChoices, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint, create_engine, select, text
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from .auth_util import hash_password, new_session_token, session_expiry, verify_password
from .portone import fetch_payment, paid_total

ALLOWED_IMAGE_TYPES = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
}
MAX_IMAGE_BYTES = 5 * 1024 * 1024


class Settings(BaseSettings):
    database_url: str = Field(validation_alias=AliasChoices('DATABASE_URL', 'MYSQL_URL', 'database_url'))
    cors_origins: str = 'http://localhost:5173,http://127.0.0.1:5173'
    admin_api_key: str = ''
    orders_enabled: bool = False
    kakao_rest_api_key: str = ''
    kakao_redirect_uri: str = ''
    naver_client_id: str = ''
    naver_client_secret: str = ''
    naver_redirect_uri: str = ''
    portone_store_id: str = Field(default='', validation_alias=AliasChoices('PORTONE_STORE_ID', 'portone_store_id'))
    portone_api_secret: str = Field(
        default='', validation_alias=AliasChoices('PORTONE_API_SECRET', 'portone_api_secret')
    )
    portone_channel_key_card: str = Field(
        default='',
        validation_alias=AliasChoices(
            'PORTONE_CHANNEL_KEY_CARD',
            'PORTONE_CHANNEL_KEY',
            'portone_channel_key_card',
        ),
    )
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')


settings = Settings()
url = settings.database_url
if url.startswith('mysql://'):
    url = url.replace('mysql://', 'mysql+pymysql://', 1)
engine = create_engine(
    url,
    pool_pre_ping=True,
    **({'connect_args': {'check_same_thread': False}} if url.startswith('sqlite') else {}),
)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Category(Base):
    __tablename__ = 'categories'
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    image: Mapped[str] = mapped_column(String(500), default='')
    position: Mapped[int] = mapped_column(Integer, default=0)


class Product(Base):
    __tablename__ = 'products'
    id: Mapped[int] = mapped_column(primary_key=True)
    category_id: Mapped[int] = mapped_column(ForeignKey('categories.id'))
    name: Mapped[str] = mapped_column(String(200))
    option: Mapped[str] = mapped_column(String(200), default='')
    description: Mapped[str] = mapped_column(String(300), default='')
    price: Mapped[int] = mapped_column(Integer)
    image: Mapped[str] = mapped_column(String(500))
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class ProductOption(Base):
    __tablename__ = 'product_options'
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(ForeignKey('products.id'), index=True)
    label: Mapped[str] = mapped_column(String(200))
    price: Mapped[int] = mapped_column(Integer)
    position: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class ProductAddon(Base):
    """추가옵션: 본옵션과 함께 선택하는 부가 항목."""
    __tablename__ = 'product_addons'
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(ForeignKey('products.id'), index=True)
    label: Mapped[str] = mapped_column(String(200))
    price: Mapped[int] = mapped_column(Integer, default=0)
    position: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class ProductAddonLink(Base):
    """비어 있으면 모든 본옵션에 노출. 있으면 해당 본옵션에만 노출."""
    __tablename__ = 'product_addon_links'
    __table_args__ = (UniqueConstraint('addon_id', 'option_id', name='uq_addon_option'),)
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    addon_id: Mapped[int] = mapped_column(ForeignKey('product_addons.id'), index=True)
    option_id: Mapped[int] = mapped_column(ForeignKey('product_options.id'), index=True)


class User(Base):
    __tablename__ = 'users'
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(200))
    name: Mapped[str] = mapped_column(String(100), default='')
    phone: Mapped[str] = mapped_column(String(30), default='')
    provider: Mapped[str] = mapped_column(String(20), default='local')  # local|kakao|naver
    note: Mapped[str] = mapped_column(String(2000), default='')
    blocked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


class AuthSession(Base):
    __tablename__ = 'auth_sessions'
    token: Mapped[str] = mapped_column(String(80), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


class UserAddress(Base):
    __tablename__ = 'user_addresses'
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'), index=True)
    label: Mapped[str] = mapped_column(String(40), default='기본')
    recipient_name: Mapped[str] = mapped_column(String(100))
    phone: Mapped[str] = mapped_column(String(30))
    address: Mapped[str] = mapped_column(String(500))
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


class Order(Base):
    __tablename__ = 'orders'
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey('users.id'), nullable=True, default=None)
    customer_name: Mapped[str] = mapped_column(String(100))
    phone: Mapped[str] = mapped_column(String(30))
    address: Mapped[str] = mapped_column(String(500))
    tracking_number: Mapped[str] = mapped_column(String(20), default='')
    payment_id: Mapped[str] = mapped_column(String(80), default='')
    total: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(40), default='pending_payment')
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


def portone_card_enabled() -> bool:
    return bool(
        settings.portone_store_id.strip()
        and settings.portone_api_secret.strip()
        and settings.portone_channel_key_card.strip()
    )


def order_display_name(resolved: list) -> str:
    if not resolved:
        return '언니네닭 주문'
    first = resolved[0][0].name
    extra = len(resolved) - 1
    return f'{first} 외 {extra}건' if extra else first


class OrderItem(Base):
    __tablename__ = 'order_items'
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[str] = mapped_column(ForeignKey('orders.id'))
    product_id: Mapped[int] = mapped_column(ForeignKey('products.id'))
    product_name: Mapped[str] = mapped_column(String(200))
    option_label: Mapped[str] = mapped_column(String(200), default='')
    quantity: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[int] = mapped_column(Integer)


class OrderItemAddon(Base):
    __tablename__ = 'order_item_addons'
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    order_item_id: Mapped[int] = mapped_column(ForeignKey('order_items.id'), index=True)
    label: Mapped[str] = mapped_column(String(200))
    unit_price: Mapped[int] = mapped_column(Integer)
    quantity: Mapped[int] = mapped_column(Integer, default=1)


def db():
    with SessionLocal() as session:
        yield session


class OptionOut(BaseModel):
    id: int
    label: str
    price: int
    model_config = ConfigDict(from_attributes=True)


class AddonOut(BaseModel):
    id: int
    label: str
    price: int
    option_ids: List[int] = []  # empty => all options


class ProductOut(BaseModel):
    id: int
    category_id: int
    name: str
    option: str
    description: str = ''
    price: int
    image: str
    options: List[OptionOut] = []
    addons: List[AddonOut] = []
    model_config = ConfigDict(from_attributes=True)


class AddonLineIn(BaseModel):
    addon_id: int = Field(gt=0)
    quantity: int = Field(default=1, ge=1, le=10)


class LineIn(BaseModel):
    product_id: int = Field(gt=0)
    option_id: Optional[int] = Field(default=None, gt=0)
    quantity: int = Field(ge=1, le=100)
    addons: List[AddonLineIn] = Field(default_factory=list, max_length=20)


class OrderIn(BaseModel):
    customer_name: str = Field(min_length=1, max_length=100)
    phone: str = Field(pattern=r'^0[0-9-]{8,19}$')
    address: str = Field(min_length=5, max_length=500)
    items: List[LineIn] = Field(min_length=1, max_length=50)


class OrderLookupIn(BaseModel):
    order_id: str = Field(min_length=4, max_length=80)
    phone: str = Field(min_length=8, max_length=30)

    @field_validator('order_id', 'phone')
    @classmethod
    def strip_lookup(cls, value: str) -> str:
        return value.strip()


class OptionIn(BaseModel):
    id: Optional[int] = Field(default=None, gt=0)
    label: str = Field(min_length=1, max_length=200)
    price: int = Field(ge=0, le=10_000_000)

    @field_validator('label')
    @classmethod
    def strip_label(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError('옵션명을 입력해 주세요.')
        return value


class AddonIn(BaseModel):
    id: Optional[int] = Field(default=None, gt=0)
    label: str = Field(min_length=1, max_length=200)
    price: int = Field(ge=0, le=10_000_000)
    option_ids: List[int] = Field(default_factory=list, max_length=30)

    @field_validator('label')
    @classmethod
    def strip_label(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError('추가옵션명을 입력해 주세요.')
        return value


class ProductUpdateIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    category_id: int = Field(gt=0)
    active: bool = True
    image: Optional[str] = Field(default=None, max_length=500)
    options: List[OptionIn] = Field(min_length=1, max_length=80)
    addons: List[AddonIn] = Field(default_factory=list, max_length=30)

    @field_validator('name')
    @classmethod
    def strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError('상품명을 입력해 주세요.')
        return value

    @field_validator('image')
    @classmethod
    def strip_image(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        return value or None


class ProductCreateIn(ProductUpdateIn):
    pass


class RegisterIn(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=4, max_length=100)
    name: str = Field(min_length=1, max_length=100)
    phone: str = Field(default='', max_length=30)

    @field_validator('username')
    @classmethod
    def clean_username(cls, value: str) -> str:
        value = value.strip()
        if not value.isalnum():
            raise ValueError('아이디는 영문·숫자만 사용할 수 있습니다.')
        return value

    @field_validator('name')
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError('이름을 입력해 주세요.')
        return value


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1, max_length=100)


class AddressIn(BaseModel):
    label: str = Field(default='기본', min_length=1, max_length=40)
    recipient_name: str = Field(min_length=1, max_length=100)
    phone: str = Field(pattern=r'^0[0-9-]{8,19}$')
    address: str = Field(min_length=5, max_length=500)
    is_default: bool = False

    @field_validator('label', 'recipient_name', 'address')
    @classmethod
    def strip_address_fields(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError('배송지 정보를 확인해 주세요.')
        return value


MAX_USER_ADDRESSES = 10


def require_admin(x_admin_key: str = Header(default='')):
    if not settings.admin_api_key or not secrets.compare_digest(x_admin_key, settings.admin_api_key):
        raise HTTPException(401, '인증이 필요합니다.')


def get_user_optional(authorization: str = Header(default=''), session: Session = Depends(db)) -> Optional[User]:
    if not authorization.lower().startswith('bearer '):
        return None
    token = authorization.split(' ', 1)[1].strip()
    if not token:
        return None
    row = session.get(AuthSession, token)
    if not row:
        return None
    expires = row.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        return None
    return session.get(User, row.user_id)


def require_user(user: Optional[User] = Depends(get_user_optional)) -> User:
    if not user:
        raise HTTPException(401, '로그인이 필요합니다.')
    if user.blocked:
        raise HTTPException(403, '이용이 제한된 계정입니다. 고객센터에 문의해 주세요.')
    return user


def create_login_session(session: Session, user: User) -> dict:
    token = new_session_token()
    session.add(AuthSession(token=token, user_id=user.id, expires_at=session_expiry()))
    session.commit()
    return {
        'token': token,
        'user': {'id': user.id, 'username': user.username, 'name': user.name, 'phone': user.phone or ''},
    }


def product_options(session: Session, product_id: int) -> List[ProductOption]:
    return list(
        session.scalars(
            select(ProductOption)
            .where(ProductOption.product_id == product_id, ProductOption.active == True)
            .order_by(ProductOption.position, ProductOption.id)
        )
    )


def product_addons(session: Session, product_id: int) -> List[ProductAddon]:
    return list(
        session.scalars(
            select(ProductAddon)
            .where(ProductAddon.product_id == product_id, ProductAddon.active == True)
            .order_by(ProductAddon.position, ProductAddon.id)
        )
    )


def addon_option_ids(session: Session, addon_id: int) -> List[int]:
    return list(session.scalars(select(ProductAddonLink.option_id).where(ProductAddonLink.addon_id == addon_id)))


def serialize_addons(session: Session, product_id: int) -> List[AddonOut]:
    result = []
    for addon in product_addons(session, product_id):
        result.append(
            AddonOut(
                id=addon.id,
                label=addon.label,
                price=addon.price,
                option_ids=addon_option_ids(session, addon.id),
            )
        )
    return result


def serialize_product(session: Session, product: Product) -> ProductOut:
    opts = product_options(session, product.id)
    if not opts:
        opts_out = [OptionOut(id=0, label=product.option or '기본', price=product.price)]
        option_label = product.option or '기본'
        price = product.price
    else:
        opts_out = [OptionOut.model_validate(o) for o in opts]
        option_label = opts[0].label
        price = opts[0].price
    return ProductOut(
        id=product.id,
        category_id=product.category_id,
        name=product.name,
        option=option_label,
        description=product.description or '',
        price=price,
        image=product.image,
        options=opts_out,
        addons=serialize_addons(session, product.id),
    )


def sync_product_defaults(product: Product, options: Union[List[OptionIn], List[ProductOption]]):
    first = options[0]
    product.option = first.label
    product.price = first.price


def replace_options(session: Session, product: Product, options: List[OptionIn]) -> List[ProductOption]:
    existing = {
        o.id: o
        for o in session.scalars(select(ProductOption).where(ProductOption.product_id == product.id))
    }
    keep_ids = set()
    for index, item in enumerate(options):
        if item.id and item.id in existing:
            row = existing[item.id]
            row.label = item.label
            row.price = item.price
            row.position = index
            row.active = True
            keep_ids.add(item.id)
        else:
            session.add(
                ProductOption(
                    product_id=product.id,
                    label=item.label,
                    price=item.price,
                    position=index,
                    active=True,
                )
            )
    for option_id, row in existing.items():
        if option_id not in keep_ids:
            row.active = False
            # drop addon links pointing at deactivated options
            for link in session.scalars(select(ProductAddonLink).where(ProductAddonLink.option_id == option_id)):
                session.delete(link)
    sync_product_defaults(product, options)
    session.flush()
    return product_options(session, product.id)


def replace_addons(session: Session, product: Product, addons: List[AddonIn], active_option_ids: Set[int]):
    existing = {
        a.id: a
        for a in session.scalars(select(ProductAddon).where(ProductAddon.product_id == product.id))
    }
    keep_ids = set()
    for index, item in enumerate(addons):
        if item.id and item.id in existing:
            row = existing[item.id]
            row.label = item.label
            row.price = item.price
            row.position = index
            row.active = True
            keep_ids.add(item.id)
            addon_row = row
        else:
            addon_row = ProductAddon(
                product_id=product.id,
                label=item.label,
                price=item.price,
                position=index,
                active=True,
            )
            session.add(addon_row)
            session.flush()
            keep_ids.add(addon_row.id)

        for link in session.scalars(select(ProductAddonLink).where(ProductAddonLink.addon_id == addon_row.id)):
            session.delete(link)
        session.flush()
        for option_id in item.option_ids:
            if option_id in active_option_ids:
                session.add(ProductAddonLink(addon_id=addon_row.id, option_id=option_id))

    for addon_id, row in existing.items():
        if addon_id not in keep_ids:
            row.active = False
            for link in session.scalars(select(ProductAddonLink).where(ProductAddonLink.addon_id == addon_id)):
                session.delete(link)


def resolve_addons_for_option(
    session: Session,
    product: Product,
    option_id: Optional[int],
    addon_lines: List[AddonLineIn],
) -> List[tuple[ProductAddon, int]]:
    """Returns list of (addon, qty). Validates availability for selected option."""
    if not addon_lines:
        return []
    available = {a.id: a for a in product_addons(session, product.id)}
    resolved = []
    seen = set()
    for line in addon_lines:
        if line.addon_id in seen:
            raise HTTPException(422, f'{product.name}: 추가옵션이 중복되었습니다.')
        seen.add(line.addon_id)
        addon = available.get(line.addon_id)
        if not addon:
            raise HTTPException(409, f'{product.name}: 사용할 수 없는 추가옵션입니다.')
        links = addon_option_ids(session, addon.id)
        if links and (option_id is None or option_id not in links):
            raise HTTPException(422, f'{product.name}: "{addon.label}"은(는) 선택한 옵션에서 사용할 수 없습니다.')
        resolved.append((addon, line.quantity))
    return resolved


@asynccontextmanager
async def lifespan(app):
    # Schema setup is explicit; do not mutate the DB on web process startup.
    yield


app = FastAPI(title='언니네닭 API', lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[x.strip() for x in settings.cors_origins.split(',') if x.strip()],
    allow_methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    # Authorization 없으면 로그인/마이페이지/주문 API가 브라우저에서 Failed to fetch 로 막힘
    allow_headers=['Authorization', 'Content-Type', 'X-Admin-Key', 'Accept'],
)


@app.get('/health')
def health(session: Session = Depends(db)):
    session.execute(text('SELECT 1'))
    return {'status': 'ok'}


@app.get('/api/categories')
def categories(session: Session = Depends(db)):
    return [
        {'id': c.id, 'name': c.name, 'image': c.image or ''}
        for c in session.scalars(select(Category).order_by(Category.position))
    ]


@app.get('/api/config')
def config():
    catalog = json.loads((Path(__file__).resolve().parents[1] / 'catalog.json').read_text(encoding='utf-8'))
    card_on = portone_card_enabled()
    return {
        'orders_enabled': settings.orders_enabled,
        'all_category_image': catalog.get('all_category_image', ''),
        'social': {
            'kakao': bool(settings.kakao_rest_api_key and settings.kakao_redirect_uri),
            'naver': bool(settings.naver_client_id and settings.naver_redirect_uri),
        },
        'payment': {
            'card_enabled': card_on,
            'store_id': settings.portone_store_id.strip() if card_on else '',
            'channel_key_card': settings.portone_channel_key_card.strip() if card_on else '',
        },
    }


@app.post('/api/auth/register', status_code=201)
def auth_register(data: RegisterIn, session: Session = Depends(db)):
    exists = session.scalar(select(User).where(User.username == data.username))
    if exists:
        raise HTTPException(409, '이미 사용 중인 아이디입니다.')
    user = User(
        username=data.username,
        password_hash=hash_password(data.password),
        name=data.name,
        phone=(data.phone or '').strip(),
        provider='local',
    )
    session.add(user)
    session.flush()
    return create_login_session(session, user)


@app.post('/api/auth/login')
def auth_login(data: LoginIn, session: Session = Depends(db)):
    user = session.scalar(select(User).where(User.username == data.username.strip()))
    if not user or user.provider != 'local' or not verify_password(data.password, user.password_hash):
        raise HTTPException(401, '아이디 또는 비밀번호를 확인해 주세요.')
    if user.blocked:
        raise HTTPException(403, '이용이 제한된 계정입니다. 고객센터에 문의해 주세요.')
    return create_login_session(session, user)


@app.get('/api/auth/me')
def auth_me(user: Optional[User] = Depends(get_user_optional)):
    if not user:
        raise HTTPException(401, '로그인이 필요합니다.')
    return {'id': user.id, 'username': user.username, 'name': user.name, 'phone': user.phone or ''}


@app.post('/api/auth/logout')
def auth_logout(authorization: str = Header(default=''), session: Session = Depends(db)):
    if authorization.lower().startswith('bearer '):
        token = authorization.split(' ', 1)[1].strip()
        row = session.get(AuthSession, token)
        if row:
            session.delete(row)
            session.commit()
    return {'ok': True}


def serialize_address(row: UserAddress) -> dict:
    return {
        'id': row.id,
        'label': row.label,
        'recipient_name': row.recipient_name,
        'phone': row.phone,
        'address': row.address,
        'is_default': bool(row.is_default),
    }


def user_addresses(session: Session, user_id: int) -> List[UserAddress]:
    return list(
        session.scalars(
            select(UserAddress)
            .where(UserAddress.user_id == user_id)
            .order_by(UserAddress.is_default.desc(), UserAddress.id.desc())
        )
    )


def clear_default_addresses(session: Session, user_id: int, except_id: Optional[int] = None):
    rows = user_addresses(session, user_id)
    for row in rows:
        if except_id is not None and row.id == except_id:
            continue
        if row.is_default:
            row.is_default = False


def get_user_address(session: Session, user: User, address_id: int) -> UserAddress:
    row = session.get(UserAddress, address_id)
    if not row or row.user_id != user.id:
        raise HTTPException(404, '배송지를 찾을 수 없습니다.')
    return row


@app.get('/api/my/addresses')
def list_my_addresses(user: User = Depends(require_user), session: Session = Depends(db)):
    return [serialize_address(row) for row in user_addresses(session, user.id)]


@app.post('/api/my/addresses', status_code=201)
def create_my_address(data: AddressIn, user: User = Depends(require_user), session: Session = Depends(db)):
    existing = user_addresses(session, user.id)
    if len(existing) >= MAX_USER_ADDRESSES:
        raise HTTPException(422, f'배송지는 최대 {MAX_USER_ADDRESSES}개까지 등록할 수 있습니다.')
    make_default = data.is_default or not existing
    if make_default:
        clear_default_addresses(session, user.id)
    row = UserAddress(
        user_id=user.id,
        label=data.label,
        recipient_name=data.recipient_name,
        phone=data.phone,
        address=data.address,
        is_default=make_default,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return serialize_address(row)


@app.put('/api/my/addresses/{address_id}')
def update_my_address(
    address_id: int,
    data: AddressIn,
    user: User = Depends(require_user),
    session: Session = Depends(db),
):
    row = get_user_address(session, user, address_id)
    row.label = data.label
    row.recipient_name = data.recipient_name
    row.phone = data.phone
    row.address = data.address
    if data.is_default:
        clear_default_addresses(session, user.id, except_id=row.id)
        row.is_default = True
    elif row.is_default and not data.is_default:
        # Keep at least one default when unchecking is not allowed if it's the only address
        others = [a for a in user_addresses(session, user.id) if a.id != row.id]
        if others:
            row.is_default = False
            if not any(a.is_default for a in others):
                others[0].is_default = True
        else:
            row.is_default = True
    session.commit()
    session.refresh(row)
    return serialize_address(row)


@app.post('/api/my/addresses/{address_id}/default')
def set_default_my_address(address_id: int, user: User = Depends(require_user), session: Session = Depends(db)):
    row = get_user_address(session, user, address_id)
    clear_default_addresses(session, user.id, except_id=row.id)
    row.is_default = True
    session.commit()
    session.refresh(row)
    return serialize_address(row)


@app.delete('/api/my/addresses/{address_id}')
def delete_my_address(address_id: int, user: User = Depends(require_user), session: Session = Depends(db)):
    row = get_user_address(session, user, address_id)
    was_default = row.is_default
    session.delete(row)
    session.flush()
    if was_default:
        remaining = user_addresses(session, user.id)
        if remaining:
            remaining[0].is_default = True
    session.commit()
    return {'ok': True}


@app.get('/api/auth/social/{provider}/start')
def auth_social_start(provider: str):
    provider = provider.lower()
    if provider == 'kakao':
        if not (settings.kakao_rest_api_key and settings.kakao_redirect_uri):
            raise HTTPException(503, '카카오 로그인은 앱 키 설정 후 사용할 수 있습니다.')
        query = urlencode(
            {
                'client_id': settings.kakao_rest_api_key,
                'redirect_uri': settings.kakao_redirect_uri,
                'response_type': 'code',
            }
        )
        return {'url': f'https://kauth.kakao.com/oauth/authorize?{query}'}
    if provider == 'naver':
        if not (settings.naver_client_id and settings.naver_redirect_uri):
            raise HTTPException(503, '네이버 로그인은 앱 키 설정 후 사용할 수 있습니다.')
        state = secrets.token_urlsafe(16)
        query = urlencode(
            {
                'response_type': 'code',
                'client_id': settings.naver_client_id,
                'redirect_uri': settings.naver_redirect_uri,
                'state': state,
            }
        )
        return {'url': f'https://nid.naver.com/oauth2.0/authorize?{query}', 'state': state}
    raise HTTPException(404, '지원하지 않는 로그인입니다.')


@app.get('/api/products', response_model=List[ProductOut])
def products(category_id: Optional[int] = None, q: str = '', session: Session = Depends(db)):
    stmt = select(Product).where(Product.active == True)
    if category_id is not None:
        stmt = stmt.where(Product.category_id == category_id)
    if q:
        stmt = stmt.where(Product.name.contains(q[:100], autoescape=True))
    stmt = stmt.outerjoin(Category, Category.id == Product.category_id)
    rows = list(session.scalars(stmt.order_by(Category.position, Product.id).limit(200)))
    return [serialize_product(session, p) for p in rows]


@app.get('/api/products/{product_id}', response_model=ProductOut)
def product(product_id: int, session: Session = Depends(db)):
    p = session.get(Product, product_id)
    if not p or not p.active:
        raise HTTPException(404, '상품을 찾을 수 없습니다.')
    return serialize_product(session, p)


@app.get('/api/my/orders')
def my_orders(user: User = Depends(require_user), session: Session = Depends(db)):
    rows = list(
        session.scalars(select(Order).where(Order.user_id == user.id).order_by(Order.created_at.desc()).limit(100))
    )
    return [serialize_order(session, o) for o in rows]


@app.post('/api/orders/lookup')
def order_lookup(data: OrderLookupIn, session: Session = Depends(db)):
    order = session.get(Order, data.order_id)
    phone = ''.join(ch for ch in data.phone if ch.isdigit())
    if not order:
        raise HTTPException(404, '주문 정보를 찾을 수 없습니다. 주문번호와 연락처를 확인해 주세요.')
    stored = ''.join(ch for ch in (order.phone or '') if ch.isdigit())
    if not phone or phone != stored:
        raise HTTPException(404, '주문 정보를 찾을 수 없습니다. 주문번호와 연락처를 확인해 주세요.')
    return serialize_order(session, order)


@app.post('/api/orders', status_code=201)
def order(data: OrderIn, session: Session = Depends(db), user: Optional[User] = Depends(get_user_optional)):
    if not settings.orders_enabled:
        raise HTTPException(503, '현재 주문 접수가 준비 중입니다.')

    product_qty: dict[int, int] = {}
    for line in data.items:
        product_qty[line.product_id] = product_qty.get(line.product_id, 0) + line.quantity
        if product_qty[line.product_id] > 100:
            raise HTTPException(422, '상품별 최대 수량은 100개입니다.')

    product_ids = set(product_qty)
    selected = {
        p.id: p
        for p in session.scalars(select(Product).where(Product.id.in_(product_ids), Product.active == True))
    }
    if len(selected) != len(product_ids):
        raise HTTPException(409, '판매 중이 아닌 상품이 포함되어 있습니다.')

    resolved = []
    total = 0
    for line in data.items:
        p = selected[line.product_id]
        opts = product_options(session, p.id)
        if opts:
            if line.option_id is None:
                raise HTTPException(422, f'{p.name}: 옵션을 선택해 주세요.')
            opt = next((o for o in opts if o.id == line.option_id), None)
            if not opt:
                raise HTTPException(409, f'{p.name}: 선택한 옵션을 사용할 수 없습니다.')
            label, base_price = opt.label, opt.price
            option_id = opt.id
        else:
            label, base_price = p.option or '기본', p.price
            option_id = None

        addon_rows = resolve_addons_for_option(session, p, option_id, line.addons)
        addon_extra = sum(a.price * qty for a, qty in addon_rows)
        unit_price = base_price + addon_extra
        total += unit_price * line.quantity
        resolved.append((p, label, unit_price, line.quantity, addon_rows))

    order_id = secrets.token_urlsafe(24)
    payment_id = f'order-{order_id}'
    receipt = Order(
        id=order_id,
        user_id=user.id if user else None,
        customer_name=data.customer_name.strip(),
        phone=data.phone,
        address=data.address.strip(),
        payment_id=payment_id,
        total=total,
    )
    if not receipt.customer_name or len(receipt.address) < 5:
        raise HTTPException(422, '배송 정보를 확인해 주세요.')
    session.add(receipt)
    session.flush()
    for p, label, unit_price, quantity, addon_rows in resolved:
        item = OrderItem(
            order_id=receipt.id,
            product_id=p.id,
            product_name=p.name,
            option_label=label,
            quantity=quantity,
            unit_price=unit_price,
        )
        session.add(item)
        session.flush()
        for addon, addon_qty in addon_rows:
            session.add(
                OrderItemAddon(
                    order_item_id=item.id,
                    label=addon.label,
                    unit_price=addon.price,
                    quantity=addon_qty,
                )
            )
    session.commit()
    body = {
        'order_id': receipt.id,
        'payment_id': payment_id,
        'total': total,
        'status': receipt.status,
        'order_name': order_display_name(resolved),
    }
    if portone_card_enabled():
        body['payment'] = {
            'store_id': settings.portone_store_id.strip(),
            'channel_key': settings.portone_channel_key_card.strip(),
            'pay_method': 'CARD',
            'currency': 'CURRENCY_KRW',
        }
    return body


class PaymentCompleteIn(BaseModel):
    payment_id: str = Field(min_length=4, max_length=80)
    order_id: str = Field(min_length=4, max_length=80)

    @field_validator('payment_id', 'order_id')
    @classmethod
    def strip_payment_ids(cls, value: str) -> str:
        return value.strip()


def mark_order_paid_from_portone(session: Session, order: Order, payment_id: str) -> Order:
    if not portone_card_enabled():
        raise HTTPException(503, '카드 결제가 설정되지 않았습니다.')
    expected = (order.payment_id or '').strip() or f'order-{order.id}'
    if payment_id != expected:
        raise HTTPException(409, '결제 정보가 주문과 일치하지 않습니다.')
    if order.status == 'paid':
        return order
    if order.status not in ('pending_payment',):
        raise HTTPException(409, '이미 처리된 주문입니다.')
    try:
        payment = fetch_payment(payment_id, settings.portone_api_secret.strip())
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc
    status = payment.get('status')
    total = paid_total(payment)
    if total is None or total != order.total:
        raise HTTPException(409, '결제 금액이 주문 금액과 다릅니다.')
    if status != 'PAID':
        raise HTTPException(409, f'결제가 완료되지 않았습니다. ({status or "unknown"})')
    order.payment_id = payment_id
    order.status = 'paid'
    session.commit()
    return order


@app.post('/api/payments/complete')
def payment_complete(data: PaymentCompleteIn, session: Session = Depends(db)):
    order = session.get(Order, data.order_id)
    if not order:
        raise HTTPException(404, '주문을 찾을 수 없습니다.')
    order = mark_order_paid_from_portone(session, order, data.payment_id)
    return serialize_order(session, order)


@app.post('/api/payments/portone/webhook')
async def payment_webhook(request: Request, session: Session = Depends(db)):
    """PortOne V2 webhook: verify paymentId against stored order when possible."""
    if not portone_card_enabled():
        return {'ok': True, 'ignored': True}
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    payment_id = str(
        payload.get('paymentId')
        or payload.get('payment_id')
        or (payload.get('data') or {}).get('paymentId')
        or ''
    ).strip()
    if not payment_id:
        return {'ok': True, 'ignored': True}
    order = session.scalar(select(Order).where(Order.payment_id == payment_id))
    if not order and payment_id.startswith('order-'):
        order = session.get(Order, payment_id[len('order-') :])
    if not order:
        return {'ok': True, 'ignored': True}
    if order.status == 'paid':
        return {'ok': True, 'status': 'paid'}
    try:
        mark_order_paid_from_portone(session, order, payment_id)
    except HTTPException:
        return {'ok': True, 'status': order.status}
    return {'ok': True, 'status': 'paid'}


ORDER_STATUSES = ('pending_payment', 'paid', 'preparing', 'shipping', 'completed', 'cancelled')
ORDER_STATUS_LABELS = {
    'pending_payment': '결제 대기',
    'paid': '결제 완료',
    'preparing': '상품 준비중',
    'shipping': '배송중',
    'completed': '완료',
    'cancelled': '취소',
}


class OrderStatusIn(BaseModel):
    status: str

    @field_validator('status')
    @classmethod
    def valid_status(cls, value: str) -> str:
        value = value.strip()
        if value not in ORDER_STATUSES:
            raise ValueError('주문 상태를 확인해 주세요.')
        return value


def cj_tracking_url(number: str) -> str:
    digits = ''.join(ch for ch in (number or '') if ch.isdigit())
    if not digits:
        return ''
    return f'https://trace.cjlogistics.com/next/tracking.html?wblNo={digits}'


def serialize_order(session: Session, o: Order) -> dict:
    items = []
    for i in session.scalars(select(OrderItem).where(OrderItem.order_id == o.id)):
        addons = [
            {'label': a.label, 'unit_price': a.unit_price, 'quantity': a.quantity}
            for a in session.scalars(select(OrderItemAddon).where(OrderItemAddon.order_item_id == i.id))
        ]
        items.append(
            {
                'name': i.product_name,
                'option': i.option_label,
                'quantity': i.quantity,
                'unit_price': i.unit_price,
                'addons': addons,
            }
        )
    return {
        'id': o.id,
        'customer_name': o.customer_name,
        'phone': o.phone,
        'address': o.address,
        'carrier': 'cj',
        'carrier_label': 'CJ대한통운',
        'tracking_number': o.tracking_number or '',
        'tracking_url': cj_tracking_url(o.tracking_number or ''),
        'total': o.total,
        'status': o.status,
        'status_label': ORDER_STATUS_LABELS.get(o.status, o.status),
        'payment_id': o.payment_id or '',
        'payment_status': o.status,
        'payment_label': ORDER_STATUS_LABELS.get(o.status, o.status),
        'created_at': o.created_at,
        'items': items,
    }


@app.get('/api/admin/orders')
def admin_orders(_: None = Depends(require_admin), session: Session = Depends(db)):
    orders = session.scalars(select(Order).order_by(Order.created_at.desc()).limit(100))
    return [serialize_order(session, o) for o in orders]


@app.put('/api/admin/orders/{order_id}/status')
def admin_update_order_status(
    order_id: str,
    data: OrderStatusIn,
    _: None = Depends(require_admin),
    session: Session = Depends(db),
):
    order = session.get(Order, order_id)
    if not order:
        raise HTTPException(404, '주문을 찾을 수 없습니다.')
    order.status = data.status
    session.commit()
    return serialize_order(session, order)


class TrackingIn(BaseModel):
    tracking_number: str = Field(default='', max_length=30)


@app.put('/api/admin/orders/{order_id}/tracking')
def admin_update_order_tracking(
    order_id: str,
    data: TrackingIn,
    _: None = Depends(require_admin),
    session: Session = Depends(db),
):
    order = session.get(Order, order_id)
    if not order:
        raise HTTPException(404, '주문을 찾을 수 없습니다.')
    digits = ''.join(ch for ch in data.tracking_number if ch.isdigit())
    if digits and not 10 <= len(digits) <= 14:
        raise HTTPException(422, 'CJ대한통운 운송장번호는 10~14자리 숫자입니다.')
    order.tracking_number = digits
    if digits and order.status in ('paid', 'preparing'):
        order.status = 'shipping'
    session.commit()
    return serialize_order(session, order)


class CustomerUpdateIn(BaseModel):
    note: str = Field(default='', max_length=2000)
    blocked: bool = False


def customer_stats(session: Session, user_id: int) -> dict:
    rows = list(session.scalars(select(Order).where(Order.user_id == user_id)))
    return {
        'order_count': len(rows),
        'order_total': sum(o.total for o in rows),
        'last_order_at': max((o.created_at for o in rows), default=None),
    }


def serialize_customer(session: Session, user: User, include_orders: bool = False) -> dict:
    stats = customer_stats(session, user.id)
    item = {
        'id': user.id,
        'username': user.username,
        'name': user.name,
        'phone': user.phone or '',
        'provider': user.provider,
        'note': user.note or '',
        'blocked': bool(user.blocked),
        'created_at': user.created_at,
        'order_count': stats['order_count'],
        'order_total': stats['order_total'],
        'last_order_at': stats['last_order_at'],
    }
    if include_orders:
        orders = list(
            session.scalars(select(Order).where(Order.user_id == user.id).order_by(Order.created_at.desc()).limit(50))
        )
        item['orders'] = [serialize_order(session, o) for o in orders]
    return item


@app.get('/api/admin/customers')
def admin_customers(q: str = '', _: None = Depends(require_admin), session: Session = Depends(db)):
    users = list(session.scalars(select(User).order_by(User.id.desc()).limit(300)))
    query = (q or '').strip().lower()
    result = []
    for user in users:
        if query:
            blob = f'{user.username} {user.name} {user.phone}'.lower()
            if query not in blob:
                continue
        result.append(serialize_customer(session, user))
    # 비회원: user_id 없는 주문을 연락처 기준으로 묶음
    guest_orders = list(session.scalars(select(Order).where(Order.user_id.is_(None)).order_by(Order.created_at.desc()).limit(200)))
    guests: dict[str, dict] = {}
    for o in guest_orders:
        key = (o.phone or '').strip() or o.id
        if query and query not in f'{o.customer_name} {o.phone}'.lower():
            continue
        bucket = guests.setdefault(
            key,
            {
                'id': f'guest:{key}',
                'username': '',
                'name': o.customer_name,
                'phone': o.phone,
                'provider': 'guest',
                'note': '',
                'blocked': False,
                'created_at': o.created_at,
                'order_count': 0,
                'order_total': 0,
                'last_order_at': o.created_at,
                'is_guest': True,
            },
        )
        bucket['order_count'] += 1
        bucket['order_total'] += o.total
        if o.created_at and (bucket['last_order_at'] is None or o.created_at > bucket['last_order_at']):
            bucket['last_order_at'] = o.created_at
            bucket['name'] = o.customer_name
    result.extend(guests.values())
    result.sort(key=lambda x: x.get('last_order_at') or x.get('created_at') or '', reverse=True)
    return result


@app.get('/api/admin/customers/{customer_id}')
def admin_customer_detail(customer_id: str, _: None = Depends(require_admin), session: Session = Depends(db)):
    if customer_id.startswith('guest:'):
        phone = customer_id[6:]
        orders = list(
            session.scalars(
                select(Order)
                .where(Order.user_id.is_(None), Order.phone == phone)
                .order_by(Order.created_at.desc())
                .limit(50)
            )
        )
        if not orders:
            raise HTTPException(404, '고객을 찾을 수 없습니다.')
        latest = orders[0]
        return {
            'id': customer_id,
            'username': '',
            'name': latest.customer_name,
            'phone': latest.phone,
            'provider': 'guest',
            'note': '',
            'blocked': False,
            'created_at': latest.created_at,
            'order_count': len(orders),
            'order_total': sum(o.total for o in orders),
            'last_order_at': latest.created_at,
            'is_guest': True,
            'orders': [serialize_order(session, o) for o in orders],
        }
    try:
        uid = int(customer_id)
    except ValueError as exc:
        raise HTTPException(404, '고객을 찾을 수 없습니다.') from exc
    user = session.get(User, uid)
    if not user:
        raise HTTPException(404, '고객을 찾을 수 없습니다.')
    return serialize_customer(session, user, include_orders=True)


@app.put('/api/admin/customers/{customer_id}')
def admin_update_customer(
    customer_id: str,
    data: CustomerUpdateIn,
    _: None = Depends(require_admin),
    session: Session = Depends(db),
):
    if customer_id.startswith('guest:'):
        raise HTTPException(422, '비회원은 메모·차단을 저장할 수 없습니다. 회원 가입 후 관리하세요.')
    try:
        uid = int(customer_id)
    except ValueError as exc:
        raise HTTPException(404, '고객을 찾을 수 없습니다.') from exc
    user = session.get(User, uid)
    if not user:
        raise HTTPException(404, '고객을 찾을 수 없습니다.')
    user.note = (data.note or '').strip()
    user.blocked = data.blocked
    session.commit()
    return serialize_customer(session, user, include_orders=True)


@app.get('/api/admin/products')
def admin_products(_: None = Depends(require_admin), session: Session = Depends(db)):
    rows = list(session.scalars(select(Product).order_by(Product.id)))
    result = []
    for p in rows:
        item = serialize_product(session, p).model_dump()
        item['active'] = p.active
        result.append(item)
    return result


def _save_product_payload(session: Session, product: Product, data: ProductUpdateIn):
    product.name = data.name
    product.category_id = data.category_id
    product.active = data.active
    if data.image is not None:
        product.image = data.image
    active_opts = replace_options(session, product, data.options)
    replace_addons(session, product, data.addons, {o.id for o in active_opts})
    session.commit()
    item = serialize_product(session, product).model_dump()
    item['active'] = product.active
    return item


@app.post('/api/admin/products', status_code=201)
def admin_create_product(data: ProductCreateIn, _: None = Depends(require_admin), session: Session = Depends(db)):
    if not session.get(Category, data.category_id):
        raise HTTPException(422, '카테고리를 확인해 주세요.')
    next_id = (session.scalar(select(Product.id).order_by(Product.id.desc()).limit(1)) or 0) + 1
    product = Product(
        id=next_id,
        category_id=data.category_id,
        name=data.name,
        option=data.options[0].label,
        price=data.options[0].price,
        image=data.image or '',
        active=data.active,
    )
    session.add(product)
    session.flush()
    return _save_product_payload(session, product, data)


@app.put('/api/admin/products/{product_id}')
def admin_update_product(
    product_id: int,
    data: ProductUpdateIn,
    _: None = Depends(require_admin),
    session: Session = Depends(db),
):
    product = session.get(Product, product_id)
    if not product:
        raise HTTPException(404, '상품을 찾을 수 없습니다.')
    if not session.get(Category, data.category_id):
        raise HTTPException(422, '카테고리를 확인해 주세요.')
    return _save_product_payload(session, product, data)


@app.post('/api/admin/products/{product_id}/image')
async def admin_upload_image(
    product_id: int,
    file: UploadFile = File(...),
    _: None = Depends(require_admin),
    session: Session = Depends(db),
):
    product = session.get(Product, product_id)
    if not product:
        raise HTTPException(404, '상품을 찾을 수 없습니다.')
    content_type = (file.content_type or '').split(';')[0].strip().lower()
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(422, 'JPEG, PNG, WebP 이미지만 업로드할 수 있습니다.')
    data = await file.read()
    if not data:
        raise HTTPException(422, '빈 파일입니다.')
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(422, '이미지 용량은 5MB 이하여야 합니다.')
    try:
        from .storage import upload_bytes
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(503, f'이미지 저장소 설정을 확인해 주세요. ({exc})') from exc
    ext = ALLOWED_IMAGE_TYPES[content_type]
    key = f'products/admin/{product_id}-{uuid.uuid4().hex}{ext}'
    try:
        url = upload_bytes(data, key, content_type)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f'이미지 업로드에 실패했습니다. ({exc})') from exc
    product.image = url
    session.commit()
    return {'image': url}
