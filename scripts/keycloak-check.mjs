// Read-only setup check: never sends client credentials or creates sessions.
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });
let failed = false;
const missing = [
  "KEYCLOAK_ISSUER",
  "KEYCLOAK_CLIENT_ID",
  "KEYCLOAK_CLIENT_SECRET",
  "KEYCLOAK_REDIRECT_URI",
].filter((key) => !process.env[key]?.trim());
for (const key of missing) console.error(`Missing: ${key}`);
failed = missing.length > 0;
try {
  const issuer = new URL(process.env.KEYCLOAK_ISSUER);
  if (
    issuer.protocol !== "https:" ||
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash
  )
    throw new Error(
      "Issuer must be an HTTPS realm URL without credentials, query or fragment.",
    );
  const callback = new URL(process.env.KEYCLOAK_REDIRECT_URI);
  if (
    callback.pathname !== "/api/auth/keycloak/callback" ||
    callback.search ||
    callback.hash ||
    callback.username ||
    callback.password
  )
    throw new Error(
      "Callback must end with /api/auth/keycloak/callback and contain no query, fragment or credentials.",
    );
  if (
    callback.protocol !== "https:" &&
    !(callback.protocol === "http:" && callback.hostname === "localhost")
  )
    throw new Error(
      "Use HTTPS for the callback, or http://localhost for local development.",
    );
  if (callback.protocol === "http:" && process.env.COOKIE_SECURE === "true")
    throw new Error("Local HTTP development requires COOKIE_SECURE=false.");
  const response = await fetch(
    issuer.href.replace(/\/$/, "") + "/.well-known/openid-configuration",
    {
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    },
  );
  if (!response.ok)
    throw new Error(
      `Realm discovery returned HTTP ${response.status}. Check the realm name and server path.`,
    );
  const data = await response.json();
  if (data.issuer !== process.env.KEYCLOAK_ISSUER)
    throw new Error("Discovery issuer does not exactly match KEYCLOAK_ISSUER.");
  for (const name of ["authorization_endpoint", "token_endpoint", "jwks_uri"])
    if (new URL(data[name]).protocol !== "https:")
      throw new Error(`Missing or non-HTTPS ${name}.`);
  if (!data.code_challenge_methods_supported?.includes("S256"))
    throw new Error("Realm does not advertise S256 PKCE support.");
  console.log("PASS: HTTPS realm discovery, issuer and S256 PKCE support.");
  console.log("Callback:", callback.href);
  console.log(
    "Client credentials, account linking and browser login still require an end-to-end sign-in.",
  );
} catch (error) {
  failed = true;
  const code = error.cause?.code || error.code;
  const tlsCodes = [
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "CERT_HAS_EXPIRED",
  ];
  if (tlsCodes.includes(code)) {
    console.error(`FAIL: TLS certificate verification failed (${code}).`);
    console.error(
      "Have the server administrator check the full certificate chain and expiry. For an intentionally private CA, install the verified CA or use NODE_EXTRA_CA_CERTS before starting Node. Do not disable TLS verification.",
    );
  } else console.error(`FAIL: ${error.message}${code ? ` (${code})` : ""}`);
}
process.exitCode = failed ? 1 : 0;
