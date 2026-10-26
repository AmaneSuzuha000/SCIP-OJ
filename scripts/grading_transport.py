"""Trusted Actions transport. Never execute this with student-controlled globals.

DB requests use the existing Actions service credential. Neither credentials nor
private instance seeds are printed, included in callbacks, or mounted in Docker.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path


def rpc(name, body):
    url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/rpc/" + name
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return request_json(url, body, {"apikey": key, "Authorization": "Bearer " + key})


def request_json(url, body, headers):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", **headers})
    with urllib.request.urlopen(req, timeout=25) as response:
        value = response.read()
        return json.loads(value) if value else None


def claim():
    submission_id = os.environ["SUBMISSION_ID"]
    grading_id = os.environ["GRADING_ID"]
    data = rpc("claim_grading", {"p_grading_id": grading_id, "p_submission_id": submission_id,
                                "p_runner_ref": runner_ref(), "p_legacy_ref": os.environ["GITHUB_SHA"]})
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        output.write(f"claimed={'true' if data else 'false'}\n")
        if not data:
            return  # Duplicate delivery does not own this attempt or callback.
        ref = data["config"]["grader_ref"]
        if len(ref) != 40 or any(c not in "0123456789abcdef" for c in ref):
            raise ValueError("Invalid frozen grader ref")
        output.write(f"grader_ref={ref}\n")
    target = Path("_grading_tmp")
    target.mkdir(exist_ok=True)
    source = data.pop("code_text")
    if hashlib.sha256(source.encode()).hexdigest() != data["code_hash"]:
        raise ValueError("Submission hash mismatch")
    (target / "submission.py").write_text(source, encoding="utf-8")
    (target / "context.json").write_text(json.dumps(data), encoding="utf-8")


def runner_ref():
    return f"run_{os.environ['GITHUB_RUN_ID']}_{os.environ.get('GITHUB_RUN_ATTEMPT', '1')}"


def callback():
    report_file = Path("_grading_tmp/report.json")
    report = json.loads(report_file.read_text()) if report_file.exists() else {}
    done = report.get("status") == "done" and isinstance(report.get("score"), int)
    body = {"submission_id": os.environ["SUBMISSION_ID"], "grading_id": os.environ["GRADING_ID"],
            "runner_ref": runner_ref(), "status": "done" if done else "system_error",
            "score": report["score"] if done else None, "passed": report.get("passed", False),
            "report": report, "error_message": None if done else "评测运行未完成，请检查系统任务"}
    raw = json.dumps(body, ensure_ascii=False).encode()
    sig = hmac.new(os.environ["GRADE_CALLBACK_SECRET"].encode(), raw, hashlib.sha256).hexdigest()
    # Retry identical signed bytes. The transactional endpoint is idempotent.
    url = os.environ["SUPABASE_URL"].rstrip("/") + "/functions/v1/grade-callback"
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, data=raw, method="POST", headers={
                "Content-Type": "application/json", "X-Grade-Signature": sig})
            with urllib.request.urlopen(req, timeout=25) as response:
                if response.status != 200:
                    raise RuntimeError("Callback rejected")
            print("Grade callback accepted")
            return
        except urllib.error.HTTPError as exc:
            if exc.code < 500 and exc.code != 429:
                raise RuntimeError(f"Callback rejected: HTTP {exc.code}") from None
        except (OSError, TimeoutError):
            pass
        if attempt < 3:
            time.sleep(2 ** attempt)
    raise RuntimeError("Callback unavailable after retries")


def drain():
    recovery = rpc("recover_grading_jobs", {})
    print("Recovery:", json.dumps(recovery))
    # One bounded batch per scheduled pass: concurrency is controlled by leases.
    for job in rpc("lease_grading_dispatches", {"p_limit": 25}) or []:
        failure = None
        try:
            request_json(f"https://api.github.com/repos/{os.environ['GITHUB_REPOSITORY']}/actions/workflows/grade-submission.yml/dispatches",
                         {"ref": "main", "inputs": {"submission_id": job["submission_id"],
                          "grading_id": job["grading_id"], "problem_id": job["problem_id"]}},
                         {"Authorization": "Bearer " + os.environ["GH_TOKEN"],
                          "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"})
        except (OSError, TimeoutError):
            failure = "Dispatch response unconfirmed; retry is safe"
        rpc("finish_grading_dispatch", {"p_grading_id": job["grading_id"],
                                       "p_lease_token": job["lease_token"], "p_error": failure})


if __name__ == "__main__":
    import sys
    {"claim": claim, "callback": callback, "drain": drain}[sys.argv[1]]()
