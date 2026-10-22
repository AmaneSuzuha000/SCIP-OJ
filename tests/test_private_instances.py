"""Deterministic checks of formally hidden generators and their exact oracles."""
import itertools
import unittest
from judge.private_instances import private_knapsack, private_assignment


class PrivateInstanceTests(unittest.TestCase):
    def test_knapsack_larger_than_public_examples_and_exact_dp(self):
        for seed in range(12):
            inst = private_knapsack(seed)
            self.assertGreaterEqual(inst["n"], 16)
            self.assertLessEqual(inst["n"], 30)
            self.assertEqual(len(inst["values"]), inst["n"])
            capacity = inst["capacity"]
            dp = [0] * (capacity + 1)
            for w, v in zip(inst["weights"], inst["values"]):
                for c in range(capacity, w - 1, -1):
                    dp[c] = max(dp[c], dp[c - w] + v)
            self.assertEqual(dp[capacity], inst["optimal_value"])

    def test_assignment_larger_than_public_and_exact_oracle(self):
        examples = [private_assignment(seed) for seed in range(10)]
        self.assertTrue(all(6 <= inst["n"] <= 9 for inst in examples))
        smallest = next(i for i in examples if i["n"] == min(e["n"] for e in examples))
        n, costs = smallest["n"], smallest["costs"]
        oracle = min(sum(costs[i][perm[i]] for i in range(n))
                     for perm in itertools.permutations(range(n)))
        self.assertEqual(float(oracle), smallest["optimal_value"])

    def test_seed_changes_instances(self):
        a = private_knapsack(1)
        b = private_knapsack(2)
        self.assertNotEqual(a["weights"], b["weights"])
        a = private_assignment(1)
        b = private_assignment(2)
        self.assertNotEqual(a["costs"], b["costs"])


if __name__ == "__main__":
    unittest.main()
