# Dayline checkpoint — 7 October 2026

This file records the state requested by the user. Read it before continuing work.

## Repository state
- Workspace: `/root/projects/Attendance-Tracker`
- Branch: `Feature/Whatsapp-Integration`
- Base commit: `328b1c358f95854dca609d33327e287a7b2ad303`
- Current implementation is saved on disk but **not committed or stashed**.
- Source archive and tracked-file patch: `.local/checkpoints/20261007T103829Z/`.
- The archive contains project source, including new untracked source files. It excludes ignored files, dependencies, builds, database data, `.env` and WhatsApp credentials/sessions. It is not a database backup.

## Completed behavior
- Separate WhatsApp and Leave Approval modules share the existing Chatery device, selected group and sync loop.
- Leave collection is opt-in; approval is always manual. Existing attendance requires explicit overwrite. Leave/half-day parsing supports the examples previously supplied, with uncertain messages held for review.
- Group switching remembers each device/group's original import boundary. Existing advanced cutoffs recover from saved message history. Message IDs remain deduplicated; approval settings still apply.
- Joined `Intime` and `Outtime` labels are supported, including case/spacing variations and dot-separated times. The previously missed 09:36 In time was recovered and verified live.
- Reset attendance: choose employees and a date range, preview, then reset. Clears saved attendance and notes to the normal Unmarked/Holiday state. A changed record invalidates the preview. Other employee/date records remain intact.
- Automatic Out time is enabled by default: after 8 PM in the attendance timezone, open day shifts get 7:05 PM with a short note. Only entries with an In time and missing Out time qualify. Existing Out times, direct statuses, inactive employees, overnight shifts and In times at/after 7:05 PM are excluded.
- Automatic Out time runs on server startup and every minute. Activation boundary prevents changing pre-upgrade history; overdue entries since activation catch up on reopening. A ledger prevents reapplying an automatic time after it is deliberately cleared. Requires the backend to be running to execute.
- Attendance timezone defaults to the configured WhatsApp timezone, otherwise Asia/Kolkata, and is configurable under Settings → Timings. The live activation date was verified as 2026-10-07; break deduction was off.
- Optional one-hour break deduction is off by default. When enabled, worked minutes are max(0, elapsed minus 60); status and overtime use the reduced duration. Attendance and daily reports show the deduction explanation.
- Recurring weekday shift overrides exist at workspace, department and individual scope. Matching individual weekday overrides take priority over department/workspace weekday overrides; otherwise normal shifts apply. Hour thresholds remain separately configured. Manual entry, WhatsApp and historical recalculation use the attendance date.
- Calendar cells show marked absentee names. The separate three-dot button opens status counts and an absentee list. Unmarked remains separate. Preview supports close, Escape and keyboard focus handling.
- Activity log has readable before/after details, employee/action search, event-date/action filters, refresh and 25-row pages within the latest 500 events. It no longer shows raw JSON or an unrelated attendance-export action.
- Leave notes now say “Leave approved via WhatsApp” or “Half day approved via WhatsApp”. Historical request hashes are cleaned in attendance API responses without changing historical database rows.
- Attendance details uses one Day selector and filters its rows, totals and export accordingly. Employee summary retains date ranges.

## Relevant implementation

See [ARCHITECTURE.md](ARCHITECTURE.md) for the current complete file map. Key locations:

- `server/src/services/rules.js`: weekday resolution and optional break calculations.
- `server/src/services/auto-clockout.js`: automatic Out time and idempotency.
- `server/src/database/setup.js`: idempotent schema upgrades.
- `server/src/controllers/workspace.js`: attendance/settings endpoints and note cleanup.
- `server/src/services/whatsapp.js`, `utils/whatsapp-parser.js`: sync and attendance parsing.
- `server/src/controllers/leave.js`, `services/leave.js`, `utils/leave-parser.js`: leave workflow.
- `server/src/controllers/admin.js`: bulk absence and preview-protected reset.
- `client/src/pages/`: feature screens; `layouts/WorkspaceLayout.jsx` coordinates editing and refresh.
- `shared/attendance-notes.js`: historical leave-note cleanup.

## Verification completed
- 37 Node unit tests passed.
- `test:automation`, `test:admin`, `test:whatsapp`, `test:leave`, `test:auth`, `test:export` passed using isolated data.
- Updated main UI tests passed: reset, break toggle, weekday shifts, calendar preview, day-only details, searchable activity and earlier flows.
- Attendance editor regression passed in both 12-hour and 24-hour formats, including three-dot edit, add/save/reopen, time clearing, validation retry and employee editing.
- Production build passed; existing large ExcelJS chunk warning remains.
- Chromium checks passed at 1440px and 390px, using mocked APIs: calendar preview, timing controls, day-only report, break display and activity log. Screenshots and logs are under `.local/`.
- Live read-only checks through the Vite proxy confirmed settings, timezone, activation date, break-off state and presence of the automatic-Out-time ledger.
- No live attendance was created for testing the new scheduled feature; the 8 PM boundary was tested with a controlled clock in an isolated database.

## User preferences and remaining context
- Preserve existing WhatsApp sync, approval/overwrite behavior, attendance editing and saved data.
- User wants concise explanations and a simple interface; do not add unrelated modules or request repeated approval.
- Requested clarification confirmed: auto Out time applies only when In time exists and Out time is missing; day-specific shifts repeat by weekday.
- No commit/push was requested in this checkpoint action. Do not discard the existing working tree.
- Earlier review concerns were deferred (e.g. clearing WhatsApp message history can remove deduplication protection; automatic imports may require refreshing an already-open attendance screen). Do not claim these were comprehensively fixed by the current changes.
- Latest informational question was answered: React 18 + Vite + JavaScript/plain CSS; Node.js/Express; MySQL/MariaDB; Chatery WhatsApp integration; Zod, ExcelJS, Lucide, Node test runner and React Testing Library/jsdom.

## Structure update — 7 October 2026

The current source follows the eFlexo reference projects' separation of pages, layouts, shared components, configuration, controllers, services and database setup. See [ARCHITECTURE.md](ARCHITECTURE.md) for the current file map and the root README for portable setup. The earlier archive remains a pre-restructure checkpoint. No application data, environment secrets or device credentials were moved. WhatsApp fetching and leave collection now live under `server/src/services/`, with HTTP handlers under `server/src/controllers/`.

Structure validation passed: all 37 unit tests; attendance/auth/WhatsApp/leave/time-picker UI suites; admin/auth/holiday/WhatsApp/leave/automatic-Out-time database suites; workbook exports; production build; desktop/mobile browser checks for settings, calendar, reports, WhatsApp panel spacing and collapsed navigation. Live read-only API checks and built-frontend serving also passed. The existing ExcelJS bundle-size warning remains. No commit or push was made.

## Attendance updates — 15 October 2026

- Pending leave requests with missing dates are re-parsed on listing using their original timestamp and configured timezone. Today/tomorrow spellings, consecutive relative dates and comma-separated consecutive dates fill both review inputs; nonconsecutive dates remain for manual review. Decided requests are unchanged.
- BulkAttendance replaces the BulkAbsence screen and supports Present, Absent, Half day and Attended as direct statuses. Preview tokens include the chosen status; reset and overwrite protection remain. The old bulk-absence API is retained as an Absent-only compatibility route.
- Monthly reports and Excel include Daily working avg: total recorded minutes divided by Present + Half-day count. Zero qualifying days returns no average.
- Optional auto absence is off by default. Completed local days since activation are checked on startup/every minute; holidays, saved attendance, inactive employees and pre-employment dates are skipped, and overnight shifts wait until finished. A persistent ledger/cursor preserves deliberate clearing and catches up in 31-day batches. Re-enabling starts from the new activation day. Untouched system absences can be replaced by valid WhatsApp IN according to approval settings; manually modified entries retain overwrite protection.
- `npm run db:setup` applied the `auto_absences` table locally; automatic absence remains disabled in the workspace.
- Verification: 46 unit tests; admin, leave, WhatsApp, automation and export suites; main UI, 12/24-hour editor and leave UI regressions; production build; browser checks at 1440px and 390px. Live read-only settings/leave endpoints returned successfully. Existing unrelated working-tree changes were preserved; no commit was made.

## WhatsApp history and automatic attendance safeguards — 15 October 2026

- Clear archives messages for the selected device/group using `whatsapp_events.clearedAt`; deduplication and attendance are retained. Show cleared history lists the latest 100 archived messages. This resolves the earlier clear/deduplication concern above for newly cleared messages.
- Automatic WhatsApp processing, including queued retries and overwrite, may modify only today/yesterday in the group timezone. Older attendance dates remain for manual approval, including overnight OUT messages that belong to an older IN date. Explicit manual approval/overwrite remains available.
- Automatic Out time now has configurable cutoff, assigned Out time and restart catch-up toggle in Settings → Timings. Defaults remain 20:00, 19:05 and catch-up on. This separate scheduled fallback retains its activation boundary and existing/manual/overnight protections.
- Regression coverage includes the automatic retry path, local midnight, older manual overwrite, archive deduplication, adjustable cutoff boundaries, UI history switching and saving time controls.

## Preserved times and daily WhatsApp controls — 22 October 2026

- Individual direct-status edits preserve omitted saved times; explicit empty/null fields clear only the requested time. Measured hours are calculated from retained times while the chosen direct status stays authoritative. Existing manual entries without times no longer receive a default In time merely by opening the editor.
- Bulk status replacement and approved leave retain existing In/Out times and measured values. Confirmation text explains preservation. Reset still removes the selected attendance entries.
- WhatsApp lists complete day counts in the selected group timezone, with today expanded and older dates collapsed. Per-day message pages load 100 at a time. Day checkboxes support scoped bulk sync/clear; clearing archives the entire selected day, including unloaded pages, without touching attendance or deduplication.
- Sync today/date/selected days and all history use the existing persisted batch/cursor workflow. Selected dates filter both attendance and leave collection and do not advance the ordinary incremental checkpoint. Active jobs must finish before another selection starts. Existing approval, source boundary and today/yesterday safeguards remain.
- Sync health uses a red/green indicator and explicit paused/disconnected/failed/in-progress/ready/completed text.
- Validation: 48 unit tests; admin, WhatsApp, leave, automation and workbook integration checks; WhatsApp controls, both attendance-editor time formats and main UI checks; production build; 1440px and 390px browser checks. The existing ExcelJS bundle-size warning remains. No commit or push was made.

## Deferred review findings — 25 October 2026

User asked to remember these and remind them later. Bring up outstanding items at the next commit-readiness/release review or before client handoff. They do not prevent a checkpoint commit; they are not fixed yet. No timed notification is scheduled.

- [ ] **Attendance editor (medium):** On a new entry, enter a time in Direct status, switch to In / out time, then back. The entered time is cleared. Reproduced in an additional UI check. In `client/src/layouts/WorkspaceLayout.jsx`, mark direct-status time edits as user-entered (`timeTouched`) so mode changes preserve them.
- [ ] **Leave suggestions (medium):** `Leave today or tomorrow` incorrectly suggests both dates. `Leave on Friday in November`, sent 25 October 2026, incorrectly suggests 23 October. In `server/src/utils/leave-parser.js`, require manual date selection for alternatives and conflicting month references while preserving clear consecutive-date/current-week requests. Approval remains manual.
- [ ] **Chatery setup (medium):** README pins an upstream version without sender recovery but omits the patch step. Include/link `docs/WHATSAPP_SENDER_RECOVERY.md` and `docs/chatery-sender-recovery.patch` in the main setup instructions, or pin a verified version containing the fix.
- [ ] **Dependencies:** Production audit reported high-severity advisories for installed `body-parser` 1.20.8 and `zod` 3.25.76. Recheck advisories, update carefully and rerun regression tests before public deployment. The proposed Zod fix was a major-version update; do not apply blindly. Exploitability against Dayline was not confirmed.

Review checks passed: 51 unit tests; auth/admin/WhatsApp/leave/automation/export/holiday suites; main UI and 12/24-hour attendance editor; auth/time-picker/WhatsApp/leave/employee/users/locations/time-away UI suites; production build and Git whitespace checks. The additional editor reproduction failed, confirming the first finding. Secret-signature scanning found no matches. Live WhatsApp delivery/QR, Keycloak and external map providers were not verified end to end. Logs are under ignored `.local/review/`. No application-code fixes or commit were made during the review.
