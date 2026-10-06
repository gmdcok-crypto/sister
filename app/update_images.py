"""Update only catalog image URLs; preserve live product names, prices and options."""
import json
from pathlib import Path
from .main import SessionLocal, Product

def main():
    catalog=json.loads((Path(__file__).parents[1]/'catalog.json').read_text(encoding='utf-8'))
    with SessionLocal() as session:
        for row in catalog['products']:
            product=session.get(Product,row['id'])
            if product: product.image=row['image']
        session.commit()
if __name__ == '__main__': main()
