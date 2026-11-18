import React, { useEffect, useRef, useState } from "react";
import api from "../../services/api.js";
import { today } from "../../utils/display.js";

export default function SendEmployeeReport() {
  const [month, setMonth] = useState(today().slice(0, 7));
  const [format, setFormat] = useState("pdf"),
    [detail, setDetail] = useState("detailed");
  const [rows, setRows] = useState([]),
    [selected, setSelected] = useState([]);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [resend, setResend] = useState(true),
    [revision, setRevision] = useState(0);
  const stopped = useRef(false);
  const params = new URLSearchParams({ month, format, detail }).toString();
  useEffect(() => {
    stopped.current = false;
    return () => {
      stopped.current = true;
    };
  }, []);
  useEffect(() => {
    let alive = true;
    setSelected([]);
    setRows([]);
    setError("");
    setNotice("");
    setLoading(true);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      setLoading(false);
      return;
    }
    api("/employee-reports?" + params)
      .then((data) => {
        if (alive) setRows(data);
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
  }, [params, revision]);
  const eligible = (row) =>
    Boolean(row.phone) &&
    row.delivery?.state !== "sending" &&
    (!row.delivery || resend);
  const available = rows.filter(eligible);
  const chosen = rows.filter(
    (row) => selected.includes(row.id) && eligible(row),
  );
  async function sendReports() {
    const targets = chosen;
    if (
      !targets.length ||
      !window.confirm(
        `Send ${month} ${format.toUpperCase()} reports (${detail === "detailed" ? "with time & details" : "simple attendance"}) privately to these ${targets.length} employees?\n\n${targets.map((r) => `${r.name} — ${r.phone}`).join("\n")}${resend ? "\n\nPreviously attempted reports may be sent again." : ""}`,
      )
    )
      return;
    stopped.current = false;
    setBusy(true);
    setError("");
    setNotice("");
    let sent = 0,
      failed = 0;
    for (const row of targets) {
      if (stopped.current) break;
      setNotice(
        `Sending ${sent + failed + 1} of ${targets.length}: ${row.name}`,
      );
      try {
        await api("/employee-reports/send", {
          employeeId: row.id,
          month,
          format,
          detail,
          resend,
        });
        sent++;
        if (!stopped.current)
          setRows((old) =>
            old.map((r) =>
              r.id === row.id
                ? {
                    ...r,
                    delivery: {
                      state: "sent",
                      sentAt: new Date().toISOString(),
                      phone: row.phone,
                    },
                  }
                : r,
            ),
          );
      } catch (e) {
        failed++;
        if (!stopped.current) {
          setError(e.message);
          setRows((old) =>
            old.map((r) =>
              r.id === row.id
                ? { ...r, delivery: { state: "unknown", error: e.message } }
                : r,
            ),
          );
        }
      }
    }
    if (!stopped.current) {
      setNotice(
        `${sent} sent · ${failed} not confirmed. Refresh status before retrying.`,
      );
      setSelected([]);
      setBusy(false);
    }
  }
  return (
    <section className="card send-employee-report">
      <div className="card-heading">
        <div>
          <h2>Send Emp Report</h2>
          <p>
            Each selected employee receives only their own monthly report in a
            private WhatsApp message.
          </p>
        </div>
      </div>
      <fieldset disabled={busy} className="report-send-controls">
        <label>
          Report month
          <input
            type="month"
            required
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </label>
        <label>
          File format
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="pdf">PDF</option>
            <option value="xlsx">Excel</option>
          </select>
        </label>
        <label>
          Report contents
          <select value={detail} onChange={(e) => setDetail(e.target.value)}>
            <option value="detailed">
              {format === "xlsx" ? "With times" : "With time & details"}
            </option>
            <option value="simple">Simple attendance only</option>
          </select>
        </label>
        <button
          className="button"
          disabled={loading}
          onClick={() => setRevision((n) => n + 1)}
        >
          Refresh status
        </button>
      </fieldset>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={resend}
          disabled={busy}
          onChange={(e) => {
            setResend(e.target.checked);
            setSelected([]);
          }}
        />
        Allow resending previously attempted reports
      </label>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {loading ? (
        <p role="status">Loading employees…</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select all eligible employees"
                    disabled={busy || !available.length}
                    checked={
                      available.length > 0 &&
                      available.every((r) => selected.includes(r.id))
                    }
                    onChange={(e) =>
                      setSelected(
                        e.target.checked ? available.map((r) => r.id) : [],
                      )
                    }
                  />
                </th>
                <th>Employee</th>
                <th>WhatsApp number</th>
                <th>Attendance report sent</th>
                <th>Preview / download</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.name}`}
                      checked={selected.includes(row.id)}
                      disabled={busy || !eligible(row)}
                      onChange={(e) =>
                        setSelected((ids) =>
                          e.target.checked
                            ? [...ids, row.id]
                            : ids.filter((id) => id !== row.id),
                        )
                      }
                    />
                  </td>
                  <td>
                    {row.name}
                    {row.status === "Inactive" && <small>Inactive</small>}
                  </td>
                  <td>{row.phone || "Add employee phone number"}</td>
                  <td>
                    <strong
                      className={
                        row.delivery?.state === "sent" ? "report-sent" : ""
                      }
                    >
                      {row.delivery?.state === "sent"
                        ? "✓ Sent"
                        : row.delivery?.state === "sending"
                          ? "Sending…"
                          : row.delivery
                            ? "Not confirmed — check WhatsApp"
                            : "Not sent"}
                    </strong>
                    {row.delivery?.sentAt && (
                      <small>
                        Last sent:{" "}
                        {new Date(
                          row.delivery.sentAt.endsWith("Z")
                            ? row.delivery.sentAt
                            : row.delivery.sentAt.replace(" ", "T") + "Z",
                        ).toLocaleString()}
                      </small>
                    )}
                    {row.delivery?.phone &&
                      row.delivery.phone !== row.phone && (
                        <small>Previously sent to {row.delivery.phone}</small>
                      )}
                  </td>
                  <td>
                    <a
                      className="button"
                      href={`/api/employee-reports/${row.id}/download?${params}`}
                    >
                      Download {format.toUpperCase()}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <p className="empty">No employees for this selection.</p>
          )}
        </div>
      )}
      <div className="report-send-footer">
        <span>{chosen.length} employee(s) selected</span>
        <button
          className="primary"
          disabled={busy || loading || !chosen.length}
          onClick={sendReports}
        >
          {busy ? "Sending…" : "Send selected reports"}
        </button>
      </div>
    </section>
  );
}
