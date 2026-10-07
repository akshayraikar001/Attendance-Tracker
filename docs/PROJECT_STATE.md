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
