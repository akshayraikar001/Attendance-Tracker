import React, { useState, useEffect } from "react";
export default function UserManagement({ api, user, onLogout }) {
  const [users, setUsers] = useState([]),
    [edit, setEdit] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function load() {
    try {
      setUsers(await api("/users"));
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const data = Object.fromEntries(new FormData(e.currentTarget));
    data.active = data.active === "on";
    if (!data.password) delete data.password;
    try {
      await api(
        "/users" + (edit.id ? "/" + edit.id : ""),
        data,
        edit.id ? "PUT" : "POST",
      );
      setEdit(null);
      setMessage(
        "Account saved. Password, role, and deactivation changes revoke existing sessions.",
      );
      await load();
      if (edit.id === user.id && data.password)
        window.dispatchEvent(new Event("session-expired"));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card users-card">
      <div className="card-heading">
        <div>
          <h2>User management</h2>
          <p>
            Login accounts are separate from employee records. Admins manage
            users and settings; staff manage attendance, employees, and reports.
          </p>
        </div>
        <button
          className="primary"
          onClick={() => {
            setEdit({ name: "", username: "", role: "Staff", active: true });
            setError("");
          }}
        >
          Add user
        </button>
      </div>
      {error && (
        <p role="alert" className="bulk-message error-text">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="bulk-message">
          {message}
        </p>
      )}
      {edit && (
        <form key={edit.id || "new"} className="user-editor" onSubmit={save}>
          <h3>{edit.id ? "Edit account" : "New account"}</h3>
          <div className="form-grid">
            <label>
              Name
              <input
                name="name"
                defaultValue={edit.name}
                required
                minLength={2}
                maxLength={100}
              />
            </label>
            <label>
              Username
              <input
                name="username"
                defaultValue={edit.username}
                required
                disabled={!!edit.id}
                minLength={3}
                maxLength={60}
                pattern="[A-Za-z0-9._-]+"
              />
            </label>
            <label>
              {edit.id ? "New password (leave blank to keep)" : "Password"}
              <input
                name="password"
                type="password"
                required={!edit.id}
                minLength={10}
                maxLength={128}
                autoComplete="new-password"
              />
            </label>
            <label>
              Access role
              <select name="role" defaultValue={edit.role}>
                <option>Staff</option>
                <option>Admin</option>
              </select>
            </label>
            <label className="checkbox">
              <input
                name="active"
                type="checkbox"
                defaultChecked={edit.active}
              />
              Active account
            </label>
          </div>
          <div className="form-footer">
            <button
              type="button"
              className="button"
              onClick={() => setEdit(null)}
              disabled={busy}
            >
              Cancel
            </button>
            <button className="primary" disabled={busy}>
              Save account
            </button>
          </div>
        </form>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Username</th>
              <th>Access</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  {u.name}
                  {u.id === user.id ? " (you)" : ""}
                </td>
                <td>{u.username}</td>
                <td>{u.role}</td>
                <td>{u.active ? "Active" : "Disabled"}</td>
                <td>
                  <button
                    className="button"
                    onClick={() => {
                      setEdit(u);
                      setError("");
                    }}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
export function AccountSettings({ api, onLogout }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    if (data.password !== data.confirm)
      return setError("New passwords do not match.");
    setBusy(true);
    setError("");
    try {
      await api("/auth/password", data);
      window.dispatchEvent(new Event("session-expired"));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card user-editor">
      <h2>Change password</h2>
      <p>Changing your password signs out all sessions.</p>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label>
            Current password
            <input
              type="password"
              name="currentPassword"
              required
              autoComplete="current-password"
            />
          </label>
          <label>
            New password
            <input
              type="password"
              name="password"
              required
              minLength={10}
              maxLength={128}
              autoComplete="new-password"
            />
          </label>
          <label>
            Confirm new password
            <input
              type="password"
              name="confirm"
              required
              minLength={10}
              maxLength={128}
              autoComplete="new-password"
            />
          </label>
        </div>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          Change password
        </button>
      </form>
    </section>
  );
}
