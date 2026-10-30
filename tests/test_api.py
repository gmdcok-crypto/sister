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


def test_catalog_category_order_keeps_ids():
    import json
    from app.seed import category_rows

    catalog = json.loads((Path(__file__).parents[1] / 'catalog.json').read_text(encoding='utf-8'))
    rows = category_rows(catalog)
    assert [r['name'] for r in rows][:4] == ['닭가슴살·닭안심살', '윙·봉·닭다리살', '닭한마리·오리고기', '특수부위']
    assert {r['name']: r['id'] for r in rows}['특수부위'] == 2
    assert [r['position'] for r in rows] == list(range(1, len(rows) + 1))


def test_products_follow_category_order():
    with SessionLocal() as s:
        s.add(Category(id=90, name='앞', image='', position=-1))
        s.flush()
        s.add(Product(id=900, category_id=90, name='앞상품', option='', price=1000, image=''))
        s.commit()
    try:
        ids = [p['id'] for p in client.get('/api/products').json()]
        assert ids.index(900) < ids.index(1)
    finally:
        with SessionLocal() as s:
            s.query(ProductOption).filter(ProductOption.product_id == 900).delete()
            s.query(Product).filter(Product.id == 900).delete()
            s.query(Category).filter(Category.id == 90).delete()
            s.commit()


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


def test_admin_customers():
    listed = client.get('/api/admin/customers', headers=ADMIN)
    assert listed.status_code == 200
    assert any(c.get('username') == 'buyer01' for c in listed.json())
    user = next(c for c in listed.json() if c.get('username') == 'buyer01')
    updated = client.put(
        f"/api/admin/customers/{user['id']}",
        headers=ADMIN,
        json={'note': '단골 고객', 'blocked': False},
    )
    assert updated.status_code == 200
    assert updated.json()['note'] == '단골 고객'
    detail = client.get(f"/api/admin/customers/{user['id']}", headers=ADMIN)
    assert detail.status_code == 200 and detail.json()['note'] == '단골 고객'


def test_my_orders_and_lookup():
    login = client.post('/api/auth/login', json={'username': 'buyer01', 'password': 'pass1234'})
    token = login.json()['token']
    headers = {'Authorization': f'Bearer {token}'}
    oid = client.get('/api/products/1').json()['options'][0]['id']
    created = client.post(
        '/api/orders',
        headers=headers,
        json=payload([dict(product_id=1, option_id=oid, quantity=1)]),
    )
    assert created.status_code == 201
    order_id = created.json()['order_id']
    mine = client.get('/api/my/orders', headers=headers)
    assert mine.status_code == 200
    assert any(o['id'] == order_id for o in mine.json())
    looked = client.post('/api/orders/lookup', json={'order_id': order_id, 'phone': '01012345678'})
    assert looked.status_code == 200
    assert looked.json()['id'] == order_id
    assert client.post('/api/orders/lookup', json={'order_id': order_id, 'phone': '01000000000'}).status_code == 404
    saved = client.put(
        f'/api/admin/orders/{order_id}/tracking',
        headers=ADMIN,
        json={'tracking_number': '1234-5678-9012'},
    )
    assert saved.status_code == 200
    assert saved.json()['tracking_number'] == '123456789012'
    assert saved.json()['carrier'] == 'cj'
    assert 'wblNo=123456789012' in saved.json()['tracking_url']
    assert client.put(
        f'/api/admin/orders/{order_id}/tracking',
        headers=ADMIN,
        json={'tracking_number': '123'},
    ).status_code == 422


def test_user_addresses():
    login = client.post('/api/auth/login', json={'username': 'buyer01', 'password': 'pass1234'})
    headers = {'Authorization': f'Bearer {login.json()["token"]}'}
    assert client.get('/api/my/addresses').status_code == 401
    created = client.post(
        '/api/my/addresses',
        headers=headers,
        json={
            'label': '집',
            'recipient_name': '홍길동',
            'phone': '01011112222',
            'address': '서울시 강남구 테스트로 1',
            'is_default': True,
        },
    )
    assert created.status_code == 201
    home_id = created.json()['id']
    assert created.json()['is_default'] is True
    office = client.post(
        '/api/my/addresses',
        headers=headers,
        json={
            'label': '회사',
            'recipient_name': '홍길동',
            'phone': '01033334444',
            'address': '서울시 중구 회사로 2',
            'is_default': True,
        },
    )
    assert office.status_code == 201
    office_id = office.json()['id']
    listed = client.get('/api/my/addresses', headers=headers).json()
    assert len(listed) >= 2
    assert next(a for a in listed if a['id'] == office_id)['is_default'] is True
    assert next(a for a in listed if a['id'] == home_id)['is_default'] is False
    updated = client.put(
        f'/api/my/addresses/{home_id}',
        headers=headers,
        json={
            'label': '우리집',
            'recipient_name': '홍길동',
            'phone': '01011112222',
            'address': '서울시 강남구 테스트로 1-2',
            'is_default': False,
        },
    )
    assert updated.status_code == 200 and updated.json()['label'] == '우리집'
    assert client.post(f'/api/my/addresses/{home_id}/default', headers=headers).status_code == 200
    listed2 = client.get('/api/my/addresses', headers=headers).json()
    assert next(a for a in listed2 if a['id'] == home_id)['is_default'] is True
    assert client.delete(f'/api/my/addresses/{office_id}', headers=headers).status_code == 200
    assert all(a['id'] != office_id for a in client.get('/api/my/addresses', headers=headers).json())

def test_config_payment_off_by_default():
    cfg = client.get('/api/config').json()
    assert cfg['payment']['card_enabled'] is False
    assert cfg['payment']['store_id'] == ''


def test_portone_card_complete(monkeypatch):
    settings.portone_store_id = 'store-test'
    settings.portone_api_secret = 'secret-test'
    settings.portone_channel_key_card = 'channel-key-test'
    try:
        cfg = client.get('/api/config').json()
        assert cfg['payment']['card_enabled'] is True
        assert cfg['payment']['store_id'] == 'store-test'
        oid = option_id('500g')
        created = client.post('/api/orders', json=payload([dict(product_id=1, option_id=oid, quantity=1)]))
        assert created.status_code == 201
        body = created.json()
        assert body['payment']['pay_method'] == 'CARD'
        assert body['payment_id'].startswith('order-')
        order_id = body['order_id']
        payment_id = body['payment_id']
        total = body['total']

        def fake_fetch(pid, secret, timeout=60):
            assert pid == payment_id
            assert secret == 'secret-test'
            return {'status': 'PAID', 'amount': {'total': total}}

        monkeypatch.setattr('app.main.fetch_payment', fake_fetch)
        done = client.post(
            '/api/payments/complete',
            json={'order_id': order_id, 'payment_id': payment_id},
        )
        assert done.status_code == 200
        assert done.json()['status'] == 'paid'

        again = client.post(
            '/api/payments/complete',
            json={'order_id': order_id, 'payment_id': payment_id},
        )
        assert again.status_code == 200 and again.json()['status'] == 'paid'

        bad = client.post(
            '/api/orders',
            json=payload([dict(product_id=1, option_id=oid, quantity=2)]),
        )
        assert bad.status_code == 201

        def wrong_amount(pid, secret, timeout=60):
            return {'status': 'PAID', 'amount': {'total': 1}}

        monkeypatch.setattr('app.main.fetch_payment', wrong_amount)
        mismatch = client.post(
            '/api/payments/complete',
            json={'order_id': bad.json()['order_id'], 'payment_id': bad.json()['payment_id']},
        )
        assert mismatch.status_code == 409
    finally:
        settings.portone_store_id = ''
        settings.portone_api_secret = ''
        settings.portone_channel_key_card = ''
