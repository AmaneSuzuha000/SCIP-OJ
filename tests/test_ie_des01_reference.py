"""Checks that the IE-DES-01 grading oracle agrees with hand calculation.

The lab page and the JSON replay protocol it fed are gone, so the tamper
-detection tests that used to live here have no subject. What remains is the
part that still decides a grade: reference_simulate() is what a student's
implementation is scored against, so it is pinned to the three-job example
printed in the course handbook and to the finite-horizon boundary case.
"""
import math
import unittest

from judge.ie_des01_reference import reference_simulate, workload


class IEDES01ReferenceTests(unittest.TestCase):
    def test_three_job_hand_calculated_oracle(self):
        # The exact numbers in section 2 of the IE-DES-01 handbook. If the
        # oracle drifts from them, the handbook and the grader disagree.
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

    def test_workload_is_reproducible_from_the_seed(self):
        params = {
            "arrivalMean": 8, "serviceMean": 12, "serversA": 2,
            "serversB": 3, "horizon": 480, "warmup": 60,
            "replications": 30, "seed": 20261023,
        }
        self.assertEqual(workload(params, params["seed"]), workload(params, params["seed"]))
        self.assertNotEqual(workload(params, 1), workload(params, 2))


if __name__ == "__main__":
    unittest.main()
