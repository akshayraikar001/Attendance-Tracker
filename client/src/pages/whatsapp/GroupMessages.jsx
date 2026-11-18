import React, { useEffect, useRef, useState } from "react";
import { useTimeFormatter } from "../../components/common/TimeDisplay.jsx";

export default function GroupMessages({ api, zone, onSelected }) {
  const clock = useTimeFormatter();
  const [date, setDate] = useState("");
  const [history, setHistory] = useState(false);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const startRequested = useRef(false);
  async function load(more = false) {
    const current = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const result = await api(
        "/whatsapp/group-messages?" +
          new URLSearchParams({
            ...(date ? { date } : {}),
            ...(history ? { history: "archived" } : {}),
            offset: more ? data.messages.length : 0,
          }),
      );
      if (current !== generation.current) return;
      if (!date && result.days.length) {
        setDate(result.days[0].date);
        return;
      }
      setData((old) => ({
        ...result,
        messages: more
          ? [...old.messages, ...result.messages]
          : result.messages,
      }));
    } catch (e) {
      if (current === generation.current) setError(e.message);
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    setData(null);
    load();
    return () => {
      generation.current++;
    };
  }, [date, history]);
  useEffect(() => {
    if (data?.scan?.state === "idle" && !history && !scanning) {
      startRequested.current = true;
      setScanning(true);
    }
  }, [data?.scan?.state, history]);
  useEffect(() => {
    if (!scanning || history) return;
    let alive = true,
      timer;
    async function next() {
      try {
        const start = startRequested.current;
        startRequested.current = false;
        const result = await api("/whatsapp/group-messages/scan", {
          ...(date ? { date } : {}),
          start,
        });
        if (!alive) return;
        setData(result);
        if (!date && result.days.length) setDate(result.days[0].date);
        if (["scanning", "waiting"].includes(result.scan.state))
          timer = setTimeout(
            next,
            result.scan.state === "waiting" ? 10000 : 100,
          );
        else setScanning(false);
      } catch (e) {
        if (alive) {
          setError(e.message);
          setScanning(false);
        }
      }
    }
    next();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [scanning, date, history]);
  async function clear(all = false) {
    setScanning(false);
    generation.current++;
    setBusy(true);
    setError("");
    try {
      await api(
        "/whatsapp/group-messages",
        { ...data.source, ...(!all && date ? { date } : {}) },
        "DELETE",
      );
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function select(message) {
    setScanning(false);
    setBusy(true);
    setError("");
    try {
      const event = await api("/whatsapp/group-messages/select", {
        messageId: message.id,
        ...data.source,
      });
      await onSelected(event);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="group-messages">
      <h3>All group messages</h3>
      <div className="whatsapp-actions">
        <label>
          Group message day
          <input
            type="date"
            value={date}
            disabled={busy}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <select
          aria-label="Available message days"
          value={date}
          disabled={busy}
          onChange={(e) => setDate(e.target.value)}
        >
          <option value={date}>{date || "Select day"}</option>
          {data?.days
            .filter((day) => day.date !== date)
            .map((day) => (
              <option key={day.date} value={day.date}>
                {day.date} · {day.count}
              </option>
            ))}
        </select>
        <button
          className="button"
          disabled={busy || scanning}
          onClick={() => load()}
        >
          Refresh messages
        </button>
        <button
          className="button"
          disabled={busy || scanning || history}
          onClick={() => {
            setError("");
            startRequested.current = true;
            setScanning(true);
          }}
        >
          Fetch all messages
        </button>
        {scanning && (
          <button className="button" onClick={() => setScanning(false)}>
            Pause scan
          </button>
        )}
        {!scanning && ["scanning", "waiting"].includes(data?.scan?.state) && (
          <button
            className="button"
            disabled={busy || history}
            onClick={() => setScanning(true)}
          >
            Resume scan
          </button>
        )}
        <button
          className="button"
          disabled={busy || history || !date || !data?.messages.length}
          onClick={() => clear()}
        >
          Clear day
        </button>
        <button
          className="button"
          disabled={busy || history || !data?.days.length}
          onClick={() => clear(true)}
        >
          Clear all messages
        </button>
      </div>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={history}
          disabled={busy}
          onChange={(e) => {
            setScanning(false);
            setHistory(e.target.checked);
          }}
        />
        Show cleared group messages
      </label>
      {scanning && (
        <p role="status">
          {data?.scan?.state === "waiting"
            ? "Waiting for WhatsApp history…"
            : "Scanning…"}{" "}
          · {data?.scan?.scanned || 0} messages
        </p>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Sender</th>
              <th>Message</th>
              <th>Time</th>
              <th>In time</th>
              <th>Out time</th>
              <th>Attendance</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {data?.messages.map((message) => (
              <tr key={message.id}>
                <td>
                  {message.senderName || message.sender || "Unknown sender"}
                </td>
                <td>
                  {message.content ||
                    message.caption ||
                    "[" + message.type + "]"}
                  {message.isEdited && <span className="badge">Edited</span>}
                </td>
                <td>
                  {new Date(
                    Number(message.timestamp) * 1000,
                  ).toLocaleTimeString("en-GB", { timeZone: zone })}
                </td>
                <td>{clock(message.inTime)}</td>
                <td>{clock(message.outTime)}</td>
                <td>{message.attendanceState || "—"}</td>
                <td>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => select(message)}
                  >
                    Select for review
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {busy && <p role="status">Loading…</p>}
      {!busy && data && !data.messages.length && <p>No messages.</p>}
      {data?.hasMore && (
        <button
          className="button"
          disabled={busy || scanning}
          onClick={() => load(true)}
        >
          Load more messages
        </button>
      )}
    </div>
  );
}
