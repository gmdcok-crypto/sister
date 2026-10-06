"""Upload product images from frontend/public/assets to R2 and rewrite catalog URLs."""
from __future__ import annotations

import json
import re
from pathlib import Path

from .storage import public_url, upload_file

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'frontend' / 'public' / 'assets'
CATALOG = ROOT / 'catalog.json'
FRONTEND_CATALOG = ROOT / 'frontend' / 'src' / 'catalog.json'
MAIN_JS = ROOT / 'frontend' / 'src' / 'main.js'
PREFIX = 'products/'


def _product_filenames(catalog: dict) -> list[str]:
    names = []
    for row in catalog['products']:
        image = row['image']
        name = Path(image).name
        if name not in names:
            names.append(name)
    return names


def main() -> None:
    catalog = json.loads(CATALOG.read_text(encoding='utf-8'))
    uploaded: dict[str, str] = {}
    for name in _product_filenames(catalog):
        local = ASSETS / name
        if not local.is_file():
            raise FileNotFoundError(f'로컬 이미지 없음: {local}')
        key = f'{PREFIX}{name}'
        url = upload_file(local, key)
        uploaded[name] = url
        print(f'uploaded {key} -> {url}')

    for row in catalog['products']:
        row['image'] = uploaded[Path(row['image']).name]
    CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    front_rows = json.loads(FRONTEND_CATALOG.read_text(encoding='utf-8'))
    for row in front_rows:
        row['image'] = uploaded[Path(row['image']).name]
    FRONTEND_CATALOG.write_text(json.dumps(front_rows, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    hero = uploaded.get('chicken-breast-premium.png') or public_url(f'{PREFIX}chicken-breast-premium.png')
    js = MAIN_JS.read_text(encoding='utf-8')
    js2, n = re.subn(
        r'src="/assets/chicken-breast-premium\.png"',
        f'src="{hero}"',
        js,
        count=1,
    )
    if n:
        MAIN_JS.write_text(js2, encoding='utf-8')
        print(f'updated hero image in main.js')

    print(f'done: {len(uploaded)} files, catalog URLs updated')


if __name__ == '__main__':
    main()
