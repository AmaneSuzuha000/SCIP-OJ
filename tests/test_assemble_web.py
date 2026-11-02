"""The shell switch must stay reversible and must not drop the runtime.

assemble_site.py is now the single point where a deployment decides which front
door to serve. These tests lock the two properties that make that safe: the
React path still carries the notebook runtime, docs and problems, and a shell
missing its GitHub Pages fallback is rejected rather than deployed.
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


class WebShellAssemblyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="scip-oj-assemble-"))
        self.lite = self.tmp / "lite"
        (self.lite / "lab").mkdir(parents=True)
        (self.lite / "lab" / "index.html").write_text(
            "<html><head></head><body>lite</body></html>", encoding="utf-8")
        self.web = self.tmp / "web"
        (self.web / "assets").mkdir(parents=True)
        (self.web / "index.html").write_text("<html>app</html>", encoding="utf-8")
        (self.web / "404.html").write_text("<html>app</html>", encoding="utf-8")
        (self.web / "assets" / "bundle.js").write_text("console.log(1)", encoding="utf-8")
        self.out = self.tmp / "out"

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_react_shell_keeps_the_notebook_runtime(self):
        assemble(self.lite, self.out, self.web)
        self.assertTrue((self.out / "notebooks" / "lab" / "index.html").is_file())
        self.assertTrue((self.out / "notebooks" / "bridge.js").is_file())
        self.assertTrue((self.out / "notebooks" / "engine.js").is_file())
        self.assertTrue((self.out / "problems").is_dir())
        self.assertTrue((self.out / ".nojekyll").is_file())

    def test_react_shell_serves_the_spa_and_its_deep_link_fallback(self):
        assemble(self.lite, self.out, self.web)
        self.assertEqual((self.out / "index.html").read_text(encoding="utf-8"), "<html>app</html>")
        # Without this file a direct hit on /course/<uuid> would 404 on Pages.
        self.assertEqual((self.out / "404.html").read_text(encoding="utf-8"), "<html>app</html>")
        self.assertTrue((self.out / "assets" / "bundle.js").is_file())

    def test_direct_notebook_visits_are_still_redirected(self):
        assemble(self.lite, self.out, self.web)
        lab = (self.out / "notebooks" / "lab" / "index.html").read_text(encoding="utf-8")
        self.assertIn("location.replace", lab)
        self.assertIn("engine.js", lab)

    def test_shell_without_pages_fallback_is_rejected(self):
        (self.web / "404.html").unlink()
        with self.assertRaises(ValueError) as caught:
            assemble(self.lite, self.out, self.web)
        self.assertIn("404.html", str(caught.exception))

    def test_missing_shell_build_is_rejected(self):
        (self.web / "index.html").unlink()
        with self.assertRaises(ValueError):
            assemble(self.lite, self.out, self.web)

    def test_output_must_be_a_fresh_directory(self):
        self.out.mkdir()
        with self.assertRaises(ValueError):
            assemble(self.lite, self.out, self.web)


if __name__ == "__main__":
    unittest.main()
