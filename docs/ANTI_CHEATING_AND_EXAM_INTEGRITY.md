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

## Security that is NOT provided yet (release blockers)

1. **Student execution sandbox**: current L2 still loads arbitrary student Python in the trusted scoring process on GitHub Actions. Use a separately sandboxed non-root process/container with no network or secrets and strict CPU/wall-time/memory constraints, with grading logic outside that sandbox. Until this is fixed, official exam results are not securely trustworthy.
2. **Server-private test sets**: predictable public `seed_base`, tiny datasets, and reuse of public L1/L2 tests allow adaptive overfitting. Formal L2 must draw undisclosed per-submission seeds/test suites.
3. **Callback integrity**: bind signed callback to a specific `grading_id`, runner/attempt and code digest, enforce state transition atomically and detect replays. Existing callbacks select latest queued/running row, which is ambiguous.
4. **Identity and fairness**: course enrollment/claimed student number alone does not prove identity. Teacher-verified roster identity plus clearly published assessment rules are needed.
5. **Operational controls**: submit throttling, grading cost limits, similarity review access controls, privacy/retention policy and fair accommodations; legitimate code reuse/AI guidance may be authorized depending on course policy.

These security gates matter more than visual similarity to any other online judge.
