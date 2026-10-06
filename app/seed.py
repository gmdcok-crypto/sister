import json
from pathlib import Path
from sqlalchemy import inspect, text
from .main import Base, engine, SessionLocal, Category, Product

def ensure_category_image_column():
    inspector = inspect(engine)
    if 'categories' not in inspector.get_table_names():
        return
    columns = {c['name'] for c in inspector.get_columns('categories')}
    if 'image' in columns:
        return
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE categories ADD COLUMN image VARCHAR(500) NOT NULL DEFAULT ''"))

def category_rows(catalog):
    rows = []
    for i, item in enumerate(catalog['categories'], 1):
        if isinstance(item, str):
            rows.append({'id': i, 'name': item, 'image': '', 'position': i})
        else:
            rows.append({'id': i, 'name': item['name'], 'image': item.get('image', ''), 'position': i})
    return rows

def main():
    Base.metadata.create_all(engine)
    ensure_category_image_column()
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
                session.add(Product(**{k: v for k, v in item.items() if k != 'crop'}))
        session.commit()

if __name__ == '__main__':
    main()
