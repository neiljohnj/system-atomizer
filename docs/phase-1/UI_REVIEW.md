# Phase 1 UI review

> Publication follow-up, 2026-10-02: after this implementation/verification snapshot, the owner authorized committing and pushing all Phase 1 changes without rerunning tests. References below to uncommitted work or no push describe the original bounded turn. No deployment or real-data upgrade was authorized or performed.

Date: 2026-10-02. Local uncommitted `phase-1` candidate based on `1df70751504a56ab961f787923c7b20ea61d65f6`. Synthetic accounts/data only. The rendered setup acceptance journey passes; this is not a visual certification of every older activity/editor surface.

## Findings and disposition

| Finding | Evidence / disposition |
|---|---|
| Existing activity-document headings overlap the submission panel at 390px | `08-student-submission-mobile.png`: Activity overview / Requirements / Submission notes intrude into the upload area. Upload and receipt succeeded. The older activity detail/document layout was not redesigned in this bounded setup task. |
| Existing connection banner displays a static address | The header's displayed address is not the actual dynamic test origin. No new connection-status behavior was introduced; do not interpret it as network verification. |
| New select labels initially included option text | Added explicit concise accessible labels; the same exact-label interaction now passes. |
| Setup username HTML pattern produced a modern-browser regex error | Escaped the hyphen in the HTML pattern; final console is clean. Server validation remains unchanged. |
| Harness route/screenshot timing | Waited for confirmed sign-in and pending route completion. Enlarged-layout capture now uses an independent 720 CSS-pixel, 2x-scale context instead of CSS zoom or conflicting viewport overrides. |

## Environment and interaction loop

Browser plugin not available. The testing skill's fallback used existing Playwright 1.62.1 / Chromium 151.0.7922.34; no app/browser dependency was added. The compiled app served `/setup`, `/course-setup/:id` and `/subjects/:id/activities` from its owned loopback port and, for authoring/submission, the host's actual LAN HTTP address. The title was `ATOM · Local academic workspace`.

The flow under test was: fresh host-local owner → **Set up course** → new course/term/offering → distinct instructor hand-offs → groups/map → manual/pasted roster preview/apply → Review/ready → existing Activities → instructor publication on LAN HTTP → student activation/mobile upload → permanently locked setup.

Desktop was 1440×1000; mobile was 390×844. The 200% equivalent reflow check used 720×500 CSS pixels at device scale 2 and verified no page overflow with stacked setup content. Native browser-chrome zoom and assistive-technology testing were not automated. The narrow roster intentionally scrolls inside its table wrapper instead of squeezing five columns or using student cards.

## Screen and state inventory

| Screen/state | Concrete proof |
|---|---|
| Fresh owner | Empty installation reaches `/setup`; real owner creation reaches Your subjects and exposes Set up course. No renamed demo or sample class. |
| Course & term | Create course and term, select saved choices, enter offering identity/required components, save draft and advance after success. Saved offerings can be resumed. |
| Teaching groups | Lecture L, Lab A and Lab B each have a different instructor. Ordinary checkbox/select controls express assignments and links. Live map uses the same objects without inferred rights or placements. |
| Failed save | One intentional HTTP 503 shows an inline error and retains three group rows/selections; no false navigation. Retry after removing the fault advances. |
| Manual roster | Preview/cancel leaves saved count zero. A separate manual row applies and gives a saved count of one. Leading zeros remain visible. |
| Pasted roster | Duplicate number produces a row issue and no Apply action. Remove duplicate, re-preview, then Apply gives two saved students. |
| Private hand-off | Separate dialog with masked secret, reveal/discard, expiry and recipient verification. Table shows not issued/unclaimed instead of invented completed activation. Screenshots reveal no password. |
| Mobile Students/Review | Stages wrap, inputs stack, buttons remain reachable, map stacks below summary. Table scroll is contained. Review shows actual counts/instructors and permanent-lock warning. |
| Ready / manager-only handoff | Ready succeeds before student activation. Owner without instructional assignment sees operational guidance, not student evidence/editor. |
| Delayed old-account response | Hold owner setup response, sign out, activate a different faculty, then release old response: no old roster or unauthorized setup entry appears. |
| LAN authoring / submission | New browser-safe identifiers, authoring save and publication succeed via host LAN HTTP. Student completes forced change, uploads and sees a receipt at 390px. |
| Locked setup | Returning owner sees the dated reason and disabled group/membership controls after publication; protected API tests independently prove rejection. |

## Checks and privacy

| Check | Result |
|---|---|
| Page identity / meaningful content | PASS: correct routes/title, actual saved data, no empty shell |
| Framework overlay | PASS: none observed |
| Console/runtime | PASS: zero unexpected page/console errors and zero warnings; injected save HTTP 503 expected |
| Interaction proof | PASS: API-backed setup, roster, activation, ready, publication and upload |
| Desktop/mobile setup | PASS: staged forms, retained edits, stacked map, contained table scroll; older submission-layout defect above remains |
| Enlarged setup layout | PASS for 720px/2x equivalent reflow; native browser zoom not separately tested |
| Labels/focus/touch | Native labeled controls, visible focus styles, stage-heading focus, textual save/lock/error states and 44px setup control targets. Radix handoff reuses modal behavior. No screen-reader audit claim. |
| Privacy | No unauthorized entry or stale configuration after switch; no setup/roster/activation keys in local/session storage; no-store responses; no credential material in ordinary roster/detail payloads |
| Context | Account/offering keys reset scoped state; setup entry retains workspace path/query for Back; normal group/period module routing remains. Full cross-module permutation testing is not claimed. |

Stages express saved configuration, not a fictional percentage. Saved state is distinct from the unsaved review table. Canceling preview writes nothing; previous explicit saves remain drafts. A single main advance/apply action is used per stage, with a focused credential dialog. Saved-roster search/sort and row actions use a table. No syllabus, gradebook or exam setup controls were added.

Pasted rows and activation secrets are not persisted across a lost tab. Close/discard removes handoff state; lost activation requires reissue. Recipient verification remains an operator obligation.

## Evidence inventory

Outside-Git evidence directory: `C:\Users\User\.codex\visualizations\2026\10\02\01a0fb33-c0cc-79f3-9fe9-3db07dbfcc46\phase-1-ui`.

| File | State |
|---|---|
| `01-teaching-groups-desktop.png` | Three distinct instructors and live map |
| `02-save-failure-retains-edits.png` | Expected failure, retained group edits |
| `03-roster-preview-desktop.png` | Corrected paste plan, saved roster, separate hand-off |
| `04-roster-mobile.png` | 390px Students stage and contained table |
| `05-review-mobile.png` | Mobile summary, stacked map, fixed-roster warning |
| `06-review-200-percent.png` | 720 CSS-pixel / 2x-scale reflow |
| `07-lan-published-activity.png` | New activity published via actual LAN origin |
| `08-student-submission-mobile.png` | Student receipt plus documented older layout defect |
| `09-locked-setup.png` | Permanent lock and disabled staff/group controls |
| `browser-results.json` | Sanitized passing run metadata, no credentials |

Reproduce: `npm.cmd run build`, set `ATOM_PLAYWRIGHT_MODULE` to an existing installed module and `ATOM_UI_EVIDENCE` to an absolute external directory, then `node server/test-fixtures/browser-phase1.mjs`. The harness owns its fresh data, port, browser contexts and shutdown. Screenshots are local evidence paths, not portable hosted assets. Early-debugging `failure.png` is not final acceptance evidence.

No physical second-client/firewall/TLS check, Firefox/Safari run, screen-reader audit, 200-row mobile performance benchmark or institutional deployment occurred. Functional upload success does not erase the older layout problem. Installing the Browser plugin could improve later in-app frontend inspection; it is optional and was not installed here.

## Selected screenshots

Desktop teaching setup, followed by mobile review. All displayed identities are synthetic.

![Desktop teaching groups and map](C:/Users/User/.codex/visualizations/2026/10/02/01a0fb33-c0cc-79f3-9fe9-3db07dbfcc46/phase-1-ui/01-teaching-groups-desktop.png)
![Mobile setup review](C:/Users/User/.codex/visualizations/2026/10/02/01a0fb33-c0cc-79f3-9fe9-3db07dbfcc46/phase-1-ui/05-review-mobile.png)
