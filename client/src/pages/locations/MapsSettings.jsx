import React, { useEffect, useState } from "react";
import api from "../../services/api.js";
export default function MapsSettings({ onSaved }) {
  const [status, setStatus] = useState(null),
    [provider, setProvider] = useState("geoapify"),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api("/locations/config")
      .then((result) => {
        setStatus(result);
        setProvider(result.provider || "google");
      })
      .catch((e) => setError(e.message));
  }, []);
  async function save(e) {
    e.preventDefault();
    const form = e.currentTarget,
      values = Object.fromEntries(new FormData(form)),
      body = { provider };
    for (const field of provider === "geoapify"
      ? ["geoapifyKey"]
      : ["embedKey", "geocodingKey"]) {
      if (values["clear_" + field]) body[field] = "";
      else if (values[field]?.trim()) body[field] = values[field].trim();
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setStatus(await api("/locations/config", body, "PUT"));
      form.reset();
      setMessage("Map settings saved.");
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="location-settings">
      <summary>Map settings · API keys</summary>
      <p>
        Select the company that issued your API key. Google and Geoapify keys
        are not interchangeable.
      </p>
      {status && (
        <form onSubmit={save}>
          <label>
            Map provider
            <select
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                setMessage("");
              }}
              disabled={busy}
            >
              <option value="geoapify">Geoapify (free plan)</option>
              <option value="google">Google Maps</option>
            </select>
          </label>
          <div className="form-grid" key={provider}>
            {(provider === "geoapify"
              ? [["geoapifyKey", "Geoapify API key", status.geoapifyConfigured]]
              : [
                  ["embedKey", "Maps preview API key", status.embedConfigured],
                  [
                    "geocodingKey",
                    "Area names API key",
                    status.geocodingConfigured,
                  ],
                ]
            ).map(([field, label, configured]) => (
              <div key={field}>
                <label>
                  {label}
                  <input
                    type="password"
                    name={field}
                    maxLength={255}
                    autoComplete="new-password"
                    disabled={busy}
                    placeholder={
                      configured
                        ? "Configured — leave blank to keep"
                        : "Paste API key"
                    }
                  />
                </label>
                <small>
                  {configured ? "Configured" : "Not configured"} ·{" "}
                  {field === "geoapifyKey"
                    ? "One key for maps and area names. Requests come from your server."
                    : field === "embedKey"
                      ? "Restrict to your website and Maps Embed API."
                      : "Restrict to your server IP and Geocoding API."}
                </small>
                {configured && (
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      name={"clear_" + field}
                      disabled={busy}
                    />
                    Remove saved key
                  </label>
                )}
              </div>
            ))}
          </div>
          <p>
            {provider === "geoapify"
              ? "Your Geoapify key stays on the server. Free-plan usage limits apply."
              : "Enable Maps Embed API and Geocoding API in Google Cloud. The area-names key stays on the server."}
          </p>
          <button className="primary" disabled={busy}>
            Save map settings
          </button>{" "}
          <a
            href={
              provider === "geoapify"
                ? "https://myprojects.geoapify.com/"
                : "https://console.cloud.google.com/google/maps-apis/credentials"
            }
            target="_blank"
            rel="noreferrer"
          >
            {provider === "geoapify"
              ? "Open Geoapify projects"
              : "Open Google Cloud credentials"}{" "}
            ↗
          </a>
        </form>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </details>
  );
}
