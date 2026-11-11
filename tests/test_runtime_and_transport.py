"""Unit tests for the browser pyscipopt shim, grading transport diagnostics, and sandbox pipe runner."""
from __future__ import annotations

import hashlib
import hmac
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

_HAS_SCIPY = (
    importlib.util.find_spec("numpy") is not None
    and importlib.util.find_spec("scipy") is not None
)


def _load_shim():
    spec = importlib.util.spec_from_file_location(
        "scip_oj_pyscipopt_shim",
        ROOT / "web" / "public" / "runtime" / "pyscipopt.py",
    )
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class PySCIPOptShimTests(unittest.TestCase):
    @unittest.skipUnless(_HAS_SCIPY, "numpy/scipy required to execute HiGHS shim tests")
    def test_solution_apis_objective_constant_and_var_obj_fallback(self):
        shim = _load_shim()
        # 1) Variable obj= fallback without setObjective(), plus setParam & getBestSol/getSolVal
        m1 = shim.Model("var-obj")
        m1.setParam("display/verblevel", 0)
        m1.setParam("limits/time", 5)
        self.assertFalse(m1._verbose)
        self.assertEqual(m1._params["limits/time"], 5)

        x = m1.addVar("x", vtype="B", obj=10.0)
        y = m1.addVar("y", vtype="B", obj=6.0)
        m1.addCons(x + y <= 1)
        m1.setMaximize()
        m1.optimize()

        self.assertEqual(m1.getStatus(), "optimal")
        self.assertEqual(m1.getNSols(), 1)
        self.assertEqual(len(m1.getSols()), 1)
        best = m1.getBestSol()
        self.assertIsNotNone(best)
        self.assertAlmostEqual(m1.getObjVal(), 10.0)
        self.assertAlmostEqual(m1.getSolVal(best, x), 1.0)
        self.assertAlmostEqual(m1.getSolVal(best, y), 0.0)
        self.assertAlmostEqual(m1.getSolVal(best, 2 * x + 3), 5.0)
        self.assertAlmostEqual(m1.getSolVal(best, 7), 7.0)

        # 2) Explicit setObjective with non-zero constant term must be preserved in getObjVal()
        m2 = shim.Model("obj-const")
        m2.hideOutput()
        a = m2.addVar("a", vtype="I", lb=1, ub=4)
        b = m2.addVar("b", vtype="I", lb=0, ub=4)
        m2.addCons(a + b >= 3)
        m2.setObjective(5 * a + 2 * b + 12.5, "minimize")
        m2.optimize()
        self.assertEqual(m2.getStatus(), "optimal")
        self.assertAlmostEqual(m2.getObjVal(), 5 * 1 + 2 * 2 + 12.5)

        # 3) Infeasible model must expose zero solutions cleanly
        m3 = shim.Model("infeasible")
        z = m3.addVar("z", vtype="B")
        m3.addCons(z >= 1)
        m3.addCons(z <= 0)
        m3.optimize()
        self.assertEqual(m3.getStatus(), "infeasible")
        self.assertEqual(m3.getNSols(), 0)
        self.assertIsNone(m3.getBestSol())
        self.assertEqual(m3.getSols(), [])
        with self.assertRaises(shim.ConstraintError):
            m3.getSolVal(None, z)


class GradingTransportTests(unittest.TestCase):
    def test_callback_extracts_error_or_messages_and_signs_payload(self):
        import scripts.grading_transport as gt

        with tempfile.TemporaryDirectory() as tmp:
            old_cwd = Path.cwd()
            os.chdir(tmp)
            try:
                tmp_dir = Path(tmp) / "_grading_tmp"
                tmp_dir.mkdir()
                (tmp_dir / "report.json").write_text(
                    json.dumps(
                        {
                            "status": "system_error",
                            "score": None,
                            "passed": False,
                            "messages": ["first reason", "second reason"],
                        },
                        ensure_ascii=False,
                    ),
                    encoding="utf-8",
                )

                captured = {}

                class _Resp:
                    status = 200

                    def __enter__(self):
                        return self

                    def __exit__(self, *args):
                        return False

                def fake_urlopen(req, timeout=25):
                    captured["url"] = req.full_url
                    captured["headers"] = dict(req.header_items())
                    captured["raw"] = req.data
                    return _Resp()

                env = {
                    "SUBMISSION_ID": "sub-1",
                    "GRADING_ID": "grd-1",
                    "GITHUB_RUN_ID": "99",
                    "GITHUB_RUN_ATTEMPT": "2",
                    "GRADE_CALLBACK_SECRET": "top-secret-hmac",
                    "SUPABASE_URL": "https://example.supabase.co/",
                }
                with mock.patch.dict(os.environ, env, clear=False), mock.patch.object(
                    gt.urllib.request, "urlopen", side_effect=fake_urlopen
                ):
                    gt.callback()

                body = json.loads(captured["raw"].decode("utf-8"))
                self.assertEqual(body["status"], "system_error")
                self.assertEqual(body["error_message"], "first reason; second reason")
                expected_sig = hmac.new(
                    b"top-secret-hmac", captured["raw"], hashlib.sha256
                ).hexdigest()
                sig_header = {k.lower(): v for k, v in captured["headers"].items()}["x-grade-signature"]
                self.assertEqual(sig_header, expected_sig)
            finally:
                os.chdir(old_cwd)

    def test_drain_records_http_code_without_leaking_credentials(self):
        import scripts.grading_transport as gt

        calls = []

        def fake_rpc(name, body):
            calls.append((name, body))
            if name == "recover_grading_jobs":
                return {"recovered": 0}
            if name == "lease_grading_dispatches":
                return [
                    {
                        "submission_id": "s1",
                        "grading_id": "g1",
                        "problem_id": "P001",
                        "lease_token": "tok-1",
                    },
                    {
                        "submission_id": "s2",
                        "grading_id": "g2",
                        "problem_id": "P002",
                        "lease_token": "tok-2",
                    },
                ]
            return None

        seq = [
            urllib.error.HTTPError(
                url="https://api.github.com/...",
                code=422,
                msg="Unprocessable",
                hdrs=None,
                fp=io.BytesIO(b""),
            ),
            TimeoutError("timed out"),
        ]

        def fake_request_json(url, body, headers):
            exc = seq.pop(0)
            raise exc

        env = {
            "GITHUB_REPOSITORY": "AmaneSuzuha000/SCIP-OJ",
            "GH_TOKEN": "ghs_DO_NOT_LEAK_TOKEN",
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "srv_DO_NOT_LEAK",
        }
        with mock.patch.dict(os.environ, env, clear=False), mock.patch.object(
            gt, "rpc", side_effect=fake_rpc
        ), mock.patch.object(gt, "request_json", side_effect=fake_request_json):
            gt.drain()

        finishes = [body for name, body in calls if name == "finish_grading_dispatch"]
        self.assertEqual(len(finishes), 2)
        self.assertEqual(finishes[0]["p_error"], "GitHub dispatch HTTP 422; retry is safe")
        self.assertEqual(finishes[1]["p_error"], "TimeoutError: dispatch unconfirmed")
        for item in finishes:
            self.assertNotIn("ghs_DO_NOT_LEAK_TOKEN", item["p_error"])
            self.assertNotIn("srv_DO_NOT_LEAK", item["p_error"])


class SandboxPipeRunnerTests(unittest.TestCase):
    def _make_fake_proc(self, stdout_bytes: bytes, stderr_bytes: bytes = b"", returncode: int = 0, hang_timeout: bool = False):
        proc = mock.MagicMock()
        proc.stdin = io.BytesIO()
        proc.stdout = io.BytesIO(stdout_bytes)
        proc.stderr = io.BytesIO(stderr_bytes)
        if hang_timeout:
            proc.wait.side_effect = [subprocess.TimeoutExpired(cmd="docker", timeout=5), 0]
        else:
            proc.wait.return_value = returncode
        return proc

    def test_run_isolated_parses_result_line(self):
        from judge import sandbox

        payload = sandbox.RESULT_PREFIX.encode() + json.dumps({"objective": 7, "solution": [1, 0]}).encode() + b"\n"
        fake_proc = self._make_fake_proc(payload, returncode=0)
        with tempfile.TemporaryDirectory() as tmp:
            code_path = Path(tmp) / "sub.py"
            code_path.write_text("def solve(i): return {}\n", encoding="utf-8")
            with mock.patch.object(sandbox.subprocess, "Popen", return_value=fake_proc):
                res, err = sandbox._run_isolated(code_path, {"n": 2}, 5)
        self.assertEqual(res, {"objective": 7, "solution": [1, 0]})
        self.assertIsNone(err)

    def test_run_isolated_rejects_stdout_over_output_limit(self):
        from judge import sandbox

        oversized = b"A" * (sandbox.OUTPUT_LIMIT + 4096)
        fake_proc = self._make_fake_proc(oversized, returncode=0)
        with tempfile.TemporaryDirectory() as tmp:
            code_path = Path(tmp) / "spam.py"
            code_path.write_text("def solve(i): return {}\n", encoding="utf-8")
            with mock.patch.object(sandbox.subprocess, "Popen", return_value=fake_proc):
                res, err = sandbox._run_isolated(code_path, {"n": 1}, 5)
        self.assertIsNone(res)
        self.assertEqual(err, "代码标准输出超过 1 MiB 限制")

    def test_run_isolated_handles_timeout_and_docker_start_error(self):
        from judge import sandbox
        from judge.errors import SystemJudgeError

        with tempfile.TemporaryDirectory() as tmp:
            code_path = Path(tmp) / "loop.py"
            code_path.write_text("def solve(i): return {}\n", encoding="utf-8")

            timeout_proc = self._make_fake_proc(b"", hang_timeout=True)
            with mock.patch.object(sandbox.subprocess, "Popen", return_value=timeout_proc):
                res, err = sandbox._run_isolated(code_path, {}, 3)
            self.assertIsNone(res)
            self.assertEqual(err, "超过 3s 时间限制")
            timeout_proc.kill.assert_called_once()

            fail_start_proc = self._make_fake_proc(b"", stderr_bytes=b"daemon missing", returncode=125)
            with mock.patch.object(sandbox.subprocess, "Popen", return_value=fail_start_proc):
                with self.assertRaises(SystemJudgeError):
                    sandbox._run_isolated(code_path, {}, 3)


if __name__ == "__main__":
    unittest.main()
