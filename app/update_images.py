"""Update catalog image URLs for products and categories; preserve prices/options."""
import json
from pathlib import Path
from .main import SessionLocal, Product, Category
from .seed import ensure_category_image_column, category_rows

def main():
    ensure_category_image_column()
    catalog = json.loads((Path(__file__).parents[1] / 'catalog.json').read_text(encoding='utf-8'))
    with SessionLocal() as session:
        for row in catalog['products']:
            product = session.get(Product, row['id'])
            if product:
                product.image = row['image']
        for row in category_rows(catalog):
            category = session.get(Category, row['id'])
            if category:
                category.image = row['image']
                category.name = row['name']
        session.commit()

if __name__ == '__main__':
    main()
