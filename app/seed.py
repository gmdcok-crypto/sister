import json
from pathlib import Path
from sqlalchemy import select
from .main import Base, engine, SessionLocal, Category, Product

def main():
    Base.metadata.create_all(engine)
    catalog = json.loads((Path(__file__).parents[1] / 'catalog.json').read_text(encoding='utf-8'))
    with SessionLocal() as session:
        for i,name in enumerate(catalog['categories'],1):
            if not session.get(Category,i): session.add(Category(id=i,name=name,position=i))
        session.flush()
        for item in catalog['products']:
            if not session.get(Product,item['id']):
                session.add(Product(**{k:v for k,v in item.items() if k != 'crop'}))
        session.commit()
if __name__ == '__main__': main()
