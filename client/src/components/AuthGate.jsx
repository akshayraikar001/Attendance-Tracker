import React, { useState, useEffect } from "react";
export async function authApi(path, body, method = "POST") {
  const res = await fetch("/api" + path, {
    credentials: "same-origin",
    ...(body
      ? {
          method,
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "Dayline",
          },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
export default function AuthGate({ children }) {
  const [user, setUser] = useState(null),
    [loading, setLoading] = useState(true),
    [setup, setSetup] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.theme =
      localStorage.getItem("dayline-theme") || "dark";
    async function load() {
      try {
        const status = await authApi("/auth/status");
        setSetup(status.setupRequired);
        if (!status.setupRequired) {
          const response = await fetch("/api/auth/me");
          if (response.ok) setUser(await response.json());
          else if (response.status !== 401)
            throw new Error("Unable to check your login. Refresh to retry.");
        }
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
    const expired = () => setUser(null);
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = Object.fromEntries(new FormData(e.currentTarget));
      setUser(await authApi(setup ? "/auth/setup" : "/auth/login", data));
      setSetup(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    await authApi("/auth/logout", {});
    setUser(null);
  }
  if (loading)
    return (
      <main className="login-page">
        <p>Loading your workspace…</p>
      </main>
    );
  if (user) return children({ user, onLogout: logout });
  return (
    <main className="login-page">
      <form className="card login-card" onSubmit={submit}>
        <div className="login-brand">dayline.</div>
        <h1>{setup ? "Create your administrator account" : "Welcome back"}</h1>
        <p>
          {setup
            ? "Set up the first account to secure your attendance workspace."
            : "Sign in to your attendance workspace."}
        </p>
        {setup && (
          <>
            <label>
              Your name
              <input name="name" required maxLength={100} autoComplete="name" />
            </label>
            <label>
              One-time setup code
              <input name="setupToken" required autoComplete="off" />
            </label>
            <p className="setup-hint">
              On the server, run <code>cat .local/admin-setup-token</code> to
              get this code.
            </p>
          </>
        )}
        <label>
          Username
          <input
            name="username"
            required
            minLength={3}
            maxLength={60}
            pattern="[A-Za-z0-9._-]+"
            autoComplete="username"
            autoCapitalize="none"
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            required
            minLength={10}
            maxLength={128}
            autoComplete={setup ? "new-password" : "current-password"}
          />
        </label>
        {setup && <p>Use at least 10 characters for your password.</p>}
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "Please wait…" : setup ? "Create administrator" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
