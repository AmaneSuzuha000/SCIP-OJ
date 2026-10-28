import assert from 'node:assert/strict';
import { tokenizePython, computeGrams, computeCandidates } from '../site/src/teacher/similarity.js';

// Test 1: Exact code different students flagged
{
  const code = "def solve(x):\n    return x * 2\n";
  const rows = [
    { id: "s1", user_id: "u1", assignment_id: "a1", code_text: code },
    { id: "s2", user_id: "u2", assignment_id: "a1", code_text: code },
  ];
  const flags = computeCandidates(rows);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].same_code_sha256, true);
  assert.equal(flags[0].review_status, "manual_review_only");
}

// Test 2: Different assignment or same student ignored
{
  const code = "def solve(x):\n    return x * 2\n";
  const rows = [
    { id: "s1", user_id: "u1", assignment_id: "a1", code_text: code },
    { id: "s2", user_id: "u1", assignment_id: "a1", code_text: code },
    { id: "s3", user_id: "u2", assignment_id: "a2", code_text: code },
  ];
  const flags = computeCandidates(rows);
  assert.equal(flags.length, 0);
}

// Test 3: Identifier changes are normalized
{
  const left = "def solve(item):\n    total = 0\n    for value in item:\n        if value > 2:\n            total += value\n    return total\n";
  const right = "def solve(data):\n    answer = 0\n    for num in data:\n        if num > 2:\n            answer += num\n    return answer\n";
  const tokLeft = tokenizePython(left);
  const tokRight = tokenizePython(right);
  assert.deepEqual(tokLeft, tokRight);
  const rows = [
    { id: "s1", user_id: "u1", assignment_id: "a1", code_text: left },
    { id: "s2", user_id: "u2", assignment_id: "a1", code_text: right },
  ];
  const flags = computeCandidates(rows);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].normalized_token_7gram_jaccard, 1.0);
}

// Test 4: Short common starter not used as similarity proof
{
  const left = "def solve(instance):\n    return None\n";
  const right = "def solve(data):\n    return 1\n";
  const rows = [
    { id: "s1", user_id: "u1", assignment_id: "a1", code_text: left },
    { id: "s2", user_id: "u2", assignment_id: "a1", code_text: right },
  ];
  assert.equal(computeCandidates(rows).length, 0);
}

console.log("similarity.js: token normalization and candidate matching tests passed");
