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
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState("login");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [legacy, setLegacy] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.theme =
      localStorage.getItem("dayline-theme") || "dark";
    const expired = () => {
      setUser(null);
      setMode("login");
    };
    window.addEventListener("session-expired", expired);
    let cancelled = false;
    let retryTimer;
    async function load() {
      try {
        const response = await fetch("/api/auth/me", {
          credentials: "same-origin",
        });
        if (response.ok) {
          const data = await response.json();
          if (!cancelled) setUser(data);
        } else if (response.status !== 401) {
          throw new Error(
            "We can't connect to your workspace right now. Please try again shortly.",
          );
        }
        if (!cancelled) setError("");
      } catch (e) {
        if (!cancelled) {
          setError("Reconnecting to your workspace… Please wait a moment.");
          retryTimer = setTimeout(load, 5000);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      window.removeEventListener("session-expired", expired);
    };
  }, []);
  function switchMode(next) {
    setMode(next);
    setError("");
    setLegacy(false);
  }
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = Object.fromEntries(new FormData(e.currentTarget));
      if (mode === "register" && data.password !== data.confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
      setUser(
        await authApi(
          mode === "register" ? "/auth/register" : "/auth/login",
          data,
        ),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    try {
      await authApi("/auth/logout", {});
      setUser(null);
      switchMode("login");
    } catch (e) {
      setError(e.message);
    }
  }
  if (loading)
    return (
      <main className="login-page">
        <p>Loading your workspace…</p>
      </main>
    );
  if (user) return children({ user, onLogout: logout });
  const registering = mode === "register";
  return (
    <main className="login-page">
      <form className="card login-card" onSubmit={submit}>
        <div className="login-brand">dayline.</div>
        <h1>{registering ? "Create your account" : "Welcome back"}</h1>
        <p>
          {registering
            ? "Enter your details to get started."
            : "Sign in to your attendance workspace."}
        </p>
        {(mode === "login" || registering) && (
          <>
            {registering && (
              <label>
                Your name
                <input
                  name="name"
                  required
                  minLength={2}
                  maxLength={100}
                  autoComplete="name"
                />
              </label>
            )}
            <label>
              {legacy ? "Username" : "Email address"}
              <input
                key={legacy ? "username" : "email"}
                name={legacy ? "username" : "email"}
                type={legacy ? "text" : "email"}
                required
                maxLength={254}
                autoComplete="username"
                autoCapitalize="none"
              />
            </label>
            <label>
              Password
              <input
                key={mode}
                name="password"
                type="password"
                required
                minLength={registering ? 10 : 1}
                maxLength={128}
                autoComplete={registering ? "new-password" : "current-password"}
              />
            </label>
            {registering && (
              <>
                <label>
                  Confirm password
                  <input
                    name="confirmPassword"
                    type="password"
                    required
                    minLength={10}
                    maxLength={128}
                    autoComplete="new-password"
                  />
                </label>
                <p>Use at least 10 characters for your password.</p>
              </>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "Please wait…" : registering ? "Create account" : "Sign in"}
        </button>
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => switchMode(mode === "login" ? "register" : "login")}
        >
          {mode === "login"
            ? "New to Dayline? Create account"
            : "Back to sign in"}
        </button>
        {mode === "login" && (
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => {
              setLegacy(!legacy);
              setError("");
            }}
          >
            {legacy ? "Use email instead" : "Have an older username account?"}
          </button>
        )}
      </form>
    </main>
  );
}
