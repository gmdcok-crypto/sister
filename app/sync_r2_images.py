"""Upload all frontend/public/assets images to R2.

Product images -> products/
Brand logo -> brand/
Other captures/sources -> assets/
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from .storage import upload_file

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'frontend' / 'public' / 'assets'
CATALOG = ROOT / 'catalog.json'
FRONTEND_CATALOG = ROOT / 'frontend' / 'src' / 'catalog.json'
MAIN_JS = ROOT / 'frontend' / 'src' / 'main.js'
INDEX_HTML = ROOT / 'frontend' / 'index.html'

PRODUCT_NAMES = {
    'boneless-feet-premium.png',
    'bones-premium.png',
    'gizzard-premium.png',
    'thigh-premium.png',
    'organs-premium.png',
    'neck-premium.png',
    'skin-premium.png',
    'cartilage-premium.png',
    'inner-premium.png',
    'feet-premium.png',
    'chicken-breast-premium.png',
}
BRAND_NAMES = {'unnine-logo-transparent.png'}


def r2_key(name: str) -> str:
    if name in PRODUCT_NAMES:
        return f'products/{name}'
    if name in BRAND_NAMES:
        return f'brand/{name}'
    return f'assets/{name}'


def main() -> None:
    uploaded: dict[str, str] = {}
    files = sorted(
        p for p in ASSETS.iterdir()
        if p.is_file() and p.suffix.lower() in {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'}
    )
    if not files:
        raise FileNotFoundError(f'이미지 없음: {ASSETS}')

    for local in files:
        key = r2_key(local.name)
        url = upload_file(local, key)
        uploaded[local.name] = url
        print(f'uploaded {key} -> {url}')

    catalog = json.loads(CATALOG.read_text(encoding='utf-8'))
    for row in catalog['products']:
        row['image'] = uploaded[Path(row['image']).name] if not str(row['image']).startswith('http') else uploaded.get(Path(row['image']).name, row['image'])
        name = Path(row['image']).name
        if name in uploaded:
            row['image'] = uploaded[name]
    CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    front_rows = json.loads(FRONTEND_CATALOG.read_text(encoding='utf-8'))
    for row in front_rows:
        name = Path(row['image']).name
        if name in uploaded:
            row['image'] = uploaded[name]
    FRONTEND_CATALOG.write_text(json.dumps(front_rows, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    logo = uploaded['unnine-logo-transparent.png']
    hero = uploaded['chicken-breast-premium.png']

    js = MAIN_JS.read_text(encoding='utf-8')
    js, n1 = re.subn(r'src="[^"]*unnine-logo-transparent\.png"', f'src="{logo}"', js)
    js, n2 = re.subn(r'src="[^"]*chicken-breast-premium\.png"', f'src="{hero}"', js, count=1)
    MAIN_JS.write_text(js, encoding='utf-8')
    print(f'updated main.js logo={n1} hero={n2}')

    html = INDEX_HTML.read_text(encoding='utf-8')
    html, n3 = re.subn(r'href="[^"]*unnine-logo-transparent\.png"', f'href="{logo}"', html)
    INDEX_HTML.write_text(html, encoding='utf-8')
    print(f'updated index.html favicon={n3}')

    print(f'done: {len(uploaded)} files')
    for name, url in uploaded.items():
        print(f'  {name}: {url}')


if __name__ == '__main__':
    main()
