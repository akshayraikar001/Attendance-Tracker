import React, { useEffect, useState } from "react";
export default function WhatsAppSettings({ api, employees, onReload }) {
  const [state, setState] = useState(null),
    [draft, setDraft] = useState(null),
    [groups, setGroups] = useState([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  async function load(forceDraft = false) {
    const data = await api("/whatsapp");
    setState(data);
    const suggestedTimeZone =
      !data.config.timeZone &&
      data.links?.some((link) => link.identity.startsWith("phone:91"))
        ? "Asia/Kolkata"
        : data.config.timeZone;
    setDraft((old) =>
      forceDraft
        ? { ...data.config, timeZone: suggestedTimeZone }
        : old || { ...data.config, timeZone: suggestedTimeZone },
    );
  }
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      api("/whatsapp")
        .then((data) => {
          if (alive) {
            setState(data);
            const suggestedTimeZone =
              !data.config.timeZone &&
              data.links?.some((link) => link.identity.startsWith("phone:91"))
                ? "Asia/Kolkata"
                : data.config.timeZone;
            setDraft(
              (old) => old || { ...data.config, timeZone: suggestedTimeZone },
            );
          }
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  async function action(fn, forceDraft = false) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await load(forceDraft);
      if (onReload) await onReload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!state || !draft)
    return (
      <section className="card whatsapp-settings">
        <h2>WhatsApp attendance</h2>
        <p>{error || "Loading WhatsApp settings…"}</p>
      </section>
    );
  async function loadGroups() {
    const list = await api("/whatsapp/groups");
    setGroups(list);
    const match = list.filter(
      (g) => g.subject.trim().toLowerCase() === "insight - attendance",
    );
    if (match.length === 1 && !draft.groupId)
      setDraft({ ...draft, groupId: match[0].id, groupName: match[0].subject });
  }
  async function save(event) {
    event.preventDefault();
    await action(async () => {
      const result = await api("/whatsapp/config", draft, "PUT");
      if (result.config) setDraft(result.config);
      setNotice(
        draft.enabled
          ? `Automatic attendance is enabled. Messages will be checked every ${draft.syncIntervalMinutes ?? 5} minute(s).`
          : "WhatsApp settings saved. Importing is paused.",
      );
    }, true);
  }
  return (
    <section className="card whatsapp-settings">
      <h2>WhatsApp attendance</h2>
      <p>
        <strong>Connection:</strong>{" "}
        <span
          style={{
            color: state.connection.isConnected ? "#22c55e" : "#ef4444",
          }}
        >
          ●
        </span>{" "}
        {state.connection.isConnected ? "Connected" : "Disconnected"} ·{" "}
        <strong>Import:</strong> {state.config.enabled ? "Enabled" : "Paused"}
      </p>
      {state.connectionError && <p role="status">{state.connectionError}</p>}
      {state.error && (
        <p role="alert" className="error-text">
          Last import error: {state.error}
        </p>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="whatsapp-actions">
        <button
          className="button"
          disabled={busy || state.connection.isConnected}
          onClick={() =>
            action(async () => {
              await api("/whatsapp/connect", {});
              setNotice("Preparing QR code. It will appear here when ready.");
            })
          }
        >
          Link WhatsApp / refresh QR
        </button>
        <button
          className="button"
          disabled={busy || !state.connection.isConnected}
          onClick={() => action(loadGroups)}
        >
          Load my groups
        </button>
        <button
          className="button"
          disabled={busy || !state.config.enabled}
          onClick={() =>
            action(async () => {
              const result = await api("/whatsapp/sync", {});
              if (result.error) throw new Error(result.error);
              setNotice(
                "Sync batch checked. Any remaining history continues on the next sync.",
              );
            })
          }
        >
          Sync latest messages
        </button>
        <button
          className="button"
          disabled={busy || !state.connection.isConnected}
          onClick={() => {
            if (
              window.confirm(
                "Log out this WhatsApp device? You will need to scan the QR code again.",
              )
            )
              action(async () => api("/whatsapp/disconnect", {}));
          }}
        >
          Log out device
        </button>
        <button
          className="button"
          disabled={busy || !state.events.length}
          onClick={() => {
            if (
              window.confirm(
                "Clear all imported messages for this group? Attendance records will remain.",
              )
            )
              action(async () => api("/whatsapp/events", undefined, "DELETE"));
          }}
        >
          Clear messages
        </button>
      </div>
      {state.qrCode && (
        <div className="whatsapp-qr">
          <img src={state.qrCode} alt="WhatsApp device linking QR code" />
          <p>
            WhatsApp → Linked devices → Link a device. Scan this code using a
            phone that belongs to the attendance group.
          </p>
        </div>
      )}
      <form onSubmit={save}>
        <div className="form-grid">
          <label>
            WhatsApp session
            <input
              value={draft.sessionId}
              disabled={false}
              onChange={(e) =>
                setDraft({ ...draft, sessionId: e.target.value })
              }
              required
              pattern="[a-zA-Z0-9_-]+"
            />
            <small>Save before linking if you change this name.</small>
          </label>
          <label>
            Attendance group
            <select
              value={draft.groupId}
              disabled={false}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  groupId: e.target.value,
                  groupName:
                    groups.find((g) => g.id === e.target.value)?.subject || "",
                })
              }
            >
              <option value="">Load groups after linking your phone</option>
              {draft.groupId && !groups.some((g) => g.id === draft.groupId) && (
                <option value={draft.groupId}>{draft.groupName}</option>
              )}
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.subject}
                </option>
              ))}
            </select>
          </label>
          <label>
            Timezone
            <input
              placeholder="For example Asia/Kolkata"
              list="whatsapp-timezones"
              value={draft.timeZone}
              disabled={false}
              onChange={(e) => setDraft({ ...draft, timeZone: e.target.value })}
            />
            <datalist id="whatsapp-timezones">
              {[
                ...new Set([
                  Intl.DateTimeFormat().resolvedOptions().timeZone,
                  "Asia/Kolkata",
                  "Asia/Dubai",
                  "Europe/London",
                  "America/New_York",
                  "UTC",
                ]),
              ].map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </label>
        </div>
        <div className="form-grid">
          <label>
            Messages per sync
            <input
              type="number"
              aria-label="Messages per sync"
              min="1"
              max="2000"
              step="1"
              required
              value={draft.messagesPerSync ?? 200}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  messagesPerSync:
                    e.target.value === "" ? "" : Number(e.target.value),
                })
              }
            />
            <small>
              Example: 200 fetches up to 200 messages per sync. Remaining
              history continues in later syncs.
            </small>
          </label>
          <label>
            Auto-sync interval (minutes)
            <input
              type="number"
              aria-label="Auto-sync interval (minutes)"
              min="1"
              max="1440"
              step="1"
              required
              value={draft.syncIntervalMinutes ?? 5}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  syncIntervalMinutes:
                    e.target.value === "" ? "" : Number(e.target.value),
                })
              }
            />
            <small>
              Example: 5 checks every 5 minutes while Dayline is running. Sync
              lets you check immediately.
            </small>
          </label>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
          />{" "}
          Enable automatic attendance
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={draft.autoApprove ?? false}
            onChange={(e) =>
              setDraft({ ...draft, autoApprove: e.target.checked })
            }
          />{" "}
          Auto-approve messages from matched employees
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={draft.autoOverwrite ?? false}
            disabled={!draft.autoApprove}
            onChange={(e) =>
              setDraft({ ...draft, autoOverwrite: e.target.checked })
            }
          />{" "}
          Allow auto-approval to replace existing times
        </label>
        <button className="primary" disabled={busy}>
          Save WhatsApp settings
        </button>
      </form>
      <p>
        Supported: <strong>IN</strong>, <strong>OUT</strong>,{" "}
        <strong>In 9:30 AM</strong>, <strong>Out 18:15</strong>. Messages
        without a time use the WhatsApp message timestamp in your selected
        timezone. Other formats and conflicts stay in the review list. History
        from before the first enable is excluded.
      </p>
      <details className="whatsapp-link-details">
        <summary>Link an employee by phone number</summary>
        <form
          className="whatsapp-actions"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const data = new FormData(form);
            action(async () => {
              await api("/whatsapp/links", {
                identity:
                  "phone:" + String(data.get("phone")).replace(/\D/g, ""),
                employeeId: Number(data.get("employeeId")),
              });
              form.reset();
              setNotice(
                "Sender linked. Use Retry on their pending messages, starting with In time.",
              );
            });
          }}
        >
          <div className="whatsapp-link-form">
            <input
              aria-label="WhatsApp number with country code"
              name="phone"
              placeholder="Number including country code"
              required
              pattern="[+0-9 ()-]{6,30}"
            />
            <select aria-label="Employee to link" name="employeeId" required>
              <option value="">Select employee</option>
              {employees
                .filter((e) => e.status === "Active")
                .map((e) => (
                  <option value={e.id} key={e.id}>
                    {e.name}
                  </option>
                ))}
            </select>
            <button className="button" disabled={busy}>
              Link sender
            </button>
          </div>
        </form>
        {state.links.length > 0 && (
          <p>
            Linked:{" "}
            {state.links.map((l) => `${l.name} (${l.identity})`).join(" · ")}
          </p>
        )}
      </details>
      {state.config.syncProgress && (
        <p role="status">
          {state.config.syncProgress.phase === "fetch"
            ? `Checking history: ${state.config.syncProgress.scanned} messages fetched. Attendance is processed oldest first after this scan finishes.`
            : "Applying checked messages in order. Remaining messages continue on the next sync."}
        </p>
      )}
      <h3>Recent attendance messages</h3>
      <p>
        {state.lastSync
          ? `Last checked: ${new Date(state.lastSync).toLocaleString()}`
          : "No sync completed yet."}{" "}
        Showing the latest 100 messages. Existing manual entries are preserved.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Sender</th>
              <th>Message</th>
              <th>Result</th>
              <th>Link / retry</th>
            </tr>
          </thead>
          <tbody>
            {state.events.map((event) => (
              <tr key={event.id}>
                <td>
                  {event.senderName || "Unknown sender"}
                  <br />
                  <small>{event.senderId}</small>
                </td>
                <td>
                  {event.text}
                  <br />
                  <small>
                    {new Date(Number(event.timestamp) * 1000).toLocaleString()}
                  </small>
                </td>
                <td>
                  {event.state}
                  <br />
                  <small>{event.reason}</small>
                </td>
                <td>
                  {event.state === "review" && (
                    <>
                      <select
                        aria-label={`Link sender ${event.senderName || event.senderId}`}
                        defaultValue=""
                        disabled={busy || event.senderId === "unresolved"}
                        onChange={(e) => {
                          const employeeId = Number(e.target.value);
                          if (employeeId)
                            action(() =>
                              api("/whatsapp/links", {
                                identity: event.senderId,
                                employeeId,
                              }),
                            );
                        }}
                      >
                        <option value="">Link to employee…</option>
                        {employees
                          .filter((e) => e.status === "Active")
                          .map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.name}
                            </option>
                          ))}
                      </select>
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() =>
                          action(async () => {
                            const result = await api("/whatsapp/retry", {
                              id: event.id,
                            });
                            setNotice(result.reason);
                          })
                        }
                      >
                        Retry
                      </button>
                      {event.employeeId && (
                        <>
                          <button
                            className="button"
                            disabled={busy}
                            onClick={() =>
                              action(async () => {
                                const result = await api("/whatsapp/approve", {
                                  id: event.id,
                                });
                                setNotice(result.reason);
                              })
                            }
                          >
                            Approve / overwrite
                          </button>
                        </>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!state.events.length && (
          <p>
            No attendance messages imported yet. Link the phone and enable your
            group to start.
          </p>
        )}
      </div>
    </section>
  );
}
