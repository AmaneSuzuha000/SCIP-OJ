import colorsys, re, pathlib, collections

files = ['site/case-studio.css','site/course-case-v3.css','site/case-labs.css','site/case-entry.css','site/styles/shell.css']
counts = collections.Counter()
for f in files:
    for hexv in re.findall(r'#[0-9a-fA-F]{3,8}', pathlib.Path(f).read_text(encoding='utf-8')):
        counts[hexv.lower()] += 1

def hsl(h):
    h = h.lstrip('#')
    if len(h) == 3: h = ''.join(c*2 for c in h)
    if len(h) == 8: h = h[:6]
    if len(h) != 6: return None
    r,g,b = (int(h[i:i+2],16)/255 for i in (0,2,4))
    hh,l,s = colorsys.rgb_to_hls(r,g,b)
    return hh*360, s, l

rows = []
for hexv, n in counts.items():
    v = hsl(hexv)
    if v: rows.append((v[0], v[1], v[2], hexv, n))

# Bucket by lightness so the design decision is visible, not guessed.
buckets = {'very-light (L>.955)':[], 'light (.90-.955)':[], 'mid (.45-.90)':[], 'dark (<.45)':[]}
for h,s,l,hexv,n in rows:
    if l > .955: buckets['very-light (L>.955)'].append((h,s,l,hexv,n))
    elif l > .90: buckets['light (.90-.955)'].append((h,s,l,hexv,n))
    elif l > .45: buckets['mid (.45-.90)'].append((h,s,l,hexv,n))
    else: buckets['dark (<.45)'].append((h,s,l,hexv,n))

for name, items in buckets.items():
    items.sort(key=lambda x: -x[4])
    print(f'\n=== {name}: {len(items)} unique ===')
    for h,s,l,hexv,n in items[:14]:
        print(f'  {hexv}  x{n:<3} h={h:5.1f} s={s:.2f} l={l:.2f}')
