"""The Pages artifact must be complete, or the build must fail.

assemble_site.py is the single point where a deployment decides what ships.
These tests lock the properties that make that safe: the app itself, the Python
runtime without which every lesson dies at start-up, and the Pages deep-link
fallback. A missing piece must raise rather than deploy a site that looks fine
until a student opens a lesson.
"""
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.assemble_site import assemble  # noqa: E402


class SiteAssemblyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="scip-oj-assemble-"))
        self.web = self.tmp / "web"
        (self.web / "assets").mkdir(parents=True)
        (self.web / "index.html").write_text("<html>app</html>", encoding="utf-8")
        (self.web / "404.html").write_text("<html>app</html>", encoding="utf-8")
        (self.web / "assets" / "bundle.js").write_text("console.log(1)", encoding="utf-8")
        runtime = self.web / "runtime" / "pyodide"
        runtime.mkdir(parents=True)
        (runtime / "pyodide.asm.wasm").write_bytes(b"\0asm")
        (self.web / "runtime" / "pyscipopt.py").write_text('"""shim"""\n', encoding="utf-8")
        self.out = self.tmp / "out"

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_shell_and_deep_link_fallback_are_served(self):
        assemble(self.web, self.out)
        self.assertEqual((self.out / "index.html").read_text(encoding="utf-8"), "<html>app</html>")
        # Without this file a direct hit on /course/<uuid> would 404 on Pages.
        self.assertEqual((self.out / "404.html").read_text(encoding="utf-8"), "<html>app</html>")
        self.assertTrue((self.out / "assets" / "bundle.js").is_file())

    def test_python_runtime_is_staged(self):
        assemble(self.web, self.out)
        self.assertTrue((self.out / "runtime" / "pyodide" / "pyodide.asm.wasm").is_file())
        self.assertTrue((self.out / "runtime" / "pyscipopt.py").is_file())

    def test_shell_without_pages_fallback_is_rejected(self):
        (self.web / "404.html").unlink()
        with self.assertRaises(ValueError) as caught:
            assemble(self.web, self.out)
        self.assertIn("404.html", str(caught.exception))

    def test_missing_app_build_is_rejected(self):
        (self.web / "index.html").unlink()
        with self.assertRaises(ValueError):
            assemble(self.web, self.out)

    def test_missing_python_runtime_is_rejected(self):
        # A site without the runtime serves a lesson page that cannot run code.
        shutil.rmtree(self.web / "runtime" / "pyodide")
        with self.assertRaises(ValueError) as caught:
            assemble(self.web, self.out)
        self.assertIn("runtime", str(caught.exception))

    def test_missing_modeling_shim_is_rejected(self):
        (self.web / "runtime" / "pyscipopt.py").unlink()
        with self.assertRaises(ValueError) as caught:
            assemble(self.web, self.out)
        self.assertIn("pyscipopt", str(caught.exception))

    def test_only_public_docs_are_published(self):
        assemble(self.web, self.out)
        self.assertEqual(
            (self.out / "docs" / "学生指南.md").read_bytes(),
            (ROOT / "docs" / "学生指南.md").read_bytes(),
        )
        # Internal design notes must never reach the public site.
        self.assertFalse((self.out / "docs" / "ACCESS_CONTROL.md").exists())
        self.assertFalse((self.out / "docs" / "design-evidence").exists())

    def test_output_must_be_a_fresh_directory(self):
        self.out.mkdir()
        with self.assertRaises(ValueError):
            assemble(self.web, self.out)


if __name__ == "__main__":
    unittest.main()
