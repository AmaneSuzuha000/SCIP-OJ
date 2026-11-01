"""Static notebook contract checks; solver execution occurs in CI Docker job."""
import ast
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class CourseNotebookTests(unittest.TestCase):
    def test_facility_notebook_valid_and_compilable(self):
        path = ROOT / "content/03_IE_Facility_Location_PySCIPOpt.ipynb"
        nb = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(nb["nbformat"], 4)
        cells = nb["cells"]
        self.assertGreaterEqual(len(cells), 6)
        code = "\n\n".join("".join(cell["source"]) for cell in cells if cell["cell_type"] == "code")
        ast.parse(code)
        self.assertIn("from pyscipopt import Model, quicksum", code)
        self.assertIn("brute_force_oracle", code)
        self.assertIn('assert abs(result["objective"] - oracle_obj) < 1e-6', code)
        docs = "\n".join("".join(cell["source"]) for cell in cells if cell["cell_type"] == "markdown")
        self.assertIn("single-source", docs)
        self.assertIn("合成教学数据", docs)
        self.assertIn("练习用，不计正式成绩。", docs)


    def test_independent_oracles_in_extended_notebooks(self):
        files = {
            "04_IE_Bin_Packing_PySCIPOpt.ipynb": "oracle_min_bins",
            "05_IE_Flow_Shop_PySCIPOpt.ipynb": "evaluate_schedule",
            "06_IE_Stochastic_Inventory_PySCIPOpt.ipynb": "explicit_expected_cost",
        }
        for file, oracle in files.items():
            with self.subTest(file=file):
                nb = json.loads((ROOT / "content" / file).read_text(encoding="utf-8"))
                self.assertEqual(nb["nbformat"], 4)
                code = "\n\n".join("".join(c["source"]) for c in nb["cells"] if c["cell_type"] == "code")
                ast.parse(code)
                self.assertIn("from pyscipopt import Model, quicksum", code)
                self.assertIn(oracle, code)
                self.assertIn("assert", code)
                self.assertGreater(len(nb["cells"]), 5)

    def test_new_modeling_notebooks_are_original_and_checked(self):
        expected = {
            "07_IE_Transportation_PySCIPOpt.ipynb": "oracle_min_cost",
            "08_IE_Cutting_Stock_PySCIPOpt.ipynb": "oracle_min_rolls",
            "09_IE_TSP_MTZ_PySCIPOpt.ipynb": "oracle_tour_cost",
            "10_IE_CVRP_PySCIPOpt.ipynb": "oracle_min_distance",
            "11_IE_Single_Machine_PySCIPOpt.ipynb": "oracle_total_tardiness",
        }
        for file, oracle in expected.items():
            with self.subTest(file=file):
                nb = json.loads((ROOT / "content" / file).read_text(encoding="utf-8"))
                self.assertEqual(nb["nbformat"], 4)
                code = "\n\n".join("".join(c["source"]) for c in nb["cells"] if c["cell_type"] == "code")
                docs = "\n".join("".join(c["source"]) for c in nb["cells"] if c["cell_type"] == "markdown")
                ast.parse(code)
                self.assertIn("from pyscipopt import Model, quicksum", code)
                self.assertIn(oracle, code)
                self.assertIn("assert", code)
                self.assertIn("合成教学数据", docs)
                self.assertIn("练习用，不计正式成绩。", docs)
                self.assertGreater(len(nb["cells"]), 5)

    def test_published_lessons_exist_without_courseware_binaries(self):
        for name in [
            "docs/课程学习路径.md",
            "docs/lessons/01-建模与SCIP入门.md",
            "docs/lessons/02-经典组合优化应用.md",
            "docs/lessons/03-路径与调度.md",
        ]:
            text = (ROOT / name).read_text(encoding="utf-8")
            self.assertIn("不计入正式成绩", text)
            self.assertGreater(len(text), 200)
        banned = []
        for path in ROOT.rglob("*"):
            if any(part in {".git", "node_modules", ".portal-build", "lite-build", "ui-preview", "ui-artifacts"} for part in path.parts):
                continue
            if path.suffix.lower() in {".pptx", ".pdf"}:
                banned.append(str(path.relative_to(ROOT)))
        self.assertEqual(banned, [])

    def test_all_case_links_exist(self):
        for name in ["case-studio.html", "inventory-lab.html",
                     "flow-lab.html", "official-examples.html"]:
            self.assertTrue((ROOT / "site" / name).is_file())
        self.assertTrue((ROOT / "docs/课程实验与评价规范.md").is_file())


if __name__ == "__main__":
    unittest.main()
