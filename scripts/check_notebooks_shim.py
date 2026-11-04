"""Run every course notebook against the browser shim and report honestly.

Notebooks print their own verification (several compare the solver against an
independent brute force), so a passing cell is real evidence, not just "no
exception". Anything the shim cannot do must surface as a skip, never a silent
pass.
"""
import glob
import json
import pathlib
import sys
import traceback

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "web" / "runtime"))

def cells(path):
    nb = json.load(open(path, encoding="utf-8"))
    for cell in nb["cells"]:
        if cell["cell_type"] == "code":
            yield "".join(cell["source"])

def main(pattern="*"):
    files = sorted(glob.glob(str(ROOT / "content" / (pattern + ".ipynb"))))
    if not files:
        print("没有匹配的 notebook")
        return 1
    failures = 0
    for path in files:
        name = pathlib.Path(path).name
        namespace = {"__name__": "__main__"}
        ok = True
        for index, code in enumerate(cells(path)):
            try:
                exec(compile(code, name + ":" + str(index), "exec"), namespace)
            except Exception:
                ok = False
                failures += 1
                print("FAIL " + name + " cell " + str(index))
                traceback.print_exc()
                break
        print(("PASS " if ok else "FAIL ") + name)
    print()
    print(str(len(files)) + " notebooks, " + str(failures) + " failing cells")
    return 1 if failures else 0

if __name__ == "__main__":
    sys.exit(main(*(sys.argv[1:2] or ["*"])))
