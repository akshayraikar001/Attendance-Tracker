import * as oidc from "openid-client";
import { randomBytes } from "node:crypto";
export const keycloakEnabled = () =>
  Boolean(
    process.env.KEYCLOAK_ISSUER &&
    process.env.KEYCLOAK_CLIENT_ID &&
    process.env.KEYCLOAK_REDIRECT_URI,
  );
export function registerKeycloak({ app, wrap, query, loginSession }) {
  const pending = new Map();
  let configuration;
  async function config() {
    if (!keycloakEnabled())
      throw Object.assign(new Error("Keycloak is not configured."), {
        status: 503,
      });
    return (configuration ||= await oidc.discovery(
      new URL(process.env.KEYCLOAK_ISSUER),
      process.env.KEYCLOAK_CLIENT_ID,
      process.env.KEYCLOAK_CLIENT_SECRET || undefined,
    ));
  }
  function cookie(res, value, age) {
    res.append(
      "Set-Cookie",
      `dayline_oidc=${value}; Path=/api/auth/keycloak; HttpOnly; SameSite=Lax; Max-Age=${age}${new URL(process.env.KEYCLOAK_REDIRECT_URI).protocol === "https:" ? "; Secure" : ""}`,
    );
  }
  app.get(
    "/api/auth/keycloak/login",
    wrap(async (req, res) => {
      const cfg = await config();
      for (const [key, value] of pending)
        if (value.expires < Date.now()) pending.delete(key);
      if (pending.size >= 1000)
        return res.status(429).json({ error: "Please try again later." });
      const state = oidc.randomState(),
        nonce = oidc.randomNonce(),
        verifier = oidc.randomPKCECodeVerifier();
      const browser = randomBytes(32).toString("hex");
      pending.set(browser, {
        state,
        nonce,
        verifier,
        expires: Date.now() + 600000,
      });
      cookie(res, browser, 600);
      res.redirect(
        oidc.buildAuthorizationUrl(cfg, {
          redirect_uri: process.env.KEYCLOAK_REDIRECT_URI,
          scope: "openid",
          state,
          nonce,
          code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
          code_challenge_method: "S256",
        }).href,
      );
    }),
  );
  app.get(
    "/api/auth/keycloak/callback",
    wrap(async (req, res) => {
      try {
        const browser = (req.headers.cookie || "")
          .split(";")
          .map((x) => x.trim())
          .find((x) => x.startsWith("dayline_oidc="))
          ?.slice(13);
        const flow = pending.get(browser);
        pending.delete(browser);
        if (!flow || flow.expires < Date.now())
          throw new Error("Expired login");
        const url = new URL(process.env.KEYCLOAK_REDIRECT_URI);
        url.search = new URL(req.originalUrl, "http://localhost").search;
        const tokens = await oidc.authorizationCodeGrant(await config(), url, {
          pkceCodeVerifier: flow.verifier,
          expectedState: flow.state,
          expectedNonce: flow.nonce,
          idTokenExpected: true,
        });
        const subject = tokens.claims()?.sub;
        if (!subject) throw new Error("Missing subject");
        const [user] = await query(
          "SELECT * FROM users WHERE keycloakSubject=? AND active=1",
          [subject],
        );
        if (!user || (user.role === "Employee" && !user.employeeId))
          throw new Error("Unlinked account");
        await loginSession(req, res, user);
        cookie(res, "", 0);
        res.redirect("/");
      } catch {
        res.redirect("/?authError=keycloak");
      }
    }),
  );
}
