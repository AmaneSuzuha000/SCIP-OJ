"""Cross-language and adversarial checks of the IE-DES-01 lab evidence protocol."""
import copy
import json
import math
import subprocess
import unittest

from judge.ie_des01_reference import (
    VerificationError, reference_simulate, verify_document, workload,
)


class IEDES01ReferenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        script = r"""
const core = require("./site/js/simulation-core.js");
const params = {
  arrivalMean: 8, serviceMean: 12, serversA: 2, serversB: 3,
  horizon: 480, warmup: 60, replications: 30, seed: 20261023
};
const result = core.compare(params);
const report = {
  schemaVersion: "ie-des01-experiment/1", caseId: "IE-DES-01",
  params: result.params, summary: {
    baseline: result.baseline, alternative: result.alternative,
    waitDiffCI: result.waitDiffCI
  }, runs: result.runs
};
process.stdout.write(JSON.stringify(report));
"""
        process = subprocess.run(
            ["node", "-e", script], check=True, capture_output=True, text=True
        )
        cls.document = json.loads(process.stdout)

    def test_real_browser_manifest_independently_replays(self):
        result = verify_document(self.document)
        self.assertEqual(result["status"], "VERIFIED_REPLAY")
        self.assertEqual(result["replications"], 30)

    def test_per_run_wait_tampering_is_rejected(self):
        forged = copy.deepcopy(self.document)
        forged["runs"][6]["resultB"]["avgWait"] += 1
        with self.assertRaisesRegex(VerificationError, "avgWait"):
            verify_document(forged)

    def test_seed_tampering_is_rejected(self):
        forged = copy.deepcopy(self.document)
        forged["runs"][0]["seed"] += 1
        with self.assertRaisesRegex(VerificationError, "seed mismatch"):
            verify_document(forged)

    def test_summary_and_interval_tampering_is_rejected(self):
        for group, field in (("baseline", "throughput"), ("waitDiffCI", "low")):
            with self.subTest(group=group):
                forged = copy.deepcopy(self.document)
                forged["summary"][group][field] += 1
                with self.assertRaises(VerificationError):
                    verify_document(forged)

    def test_truncated_replicates_rejected(self):
        forged = copy.deepcopy(self.document)
        forged["runs"].pop()
        with self.assertRaisesRegex(VerificationError, "exactly"):
            verify_document(forged)

    def test_same_policy_runs_have_zero_paired_difference(self):
        script = r"""
const c=require("./site/js/simulation-core.js");
const p={arrivalMean:8,serviceMean:12,serversA:2,serversB:2,
  horizon:480,warmup:60,replications:5,seed:999};
const r=c.compare(p);
process.stdout.write(JSON.stringify({
  schemaVersion:"ie-des01-experiment/1",caseId:"IE-DES-01",params:r.params,
  summary:{baseline:r.baseline,alternative:r.alternative,waitDiffCI:r.waitDiffCI},
  runs:r.runs
}));
"""
        result = subprocess.run(["node", "-e", script], check=True, capture_output=True, text=True)
        document = json.loads(result.stdout)
        self.assertTrue(all(run["waitDifference"] == 0 for run in document["runs"]))
        self.assertEqual(verify_document(document)["status"], "VERIFIED_REPLAY")

    def test_three_job_hand_calculated_oracle(self):
        jobs = [(0, 2), (0.5, 2), (1, 1)]
        one = reference_simulate(jobs, 1, 0, 6)
        two = reference_simulate(jobs, 2, 0, 6)
        self.assertAlmostEqual(one["avgWait"], 1.5)
        self.assertAlmostEqual(two["avgWait"], 1 / 3)
        self.assertAlmostEqual(one["meanQueue"], 0.75)
        self.assertAlmostEqual(two["meanQueue"], 1 / 6)
        self.assertAlmostEqual(one["utilization"], 5 / 6)
        self.assertAlmostEqual(two["utilization"], 5 / 12)
        self.assertEqual(one["completions"], two["completions"])

    def test_boundary_warmup_and_no_steady_state_promise(self):
        params = {
            "arrivalMean": 1, "serviceMean": 180, "serversA": 1,
            "serversB": 2, "horizon": 120, "warmup": 119,
            "replications": 5, "seed": 1234,
        }
        events = workload(params, params["seed"])
        result = reference_simulate(events, 1, 119, 120)
        self.assertTrue(math.isfinite(result["avgWait"]))
        self.assertTrue(0 <= result["utilization"] <= 1)
        self.assertTrue(result["meanWip"] >= result["meanQueue"])
        # Finite-horizon metrics are well-defined even when rho >= 1.
        self.assertGreaterEqual(params["serviceMean"] / params["arrivalMean"], 1)


if __name__ == "__main__":
    unittest.main()
