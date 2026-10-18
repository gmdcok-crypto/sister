import os
from pathlib import Path
import tempfile

os.environ['DATABASE_URL'] = 'sqlite:///' + str(Path(tempfile.mkdtemp()) / 'test.db')
os.environ['ORDERS_ENABLED'] = 'true'
os.environ['ADMIN_API_KEY'] = 'test-only-secret'

from fastapi.testclient import TestClient
from app.main import (
    Base,
    Category,
    Product,
    ProductAddon,
    ProductAddonLink,
    ProductOption,
    SessionLocal,
    app,
    engine,
    settings,
)

Base.metadata.create_all(engine)
with SessionLocal() as s:
    s.add(Category(id=2, name='특수부위', image=''))
    s.flush()
    s.add(Product(id=1, category_id=2, name='닭발', option='500g', price=8500, image='/test.png'))
    s.flush()
    s.add(ProductOption(product_id=1, label='500g', price=8500, position=0, active=True))
    s.add(ProductOption(product_id=1, label='1kg', price=16000, position=1, active=True))
    s.flush()
    from sqlalchemy import select as sa_select

    s.add(ProductAddon(product_id=1, label='소스 추가', price=1000, position=0, active=True))
    s.flush()
    opt500 = s.scalars(sa_select(ProductOption).where(ProductOption.product_id == 1, ProductOption.label == '500g')).one()
    addon = s.scalars(sa_select(ProductAddon).where(ProductAddon.product_id == 1, ProductAddon.label == '소스 추가')).one()
    s.add(ProductAddonLink(addon_id=addon.id, option_id=opt500.id))
    s.add(ProductAddon(product_id=1, label='아이스팩', price=500, position=1, active=True))
    s.commit()

client = TestClient(app)
ADMIN = {'X-Admin-Key': 'test-only-secret'}


def payload(items):
    return dict(customer_name='홍길동', phone='01012345678', address='서울시 테스트 주소 123', items=items)


def product():
    return client.get('/api/products/1').json()


def option_id(label: str) -> int:
    return next(o['id'] for o in product()['options'] if o['label'] == label)


def addon_id(label: str) -> int:
    return next(a['id'] for a in product()['addons'] if a['label'] == label)


def test_catalog():
    assert client.get('/health').status_code == 200
    products = client.get('/api/products?category_id=2&q=닭발').json()
    assert len(products) == 1
    assert len(products[0]['options']) >= 1
    assert len(products[0]['addons']) == 2
    sauce = next(a for a in products[0]['addons'] if a['label'] == '소스 추가')
    assert sauce['option_ids']
    ice = next(a for a in products[0]['addons'] if a['label'] == '아이스팩')
    assert ice['option_ids'] == []
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
    unit = next(o['price'] for o in product()['options'] if o['id'] == oid)
    assert r.json()['total'] == unit * 3


def test_option_pricing():
    oid = option_id('1kg')
    r = client.post('/api/orders', json=payload([dict(product_id=1, option_id=oid, quantity=1)]))
    assert r.status_code == 201 and r.json()['total'] == 16000


def test_addon_pricing_and_link():
    oid500 = option_id('500g')
    oid1kg = option_id('1kg')
    sauce = addon_id('소스 추가')
    ice = addon_id('아이스팩')
    ok = client.post(
        '/api/orders',
        json=payload(
            [
                dict(
                    product_id=1,
                    option_id=oid500,
                    quantity=1,
                    addons=[dict(addon_id=sauce, quantity=1), dict(addon_id=ice, quantity=1)],
                )
            ]
        ),
    )
    assert ok.status_code == 201 and ok.json()['total'] == 8500 + 1000 + 500
    blocked = client.post(
        '/api/orders',
        json=payload(
            [dict(product_id=1, option_id=oid1kg, quantity=1, addons=[dict(addon_id=sauce, quantity=1)])]
        ),
    )
    assert blocked.status_code == 422


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
    ice = addon_id('아이스팩')
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
            'addons': [
                {'id': ice, 'label': '아이스팩', 'price': 700, 'option_ids': []},
                {'label': '다진마늘', 'price': 1500, 'option_ids': [keep_id]},
            ],
        },
    )
    assert updated.status_code == 200
    body = updated.json()
    assert body['price'] == 9000
    assert len(body['options']) == 2
    assert body['options'][1]['label'] == '2kg'
    assert len(body['addons']) == 2
    garlic = next(a for a in body['addons'] if a['label'] == '다진마늘')
    assert keep_id in garlic['option_ids']


def test_z_admin_order_status():
    oid = client.get('/api/products/1').json()['options'][0]['id']
    created = client.post('/api/orders', json=payload([dict(product_id=1, option_id=oid, quantity=1)]))
    assert created.status_code == 201
    order_id = created.json()['order_id']
    listed = client.get('/api/admin/orders', headers=ADMIN).json()
    assert any(o['id'] == order_id for o in listed)
    changed = client.put(
        f'/api/admin/orders/{order_id}/status',
        headers=ADMIN,
        json={'status': 'preparing'},
    )
    assert changed.status_code == 200
    assert changed.json()['status'] == 'preparing'
    assert changed.json()['status_label'] == '상품 준비중'


def test_orders_disabled():
    settings.orders_enabled = False
    try:
        oid = client.get('/api/products/1').json()['options'][0]['id']
        assert client.post('/api/orders', json=payload([dict(product_id=1, option_id=oid, quantity=1)])).status_code == 503
    finally:
        settings.orders_enabled = True


def test_auth_register_login():
    created = client.post(
        '/api/auth/register',
        json={'username': 'buyer01', 'password': 'pass1234', 'name': '홍길동', 'phone': '01011112222'},
    )
    assert created.status_code == 201
    token = created.json()['token']
    me = client.get('/api/auth/me', headers={'Authorization': f'Bearer {token}'})
    assert me.status_code == 200 and me.json()['username'] == 'buyer01'
    login = client.post('/api/auth/login', json={'username': 'buyer01', 'password': 'pass1234'})
    assert login.status_code == 200 and login.json()['token']
    assert client.get('/api/auth/social/kakao/start').status_code == 503
