# Employee access and Time away

Run `npm run db:setup` before starting the updated server. The migration preserves existing accounts and adds employee links, unique Keycloak subjects, and time-away intervals.

In **User management → Add user**, choose **Employee**, select the employee record, and set a password (at least ten characters). Selecting an employee fills the name and suggests an available username from that name; you can adjust it before saving. Keycloak user ID is optional: leave it blank for local username/password login. Employees use **Sign in with username**. Each employee record can have one linked account. Employees receive a read-only dashboard, attendance, calendar, reports with Excel export, and their time-away history. The server scopes records by the authenticated account; employee IDs in requests cannot change that scope. Admins and Staff retain existing access. Public registration is limited to the first administrator.

**Attendance** and the daily report display saved attendance notes. These are the notes on each dated attendance entry, also visible to the employee.

Admins use **Time away → Record time away** for departures during a shift. Enter local workspace date/time and an optional reason. Leave return empty while the employee is away, then choose **Record return**. Multiple non-overlapping intervals are supported, including returns after midnight. Incorrect intervals can be edited. Changes are audited. This is an informational log: it does not deduct hours or alter the configured attendance/break policy. Departure date is the log's attendance date.

## Keycloak setup

For the configured hosted test realm and local Dayline, follow [local Keycloak setup](KEYCLOAK_LOCAL_SETUP.md); an importable client file is included.

Create an OpenID Connect confidential client in your Keycloak realm, enable Standard flow, and register the exact callback URI (no wildcard). Set these server environment values:

```
KEYCLOAK_ISSUER=https://identity.example.com/realms/company
KEYCLOAK_CLIENT_ID=attendance
KEYCLOAK_CLIENT_SECRET=<client secret>
KEYCLOAK_REDIRECT_URI=https://attendance.example.com/api/auth/keycloak/callback
COOKIE_SECURE=true
```

Restart the server. Create the identity in Keycloak and copy its user ID into the app account's **Keycloak user ID (optional)** field. Keycloak handles authentication; application roles and employee links remain administrator-controlled in Dayline. No automatic linking by email or unapproved account provisioning occurs. Linked accounts must use Keycloak when configured; unlinked accounts can still use local login (including a recovery administrator).

Sign-in uses authorization code with S256 PKCE, state, nonce, and token validation through openid-client. Secrets and tokens remain on the server. HTTPS is required for issuer discovery. Incomplete configuration hides the button. Login attempts expire after ten minutes and are kept in server memory; a restart requires starting sign-in again, and multiple instances require sticky routing for the callback. Dayline sessions expire after 12 hours. Disabling an app account revokes access immediately; Keycloak disable/logout is not currently synchronized to existing Dayline sessions. Sign out ends the Dayline session, not the Keycloak SSO session.

Reference: https://www.keycloak.org/securing-apps/oidc-layers
