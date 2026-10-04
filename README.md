# Dayline — Attendance Tracker

A React + Node.js attendance workspace with a MySQL database. Includes a responsive dashboard, employee directory, attendance register, configurable shift rules, Excel reports, employee summaries, and a transactional audit log.

## Quick start

Requires Node.js 20+ and MySQL 8+ (or MariaDB 10.6+).

```bash
npm install
cp .env.example .env
docker compose up -d
# Wait until MySQL is healthy, then:
npm run db:setup
npm run dev
```

Open http://localhost:5173. The API runs on port 3001. If you already have MySQL, create a database and user using `server/database.sql`, update `.env`, and skip Docker. The setup command creates tables without deleting existing data.

Optional sample employees and attendance:

```bash
npm run db:setup -- --seed
```

Sample data is fictional. The regular setup starts empty.

## This workspace

An isolated MariaDB development instance is configured on port 3307 in `.env`, for this workspace’s employees and attendance. The standard Docker configuration uses MySQL 8 on port 3306. To restart the isolated instance if needed:

```bash
npm run db:local
npm run db:setup
npm run dev
```

The isolated data lives in the gitignored `.local/` folder. This optional helper requires MariaDB installed on the machine.

## Features

- Add and edit employees, departments, job titles, optional emails, and active status.
- Settings includes a saved AM/PM (12-hour) toggle, enabled by default, for screens, time entry, and printed reports. Turn it off for 24-hour display. Excel export formats and stored clock values stay unchanged.
- Dark mode by default, with a persistent light/dark toggle in the header.
- Enter attendance with clock-in/out times, or directly mark Present, Absent, Half day, or Attended.
- One entry per employee/date; saving again updates it and records the previous values. The attendance form stays open after saving and closes only with Cancel. Switching employee/date loads that employee’s existing entry, or starts an empty one using their applicable shift.
- Configure full/half-day minimums, overtime threshold, shift times, and late grace for the workspace, individual departments/groups, or specific employees.
- Timing priority: employee override → department/group override → workspace defaults. Use Settings to customize or restore inherited timings.
- Save clock-in alone, then add clock-out later on the same entry. Open shifts are labeled In progress; both time fields have Clear buttons.
- Explicit next-day clock-out for overnight shifts.
- Search employees and filter by department, date, and attendance status.
- Daily overview, seven-day trend, attendance breakdown, and unmarked count.
- Simple daily report (Reports → Daily report), with Name, In time, Out time, Total hours (including breaks), and color-coded Status in larger, readable text. Includes group filtering, matching Excel export, and print/PDF through the browser.
- Date-range detail and per-employee reports: worked time, lateness, early departures, overtime, entry method, and notes.
- Native `.xlsx` export with numeric Excel clock-time and duration cells, Unicode text, blank missing values, and literal text (never formulas).
- Latest 500 audit events with expandable before/after values. All audit events remain stored in MySQL.
- Saving timing settings automatically recalculates all time-based attendance using employee/group/workspace precedence. Manual statuses stay unchanged. Each recalculation records previous and updated values in the audit log.

## Monthly reports, bulk absence, and workspace settings

- **Reports → Monthly report** shows each employee’s daily status with hours underneath, plus Present, Absent, and Half day totals. Sundays without records are neutral Holiday cells. Click a day to enter or edit attendance, or export the month to Excel.
- **Attendance → Bulk absent** lets you select employees and a date range (up to 366 days and 10,000 employee-days). Preview before applying. Holidays and existing entries are skipped by default; explicitly enable replacement to overwrite existing entries. Every change is audited.
- **Settings → Departments / Roles** lets you add and rename categories. Renaming updates assigned employees; department timing overrides follow the rename. Only unused categories can be removed. Manager is a job role, not a login/access permission.
- **Settings → Holidays** manages weekly days off and named dates. Attendance can still be recorded on any holiday, and existing attendance takes precedence.
- Date and date-range controls include previous/next arrows for quick navigation.

## Holidays and calendar

Open **Calendar** in the sidebar. Use the month arrows or Today, then select a date for a short report of statuses and recorded hours. Click **Edit** or **Record** beside an employee to open attendance for that date. Saving refreshes the report; Cancel closes the editor.

In the selected day panel, enter a holiday name and click **Add holiday**. You can rename it with **Save holiday** or use **Remove holiday** to make the date a working day again. Holidays apply to the whole workspace, persist in MySQL, and record changes in the activity log. Existing attendance stays intact, including work performed on a holiday.

For an existing installation, run `npm run db:setup` once before restarting the API to add the holiday and department/role catalog tables without deleting existing data.

## Calculation policy

Until clock-out is entered, a shift is In progress: lateness is measured but worked time, early departure, overtime, and final status remain pending.

Worked minutes = clock-out minus clock-in, including breaks. No break time is deducted, including for legacy workspace/group/employee settings. Full-day and half-day boundaries are inclusive; more than one minute below the half-day minimum is Attended; one minute or less is Absent. Early arrival counts toward worked time. Overtime is only worked time above the configured overtime threshold. Arriving early or staying past shift end does not independently earn overtime. The Activity column uses these hour-based results. Early arrival alone does not grant a full day if work is below the full-day minimum. Once the grace period is exceeded, lateness counts from shift start. Early departure counts until scheduled shift end. Punctuality flags do not independently change attendance classification.

Direct status entries have **no measured hours**, lateness, early departure, or overtime. Unmarked dates are not automatically absences. Attendance rate is `(present + 0.5 × half days) / active employees`. Times are entered as the team's local wall-clock time, without timezone conversion; an overnight entry belongs to its start date. Historical dashboard headcount uses the current active directory. Groups use the employee’s department. Individual rules override group rules, and group rules override workspace defaults. Saving timing settings recalculates existing time-based entries immediately; original inputs and manual statuses are preserved. Workspace holidays label employees without entries as Holiday in the calendar, register, and daily report/export. Recorded attendance always takes precedence; holiday changes never rewrite measured hours or statuses. Sundays are weekly holidays by default; Settings → Holidays lets you change weekly days off and add dated holidays. Existing attendance rates remain based on recorded attendance/current active headcount; there is no holiday pay, payroll, or leave calculation.

## Production build

```bash
npm run build
npm start
```

The Node server serves the compiled React app and API at http://localhost:3001.

This release is a single-administrator workspace without built-in login. Run on a trusted local network or place it behind authenticated access before exposing employee data on the internet. Database credentials belong in `.env`, which is gitignored.

## Verification

```bash
npm test
npm run test:ui
npm run test:export
npm run test:admin
npm run test:holidays
npm run build
```

Run `npm run test:admin` and `npm run test:holidays` after `npm run db:local` to verify the holiday API against a temporary isolated database; it removes its test database afterward.

Calculation tests cover full/half days, included breaks, late grace, early exits, overtime, overnight shifts, invalid times/dates, and manual entries.

## Project structure

```text
client/
  src/main.jsx          React entry point
  src/App.jsx           Screens and attendance forms
  src/components/       Daily report and timing settings
  src/styles.css        Responsive design system
  vite.config.js        Development proxy
server/
  src/index.js          API routes, transactions, static hosting
  src/db.js             MySQL connection pool
  src/rules.js          Validation and attendance calculation
  src/setup.js          Idempotent schema and optional seed
  test/rules.test.js    Calculation tests
  database.sql          Initial database/user provisioning
.env.example            Configuration template
docker-compose.yml     MySQL development service
```

## API

- `GET /api/health`
- `GET /api/employees`, `POST /api/employees`, `PUT /api/employees/:id`
- `GET /api/attendance?from=YYYY-MM-DD&to=YYYY-MM-DD`, `POST /api/attendance`
- `GET /api/settings`, `PUT /api/settings`
- `GET /api/catalog`, `POST /api/catalog/:kind`, `PUT /api/catalog/:kind/:id`, `DELETE /api/catalog/:kind/:id` (`departments` or `roles`)
- `POST /api/attendance/bulk-absence/preview`, `POST /api/attendance/bulk-absence`
- `GET /api/audit`
- `GET /api/holidays`, `PUT /api/holidays/:date` (name and optional active flag)

Employee updates and attendance/settings changes commit atomically with their audit records. Parameterized queries protect input values, and server-side validation enforces attendance inputs and rule consistency.

The included `node scripts/smoke-test.mjs` exercises a running API with actual writes. It creates a test employee, then deactivates it and restores the original settings. Run only against a development database.

## phpMyAdmin in this workspace

The existing phpMyAdmin installation has an additional server named **Attendance Tracker (port 3307)**. Select it and log in using the database user/password in `.env`. The original port-3306 connection is unchanged. Configuration: `/etc/phpmyadmin/conf.d/attendance-tracker.php`.

Employees, attendance, and activity history were cleared at your request. A private SQL backup from before the reset is stored in `.local/backups/`. Attendance rules were preserved. Do not run the optional `--seed` command for daily use.
