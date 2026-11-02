"""Assemble the portal and an independent JupyterLite distribution."""
import argparse
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def assemble(lite, output, web_dist=None):
    """Stage a Pages artifact.

    web_dist switches the application shell: when given, the React build in that
    directory replaces site/ + .portal-build, while the notebook runtime, docs,
    problems and KaTeX assets are staged exactly as before. The default path is
    untouched, so switching back is deleting one argument.
    """
    lite, output = Path(lite).resolve(), Path(output).resolve()
    web_dist = Path(web_dist).resolve() if web_dist else None
    if not (lite / 'lab/index.html').is_file():
        raise ValueError('Missing built JupyterLite lab')
    if output == ROOT or output in lite.parents or lite == output or output in ROOT.parents:
        raise ValueError('Output must be separate from sources and runtime')
    if output.exists():
        raise ValueError('Output must be a fresh directory')
    if web_dist is not None:
        if not (web_dist / 'index.html').is_file():
            raise ValueError('Missing React shell: build it with npm --prefix web run build')
        if not (web_dist / '404.html').is_file():
            raise ValueError('React shell has no 404.html; GitHub Pages needs it for deep links')
        shutil.copytree(web_dist, output)
    else:
        portal = ROOT / '.portal-build/js'
        if not all((portal / (name+'.js')).is_file() for name in ('app','platform','teacher','markdown')):
            raise ValueError('Build portal components first: npm ci && npm run build')
        shutil.copytree(ROOT / 'site', output, ignore=shutil.ignore_patterns('src','layout'))
        for page in (ROOT / '.portal-build/html').glob('*.html'):
            shutil.copyfile(page, output / page.name)
        for name in ('app','platform','teacher','markdown'):
            shutil.copyfile(portal / (name+'.js'), output / 'js' / (name+'.js'))
        shutil.copyfile(portal / 'markdown.css', output / 'js/markdown.css')
    # KaTeX is shared by the lesson renderer, not owned by either shell.
    shutil.copytree(ROOT / '.portal-build/assets/katex', output / 'assets/katex', dirs_exist_ok=True)
    shutil.copytree(lite, output / 'notebooks')
    for name in ('engine.js', 'bridge.js'):
        shutil.copyfile(ROOT / 'notebook' / name, output / 'notebooks' / name)
    # Direct visits enter the same portal gate. The admitted portal owns iframes.
    direct_guard = '<script>if(window.top===window){location.replace("../../index.html#course-labs")}</script>'
    for app in ('lab', 'repl'):
        entry = output / 'notebooks' / app / 'index.html'
        if entry.is_file():
            html = entry.read_text(encoding='utf-8')
            html = html.replace('<head>', '<head>'+direct_guard, 1) if '<head>' in html else direct_guard+html
            entry.write_text(html, encoding='utf-8')
    lab = output / 'notebooks/lab/index.html'
    html = lab.read_text(encoding='utf-8')
    bridge = '<script src="../engine.js?v=journey2"></script><script src="../bridge.js?v=journey2"></script>'
    lab.write_text(html.replace('</body>', bridge+'</body>') if '</body>' in html else html+bridge, encoding='utf-8')
    public_docs = (
        '学生指南.md', '教师指南.md', '出题指南.md', '拓展学习指南.md',
        '教师手册-考试花名册核验.md', 'IE_DES_01_精品案例实验指导书.md',
        '课程实验与评价规范.md', '判分协议-已冻结.md', '课程学习路径.md',
    )
    docs_out = output / 'docs'
    docs_out.mkdir()
    for name in public_docs:
        source = ROOT / 'docs' / name
        if source.is_file():
            shutil.copyfile(source, docs_out / name)
    lessons = ROOT / 'docs' / 'lessons'
    if lessons.is_dir():
        shutil.copytree(lessons, docs_out / 'lessons')
    shutil.copytree(ROOT / 'problems', output / 'problems')
    shutil.copyfile(ROOT / 'README.md', output / 'README.md')
    for app in ('lab', 'repl'):
        target = output / app
        target.mkdir()
        (target / 'index.html').write_text('''<!doctype html><meta charset="utf-8"><title>课程实验</title>
<script>const target=new URL('../index.html',location.href);const path=new URLSearchParams(location.search).get('path');target.hash=path?'notebook/'+encodeURIComponent(path):'course-labs';location.replace(target.href)</script>
<a href="../index.html#course-labs">返回课程实验</a>''', encoding='utf-8')
    (output / '.nojekyll').touch()

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--lite', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--web-dist', default=None,
                        help='React shell build directory; omit to keep the legacy shell')
    args = parser.parse_args()
    assemble(args.lite, args.output, args.web_dist)
