"""Assemble the portal and an independent JupyterLite distribution."""
import argparse
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def assemble(lite, output):
    lite, output = Path(lite).resolve(), Path(output).resolve()
    if not (lite / 'lab/index.html').is_file():
        raise ValueError('Missing built JupyterLite lab')
    if output == ROOT or output in lite.parents or lite == output or output in ROOT.parents:
        raise ValueError('Output must be separate from sources and runtime')
    if output.exists():
        raise ValueError('Output must be a fresh directory')
    portal = ROOT / '.portal-build/js'
    if not all((portal / (name+'.js')).is_file() for name in ('app','platform','teacher')):
        raise ValueError('Build portal components first: npm ci && npm run build')
    shutil.copytree(ROOT / 'site', output, ignore=shutil.ignore_patterns('src'))
    for name in ('app','platform','teacher'):
        shutil.copyfile(portal / (name+'.js'), output / 'js' / (name+'.js'))
    shutil.copytree(lite, output / 'notebooks')
    for name in ('engine.js', 'bridge.js'):
        shutil.copyfile(ROOT / 'notebook' / name, output / 'notebooks' / name)
    lab = output / 'notebooks/lab/index.html'
    html = lab.read_text(encoding='utf-8')
    bridge = '<script src="../engine.js?v=progress2"></script><script src="../bridge.js?v=progress2"></script>'
    lab.write_text(html.replace('</body>', bridge+'</body>') if '</body>' in html else html+bridge, encoding='utf-8')
    shutil.copytree(ROOT / 'docs', output / 'docs')
    shutil.copytree(ROOT / 'problems', output / 'problems')
    shutil.copyfile(ROOT / 'README.md', output / 'README.md')
    for app in ('lab', 'repl'):
        target = output / app
        target.mkdir()
        (target / 'index.html').write_text('''<!doctype html><meta charset="utf-8"><title>课程实验</title>
<script>location.replace('../notebooks/APP/index.html'+location.search+location.hash)</script>
<a href="../notebooks/APP/index.html">打开课程实验</a>'''.replace('APP', app), encoding='utf-8')
    (output / '.nojekyll').touch()

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--lite', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    assemble(args.lite, args.output)
