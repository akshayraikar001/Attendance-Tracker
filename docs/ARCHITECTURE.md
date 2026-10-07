# Project structure

Dayline uses the page/component/service separation of `eflexo-new-ui` and the configuration/controller/service/database separation of `eflexo`. It keeps its existing React + Express stack, API URLs, database tables and behavior.

## Frontend

| Location | Responsibility |
| --- | --- |
| `client/src/main.jsx` | Loads CSS, mounts React and wraps the workspace in authentication. |
| `client/src/App.jsx` | Small public application entry point. |
| `client/src/layouts/WorkspaceLayout.jsx` | Coordinates workspace data, selected module, attendance/employee editing and refreshes. |
| `client/src/layouts/Sidebar.jsx`, `Topbar.jsx` | Navigation, collapsed sidebar, account menu and theme controls. |
| `client/src/pages/` | Screens organized by feature: account, attendance, auth, calendar, leave, reports, settings and WhatsApp. |
| `client/src/components/common/` | Reusable date navigation, time input/display and worked-time display. |
| `client/src/services/api.js` | Shared workspace API requests, error handling and expired-session notification. |
| `client/src/hooks/useTheme.js` | Saved theme and document theme effects. |
| `client/src/constants/attendance.js` | Initial attendance rule values while server settings load. |
| `client/src/utils/` | Display helpers, saved navigation and Excel workbook generation. |
| `client/src/assets/styles/main.css` | Existing shared visual system and responsive page styles. |

The workspace still owns coordinated editing state so selecting an employee/date, saving an entry and refreshing reports retain their existing behavior. Feature components receive callbacks and data through props; no new state library was introduced.

## Backend

| Location | Responsibility |
| --- | --- |
| `server/src/index.js` | Starts the HTTP server, optional local services and attendance timers. |
| `server/src/app.js` | Composes Express middleware, authentication, routes, static frontend and error handling. |
| `server/src/config/db.js` | Loads the root `.env`; creates the MySQL pool and query helper. |
| `server/src/database/setup.js` | Creates/upgrades tables and optionally seeds fictional data. |
| `server/src/database/transactions.js` | Transaction boundaries and audit writes. |
| `server/src/controllers/auth.js` | Account creation, sessions, permissions and account endpoints. |
| `server/src/controllers/admin.js` | Catalog administration, bulk absence and guarded attendance reset. |
| `server/src/controllers/workspace.js` | Employees, holidays, settings, attendance and activity endpoints. |
| `server/src/controllers/whatsapp.js` | Device/group/settings, history and attendance approval endpoints. |
| `server/src/controllers/leave.js` | Leave review, manual approval/rejection and conflict handling. |
| `server/src/services/whatsapp.js` | Shared sync engine, pagination, import boundaries, deduplication and attendance processing. |
| `server/src/services/leave.js` | Collects pending leave requests from the shared sync transaction. |
| `server/src/services/rules.js`, `recalculate.js` | Validation, effective rules, calculated attendance and settings recalculation. |
| `server/src/services/auto-clockout.js` | Eligible automatic Out time with a persistent idempotency ledger. |
| `server/src/services/employee-phone.js` | Canonical employee number and link persistence. |
| `server/src/services/local-database.js` | Optional Linux development database monitor. |
| `server/src/integrations/chatery.js` | Chatery HTTP adapter and optional local process startup. |
| `server/src/utils/*-parser.js` | Attendance and leave message interpretation. |

Authentication registers before protected routes. Controllers validate requests and call the existing transactional services. Keep attendance writes and their audit entries in the same transaction.

## Data flow

```text
Browser → /api routes → controller → service/rules → MySQL
                                ↘ Chatery API → linked WhatsApp device

Auto/manual sync → same sync service → message queue → attendance or pending leave
Manual leave approval → conflict check → attendance + activity log
```

Automatic and manual sync share the same device, group, parser and deduplication rules. Leave collection never auto-approves. Application startup remains `server/src/index.js`; existing npm entry commands remain valid.

## Shared code and tests

`shared/` contains environment-independent time, calendar, phone, monthly-report and attendance-note helpers. Unit tests live in `server/test/`; React interaction tests in `tests/ui/`; database/API and workbook tests in `tests/integration/`. See [development instructions](DEVELOPMENT.md).

Add new screens under the appropriate `pages/` feature, reusable controls under `components/`, HTTP handlers under `controllers/`, and business operations under `services/`. Avoid importing controllers from services. Keep setup changes idempotent and preserve existing stored data.
