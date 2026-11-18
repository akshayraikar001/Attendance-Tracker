# Dayline storage and technology

## WhatsApp storage in this local setup

Dayline uses the MariaDB database `attendance_tracker`. Its files live under `/root/projects/Attendance-Tracker/.local/mysql/`; use a database backup/export rather than editing or copying individual files while MariaDB is running.

- `whatsapp_events`: imported message text, sender, WhatsApp message/group/session IDs, timestamp, processing state, and review reason.
- `whatsapp_sync_queue`: queued message JSON awaiting processing. Processed queue entries are removed.
- `whatsapp_links`: WhatsApp identity-to-employee mapping.
- `whatsapp_days`: per-employee/day synchronization hashes.
- `whatsapp_config`: connection and synchronization settings.
- `leave_requests`: recognized leave messages and approval state.
- `attendance`: attendance produced by accepted messages or manual entries.
- `audit`: change history.

The separate Chatery WhatsApp service is at `/root/projects/Test/chatery_whatsapp`. It also stores a message/contact/chat cache in `sessions/<session-id>/store.json`, along with WhatsApp authentication files in that session directory. Downloaded media uses `public/media/<session-id>/`. These session files contain credentials and should stay private. Dayline's database contains the messages it imports; it is not a complete backup of every WhatsApp conversation.

Cloudflare and ngrok forward traffic to the local app; neither is the app's database.

## Main app dependencies

| Technology | Purpose |
| --- | --- |
| React and React DOM | Admin/employee UI, forms, dashboard, calendar, sidebar and page rendering |
| Vite | Local frontend server and optimized frontend builds |
| Custom CSS | Responsive layouts, light/dark themes and component styling; no Tailwind or Bootstrap |
| Lucide React | Interface icons |
| ExcelJS | Attendance and report Excel downloads |
| Node.js | Backend runtime and development scripts |
| Express | HTTP API, authentication middleware and serving built frontend files |
| MariaDB + mysql2 | Persistent local data and SQL connections/transactions |
| Zod | Request validation and attendance/settings schemas |
| dotenv | Environment configuration |
| openid-client | Keycloak/OpenID Connect integration |
| Node crypto | Local password hashing and session cryptography |
| Geoapify APIs | Map previews and area-name lookup; optional Google Maps provider is also implemented |
| Browser Geolocation/Canvas APIs | On-demand device location capture and photo resizing |

## Separate Chatery service dependencies

| Library | Purpose |
| --- | --- |
| @whiskeysockets/baileys | WhatsApp Web connection and message synchronization |
| Express + cors | Chatery HTTP API and cross-origin handling |
| Socket.IO | Real-time connection/message events for Chatery's clients |
| qrcode | WhatsApp pairing QR codes |
| pino | Logging |
| dotenv | Chatery environment configuration |
| swagger-jsdoc + swagger-ui-express | Chatery API documentation |

## Development and testing

`concurrently` runs frontend/backend together; `prettier` formats code; `esbuild` bundles UI test entrypoints; `jsdom` and React Testing Library test browser UI behavior; Node's built-in test runner tests backend logic. Playwright has also been used for browser checks through a separate local installation. Cloudflared and ngrok are installed tunneling tools, not frontend libraries.

## Time away

Time away has a daily date picker, previous/next-day navigation, Today and Refresh controls, an admin employee filter, completed-duration totals, and a count awaiting return. Overnight intervals stay on their departure date. Employees can view only their own entries.

These intervals do not change attendance. A direct one-off deduction would be overwritten by WhatsApp sync, manual attendance saves, automatic clock-out, or rule recalculation. A safe future deduction feature needs persistent adjustments applied consistently through all those calculation paths, including status/overtime and report/export results. No deduction button is provided in this version.
