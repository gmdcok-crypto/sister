import os
from pathlib import Path
import tempfile

os.environ['DATABASE_URL'] = 'sqlite:///' + str(Path(tempfile.mkdtemp()) / 'test.db')
os.environ['ORDERS_ENABLED'] = 'true'
os.environ['ADMIN_API_KEY'] = 'test-only-secret'

from fastapi.testclient import TestClient
from app.main import Base, Category, Product, ProductOption, SessionLocal, app, engine, settings

Base.metadata.create_all(engine)
with SessionLocal() as s:
    s.add(Category(id=2, name='특수부위', image=''))
    s.flush()
    s.add(Product(id=1, category_id=2, name='닭발', option='500g', price=8500, image='/test.png'))
    s.flush()
    s.add(ProductOption(product_id=1, label='500g', price=8500, position=0, active=True))
    s.add(ProductOption(product_id=1, label='1kg', price=16000, position=1, active=True))
    s.commit()

client = TestClient(app)
ADMIN = {'X-Admin-Key': 'test-only-secret'}


def payload(items):
    return dict(customer_name='홍길동', phone='01012345678', address='서울시 테스트 주소 123', items=items)


def option_id(label: str) -> int:
    product = client.get('/api/products/1').json()
    return next(o['id'] for o in product['options'] if o['label'] == label)


def test_catalog():
    assert client.get('/health').status_code == 200
    products = client.get('/api/products?category_id=2&q=닭발').json()
    assert len(products) == 1
    assert len(products[0]['options']) >= 1
    assert client.get('/api/products?category_id=3').json() == []


def test_server_prices_and_duplicate_lines():
    oid = option_id('500g')
    data = payload(
        [
            dict(product_id=1, option_id=oid, quantity=1),
            dict(product_id=1, option_id=oid, quantity=2),
        ]
    )
    data['total'] = 1
    r = client.post('/api/orders', json=data)
    assert r.status_code == 201
    assert r.json()['status'] == 'pending_payment'
    product = client.get('/api/products/1').json()
    unit = next(o['price'] for o in product['options'] if o['id'] == oid)
    assert r.json()['total'] == unit * 3


def test_option_pricing():
    oid = option_id('1kg')
    r = client.post('/api/orders', json=payload([dict(product_id=1, option_id=oid, quantity=1)]))
    assert r.status_code == 201 and r.json()['total'] == 16000


def test_bad_quantity_and_missing_product():
    oid = option_id('500g')
    assert client.post('/api/orders', json=payload([dict(product_id=1, option_id=oid, quantity=0)])).status_code == 422
    assert client.post('/api/orders', json=payload([dict(product_id=999, option_id=1, quantity=1)])).status_code == 409
    assert (
        client.post(
            '/api/orders',
            json=payload(
                [
                    dict(product_id=1, option_id=oid, quantity=60),
                    dict(product_id=1, option_id=oid, quantity=60),
                ]
            ),
        ).status_code
        == 422
    )


def test_z_admin_auth_and_products():
    assert client.get('/api/admin/orders').status_code == 401
    assert client.get('/api/admin/orders', headers=ADMIN).status_code == 200
    assert client.get('/api/admin/products').status_code == 401
    products = client.get('/api/admin/products', headers=ADMIN).json()
    assert len(products) == 1
    keep_id = option_id('500g')
    updated = client.put(
        '/api/admin/products/1',
        headers=ADMIN,
        json={
            'name': '닭발',
            'category_id': 2,
            'active': True,
            'options': [
                {'id': keep_id, 'label': '500g', 'price': 9000},
                {'label': '2kg', 'price': 30000},
            ],
        },
    )
    assert updated.status_code == 200
    body = updated.json()
    assert body['price'] == 9000
    assert len(body['options']) == 2
    assert body['options'][1]['label'] == '2kg'


def test_orders_disabled():
    settings.orders_enabled = False
    try:
        # after admin test, 500g still exists
        oid = client.get('/api/products/1').json()['options'][0]['id']
        assert client.post('/api/orders', json=payload([dict(product_id=1, option_id=oid, quantity=1)])).status_code == 503
    finally:
        settings.orders_enabled = True
