# Dayline — Attendance Tracker

Dayline manages employees, attendance, shift timings, leave approvals and Excel reports. You can enter attendance manually or import In/Out messages from a WhatsApp group through **Chatery**.

Built with React 18, Vite, JavaScript, CSS, Node.js, Express and MySQL/MariaDB. No email provider is needed for account signup.

## 1. Install the requirements

- **Node.js 20+** and npm (`node --version`, `npm --version`).
- **Git** to clone the project.
- **Docker Desktop / Docker Compose**, or an existing MySQL 8+ / MariaDB 10.6+ server.
- For WhatsApp: a separate **Chatery** service and a phone that belongs to the attendance group.

Run the Dayline commands below from the project root. Windows users can use PowerShell; the optional local MariaDB helper requires Bash/Linux.

## 2. Download and configure Dayline

```bash
git clone <your-dayline-repository-url> Dayline
cd Dayline
# If your changes are on a feature branch, check out that branch first.
npm ci
```

Copy `.env.example` to `.env` using your editor or file manager. On macOS/Linux use `cp .env.example .env`; in PowerShell use `Copy-Item .env.example .env`.

For the included Docker database, keep these values:

```dotenv
PORT=3001
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=attendance
DB_PASSWORD=attendance_dev
DB_NAME=attendance_tracker
COOKIE_SECURE=false
DB_LOCAL_MANAGED=false
```

These credentials are for the local development database, **not** the Dayline sign-in form. `.env` is ignored by Git; configure it on each machine. Use your own credentials for a shared server.

## 3. Start the database

### Option A: Docker (simplest)

```bash
docker compose up -d
docker compose ps
```

Wait until MySQL reports **healthy**. It stores data in the `attendance_data` volume. `docker compose stop` keeps the data; `docker compose down -v` deletes that volume.

### Option B: an existing MySQL/MariaDB server

Run `server/database.sql` through your database administrator or SQL client. It creates the database and application user. Set the matching host, port, database, username and password in `.env`. Skip Docker.

For the optional Linux-only development database on port 3307, see [development and tests](docs/DEVELOPMENT.md).

Then create or upgrade Dayline's tables:

```bash
npm run db:setup
```

This command preserves existing accounts, employees and attendance. Run it when installing or upgrading. Optional fictional sample data is available with `npm run db:setup -- --seed`; use this only on an empty demo database.

## 4. Start Dayline and create your account

```bash
npm run dev
```

Open **http://localhost:5173**. The backend runs on port **3001**. Keep the terminal running.

1. Choose **Create account**.
2. Enter your name, email, password and password confirmation. Passwords must have at least 10 characters.
3. The first account becomes **Admin**. Later signups become **Staff**; an administrator manages users under **User management**.
4. Add employees, departments and their phone numbers. Configure timings under **Settings**.

There is no default application password or Gmail verification step. Existing installations should sign in with their saved account. Use **Account → Sign out** to log out.

## 5. Connect WhatsApp through Chatery

Manual attendance works without Chatery. WhatsApp imports require **both Dayline and Chatery to be running**.

### Install Chatery separately

In a second terminal, outside the Dayline folder:

```bash
git clone https://github.com/farinchan/chatery_whatsapp.git Chatery
cd Chatery
# Version checked against this integration:
git checkout a5f31a55db0872c1f7e053d09794749f7ad865fb
npm ci
```

Copy Chatery's `.env.example` to `.env`, then configure:

```dotenv
PORT=3010
API_KEY=replace-with-your-own-long-random-key
```

Start it and leave it running:

```bash
npm start
```

In **Dayline's** `.env`, set:

```dotenv
CHATERY_URL=http://127.0.0.1:3010
CHATERY_API_KEY=the-same-key-you-set-in-chatery
CHATERY_MANAGED_PATH=
```

Replace the example keys with the same actual value in both files. Restart Dayline after changing `.env`. Chatery must support paginated message history (`cursor` and `hasMore`); older installations without that API cannot reliably catch up on history.

Optional: set `CHATERY_MANAGED_PATH` to the absolute path of your local Chatery folder to let Dayline start it when needed. Otherwise start Chatery yourself as above. If Chatery runs on another computer, use a URL reachable **from the Dayline server**; `127.0.0.1` always means that same computer.

### Link the phone and choose the group

1. Sign in to Dayline as an Admin and open **WhatsApp** in the sidebar.
2. Click **Link WhatsApp / refresh QR**.
3. On your phone, open **WhatsApp → Linked devices → Link a device** and scan the QR code.
4. Wait for the green **Connected** indicator, then click **Load my groups**.
5. Select your attendance group and timezone, for example `Insight - Attendance` and `Asia/Kolkata`.
6. Match each employee's phone in **Employees**, including country code: `+919999999999`. If WhatsApp supplies an unresolved sender identity, review/link it in the WhatsApp module.
7. Enable importing, choose whether attendance should be auto-approved, and click **Save WhatsApp settings**.
8. Send a test message from a linked employee's phone, then click **Sync latest messages** or wait for auto-sync.

Examples: `In time 10:50`, `In time 2:05`, `Out time 6:55`, `IN`, `OUT`. Without AM/PM, the parser uses its office-hours rules and message timestamp. Plain `IN`/`OUT` use the message time in the selected timezone. See [WhatsApp behavior and examples](docs/WHATSAPP.md).

Only the selected group's messages are imported. Dayline sends no WhatsApp messages. Leave requests use the same linked device and group but require **Allow Leave Approval** and always need manual approval.

The phone pairing is stored in Chatery's `sessions/` directory, not in the Dayline repository. Closing the terminals normally keeps pairing. Retain that directory; logging out/unlinking or deleting it requires scanning again. WhatsApp can also revoke a linked device.

## Everyday use

- **Attendance:** add/edit In time and Out time, clear saved times, use a direct status, bulk-mark absent or preview/reset a selected date range.
- **Calendar:** see daily counts and absentee names; use the three dots for a preview.
- **Settings:** workspace, department and employee timings, recurring weekday shifts, time display and attendance timezone. One-hour break deduction is off by default.
- **Automatic Out time:** when enabled, after 8 PM an eligible entry with In time but no Out time receives 7:05 PM and a note. Existing Out times and overnight shifts are preserved. The backend must run; eligible overdue entries are checked on startup.
- **Reports:** daily, monthly, single-day attendance details, employee summaries and Excel export. Activity log shows readable changes and filters within the latest 500 events.
- **Leave Approval:** review leave/half-day requests and manually approve or reject. Existing attendance requires explicit overwrite.

## Use on another laptop or shared server

**Yes, this project can run elsewhere**, but cloning code does not copy your database, `.env` or paired WhatsApp device.

For a fresh installation, repeat steps 1–5 and create a new account. To keep your existing workspace:

1. Back up the existing MySQL/MariaDB database using your database tool or `mysqldump`.
2. Install Dayline and a compatible Chatery version on the new machine.
3. Restore the database, configure the new `.env`, then run `npm run db:setup`.
4. Start both services, sign in with your existing Dayline account, link the phone again if needed, and verify the selected group and timezone.
5. Stop the old Dayline instance before running automatic imports against the same workspace on the new one.

To access one shared workspace from multiple laptops, keep a single Dayline backend, database and Chatery service on an always-on server. The other laptops only need a browser.

For a production build:

```bash
npm ci
npm run db:setup
npm run build
npm start
```

The backend serves the built app on port **3001**. Use your server's hostname/IP instead of `localhost` from other computers. Configure networking and an HTTPS reverse proxy for remote access; set `COOKIE_SECURE=true` when using HTTPS. Keep MySQL and Chatery accessible to the backend and use a process manager/service to restart the Node processes. This repository does not provision hosting automatically.

## Troubleshooting

| Problem | Check |
| --- | --- |
| Database unavailable | Start MySQL; check `.env` host/port/credentials; run `npm run db:setup`; restart Dayline. |
| Endpoint not found after an update | Restart the backend from the updated checkout and rebuild if using `npm start`. |
| Chatery offline or connection refused | Start Chatery; verify `CHATERY_URL` from the backend machine. |
| Chatery unauthorized | Match Chatery's `API_KEY` with Dayline's `CHATERY_API_KEY`, then restart both services. |
| No groups or QR | Confirm Chatery is running and the phone is linked; refresh QR/load groups in Dayline. |
| Message missing | Check group, timezone, import switch, original enable date, sender phone and pending sync progress. Chatery must actually have received the message history. |
| Message visible but no attendance | Check auto-approval; otherwise approve manually. Review unknown senders, ambiguous times and conflicts. |
| Old changes still on screen | Refresh the view. In development keep API port 3001, or also update the proxy in `client/vite.config.js`. |
| Fresh clone has no previous users/data | Restore the old database; Git only contains the application code. |

## Project organization and tests

```text
client/src/       React app: pages, layouts, common components, hooks, services, styles
server/src/       Express app: controllers, services, integrations, configuration, database
shared/           Date, time, phone, report and note helpers shared across the app
server/test/      Unit tests
tests/           UI and database/API integration tests (see below)
scripts/          Optional local development database helper
docs/             Architecture, WhatsApp behavior and development instructions
```

See [architecture and file responsibilities](docs/ARCHITECTURE.md) and [test commands and requirements](docs/DEVELOPMENT.md). Quick checks:

```bash
npm test
npm run test:ui
npm run build
```

Database integration tests have separate local prerequisites described in the development guide. Never commit `.env`, database backups or Chatery session credentials.
