# SCIP-OJ Academic Integrity & Exam Threat Model

## Principles

SCIP-OJ supports independent learning and course assessment. **Copy/paste blocking, focus-change counters and code similarity are never proof of misconduct.** Plain websites cannot prevent browser developer tools, automation, screen capture, retyping, AI assistance, alternate devices, or sharing over other channels. No browser-only policy can guarantee authorship.

## Assessment modes

| Assignment `integrity_policy` | Clipboard / drag in code editor | Signals | Intended use |
| --- | --- | --- | --- |
| `standard` (default) | Permitted | No exam behavior signals | Ordinary exercises |
| `exam_warn` | Permitted, with user-visible warning | Limited browser-declared counts | Open-resource exercises requiring review |
| `exam_block` | UI **attempts** to block paste/copy/cut/drop | Limited browser-declared counts | Controlled in-class assessments |

A teacher configures this mode on the course assignment. Backend migration `009_assignment_integrity_policy.sql` and updated `publish-assignment` and `submit-assignment` Edge Functions **must be deployed**. A failed policy save MUST prevent activation of an exam mode; never imply it is active when the backend is missing.

## What is actually recorded

The server already computes and stores SHA-256 of the submitted source code, the authenticated user, assignment, and server-controlled submission timestamp. In exam mode, `submissions.metadata.integrity` additionally contains the assignment's **server-read policy**, server receipt timestamp, and **client-reported** bounded counts: editor changes, paste/copy/drop attempts, blocked paste attempts, and document hidden events. It does **not** collect clipboard contents, raw keystrokes, browser history, screenshots, audio, or video.

These counts can be spoofed, reset or bypassed. Visibility changes can occur from accessibility aids, permission prompts, notifications and legitimate reference material. Do not rank or automatically penalize learners based on them.

## Code similarity

`platform/scripts/audit_similarity.py` is a local, teacher-run, standard-library CLI for preliminary pairwise reviews within the same assignment. It normalizes identifiers/literals, compares seven-token fingerprints, excludes supplied starter-template fingerprints, and identifies exact source hashes. Results contain only submission identifiers and similarity scores—not the source code. Default threshold 0.72 is heuristic, not a misconduct probability.

Example, after a teacher-authorized export of submissions:

```bash
python platform/scripts/audit_similarity.py submissions.json \
  --template problems/P001_knapsack/template.py --threshold 0.72
```

**Manual review checklist**: remove common template/algorithm conventions; inspect both solutions and chronological submissions; ask students to explain modeling choices in a fair, consistent procedure; apply the course's published collaboration/AI policy; allow appeals. Never auto-fail or publicly accuse based on a similarity score.

## Formal L2 grading protection now implemented

- Formal `grade-submission.yml` builds a pinned non-root PySCIPOpt image, runs one public instance per **network-disabled, read-only** Docker execution with CPU, memory, process and wall-time limits. Private optimal values and scoring code are kept in a separate trusted host process.
- Formal L2 generates unpredictable server-side seeds, independent from browser practice seeds. Each assignment's pass-score and instance count come from a trusted Supabase row.
- Each Actions dispatch binds an explicit `grading_id` and its `runner_ref` to a signed callback, rather than updating the latest queued row.
- CI includes actual Docker execution of both available starter solutions. The retired PR grader should never run untrusted Python in the trusted process.

These protections reduce tampering and grading leakage substantially, **but they are not an independent penetration test or a mathematical proof of isolation**. Docker shares a kernel with the host, and an attacker may exploit implementation bugs. Use disposable workers without unrelated secrets, patch the runner image, and monitor for suspicious behavior.

## Remaining risks / release decisions

1. **Question depth and grading rigor**: P001/P002 formal instances are very small; the private seed prevents simple hardcoding of public instance values but is not enough to ensure a student actually builds a MIP or generalizes to large instances. Add harder hidden distributions and boundary tests per question.
2. **Identity/fairness**: a self-entered student number and course membership do not independently establish the student's identity. Verify student-to-roster ownership, publish permitted collaboration/AI assistance, offer accommodations and a fair appeals process.
3. **Infrastructure hardening**: Docker resource limits and no-network mode are defense in depth; perform adversarial testing (infinite loops, fork bombs, import manipulation, I/O and output floods), dependency version pinning, operational monitoring and cost/rate limits.
4. **Integrity telemetry**: browser counts can be spoofed. Similarity signals must be confidential, accompanied by human review and never automatically penalized.
5. **Score versioning**: historic grades under the older 90-point maximum are not directly comparable with the corrected 100-point rubric; establish a controlled rescore policy.

A GitHub Pages deployment does not automatically deploy Supabase migrations or Edge Functions. Check each layer's deployed version before conducting formal assessments.
