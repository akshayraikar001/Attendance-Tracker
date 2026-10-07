import React, { useEffect, useState } from "react";
export default function LeaveApproval({
  api,
  employees,
  onReload,
  onOpenWhatsApp,
}) {
  const [state, setState] = useState(null),
    [error, setError] = useState(""),
    [fetchError, setFetchError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState(null),
    [filter, setFilter] = useState("pending"),
    [offset, setOffset] = useState(0);
  const path = `/leave?state=${filter}&offset=${offset}`;
  async function load() {
    const result = await api(path);
    setState(result);
    setFetchError("");
  }
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      api(path)
        .then((data) => {
          if (alive) {
            setState(data);
            setFetchError("");
          }
        })
        .catch((e) => {
          if (alive) setFetchError(e.message);
        });
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [path]);
  async function action(fn) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!state)
    return (
      <section className="card whatsapp-settings">
        <h2>Leave Approval</h2>
        <p role="status">{error || fetchError || "Loading leave requests…"}</p>
      </section>
    );
  function open(request) {
    setError("");
    setReview({
      id: request.id,
      employeeId: request.employeeId || "",
      kind: request.kind,
      from: request.fromDate || "",
      to: request.toDate || "",
      overwrite: false,
    });
  }
  async function approve(e) {
    e.preventDefault();
    if (
      review.overwrite &&
      !window.confirm(
        `Replace existing attendance from ${review.from} to ${review.to} for this employee? Existing In/Out times on those dates will be removed.`,
      )
    )
      return;
    await action(async () => {
      const result = await api(`/leave/${review.id}/approve`, {
        ...review,
        employeeId: Number(review.employeeId),
      });
      setReview(null);
      setNotice(`Approved ${result.days} day(s). Attendance updated.`);
      if (onReload) await onReload();
    });
  }
  return (
    <section className="card whatsapp-settings leave-approval">
      <h2>Leave Approval</h2>
      <p>
        Review WhatsApp leave and half-day requests. Approval is always manual.
        Full-day leave is recorded as <strong>Absent</strong>; half-day leave as{" "}
        <strong>Half day</strong>.
      </p>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={state.enabled}
          disabled={busy}
          onChange={(e) => {
            const enabled = e.target.checked;
            action(async () => {
              await api("/leave/config", { enabled }, "PUT");
              setNotice(
                enabled
                  ? "Leave request collection enabled."
                  : "Leave request collection paused.",
              );
            });
          }}
        />{" "}
        Allow Leave Approval
      </label>
      <p>
        <strong>Shared group:</strong>{" "}
        {state.groupName || "Select a group in WhatsApp settings"} ·{" "}
        {state.timeZone || "Timezone not set"}
        <br />
        Uses the same linked device and sync settings: {
          state.messagesPerSync
        }{" "}
        messages per sync, every {state.syncIntervalMinutes} minute(s).
      </p>
      <div className="whatsapp-actions">
        <button className="button" onClick={onOpenWhatsApp} disabled={busy}>
          WhatsApp settings
        </button>
        <button
          className="button"
          disabled={busy || !state.enabled}
          onClick={() =>
            action(async () => {
              const result = await api("/leave/sync", {});
              if (result.error) throw new Error(result.error);
              setNotice(
                "Sync checked. Remaining history continues in later batches.",
              );
            })
          }
        >
          Sync leave requests
        </button>
      </div>
      <p className="muted">
        Example: “I am on leave tomorrow” uses the date the message was sent.
        “Leave from 8 to 10 Oct” includes all three days. Confirm suggested
        dates before approving.
      </p>
      {state.syncProgress && (
        <p role="status">
          Shared sync is continuing through saved history. Requests appear as
          messages are fetched.
        </p>
      )}
      {state.error && (
        <p className="error-text" role="alert">
          Last sync error: {state.error}
        </p>
      )}
      {fetchError && (
        <p role="alert" className="error-text">
          {fetchError}
        </p>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <label>
        Requests{" "}
        <select
          aria-label="Request status"
          value={filter}
          disabled={busy}
          onChange={(e) => {
            setFilter(e.target.value);
            setOffset(0);
            setReview(null);
          }}
        >
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="all">All requests</option>
        </select>
      </label>
      <div className="leave-request-list">
        {state.requests.map((request) => (
          <article key={request.id} className="leave-request">
            <div className="leave-request-heading">
              <strong>
                {request.employeeName ||
                  request.senderName ||
                  "Unknown employee"}
              </strong>
              <span className="badge">{request.state}</span>
            </div>
            <small>
              {request.senderId} ·{" "}
              {new Date(Number(request.timestamp) * 1000).toLocaleString(
                undefined,
                { timeZone: state.timeZone || "UTC" },
              )}
            </small>
            <blockquote>{request.text}</blockquote>
            <p>
              <strong>
                {request.kind === "Absent" ? "Leave / Absent" : "Half day"}
              </strong>{" "}
              ·{" "}
              {request.fromDate
                ? `${request.fromDate} → ${request.toDate}`
                : "Dates need review"}
            </p>
            {request.reason && <p className="muted">{request.reason}</p>}
            {request.state === "pending" && review?.id !== request.id && (
              <button
                className="button"
                disabled={busy || !state.enabled}
                onClick={() => open(request)}
              >
                Review request
              </button>
            )}
            {request.state === "pending" && review?.id === request.id && (
              <form onSubmit={approve} aria-label="Review leave request">
                <fieldset disabled={busy || !state.enabled}>
                  <div className="form-grid">
                    <label>
                      Employee
                      <select
                        required
                        value={review.employeeId}
                        onChange={(e) =>
                          setReview({ ...review, employeeId: e.target.value })
                        }
                      >
                        <option value="">Select employee</option>
                        {employees
                          .filter((e) => e.status === "Active")
                          .map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Leave type
                      <select
                        value={review.kind}
                        onChange={(e) =>
                          setReview({ ...review, kind: e.target.value })
                        }
                      >
                        <option value="Absent">Leave / Absent</option>
                        <option value="Half day">Half day</option>
                      </select>
                    </label>
                    <label>
                      From date
                      <input
                        type="date"
                        required
                        value={review.from}
                        onChange={(e) =>
                          setReview({ ...review, from: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      To date
                      <input
                        type="date"
                        required
                        min={review.from || undefined}
                        value={review.to}
                        onChange={(e) =>
                          setReview({ ...review, to: e.target.value })
                        }
                      />
                    </label>
                  </div>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={review.overwrite}
                      onChange={(e) =>
                        setReview({ ...review, overwrite: e.target.checked })
                      }
                    />{" "}
                    Replace existing attendance on these dates
                  </label>
                  <small>
                    Leave unchecked to protect saved In/Out times and statuses.
                    A conflict blocks the entire approval.
                  </small>
                  <div className="whatsapp-actions">
                    <button className="primary" type="submit">
                      Approve leave
                    </button>
                    <button
                      className="button"
                      type="button"
                      onClick={() => {
                        if (
                          window.confirm(
                            "Reject this leave request? Attendance will not change.",
                          )
                        )
                          action(async () => {
                            await api(`/leave/${request.id}/reject`, {});
                            setReview(null);
                            setNotice("Request rejected.");
                          });
                      }}
                    >
                      Reject request
                    </button>
                    <button
                      className="button"
                      type="button"
                      onClick={() => setReview(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </fieldset>
              </form>
            )}
          </article>
        ))}
      </div>
      {!state.requests.length && (
        <p>
          No {filter === "all" ? "" : filter + " "}leave requests.{" "}
          {state.enabled
            ? "Sync to check the selected group."
            : "Enable collection to start."}
        </p>
      )}
      <div className="whatsapp-actions">
        <button
          className="button"
          disabled={busy || offset === 0}
          onClick={() => {
            setOffset(Math.max(0, offset - 100));
            setReview(null);
          }}
        >
          Previous requests
        </button>
        <span>{state.total} request(s)</span>
        <button
          className="button"
          disabled={busy || !state.hasMore}
          onClick={() => {
            setOffset(offset + 100);
            setReview(null);
          }}
        >
          Next requests
        </button>
      </div>
    </section>
  );
}
