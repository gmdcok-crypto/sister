import os
from pathlib import Path
import tempfile
os.environ['DATABASE_URL'] = 'sqlite:///' + str(Path(tempfile.mkdtemp()) / 'test.db')
os.environ['ORDERS_ENABLED'] = 'true'
os.environ['ADMIN_API_KEY'] = 'test-only-secret'
from fastapi.testclient import TestClient
from app.main import app, Base, engine, SessionLocal, Category, Product, settings
Base.metadata.create_all(engine)
with SessionLocal() as s:
    s.add(Category(id=2,name='특수부위'));s.flush()
    s.add(Product(id=1,category_id=2,name='닭발',option='500g',price=8500,image='/test.png'));s.commit()
client=TestClient(app)
def payload(items): return dict(customer_name='홍길동',phone='01012345678',address='서울시 테스트 주소 123',items=items)
def test_catalog():
    assert client.get('/health').status_code==200
    assert len(client.get('/api/products?category_id=2&q=닭발').json())==1
    assert client.get('/api/products?category_id=3').json()==[]
def test_server_prices_and_duplicate_lines():
    data=payload([dict(product_id=1,quantity=1),dict(product_id=1,quantity=2)]);data['total']=1
    r=client.post('/api/orders',json=data)
    assert r.status_code==201 and r.json()['total']==25500
    assert r.json()['status']=='pending_payment'
def test_bad_quantity_and_missing_product():
    assert client.post('/api/orders',json=payload([dict(product_id=1,quantity=0)])).status_code==422
    assert client.post('/api/orders',json=payload([dict(product_id=999,quantity=1)])).status_code==409
    assert client.post('/api/orders',json=payload([dict(product_id=1,quantity=60),dict(product_id=1,quantity=60)])).status_code==422
def test_admin_auth():
    assert client.get('/api/admin/orders').status_code==401
    assert client.get('/api/admin/orders',headers={'X-Admin-Key':'test-only-secret'}).status_code==200
def test_orders_disabled():
    settings.orders_enabled=False
    try: assert client.post('/api/orders',json=payload([dict(product_id=1,quantity=1)])).status_code==503
    finally: settings.orders_enabled=True
