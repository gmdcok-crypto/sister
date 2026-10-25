import json
from pathlib import Path

from sqlalchemy import inspect, select, text

from .main import (
    Base,
    Category,
    Product,
    ProductAddon,
    ProductAddonLink,
    ProductOption,
    SessionLocal,
    engine,
)


def _add_column_if_missing(table: str, column: str, ddl: str):
    inspector = inspect(engine)
    if table not in inspector.get_table_names():
        return
    columns = {c['name'] for c in inspector.get_columns(table)}
    if column in columns:
        return
    with engine.begin() as conn:
        conn.execute(text(ddl))


def ensure_category_image_column():
    _add_column_if_missing(
        'categories',
        'image',
        "ALTER TABLE categories ADD COLUMN image VARCHAR(500) NOT NULL DEFAULT ''",
    )


def ensure_order_item_option_column():
    _add_column_if_missing(
        'order_items',
        'option_label',
        "ALTER TABLE order_items ADD COLUMN option_label VARCHAR(200) NOT NULL DEFAULT ''",
    )


def ensure_order_user_column():
    _add_column_if_missing(
        'orders',
        'user_id',
        'ALTER TABLE orders ADD COLUMN user_id INTEGER NULL',
    )


def ensure_user_admin_columns():
    _add_column_if_missing(
        'users',
        'note',
        "ALTER TABLE users ADD COLUMN note VARCHAR(2000) NOT NULL DEFAULT ''",
    )
    _add_column_if_missing(
        'users',
        'blocked',
        'ALTER TABLE users ADD COLUMN blocked BOOLEAN NOT NULL DEFAULT 0',
    )


def category_rows(catalog):
    rows = []
    for i, item in enumerate(catalog['categories'], 1):
        if isinstance(item, str):
            rows.append({'id': i, 'name': item, 'image': '', 'position': i})
        else:
            rows.append({'id': i, 'name': item['name'], 'image': item.get('image', ''), 'position': i})
    return rows


def sync_catalog_choices(session, product: Product, item: dict):
    """Replace a product's options and addons from catalog labels. Idempotent."""
    options = item.get('options') or []
    if options:
        rows = list(session.scalars(select(ProductOption).where(ProductOption.product_id == product.id)))
        by_label = {}
        for row in rows:
            by_label.setdefault(row.label, row)
        keep = set()
        first = None
        for index, opt in enumerate(options):
            label = str(opt['label']).strip()[:200]
            price = int(opt['price'])
            keep.add(label)
            row = by_label.get(label)
            if row is None:
                row = ProductOption(product_id=product.id, label=label, price=price, position=index, active=True)
                session.add(row)
                by_label[label] = row
            else:
                row.label = label
                row.price = price
                row.position = index
                row.active = True
            if first is None:
                first = row
        for row in rows:
            if row.label not in keep:
                row.active = False
        session.flush()
        if first is not None:
            product.option = first.label
            product.price = first.price

    if 'addons' not in item:
        return
    rows = list(session.scalars(select(ProductAddon).where(ProductAddon.product_id == product.id)))
    by_label = {}
    for row in rows:
        by_label.setdefault(row.label, row)
    keep = set()
    for index, addon in enumerate(item.get('addons') or []):
        label = str(addon['label']).strip()[:200]
        price = int(addon['price'])
        keep.add(label)
        row = by_label.get(label)
        if row is None:
            row = ProductAddon(product_id=product.id, label=label, price=price, position=index, active=True)
            session.add(row)
            by_label[label] = row
        else:
            row.label = label
            row.price = price
            row.position = index
            row.active = True
        session.flush()
        for link in session.scalars(select(ProductAddonLink).where(ProductAddonLink.addon_id == row.id)):
            session.delete(link)
    for row in rows:
        if row.label not in keep:
            row.active = False
    session.flush()


def ensure_product_options(session):
    products = list(session.scalars(select(Product)))
    for product in products:
        existing = list(
            session.scalars(
                select(ProductOption).where(
                    ProductOption.product_id == product.id,
                    ProductOption.active == True,
                )
            )
        )
        if existing:
            continue
        session.add(
            ProductOption(
                product_id=product.id,
                label=product.option or '기본',
                price=product.price,
                position=0,
                active=True,
            )
        )


def main():
    Base.metadata.create_all(engine)
    ensure_category_image_column()
    ensure_order_item_option_column()
    ensure_order_user_column()
    ensure_user_admin_columns()
    catalog = json.loads((Path(__file__).parents[1] / 'catalog.json').read_text(encoding='utf-8'))
    with SessionLocal() as session:
        for row in category_rows(catalog):
            existing = session.get(Category, row['id'])
            if existing:
                existing.name = row['name']
                existing.image = row['image']
                existing.position = row['position']
            else:
                session.add(Category(**row))
        session.flush()
        for item in catalog['products']:
            payload = {
                key: item[key]
                for key in ('id', 'category_id', 'name', 'option', 'price', 'image')
                if key in item
            }
            product = session.get(Product, item['id'])
            if product is None:
                product = Product(**payload)
                session.add(product)
                session.flush()
            else:
                product.category_id = payload['category_id']
                product.name = payload['name']
                product.option = payload.get('option') or product.option
                product.price = payload['price']
                product.image = payload['image']
                product.active = True
            sync_catalog_choices(session, product, item)
        session.flush()
        ensure_product_options(session)
        session.commit()


if __name__ == '__main__':
    main()
