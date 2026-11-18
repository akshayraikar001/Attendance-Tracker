import { holidayAdjustedRecords } from "../../../../shared/calendar.js";
import React, { useEffect, useRef, useState } from "react";
import {
  LayoutDashboard,
  CalendarDays,
  CalendarCheck,
  ChartNoAxesCombined,
  Coffee,
  MapPin,
  LogOut,
  Menu,
  X,
  Sun,
  Moon,
  ArrowUpRight,
  Clock3,
  CheckCircle2,
  Timer,
  Download,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import LocationTracking from "../locations/LocationTracking.jsx";
import api from "../../services/api.js";
import AttendanceCalendar from "../calendar/AttendanceCalendar.jsx";
import TimeAway from "../attendance/TimeAway.jsx";
import { TimeFormatContext } from "../../components/common/TimeDisplay.jsx";
import WorkedTime from "../../components/common/WorkedTime.jsx";
import useTheme from "../../hooks/useTheme.js";
import { today, fmt, initials, shortDate } from "../../utils/display.js";
import { formatTime } from "../../../../shared/time.js";
import { addDays, holidayForDate } from "../../../../shared/calendar.js";
import { downloadAttendanceWorkbook } from "../../utils/exportWorkbook.js";
const navigation = [
  ["Dashboard", LayoutDashboard],
  ["My attendance", CalendarCheck],
  ["Calendar", CalendarDays],
  ["Reports", ChartNoAxesCombined],
  ["Time away", Coffee],
];
const statusClass = (status) => status.toLowerCase().replaceAll(" ", "-");
function Status({ value }) {
  return (
    <span className={"badge " + statusClass(value)}>
      <i aria-hidden="true" />
      {value}
    </span>
  );
}
export default function EmployeeWorkspace({ user, onLogout }) {
  const [page, setPage] = useState("Dashboard"),
    [profile, setProfile] = useState(null),
    [savedRecords, setRecords] = useState([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [date, setDate] = useState(today()),
    [month, setMonth] = useState(today().slice(0, 7)),
    [filter, setFilter] = useState("All statuses"),
    [menuOpen, setMenuOpen] = useState(false),
    [exporting, setExporting] = useState(false);
  const records = holidayAdjustedRecords(
    savedRecords,
    profile?.holidays,
    profile?.weeklyOffDays,
  );
  const [theme, setTheme] = useTheme();
  const sidebar = useRef(null),
    menuButton = useRef(null);
  async function load() {
    setLoading(true);
    setError("");
    try {
      const [p, r] = await Promise.all([
        api("/me/profile"),
        api("/me/attendance"),
      ]);
      setProfile(p);
      setRecords(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    const media = window.matchMedia?.("(min-width: 761px)");
    if (!media) return;
    const closeOnDesktop = () => {
      if (media.matches) setMenuOpen(false);
    };
    media.addEventListener("change", closeOnDesktop);
    return () => media.removeEventListener("change", closeOnDesktop);
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sidebar.current?.querySelector("button")?.focus();
    function keyboard(e) {
      if (e.key === "Escape") setMenuOpen(false);
      if (e.key === "Tab") {
        const buttons = [...sidebar.current.querySelectorAll("button")].filter(
          (b) => !b.disabled,
        );
        const first = buttons[0],
          last = buttons.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", keyboard);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", keyboard);
      menuButton.current?.focus();
    };
  }, [menuOpen]);
  function navigate(next) {
    setPage(next);
    setMenuOpen(false);
    setFilter("All statuses");
  }
  async function logout() {
    try {
      await onLogout();
    } catch (e) {
      setError(e.message);
    }
  }
  async function download() {
    setExporting(true);
    setError("");
    try {
      await downloadAttendanceWorkbook(selected, {
        filename: `my-attendance-${month}.xlsx`,
        employeeReport: true,
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  }
  const currentDate = today(),
    employee = profile?.employee;
  const selected = records
    .filter((r) => r.date.startsWith(month))
    .sort((a, b) => b.date.localeCompare(a.date));
  const visible = selected.filter(
    (r) => filter === "All statuses" || r.status === filter,
  );
  const current = records.find((r) => r.date === currentDate);
  const dayStatus =
    current?.status ||
    (holidayForDate(currentDate, profile?.holidays, profile?.weeklyOffDays)
      ? "Holiday"
      : "Unmarked");
  const sum = (field) => selected.reduce((n, r) => n + (r[field] || 0), 0);
  const present = selected.filter((r) => r.status === "Present").length;
  const monthLabel = new Date(month + "-01T12:00:00").toLocaleDateString(
    "en-US",
    { month: "long", year: "numeric" },
  );
  const groups = [
    "Present",
    "Half day",
    "Attended",
    "Absent",
    "In progress",
    "Holiday",
  ]
    .map((status) => ({
      status,
      count: selected.filter((r) => r.status === status).length,
    }))
    .filter((g) => g.count);
  const week = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(currentDate, i - 6),
      entry = records.find((r) => r.date === day);
    return {
      day,
      entry,
      status:
        entry?.status ||
        (holidayForDate(day, profile?.holidays, profile?.weeklyOffDays)
          ? "Holiday"
          : "Unmarked"),
    };
  });
  function table(rows) {
    return (
      <div className="table-scroll">
        <table className="employee-records">
          <thead>
            <tr>
              <th>Date</th>
              <th>Status</th>
              <th>In time</th>
              <th>Out time</th>
              <th>Worked</th>
              {page !== "Reports" && <th>Late</th>}
              <th>Overtime</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id || r.date}>
                <td>{shortDate(r.date)}</td>
                <td>
                  <Status value={r.status} />
                </td>
                <td>{formatTime(r.inTime, profile?.timeFormat || "12h")}</td>
                <td>
                  {formatTime(r.outTime, profile?.timeFormat || "12h")}
                  {r.overnight && <small>Next day</small>}
                </td>
                <td>
                  <WorkedTime entry={r} />
                </td>
                {page !== "Reports" && <td>{fmt(r.lateMinutes)}</td>}
                <td>{fmt(r.overtimeMinutes)}</td>
                <td className="attendance-note">{r.notes || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <div className="employee-empty">
            <CalendarDays size={28} />
            <h3>No attendance to show</h3>
          </div>
        )}
      </div>
    );
  }
  return (
    <TimeFormatContext.Provider value={profile?.timeFormat || "12h"}>
      <div className="employee-shell">
        {menuOpen && (
          <button
            className="employee-shade"
            aria-label="Close navigation"
            onClick={() => setMenuOpen(false)}
          />
        )}
        <aside
          id="employee-sidebar"
          ref={sidebar}
          className={"employee-sidebar" + (menuOpen ? " is-open" : "")}
          aria-label="Employee sidebar"
        >
          <div className="employee-brand">
            <span className="employee-brand-mark">
              d<span>•</span>
            </span>
            <strong>
              dayline<span>.</span>
            </strong>
            <button
              className="employee-menu-close"
              aria-label="Close menu"
              onClick={() => setMenuOpen(false)}
            >
              <X size={20} />
            </button>
          </div>
          <div className="employee-workspace-label">
            <span className="employee-online" />
            Personal workspace
          </div>
          <span className="employee-nav-label">MY WORKSPACE</span>
          <nav aria-label="Employee navigation">
            {[
              ...navigation,
              ...(employee?.locationTrackingEnabled
                ? [["Location tracking", MapPin]]
                : []),
            ].map(([label, Icon]) => (
              <button
                key={label}
                className={page === label ? "is-active" : ""}
                aria-current={page === label ? "page" : undefined}
                onClick={() => navigate(label)}
              >
                <Icon size={19} />
                {label}
                {page === label && <span className="employee-nav-dot" />}
              </button>
            ))}
          </nav>
          <div className="employee-sidebar-footer">
            <button className="employee-signout" onClick={logout}>
              <LogOut size={18} />
              Sign out
            </button>
            <div className="employee-identity">
              <span className="employee-avatar">{initials(user.name)}</span>
              <div>
                <strong>{user.name}</strong>
                <small>{employee?.department || "Employee account"}</small>
              </div>
            </div>
          </div>
        </aside>
        <div className="employee-body" inert={menuOpen ? "" : undefined}>
          <header className="employee-topbar">
            <div>
              <button
                ref={menuButton}
                className="button employee-menu-toggle"
                aria-label="Open navigation"
                aria-expanded={menuOpen}
                aria-controls="employee-sidebar"
                onClick={() => setMenuOpen(true)}
              >
                <Menu size={20} />
              </button>
              <span>
                <span className="employee-breadcrumb-root">
                  My workspace <span className="employee-breadcrumb">/</span>
                </span>{" "}
                <strong>{page}</strong>
              </span>
            </div>
            <div>
              <span className="employee-today-label">
                {new Date(currentDate + "T12:00:00").toLocaleDateString(
                  "en-US",
                  { weekday: "short", month: "short", day: "numeric" },
                )}
              </span>
              <button
                className="button employee-theme"
                aria-label={
                  theme === "dark"
                    ? "Switch to light theme"
                    : "Switch to dark theme"
                }
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
              </button>
              <span className="employee-avatar small">
                {initials(user.name)}
              </span>
            </div>
          </header>
          <main className="employee-main">
            <div className="employee-page-heading">
              <div>
                <span className="employee-eyebrow">
                  YOUR PERSONAL WORKSPACE
                </span>
                <h1>
                  {page === "Dashboard"
                    ? `Hello, ${user.name.split(" ")[0]}`
                    : page}
                </h1>
              </div>
              <div className="employee-heading-actions">
                {!["Calendar", "Time away", "Location tracking"].includes(
                  page,
                ) && (
                  <label className="employee-month">
                    Month
                    <input
                      aria-label="Report month"
                      type="month"
                      value={month}
                      onChange={(e) =>
                        e.target.value && setMonth(e.target.value)
                      }
                    />
                  </label>
                )}
                <button
                  className="button"
                  aria-label="Refresh attendance"
                  disabled={loading}
                  onClick={load}
                >
                  <RefreshCw size={16} />
                </button>
              </div>
            </div>
            {error && (
              <div role="alert" className="error-banner">
                {error}
                <button className="button" disabled={loading} onClick={load}>
                  Try again
                </button>
              </div>
            )}
            {loading && !profile && (
              <section className="card employee-loading" role="status">
                <Clock3 size={26} />
                <p>Loading your attendance…</p>
              </section>
            )}
            {profile && (
              <>
                {page === "Dashboard" && (
                  <section className="employee-welcome">
                    <div>
                      <span className="employee-eyebrow">
                        TODAY · {shortDate(currentDate)}
                      </span>
                      <h2>Today</h2>

                      <button onClick={() => navigate("My attendance")}>
                        View my attendance <ArrowUpRight size={17} />
                      </button>
                    </div>
                    <div className="employee-today-card">
                      <div>
                        <span>Today’s attendance</span>
                        <Status value={dayStatus} />
                      </div>
                      <dl>
                        <div>
                          <dt>Clock in</dt>
                          <dd>
                            {formatTime(
                              current?.inTime,
                              profile.timeFormat || "12h",
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>Clock out</dt>
                          <dd>
                            {formatTime(
                              current?.outTime,
                              profile.timeFormat || "12h",
                            )}
                            {current?.overnight && <small>Next day</small>}
                          </dd>
                        </div>
                        <div>
                          <dt>Worked</dt>
                          <dd>{fmt(current?.workedMinutes)}</dd>
                        </div>
                      </dl>
                    </div>
                  </section>
                )}
                {["Dashboard", "Reports"].includes(page) && (
                  <>
                    <div className="employee-section-heading">
                      <h2>{monthLabel} overview</h2>
                      <span>
                        {selected.length} recorded{" "}
                        {selected.length === 1 ? "day" : "days"}
                      </span>
                    </div>
                    <div className="employee-metrics">
                      {[
                        [CheckCircle2, "Present days", present, "green"],
                        [
                          Clock3,
                          "Worked hours",
                          fmt(sum("workedMinutes")),
                          "blue",
                        ],
                        [
                          Timer,
                          "Late arrivals",
                          selected.filter((r) => r.lateMinutes > 0).length,
                          "amber",
                        ],
                        [
                          ArrowUpRight,
                          "Overtime",
                          fmt(sum("overtimeMinutes")),
                          "purple",
                        ],
                      ].map(([Icon, label, value, tone]) => (
                        <article className="card employee-metric" key={label}>
                          <div>
                            <span className={"employee-metric-icon " + tone}>
                              <Icon size={20} />
                            </span>
                            <span>{label}</span>
                          </div>
                          <strong>{value}</strong>
                        </article>
                      ))}
                    </div>
                    <div className="employee-insights">
                      <section className="card employee-breakdown">
                        <div className="employee-section-heading">
                          <h2>Attendance breakdown</h2>
                          <span>{monthLabel}</span>
                        </div>
                        {groups.length ? (
                          <>
                            <div
                              className="employee-status-bar"
                              aria-label="Attendance status distribution"
                            >
                              {groups.map((g) => (
                                <span
                                  key={g.status}
                                  className={statusClass(g.status)}
                                  style={{ flex: g.count }}
                                  title={`${g.status}: ${g.count} days`}
                                />
                              ))}
                            </div>
                            <div className="employee-status-list">
                              {groups.map((g) => (
                                <div key={g.status}>
                                  <span>
                                    <i className={statusClass(g.status)} />
                                    {g.status}
                                  </span>
                                  <strong>
                                    {g.count}{" "}
                                    <small>
                                      {g.count === 1 ? "day" : "days"}
                                    </small>
                                  </strong>
                                </div>
                              ))}
                            </div>
                          </>
                        ) : (
                          <p className="employee-no-data">
                            No recorded attendance.
                          </p>
                        )}
                      </section>
                      <section className="card employee-week">
                        <div className="employee-section-heading">
                          <h2>Last 7 days</h2>
                          <CalendarDays size={18} />
                        </div>
                        <div className="employee-week-strip">
                          {week.map(({ day, status }) => (
                            <button
                              key={day}
                              title={`${shortDate(day)} · ${status}`}
                              aria-label={`${shortDate(day)}: ${status}; open calendar`}
                              className={day === currentDate ? "is-today" : ""}
                              onClick={() => {
                                setDate(day);
                                navigate("Calendar");
                              }}
                            >
                              <span>
                                {new Date(day + "T12:00:00").toLocaleDateString(
                                  "en-US",
                                  { weekday: "short" },
                                )}
                              </span>
                              <strong>{Number(day.slice(-2))}</strong>
                              <i className={statusClass(status)} />
                            </button>
                          ))}
                        </div>
                        <div className="employee-week-footer">
                          <span>
                            <i className="present" />
                            Present
                          </span>
                          <span>
                            <i className="absent" />
                            Absent
                          </span>
                          <span>
                            <i className="unmarked" />
                            Unmarked
                          </span>
                          <button onClick={() => navigate("Calendar")}>
                            Calendar <ArrowRight size={15} />
                          </button>
                        </div>
                      </section>
                    </div>
                  </>
                )}
                {page === "Location tracking" ? (
                  <LocationTracking />
                ) : page === "Calendar" ? (
                  <AttendanceCalendar
                    employees={[employee]}
                    records={records}
                    holidays={profile.holidays}
                    weeklyOffDays={profile.weeklyOffDays}
                    date={date}
                    setDate={setDate}
                    canManageHolidays={false}
                  />
                ) : page === "Time away" ? (
                  <TimeAway readOnly />
                ) : (
                  <section className="card employee-history">
                    <div className="employee-section-heading">
                      <div>
                        <h2>
                          {page === "Dashboard"
                            ? "Recent attendance"
                            : page === "Reports"
                              ? "Monthly attendance report"
                              : "Attendance history"}
                        </h2>
                        <p>
                          {page === "Dashboard"
                            ? "Your latest records for the selected month."
                            : `${monthLabel} · ${visible.length} records`}
                        </p>
                      </div>
                      {page === "Dashboard" ? (
                        <button
                          className="button"
                          onClick={() => navigate("My attendance")}
                        >
                          View all <ArrowRight size={16} />
                        </button>
                      ) : page === "Reports" ? (
                        <button
                          className="primary"
                          onClick={download}
                          disabled={exporting || !selected.length}
                        >
                          <Download size={16} />
                          {exporting ? "Exporting…" : "Export my report"}
                        </button>
                      ) : (
                        <label>
                          Status
                          <select
                            aria-label="Attendance status"
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                          >
                            <option>All statuses</option>
                            {[...new Set(selected.map((r) => r.status))].map(
                              (s) => (
                                <option key={s}>{s}</option>
                              ),
                            )}
                          </select>
                        </label>
                      )}
                    </div>
                    {table(
                      page === "Dashboard" ? selected.slice(0, 5) : visible,
                    )}
                  </section>
                )}
                <footer className="employee-page-footer">
                  <span>Only your attendance is shown here.</span>
                  <span>Need a correction? Contact your administrator.</span>
                </footer>
              </>
            )}
          </main>
        </div>
      </div>
    </TimeFormatContext.Provider>
  );
}
