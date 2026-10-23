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
        self.assertIn("未接入正式 L2", docs)


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

    def test_all_case_links_exist(self):
        for name in ["case-studio.html", "inventory-lab.html",
                     "flow-lab.html", "official-examples.html"]:
            self.assertTrue((ROOT / "site" / name).is_file())
        self.assertTrue((ROOT / "docs/课程实验与评价规范.md").is_file())


if __name__ == "__main__":
    unittest.main()
