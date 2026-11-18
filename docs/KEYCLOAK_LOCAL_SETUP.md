# Hosted Keycloak with local Dayline

Dayline URL: `http://localhost:5173`

Realm: `LeaveApplicationTest` on `https://bookstack.insightirs.com/keycloak`

The local `.env` has been prepared with the issuer, client ID `dayline`, callback and `COOKIE_SECURE=false`. The client secret must be entered locally. Login stays disabled until all four Keycloak settings are present. Existing local login remains available while setup is incomplete.

## Steps requiring your admin access

1. Sign in to your Keycloak admin console and select **LeaveApplicationTest**, not master.
2. Under **Clients**, choose **Import client** and upload [keycloak-dayline-local-client.json](keycloak-dayline-local-client.json). It contains no secret. If `dayline` already exists, configure that client to match the file instead of deleting/replacing it.
3. Open the client's **Credentials** tab and copy the generated client secret into `KEYCLOAK_CLIENT_SECRET` in Dayline's local `.env`. Do not put it in Git or chat. If no secret was generated during import, generate it in that tab.
4. Open the intended user in Keycloak and copy their user ID. In Dayline's **User management**, edit the matching account and paste it into **Keycloak user ID**. Keep the account active and link an employee record if its role is Employee. Do not link an unrelated user or change their role just to make login work.

The client file enables confidential-client authentication, Standard flow and S256 PKCE, with exactly `http://localhost:5173/api/auth/keycloak/callback` as its redirect. Password grants, implicit flow and service accounts are disabled. No browser CORS origins are needed because the backend exchanges the code.

## Check and start

From the Dayline project directory:

```sh
npm run keycloak:check
npm run dev
```

If Dayline is already running, stop its development terminal with Ctrl+C and restart it after editing `.env`. Open `http://localhost:5173` (not `127.0.0.1` or a different port) and select **Sign in with Keycloak**. If Vite selects another port because 5173 is occupied, use the existing Dayline instance or resolve the port conflict first.

The check only reads public realm discovery; it never sends the secret. Passing it confirms configuration presence and discovery, not secret validity or account linking. Complete a browser sign-in to verify those.

## Current connectivity blocker

On 25 October 2026 this machine's HTTPS clients rejected the server certificate chain with an issuer-verification error; a later discovery attempt timed out. The realm and login cannot be verified end to end until connectivity and certificate trust are resolved. Have the server administrator check reachability, the full intermediate chain and certificate hostname/expiry at the HTTPS reverse proxy. If an intentional private CA is used, install its independently verified CA certificate or configure `NODE_EXTRA_CA_CERTS` before starting Node. Do not use `NODE_TLS_REJECT_UNAUTHORIZED=0` or disable certificate verification.

## Existing behavior

- Local unlinked accounts continue to use local login. Linked accounts use Keycloak once fully configured.
- Dayline roles and employee links remain in Dayline; there is no automatic account creation or email-based linking.
- Signing out ends the Dayline session only. Keycloak SSO logout and remote account-disable propagation are not implemented; existing Dayline sessions can last 12 hours unless revoked in Dayline.
- This client file is for local development. Hosting Dayline elsewhere requires an exact matching HTTPS callback and `COOKIE_SECURE=true`.

Reference: [Keycloak client administration](https://www.keycloak.org/docs/latest/server_admin/index.html#oidc-clients).
