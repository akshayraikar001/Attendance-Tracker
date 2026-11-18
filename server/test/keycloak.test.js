import test from "node:test";
import assert from "node:assert/strict";
import { keycloakEnabled } from "../src/controllers/keycloak.js";

test("confidential Keycloak login requires all four settings", () => {
  const values = {
    KEYCLOAK_ISSUER: "https://identity.example.test/realms/test",
    KEYCLOAK_CLIENT_ID: "test-client",
    KEYCLOAK_CLIENT_SECRET: "test-only-secret",
    KEYCLOAK_REDIRECT_URI: "http://localhost:5173/api/auth/keycloak/callback",
  };
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  try {
    Object.assign(process.env, values);
    assert.equal(keycloakEnabled(), true);
    for (const key of Object.keys(values)) {
      delete process.env[key];
      assert.equal(keycloakEnabled(), false, `${key} must be present`);
      process.env[key] = values[key];
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
