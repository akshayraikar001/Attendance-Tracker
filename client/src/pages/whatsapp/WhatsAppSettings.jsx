import { withoutMentions } from "../../../../shared/message-text.js";
import React, { useEffect, useRef, useState } from "react";
export default function WhatsAppSettings({ api, employees, onReload }) {
  const [state, setState] = useState(null),
    [draft, setDraft] = useState(null),
    [groups, setGroups] = useState([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [history, setHistory] = useState(false),
    [selectedDays, setSelectedDays] = useState([]),
    [syncDate, setSyncDate] = useState("");
  const messagePath = history ? "/whatsapp?history=archived" : "/whatsapp";
  async function load(forceDraft = false) {
    const data = await api(messagePath);
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
      api(messagePath)
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
  }, [messagePath]);
  useEffect(() => {
    setSelectedDays([]);
  }, [state?.config?.groupId, state?.config?.sessionId, history]);
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
  const zone = state.config.timeZone || "UTC";
  const dateKey = (timestamp) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(timestamp));
  const today = dateKey(Date.now());
  const fallbackDays = new Map();
  for (const event of state.events) {
    const date = dateKey(Number(event.timestamp) * 1000);
    fallbackDays.set(date, (fallbackDays.get(date) || 0) + 1);
  }
  const days =
    state.days ||
    [...fallbackDays]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, count]) => ({ date, count }));
  async function syncMessages(selection = {}) {
    await action(async () => {
      const result = await api("/whatsapp/sync", selection);
      if (result.error) throw new Error(result.error);
      setNotice(
        result.progress
          ? "Sync in progress. Remaining batches continue automatically; Sync latest messages also continues this job."
          : "Message sync completed.",
      );
    });
  }
  async function clearDays(dates) {
    if (
      window.confirm(
        "Move messages for the selected days to cleared history? Attendance stays unchanged.",
      )
    )
      await action(async () => {
        await api("/whatsapp/events", { dates }, "DELETE");
        setSelectedDays([]);
      });
  }
  const renderEvent = (event) => (
    <tr key={event.id}>
      <td>
        {event.senderName || "Unknown sender"}
        <br />
        <small>{event.senderId}</small>
      </td>
      <td>
        {withoutMentions(event.text) || "—"}
        <br />
        <small>
          {new Date(Number(event.timestamp) * 1000).toLocaleString("en-GB", {
            timeZone: zone,
          })}
        </small>
      </td>
      <td>
        {event.state}
        <br />
        <small>
          {event.senderId === "unresolved"
            ? "Sender details were missing from WhatsApp. Fetch sender to recover this message."
            : event.reason}
        </small>
      </td>
      <td>
        {event.state === "review" && (
          <>
            {event.senderId !== "unresolved" && (
              <select
                aria-label={`Link sender ${event.senderName || event.senderId}`}
                defaultValue=""
                disabled={busy}
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
            )}
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
              {event.senderId === "unresolved" ? "Fetch sender" : "Retry"}
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
  );
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
          onClick={() => syncMessages()}
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
          disabled={busy || history || !state.events.length}
          onClick={() => {
            if (
              window.confirm(
                "Move these messages to cleared history? Attendance and duplicate protection will remain.",
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
      <h3>
        {history ? "Cleared message history" : "Recent attendance messages"}
      </h3>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={history}
          disabled={busy}
          onChange={(e) => {
            setHistory(e.target.checked);
            setSelectedDays([]);
          }}
        />
        Show cleared history
      </label>
      <p className="muted">
        Automatic approval and overwrite only change today and yesterday, using
        the group timezone. Older dates need manual approval.
      </p>
      <p>
        {state.lastSync
          ? `Last checked: ${new Date(state.lastSync).toLocaleString("en-GB", { timeZone: zone })}`
          : "No sync completed yet."}{" "}
        Dates use {zone}. Expand a day to view its messages.
      </p>
      <div className="whatsapp-day-actions">
        <label>
          Sync date
          <input
            type="date"
            value={syncDate}
            onChange={(e) => setSyncDate(e.target.value)}
          />
        </label>
        <button
          className="button"
          disabled={busy || !syncDate || !state.config.enabled}
          onClick={() => syncMessages({ dates: [syncDate] })}
        >
          Sync date
        </button>
        <button
          className="button"
          disabled={busy || !state.config.enabled}
          onClick={() => syncMessages({ dates: [today] })}
        >
          Sync today
        </button>
        <button
          className="button"
          disabled={busy || !state.config.enabled}
          onClick={() => syncMessages({ all: true })}
        >
          Sync all history
        </button>
      </div>
      <div className="whatsapp-day-actions">
        <label className="checkbox">
          <input
            type="checkbox"
            disabled={busy || !days.length}
            checked={
              days.length > 0 &&
              days.every((day) => selectedDays.includes(day.date))
            }
            onChange={(e) =>
              setSelectedDays(
                e.target.checked ? days.map((day) => day.date) : [],
              )
            }
          />
          Select all days
        </label>
        <button
          className="button"
          disabled={busy || !selectedDays.length || !state.config.enabled}
          onClick={() => syncMessages({ dates: selectedDays })}
        >
          Sync selected days
        </button>
        <button
          className="button"
          disabled={busy || history || !selectedDays.length}
          onClick={() => clearDays(selectedDays)}
        >
          Clear selected days
        </button>
      </div>
      {days.map((day) => (
        <div
          className="whatsapp-message-day"
          key={`${history}:${state.config.groupId}:${day.date}`}
        >
          <MessageDay
            api={api}
            day={day}
            history={history}
            today={today}
            state={state}
            renderEvent={renderEvent}
            selected={selectedDays.includes(day.date)}
            busy={busy}
            onSelect={(checked) =>
              setSelectedDays((old) =>
                checked
                  ? [...old, day.date]
                  : old.filter((date) => date !== day.date),
              )
            }
            onSync={() => syncMessages({ dates: [day.date] })}
            onClear={() => clearDays([day.date])}
          />
        </div>
      ))}
      {!days.length && (
        <p>
          No messages in this view yet. Choose a date to sync its available
          history.
        </p>
      )}
    </section>
  );
}

function MessageDay({
  api,
  day,
  history,
  today,
  state,
  renderEvent,
  selected,
  busy,
  onSelect,
  onSync,
  onClear,
}) {
  const [open, setOpen] = useState(day.date === today);
  const pages = useRef(1);
  useEffect(() => setOpen(day.date === today), [day.date, today]);
  const [events, setEvents] = useState([]),
    [hasMore, setHasMore] = useState(false),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const source = `${state.config.sessionId}:${state.config.groupId}`;
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setError("");
    if (!state.days) {
      setEvents(
        state.events.filter(
          (event) =>
            new Intl.DateTimeFormat("en-CA", {
              timeZone: state.config.timeZone || "UTC",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(new Date(Number(event.timestamp) * 1000)) === day.date,
        ),
      );
      setLoading(false);
      return;
    }
    Promise.all(
      Array.from({ length: pages.current }, (_, index) =>
        api(
          `/whatsapp/messages?date=${day.date}&offset=${index * 100}${history ? "&history=archived" : ""}`,
        ),
      ),
    )
      .then((results) => {
        if (alive) {
          setEvents(results.flatMap((data) => data.events));
          setHasMore(results.at(-1).hasMore);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, source, history, day.date, state]);
  async function more() {
    setLoading(true);
    setError("");
    try {
      const data = await api(
        `/whatsapp/messages?date=${day.date}&offset=${events.length}${history ? "&history=archived" : ""}`,
      );
      pages.current += 1;
      setEvents((old) => [...old, ...data.events]);
      setHasMore(data.hasMore);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="whatsapp-day-header">
        <input
          type="checkbox"
          className="whatsapp-day-select"
          aria-label={`Select ${day.date}`}
          checked={selected}
          disabled={busy}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onSelect(e.target.checked)}
        />
        <span className="whatsapp-day-title">
          <span className="whatsapp-day-date">
            <span aria-hidden="true" className="whatsapp-day-chevron">
              {open ? "▾" : "▸"}
            </span>
            {new Date(day.date + "T12:00:00Z").toLocaleDateString("en-GB", {
              timeZone: "UTC",
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </span>
          <small>
            {day.count} {day.count === 1 ? "message" : "messages"}
          </small>
        </span>
        <span className="whatsapp-day-buttons">
          <button
            type="button"
            className="button"
            aria-label={`Sync day ${day.date}`}
            disabled={busy || !state.config.enabled}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onSync();
            }}
          >
            Sync
          </button>
          <button
            type="button"
            className="button"
            aria-label={`Clear day ${day.date}`}
            disabled={busy || history}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClear();
            }}
          >
            Clear
          </button>
        </span>
      </summary>
      {open && (
        <div className="whatsapp-day-content">
          {error && <p role="alert">{error}</p>}
          {loading && <p role="status">Loading messages…</p>}
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
              <tbody>{events.map(renderEvent)}</tbody>
            </table>
          </div>
          {hasMore && (
            <button className="button" disabled={loading} onClick={more}>
              Load more messages
            </button>
          )}
        </div>
      )}
    </details>
  );
}
