import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("merge_jupyter_shell", ROOT / "scripts/merge_jupyter_shell.py")
merge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(merge)


class JupyterHomepageConfigTest(unittest.TestCase):
    def test_custom_homepage_keeps_runtime_config(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = {"appName": "JupyterLite", "baseUrl": "./", "federated_extensions": [{"name": "xeus-python", "load": "static/remoteEntry.js"}], "description": "</script>"}
            payload = json.dumps(config).replace("</", "<\\/")
            (root / "lite.html").write_text('<script id="jupyter-config-data" type="application/json">' + payload + '</script>')
            shell = '<html><head><title>课程教学</title></head><body><main>课程作业</main></body></html>'
            (root / "index.html").write_text(shell)
            merge.merge_page_config(root)
            result = (root / "index.html").read_text()
            self.assertEqual(json.loads(merge.CONFIG.search(result).group(1)), config)
            self.assertIn('<main>课程作业</main>', result)
            self.assertEqual(result.count('id="jupyter-config-data"'), 1)

    def test_missing_generated_config_fails_without_touching_shell(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "lite.html").write_text('<html></html>')
            (root / "index.html").write_text('<head></head><main>Original</main>')
            with self.assertRaises(ValueError):
                merge.merge_page_config(root)
            self.assertEqual((root / "index.html").read_text(), '<head></head><main>Original</main>')

    def test_deploy_runs_merge_after_copying_shell(self):
        workflow = (ROOT / '.github/workflows/deploy.yml').read_text()
        self.assertLess(workflow.index('cp -r site/* dist/'), workflow.index('python3 scripts/merge_jupyter_shell.py dist'))


if __name__ == '__main__':
    unittest.main()
