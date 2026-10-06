import secrets
import json
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional
from fastapi import FastAPI, Depends, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, ConfigDict, AliasChoices
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import create_engine, String, Integer, DateTime, ForeignKey, Boolean, select, text, inspect
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker, Session

class Settings(BaseSettings):
    database_url: str = Field(validation_alias=AliasChoices('DATABASE_URL', 'MYSQL_URL', 'database_url'))
    cors_origins: str = 'http://localhost:5173,http://127.0.0.1:5173'
    admin_api_key: str = ''
    orders_enabled: bool = False
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')
settings = Settings()
url = settings.database_url
if url.startswith('mysql://'): url = url.replace('mysql://', 'mysql+pymysql://', 1)
engine = create_engine(url, pool_pre_ping=True, **({'connect_args': {'check_same_thread': False}} if url.startswith('sqlite') else {}))
SessionLocal = sessionmaker(engine, expire_on_commit=False)
class Base(DeclarativeBase): pass
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
    quantity: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[int] = mapped_column(Integer)

def db():
    with SessionLocal() as session: yield session
class ProductOut(BaseModel):
    id: int; category_id: int; name: str; option: str; price: int; image: str
    model_config = ConfigDict(from_attributes=True)
class LineIn(BaseModel):
    product_id: int = Field(gt=0)
    quantity: int = Field(ge=1, le=100)
class OrderIn(BaseModel):
    customer_name: str = Field(min_length=1, max_length=100)
    phone: str = Field(pattern=r'^0[0-9-]{8,19}$')
    address: str = Field(min_length=5, max_length=500)
    items: List[LineIn] = Field(min_length=1, max_length=50)

@asynccontextmanager
async def lifespan(app):
    # Schema setup is explicit; do not mutate the DB on web process startup.
    yield
app = FastAPI(title='언니네닭 API', lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=[x.strip() for x in settings.cors_origins.split(',') if x.strip()], allow_methods=['GET','POST'], allow_headers=['Content-Type','X-Admin-Key'])
@app.get('/health')
def health(session: Session = Depends(db)):
    session.execute(text('SELECT 1'))
    return {'status':'ok'}
@app.get('/api/categories')
def categories(session: Session = Depends(db)):
    return [{'id': c.id, 'name': c.name, 'image': c.image or ''} for c in session.scalars(select(Category).order_by(Category.position))]
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
    if category_id is not None: stmt = stmt.where(Product.category_id == category_id)
    if q: stmt = stmt.where(Product.name.contains(q[:100], autoescape=True))
    return list(session.scalars(stmt.order_by(Product.id).limit(200)))
@app.get('/api/products/{product_id}', response_model=ProductOut)
def product(product_id: int, session: Session = Depends(db)):
    p = session.get(Product, product_id)
    if not p or not p.active: raise HTTPException(404, '상품을 찾을 수 없습니다.')
    return p
@app.post('/api/orders', status_code=201)
def order(data: OrderIn, session: Session = Depends(db)):
    if not settings.orders_enabled: raise HTTPException(503, '현재 주문 접수가 준비 중입니다.')
    counts = {}
    for line in data.items:
        counts[line.product_id] = counts.get(line.product_id, 0) + line.quantity
        if counts[line.product_id] > 100: raise HTTPException(422, '상품별 최대 수량은 100개입니다.')
    selected = list(session.scalars(select(Product).where(Product.id.in_(counts), Product.active == True)))
    if len(selected) != len(counts): raise HTTPException(409, '판매 중이 아닌 상품이 포함되어 있습니다.')
    total = sum(p.price * counts[p.id] for p in selected)
    receipt = Order(id=secrets.token_urlsafe(24), customer_name=data.customer_name.strip(), phone=data.phone, address=data.address.strip(), total=total)
    if not receipt.customer_name or len(receipt.address)<5: raise HTTPException(422, '배송 정보를 확인해 주세요.')
    session.add(receipt); session.flush()
    for p in selected:
        session.add(OrderItem(order_id=receipt.id, product_id=p.id, product_name=p.name, quantity=counts[p.id], unit_price=p.price))
    session.commit()
    return {'order_id':receipt.id, 'total':total, 'status':receipt.status}
@app.get('/api/admin/orders')
def admin_orders(x_admin_key: str = Header(default=''), session: Session = Depends(db)):
    if not settings.admin_api_key or not secrets.compare_digest(x_admin_key, settings.admin_api_key): raise HTTPException(401, '인증이 필요합니다.')
    orders = session.scalars(select(Order).order_by(Order.created_at.desc()).limit(100))
    return [{'id':o.id,'customer_name':o.customer_name,'phone':o.phone,'address':o.address,'total':o.total,'status':o.status,'created_at':o.created_at,'items':[{'name':i.product_name,'quantity':i.quantity,'unit_price':i.unit_price} for i in session.scalars(select(OrderItem).where(OrderItem.order_id==o.id))]} for o in orders]
