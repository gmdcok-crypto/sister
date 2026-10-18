import secrets
import json
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Set, Union

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, AliasChoices, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint, create_engine, select, text
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

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


class Order(Base):
    __tablename__ = 'orders'
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    customer_name: Mapped[str] = mapped_column(String(100))
    phone: Mapped[str] = mapped_column(String(30))
    address: Mapped[str] = mapped_column(String(500))
    total: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(40), default='pending_payment')
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


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
    options: List[OptionIn] = Field(min_length=1, max_length=30)
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


def require_admin(x_admin_key: str = Header(default='')):
    if not settings.admin_api_key or not secrets.compare_digest(x_admin_key, settings.admin_api_key):
        raise HTTPException(401, '인증이 필요합니다.')


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
    allow_headers=['Content-Type', 'X-Admin-Key'],
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
    return {
        'orders_enabled': settings.orders_enabled,
        'all_category_image': catalog.get('all_category_image', ''),
    }


@app.get('/api/products', response_model=List[ProductOut])
def products(category_id: Optional[int] = None, q: str = '', session: Session = Depends(db)):
    stmt = select(Product).where(Product.active == True)
    if category_id is not None:
        stmt = stmt.where(Product.category_id == category_id)
    if q:
        stmt = stmt.where(Product.name.contains(q[:100], autoescape=True))
    rows = list(session.scalars(stmt.order_by(Product.id).limit(200)))
    return [serialize_product(session, p) for p in rows]


@app.get('/api/products/{product_id}', response_model=ProductOut)
def product(product_id: int, session: Session = Depends(db)):
    p = session.get(Product, product_id)
    if not p or not p.active:
        raise HTTPException(404, '상품을 찾을 수 없습니다.')
    return serialize_product(session, p)


@app.post('/api/orders', status_code=201)
def order(data: OrderIn, session: Session = Depends(db)):
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

    receipt = Order(
        id=secrets.token_urlsafe(24),
        customer_name=data.customer_name.strip(),
        phone=data.phone,
        address=data.address.strip(),
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
    return {'order_id': receipt.id, 'total': total, 'status': receipt.status}


@app.get('/api/admin/orders')
def admin_orders(_: None = Depends(require_admin), session: Session = Depends(db)):
    orders = session.scalars(select(Order).order_by(Order.created_at.desc()).limit(100))
    result = []
    for o in orders:
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
        result.append(
            {
                'id': o.id,
                'customer_name': o.customer_name,
                'phone': o.phone,
                'address': o.address,
                'total': o.total,
                'status': o.status,
                'created_at': o.created_at,
                'items': items,
            }
        )
    return result


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
