from pathlib import Path
from PIL import Image

root = Path(r'd:\sisterfood\frontend\public\assets\facility')
for p in sorted(root.glob('*.jpg')):
    im = Image.open(p).convert('RGB')
    max_edge = 2000 if p.stem in {'exterior', 'award', 'plaque', 'storage', 'stock', 'hall', 'coldroom'} else 1600
    w, h = im.size
    scale = min(1.0, max_edge / max(w, h))
    if scale < 1:
        im = im.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
    out = p.with_suffix('.webp')
    im.save(out, 'WEBP', quality=78, method=6)
    print(f'{out.name}: {out.stat().st_size} ({im.size[0]}x{im.size[1]})')
