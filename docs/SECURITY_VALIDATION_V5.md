# SCIP-OJ V5 · Teacher-attested exam identity

## Threat model

**GitHub OAuth proves control of a GitHub account, NOT the student's offline identity.** Students can self-type any student number, and an auto-matched `roster_pending.status='matched'` row is NOT independent verification. Browser paste/visibility counters cannot detect proxy test-taking.

## Mechanism

- Ordinary practice and standard formal assignments keep their existing entry requirements.
- Assignments with `integrity_policy=exam_warn` or `exam_block` now require a teacher-attested roster link **before** any submission is inserted.
- Teachers import a CSV of student number, display name, optional GitHub account, then check the real student's identity through approved offline/school channels and manually select **核验本人身份** for the matching row.
- Server-side `confirm_student_identity` requires current course teacher/admin role, a matched roster claim, a matching current student number, a student enrollment, and an attached GitHub OAuth identity.
- Verification is written to `roster_verifications` (no direct student table writes). It records verified account, course, roster row, actor and timestamp; students never set their own verified flag.
- Updates to roster's matched account, student number, name, configured GitHub login or matching status delete the prior attestation. The formal submission RPC rechecks that the recorded account and live claims still match.
- Students without an attestation receive HTTP 403 `IDENTITY_VERIFICATION_REQUIRED`. If the internal service query fails, the attempt fails closed with HTTP 503 **before any submission/grading record is inserted**. Error is surfaced in the student UI.

## Verified

GitHub Actions: Python/JS regressions and Docker/PySCIPOpt integration. Production migration 013 successfully applied, identity invalidation trigger present; online table ACLs confirm anonymous SELECT and authenticated INSERT on `roster_verifications` are denied, internal verification RPC not executable by authenticated students but allowed to service_role, and submit-assignment v8 ACTIVE.

## Critical limitations and follow-up

- The instructor must verify identity externally. Clicking the button without an independent check is insufficient. GitHub account ownership does not prove the student is physically at the keyboard.
- No test class with known instructor/student accounts was used for online end-to-end identity approval. Production had **zero** roster rows during the database inspection. Verify with a consenting test group before deploying a high-stakes assessment.
- If the course lacks a roster, exam mode now intentionally blocks students, including legitimate students, until records are imported, matched and confirmed. Inform students before scheduling.
- TEACHER/ADMIN actor authorization protects attestation, but a compromised teacher credential remains a threat. Introduce audit reporting, revocation UI, session/MFA protections, and appeals for contested identity.
- Code similarity checks remain heuristic and never automatically penalize.
