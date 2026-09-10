# Phase 0A implementation and evidence

Date: 2026-09-10. Scope: the owner-activated `ATOM_Next_Codex_Task_Phase_0A.md` only.

Starting revision: `master`, `e38627084617eed06e9198ebe3e2d5215eadbd41`. Application source was unchanged at the start. `PROJECT_STATE.md` and the four original files under `docs/audit/` already existed as untracked audit work; they were not discarded. The original audit remains historical evidence. No commit, push, deployment, dependency installation, schema migration, or real class-data operation was performed.

## Permission policy

| Operation | Positive authority | Denial / boundary |
|---|---|---|
| Faculty submission counts, rows, files, evaluation | Current faculty assignment, active student enrollment/placement, and the **submission's immutable release** intersect in the same group and offering | Offering membership, authorship and collaboration grants alone never grant grading access. Concrete query groups narrow that intersection; `all` unions it. `EXISTS` and distinct student counts prevent duplicate rows. |
| Student evidence files | Existing ownership check | A student still downloads their own historical file after enrollment becomes inactive. No new faculty restriction was applied to this student contract. |
| Current draft/material read and copy-source eligibility | Current assignment in the offering plus creator, explicit edit/publish collaborator, or a target group assigned to the actor | An unrelated offering member cannot read a hidden draft, its assets, or duplicate it. Same-scope shared drafts and explicit coauthor content access remain supported. |
| Evidence after private draft retargeting | Release-authorized current submissions remain available in lists/detail/evaluation | If current draft content is inaccessible, detail uses the latest qualifying immutable submission release, marks `evidenceOnly`, and omits current draft targets/collaborators/actions. Released files remain available; later private files and source duplication remain denied. This is a release reference view, not a claim that the current draft is published. |
| Edit content | Creator or `can_edit`, with current offering membership | Unchanged inherited targets permit a content-only edit. Changing targets requires authority over the complete old/new target union. |
| Publish | Creator or `can_publish` **and every draft destination assigned to the actor** | No implicit delegation and no silently dropped destinations. A collaborator outside a destination can edit content when granted but cannot publish there. |
| Unpublish | Publication-action grant and every destination of the **current released scope** | Checking one query group or mutable draft targets is insufficient. An already-unpublished activity returns 409. |
| Duplicate destinations | Explicit nonempty validated group set, all assigned; otherwise the complete inherited set, all assigned | Reject before copying. Copy starts as a draft, with no release or collaborators. Recheck actor/session, source contents/assets/targets and destination authority after copying; remove only this failed copy's files. |
| Organization | Existing edit grant for the selected activity and every sibling whose stored position would change | Moving a row cannot mutate another instructor's position without authority. Existing offering-level topic governance is unchanged. |

`InstructorAuthority` is the small reusable policy boundary. Roster denominators include currently eligible students in the active release scope (draft targets for never-released drafts), plus authorized current submitters on older releases, so retained evidence is not paired with a smaller unrelated roster. No submitted evidence is recalculated or deleted.

### Historical placement limitation — unresolved domain decision

The interim rule uses **current** assignments and active placements. Missing/inactive placement, a removed faculty assignment, an offering mismatch, or a release without the qualifying group denies faculty access. An A-only old release does not become B-readable merely because its mutable draft targets or student placement change to B.

However, when an old release targeted **both A and B**, a student who submitted in A and later transfers to B now satisfies B's current-placement intersection. The existing schema has no submission-time placement snapshot or reliable transfer history to distinguish that student from an original B member. The permanent test `records the unresolved shared-release transfer boundary without deleting history` explicitly demonstrates the newly available B file and revoked A access; it does **not** assert that historical broadening has been solved. Multiple current qualifying placements are treated as a union; their historical validity cannot be inferred either.

Before permitting transfer-sensitive deployment, the owner must choose whether new instructors inherit prior evidence or whether access needs prospective membership snapshots and a policy for preexisting ambiguous records. No historical memberships, delegation rules, or full transfer system were fabricated in this slice. Therefore A01 is **partially addressed overall**, although its reproduced disjoint-current-group disclosure/grading paths are fixed and tested. A02 and A03 are **fixed and verified within this slice**.

## Changes

| Files | Purpose |
|---|---|
| `server/src/instructor-authority.ts` | Actor-aware source, destination, submission and roster predicates. |
| `server/src/index.ts` | Apply predicates to lists/detail/download/evaluation, preflight response scopes before writes, protect released evidence from mutable draft scope, enforce publish/unpublish/copy targets and affected ordering siblings. Recheck upload edit authority after awaits. |
| `server/src/authority.test.ts` | 35 permanent isolated HTTP regressions and positive controls. |
| `server/test-fixtures/authority-server.mjs` | Owned test process with graceful Windows shutdown and deterministic copy/upload await barriers; no production test hooks. |
| `server/test-fixtures/run-smoke.mjs` | Run the unchanged existing HTTP smoke on a newly generated absolute disposable root. |
| `src/api.ts`, `src/types.ts` | Optional explicit duplicate destinations and evidence-only response flag. |
| `src/features/faculty/DuplicateActivityDialog.tsx`, `src/styles.css` | Shared destination confirmation, retained selections, inline denial, existing-theme spacing. |
| `src/features/subjects/AssessmentStream.tsx`, `ActivityDetailPage.tsx`, `src/features/faculty/FacultyWorkspace.tsx` | Connect duplicate confirmation at all three entry points; show release-only evidence appropriately; preserve view on rejection. |
| `src/features/authoring/ActivityAuthoring.tsx`, `src/features/faculty/EvaluationDialog.tsx` | Actual publish destinations/period and inline publication/evaluation errors with retained fields. |
| `PROJECT_STATE.md`, this report | Accepted scope, results, limitations and exactly three next tasks. |

## Before / after proof

The original 23-test HTTP suite ran against unchanged application source at the starting revision: **17 failed, 6 passed** (5.68 seconds). Each multi-assertion test stops at its first failure; that run does not independently establish later assertions in a failed test. The earlier audit supplies separate historical reproductions.

| Finding / test families in `authority.test.ts` | Observed before | Final result |
|---|---|---|
| A01: shared all/concrete counts/detail, foreign direct file/evaluation, lecture-only, coauthor without lab authority | Shared count 2 instead of 1; foreign download 200; authority controls failed | Pass; only qualifying actor evidence returned. Own-scope grading/download and two-lab union controls pass. |
| A02: evaluation forbidden/unknown response scope; publish/unpublish/organization invalid scope | Denial returned after academic tables changed | Pass; table/file snapshots unchanged on denial. Alternate duplicate query keys, mismatched period/offering and PATCH response scopes also pass. |
| A03: hidden source/asset/copy, inherited/explicit unauthorized destinations, creator/publish-coauthor destination rights | Hidden asset or copy succeeded; unauthorized inherited copy returned 201; foreign publish succeeded | Pass; authorized source-copy hashes preserved, explicit A-only copy succeeds, two-lab publication succeeds, edit-only publication fails. |
| Candidate review: mutable draft hides authorized evidence; ordering shifts an uneditable sibling | Added reproductions produced **2 failed / 31 passed** against the intermediate candidate | Both now pass; old released content remains reviewable without exposing later private content. |
| Await-boundary regressions | Added after initial repair | Copy assignment/source changes and revoked upload edit grant reject with operation-owned file cleanup and no additional academic mutation. |
| Historical shared-release transfer | Newly added explicit limitation probe | Pass documents current-placement behavior; **not a historical-isolation closure test**. |

Denial snapshots compare 17 academic tables, plus file paths and SHA-256 hashes. Auth session last-seen and security audit records are deliberately excluded from academic state; logging was not suppressed. Async tests preserve their deliberate concurrent source/grant change in the expected snapshot and assert that the rejected operation adds nothing. Source files, immutable releases, submission references/hashes and current-submission uniqueness are checked. Test actors include A-only, B-only, lecture-only, both-lab, edit-only, publish-granted and out-of-scope collaborators, plus two students sharing a lecture but in separate labs.

## Verification actually executed

- `npx.cmd vitest run server/src/authority.test.ts`: final **35/35 pass**, 3.29 seconds.
- `npm.cmd test`: final **11 files, 64/64 pass**, 5.00 seconds (10:21:47 local), including the tightened A-only hidden-sibling ordering control.
- `npm.cmd run build`: **pass**: frontend typecheck, Vite production build and server TypeScript compilation. Existing Vite chunk-size warning remains; the authoring chunk is approximately 689 kB before gzip. SQLite emitted its usual experimental warning during tests.
- `node server/test-fixtures/run-smoke.mjs`: **pass**. Executes the unchanged `server/smoke.mjs` used by `npm run smoke`: setup, progressive authoring, protected asset, rubric acknowledgment, publication, student part claim, strict validation, submission, account switch and evaluation. Uses the existing legitimate seeded faculty assignments; no actors were broadly reassigned to make smoke pass.
- `git diff --check`: pass (Windows line-ending notices only).

Each HTTP harness creates a fresh absolute root beneath the OS temporary directory and checks that `<root>/data` cannot be the repository data directory before opening it. No stress seed or application dev command was used. Fixture shutdown targets only its own child; no unrelated server was stopped. The first browser harness launch received closed stdin and exited; the interactive launch supplied the browser fixture. No real database was opened.

Cleanup exception: the browser process handle expired between goal turns; a current process inventory confirmed both the browser harness and its owned server absent. The residual synthetic root `C:\Users\neilj\AppData\Local\Temp\atom-phase0a-browser-fd7c7h` remains. Automatic approval review rejected its removal with `blocked by policy` and supplied no more specific reason; no alternate deletion method was attempted. It is outside the repository and is not a deliverable. Normal automated test/smoke fixture cleanup succeeded.

Rendered browser verification used the Codex browser tool at **http://localhost:60989**, default **855×698** and narrow **390×844**. Sign-in and actual activity stream/detail/editor routes worked. Duplicate confirmation named Midterm and both labs, retained both checked destinations after assignment-loss denial, and succeeded with an explicit authorized A-only choice. Publish confirmation retained an edited title, both groups and checked rubric acknowledgment after denial; restoring the synthetic assignment let the same request publish to both labs. Narrow duplicate rejection was screenshot-inspected with both buttons and error readable; DOM scroll width 375 at viewport width 390. Captured browser warning/error logs were empty. Temporary viewport override and QA tab were cleared. An initial screenshot call used an unsupported method; after reloading the browser API documentation, the supported screenshot method succeeded.

Browser checks cover these changed confirmation flows, not a comprehensive E2E suite or every evaluation dialog state. The evidence-only response/material path is HTTP-tested. Physical second client, clean-install build, LAN-origin A10 behavior, recovery fault tests and full Phase 0 acceptance were not rerun. Localhost results do not close A10.

## Remaining boundaries

No general “every HTTP error means no write” guarantee is claimed: unexpected connection/response failure after a successful commit remains distinct from deterministic authorization denial. Post-commit teaching-asset response failure retains the recorded file; cleanup only removes an unrecorded operation file. Pre-upload authentication/resource consumption (A05), concurrent submission retry (A09), topic/period consistency (A08), recovery durability, UUID support and stress-root repair remain deferred. Content sharing does not grant grading. A single actor lacking every affected group's assignment cannot publish/unpublish a shared activity; no delegation UI was introduced. Evaluation remains provisional; A07 is not fixed.

Phase 0A implementation is delivered with the explicit historical-policy exception above. **Phase 0 is not complete; no deployment-readiness claim is made.**
