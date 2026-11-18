# Development and testing

Start with the [installation guide](../README.md). Run commands from the repository root. `npm ci` installs both npm workspaces using the committed lockfile. `npm run dev` starts the API and Vite together; `npm run build && npm start` serves the built frontend through Express.

## Complete commit check

Run `npm run check` from the repository root. It runs all unit, UI, export and isolated database suites, then the production build; it stops on the first failure. `npm run check -- --list` lists the included checks. Use the test database connection below. It does not run the two live-workspace diagnostics or contact Keycloak/WhatsApp accounts.

## Fast checks (no live WhatsApp account required)

```bash
npm test
npm run test:ui
npm run test:auth:ui
npm run test:time-picker
npm run test:whatsapp:ui
npm run test:leave:ui
npm run test:export
npm run build
```

- `npm test`: Node unit tests for rules, time/calendar behavior, attendance and leave parsing.
- UI tests: jsdom + React Testing Library; mocked API responses; no real attendance writes. `test:ui` includes attendance-editor regressions.
- `test:export`: workbook round-trip tests using ExcelJS.
- `npm run build`: verifies the production frontend bundle. ExcelJS currently produces a large-chunk warning; this is not a build failure.
- `npm run format`: Prettier for app, shared and test source.

## Database integration tests

These tests use an isolated test schema on the local MariaDB server, with the development application user from `server/database.sql`. The shared `tests/helpers/database.mjs` connects as root through `.local/mysql.sock` when present; otherwise it uses **127.0.0.1:3307**. They never select the application database from `.env`. Each suite creates and removes only its own `attendance_*_test_*` database. Do not point test code at production.

Optional test-only connection settings: `TEST_DB_HOST` and `TEST_DB_PORT` select TCP; `TEST_DB_SOCKET` explicitly selects an admin socket. `TEST_DB_ADMIN_USER` and `TEST_DB_ADMIN_PASSWORD` configure the test administrator. Keep passwords out of Git. The application fixture still uses the development `attendance` account from `server/database.sql`. An already-running local database can be reused; there is no need to start another server.

Install MariaDB server/client tools (`mariadbd`, `mariadb-install-db`, `mysqladmin`, `mysql`), then:

```bash
npm run db:local
npm run test:admin
npm run test:auth
npm run test:holidays
npm run test:whatsapp
npm run test:leave
npm run test:automation
npm run test:employee-reports
```

These suites create temporary test databases and remove them when finished. WhatsApp/leave tests use simulated Chatery responses, not real group messages. They cover sync pagination, offline catch-up, deduplication, manual overwrite, disabled auto-approval, group switching, leave conflicts, permissions, resets and automatic Out time boundaries.

For running the actual application with the local helper, set `DB_PORT=3307` in `.env`. Optionally set `DB_LOCAL_MANAGED=true` to let the backend start/monitor this local database. Keep it false for Docker or external databases. Data is under ignored `.local/mysql/`; preserve it when keeping a workspace. The helper uses development credentials and is not a production database installer.

`tests/integration/smoke-test.mjs` and `local-db-recovery-test.mjs` are manual environment diagnostics. They can modify workspace data or stop the local database; they are deliberately excluded from the commands above. Use only in a disposable development environment after reading them.

## Updating an existing installation

1. Back up the database and preserve `.env` plus Chatery's paired-device files.
2. Update the source and run `npm ci`.
3. Run `npm run db:setup` to apply idempotent schema upgrades; do not add `--seed` to an existing workspace.
4. Rebuild if serving production assets and restart the backend.
5. Check manual attendance and the WhatsApp connection, selected group and saved options.

The restructure changes source locations, not public API routes, npm startup commands or table names. Custom scripts that imported the old `server/src/*.js` files directly must use their new paths; consult [architecture](ARCHITECTURE.md).

## Monthly employee report delivery

- `npm run test:employee-reports`: isolated database and mock document sender; validates privacy, admin-only access, month/format selection, download generation, duplicate/concurrent sends, uncertain delivery and persisted status. Requires the same local MariaDB fixture as the other integration tests. It sends no real WhatsApp messages.
- `npm run test:employee-reports:ui`: mocked API checks for selection, confirmation, format/detail controls, sent markers and explicit resends.
- `npm test`: includes PDF/Excel generation, per-employee data isolation, filenames, note shortening and employee export columns.
- `npm run db:setup`: adds the report-send tracking table without altering attendance. Restart the API after updating.
