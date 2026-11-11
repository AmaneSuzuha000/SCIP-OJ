"""Run every course notebook against the browser shim and report honestly.

Notebooks print their own verification (several compare the solver against an
independent brute force), so a passing cell is real evidence, not just "no
exception". Anything the shim cannot do must surface as a skip, never a silent
pass.
"""
import glob
import importlib.util
import json
import pathlib
import sys
import traceback

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHIM_DIR = ROOT / "web" / "public" / "runtime"
sys.path.insert(0, str(SHIM_DIR))
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

sys.modules.pop("pyscipopt", None)
import pyscipopt  # noqa: E402

if pathlib.Path(pyscipopt.__file__).resolve().parent != SHIM_DIR.resolve():
    raise RuntimeError(f"Expected shim pyscipopt in {SHIM_DIR}, got {pyscipopt.__file__}")

from judge.common import grade_assignment, grade_knapsack  # noqa: E402
from judge.private_instances import private_assignment, private_knapsack  # noqa: E402

def cells(path):
    nb = json.load(open(path, encoding="utf-8"))
    for cell in nb["cells"]:
        if cell["cell_type"] == "code":
            yield "".join(cell["source"])

def _load_module(path: pathlib.Path, name: str):
    spec = importlib.util.spec_from_file_location(name, str(path))
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

def smoke_problem_solvers():
    k_inst = private_knapsack(20261112)
    k_pub = {k: v for k, v in k_inst.items() if k != "optimal_value"}
    k_ref = _load_module(ROOT / "problems/P001_knapsack/reference_pyscipopt.py", "_smoke_p001_ref")
    k_rep = grade_knapsack(k_ref.solve(k_pub), k_inst, {"pass_score": 90})
    assert k_rep["score"] == 100 and k_rep["passed"], k_rep

    a_inst = private_assignment(20261112)
    a_pub = {k: v for k, v in a_inst.items() if k != "optimal_value"}
    a_ref = _load_module(ROOT / "tests/fixtures/p002_smoke_mip.py", "_smoke_p002_ref")
    a_rep = grade_assignment(a_ref.solve(a_pub), a_inst, {"pass_score": 90})
    assert a_rep["score"] == 100 and a_rep["passed"], a_rep
    print("PASS problem smoke solvers via pyscipopt shim (P001=100, P002=100)")

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
    if pattern == "*":
        try:
            smoke_problem_solvers()
        except Exception:
            failures += 1
            print("FAIL problem smoke solvers via pyscipopt shim")
            traceback.print_exc()
    print()
    print(str(len(files)) + " notebooks, " + str(failures) + " failing items")
    return 1 if failures else 0

if __name__ == "__main__":
    sys.exit(main(*(sys.argv[1:2] or ["*"])))
