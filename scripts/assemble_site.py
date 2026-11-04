"""Stage the GitHub Pages artifact.

The site is the React application. JupyterLite used to be shipped alongside it
as a second frontend just to host a Python kernel; that kernel now runs inside
the page (Pyodide), so there is nothing left for JupyterLite to do.
"""
import argparse
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

PUBLIC_DOCS = (
    '学生指南.md', '教师指南.md', '出题指南.md', '拓展学习指南.md',
    '教师手册-考试花名册核验.md', 'IE_DES_01_精品案例实验指导书.md',
    '课程实验与评价规范.md', '判分协议-已冻结.md', '课程学习路径.md',
)


def assemble(web_dist, output):
    """Copy the app build plus the assets it serves but does not bundle."""
    web_dist, output = Path(web_dist).resolve(), Path(output).resolve()

    if not (web_dist / 'index.html').is_file():
        raise ValueError('Missing app build: run npm --prefix web run build')
    if not (web_dist / '404.html').is_file():
        # GitHub Pages has no SPA fallback, so deep links 404 without this.
        raise ValueError('App build has no 404.html; deep links would break on Pages')
    if not (web_dist / 'runtime/pyodide/pyodide.asm.wasm').is_file():
        # Without the runtime every lesson fails at start-up; catching it here
        # turns a silent runtime error into an obvious build failure.
        raise ValueError('App build has no Python runtime: run web/scripts/stage-runtime.mjs')
    if not (web_dist / 'runtime/pyscipopt.py').is_file():
        raise ValueError('App build has no pyscipopt shim at runtime/pyscipopt.py')
    # dist/ lives inside the repository by design; copying the build into it
    # must not be mistaken for copying the repository into itself.
    if output == ROOT or output in ROOT.parents:
        raise ValueError('Output must not be the repository root or contain it')
    if output.exists():
        raise ValueError('Output must be a fresh directory')

    shutil.copytree(web_dist, output)

    docs_out = output / 'docs'
    docs_out.mkdir()
    for name in PUBLIC_DOCS:
        source = ROOT / 'docs' / name
        if source.is_file():
            shutil.copyfile(source, docs_out / name)
    lessons = ROOT / 'docs' / 'lessons'
    if lessons.is_dir():
        shutil.copytree(lessons, docs_out / 'lessons')

    # Problem definitions stay published: they are the contract students code
    # against, and the graders read the same files.
    shutil.copytree(ROOT / 'problems', output / 'problems')
    shutil.copyfile(ROOT / 'README.md', output / 'README.md')
    (output / '.nojekyll').touch()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--web-dist', required=True, help='React app build directory')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    assemble(args.web_dist, args.output)
