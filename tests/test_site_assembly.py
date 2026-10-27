import importlib.util
import tempfile
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('assembly', ROOT/'scripts/assemble_site.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
class AssemblyTest(unittest.TestCase):
    def test_separate_runtime_and_canonical_documents(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); lite=root/'runtime'; (lite/'lab').mkdir(parents=True)
            (lite/'lab/index.html').write_text('LAB')
            (lite/'index.html').write_text('RUNTIME ROOT CONFIG')
            target=root/'dist'; module.assemble(lite,target)
            self.assertEqual((target/'notebooks/index.html').read_text(),'RUNTIME ROOT CONFIG')
            self.assertIn('../bridge.js',(target/'notebooks/lab/index.html').read_text())
            self.assertTrue((target/'notebooks/engine.js').is_file())
            self.assertIn('课程教学',(target/'index.html').read_text())
            self.assertNotIn('RUNTIME ROOT CONFIG',(target/'index.html').read_text())
            self.assertEqual((target/'docs/学生指南.md').read_bytes(),(ROOT/'docs/学生指南.md').read_bytes())
            self.assertIn('location.search+location.hash',(target/'lab/index.html').read_text())
            with self.assertRaises(ValueError):module.assemble(lite,target)
    def test_invalid_runtime_does_not_write_output(self):
        with tempfile.TemporaryDirectory() as d:
            output=Path(d)/'dist'
            with self.assertRaises(ValueError):module.assemble(Path(d)/'absent',output)
            self.assertFalse(output.exists())
