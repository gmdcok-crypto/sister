import json
from pathlib import Path

from sqlalchemy import inspect, select, text

from .main import Base, Category, Product, ProductOption, SessionLocal, engine


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


def category_rows(catalog):
    rows = []
    for i, item in enumerate(catalog['categories'], 1):
        if isinstance(item, str):
            rows.append({'id': i, 'name': item, 'image': '', 'position': i})
        else:
            rows.append({'id': i, 'name': item['name'], 'image': item.get('image', ''), 'position': i})
    return rows


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
            if not session.get(Product, item['id']):
                payload = {k: v for k, v in item.items() if k not in {'crop', 'options'}}
                session.add(Product(**payload))
        session.flush()
        ensure_product_options(session)
        session.commit()


if __name__ == '__main__':
    main()
