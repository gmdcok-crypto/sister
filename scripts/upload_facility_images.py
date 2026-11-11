from pathlib import Path
from app.storage import upload_file

root = Path('frontend/public/assets/facility')
for p in sorted(root.glob('*.webp')):
    url = upload_file(p, f'facility/{p.name}')
    print(url)
