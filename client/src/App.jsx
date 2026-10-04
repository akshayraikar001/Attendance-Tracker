import EmployeeReport from "./components/EmployeeReport.jsx";
import UserManagement, {
  AccountSettings,
} from "./components/UserManagement.jsx";
import { TimeFormatContext, TimeInput } from "./components/TimeDisplay.jsx";
import { formatTime } from "../../shared/time.js";
import WorkspaceSettings from "./components/WorkspaceSettings.jsx";
import BulkAbsence from "./components/BulkAbsence.jsx";
import MonthlyReport from "./components/MonthlyReport.jsx";
import DateNavigator, { RangeNavigator } from "./components/DateNavigator.jsx";
import { holidayForDate } from "../../shared/calendar.js";
import AttendanceCalendar from "./components/AttendanceCalendar.jsx";
import { downloadAttendanceWorkbook } from "./lib/exportWorkbook.js";
import TimingSettings, {
  effectiveRules,
} from "./components/TimingSettings.jsx";
import DailyReport from "./components/DailyReport.jsx";
import React, { useEffect, useState } from "react";
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  ChartNoAxesCombined,
  Settings,
  ArrowUpRight,
  ArrowDownRight,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Plus,
  Search,
  Download,
  Clock,
  Check,
  CheckCheck,
  ArrowRight,
  Ellipsis,
  X,
  Sun,
  Moon,
  PanelLeftClose,
  LogOut,
  SlidersHorizontal,
  History,
  CheckCircle2,
  AlertCircle,
  Briefcase,
  Mail,
} from "lucide-react";
const today = () => new Date().toLocaleDateString("en-CA");
const initialDate = today();
const defaultRules = {
  fullDayHours: 8,
  halfDayHours: 4,
  shiftStart: "09:00",
  shiftEnd: "18:00",
  graceMinutes: 15,
  overtimeAfterHours: 8,
  breakMinutes: 0,
};
const fmt = (n) => (n == null ? "—" : `${Math.floor(n / 60)}h ${n % 60}m`);
const shortDate = (d) =>
  new Date(d + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
const initials = (n) =>
  n
    .split(" ")
    .map((x) => x[0])
    .slice(0, 2)
    .join("");
async function api(url, body, method = "POST") {
  const res = await fetch(
    "/api" + url,
    body
      ? {
          method,
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "Dayline",
          },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  const data = await res.json();
  if (res.status === 401) window.dispatchEvent(new Event("session-expired"));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
export default function App({
  user = { name: "Workspace admin", role: "Admin" },
  onLogout = async () => {},
}) {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("dayline-theme") === "light"
        ? "light"
        : "dark";
    } catch {
      return "dark";
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#111815" : "#f7f8fa");
    try {
      localStorage.setItem("dayline-theme", theme);
    } catch {
      /* Storage can be disabled. */
    }
  }, [theme]);
  const [page, setPage] = useState("Overview"),
    [employees, setEmployees] = useState([]),
    [records, setRecords] = useState([]),
    [holidays, setHolidays] = useState([]),
    [catalog, setCatalog] = useState({ departments: [], roles: [] }),
    [bulkOpen, setBulkOpen] = useState(false),
    [rules, setRules] = useState(defaultRules),
    [audit, setAudit] = useState([]),
    [date, setDate] = useState(initialDate),
    [search, setSearch] = useState(""),
    [department, setDepartment] = useState("All departments"),
    [filter, setFilter] = useState("All statuses"),
    [modal, setModal] = useState(null),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [from, setFrom] = useState(initialDate.slice(0, 7) + "-01"),
    [to, setTo] = useState(initialDate),
    [reportTab, setReportTab] = useState("Daily report");
  async function load() {
    try {
      const [e, a, r, h, holidays, catalog] = await Promise.all([
        api("/employees"),
        api("/attendance"),
        api("/settings"),
        api("/audit"),
        api("/holidays"),
        api("/catalog"),
      ]);
      setHolidays(holidays);
      setCatalog(catalog);
      setEmployees(e);
      setRecords(a);
      setRules(r);
      setAudit(h);
      setError("");
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
    if (toast) {
      const id = setTimeout(() => setToast(""), 4000);
      return () => clearTimeout(id);
    }
  }, [toast]);
  const navigate = (p) => {
    setPage(p);
    setSearch("");
    setFilter("All statuses");
    setDepartment("All departments");
  };
  const active = employees.filter((e) => e.status === "Active");
  const daily = records.filter((r) => r.date === date);
  const holiday = holidayForDate(date, holidays, rules.weeklyOffDays ?? [0]);
  const present = daily.filter((r) => r.status === "Present").length,
    absent = daily.filter((r) => r.status === "Absent").length,
    half = daily.filter((r) => r.status === "Half day").length,
    attended = daily.filter((r) => r.status === "Attended").length,
    late = daily.filter((r) => r.lateMinutes > 0).length;
  const inProgress = daily.filter((r) => r.status === "In progress").length;
  const unmarked = holiday
    ? 0
    : active.filter((e) => !daily.some((r) => r.employeeId === e.id)).length;
  const departments = [
    ...new Set([
      ...catalog.departments.map((d) => d.name),
      ...employees.map((e) => e.department),
    ]),
  ];
  const match = (e) =>
    (!search ||
      (e.name + " " + e.email).toLowerCase().includes(search.toLowerCase())) &&
    (department === "All departments" || department === e.department);
  const rows = employees
    .filter(
      (e) => e.status === "Active" || daily.some((r) => r.employeeId === e.id),
    )
    .map((e) => ({
      ...e,
      ...daily.find((r) => r.employeeId === e.id),
      employeeId: e.id,
      status:
        daily.find((r) => r.employeeId === e.id)?.status ||
        (holiday ? "Holiday" : "Unmarked"),
    }))
    .filter(match)
    .filter(
      (r) =>
        filter === "All statuses" ||
        r.status === filter ||
        (filter === "Late arrival" && r.lateMinutes > 0),
    );
  const report = records
    .filter((r) => r.date >= from && r.date <= to)
    .filter(match)
    .filter(
      (r) =>
        filter === "All statuses" ||
        r.status === filter ||
        (filter === "Late arrival" && r.lateMinutes > 0),
    );
  async function exportExcel(data = report) {
    try {
      await downloadAttendanceWorkbook(data);
      setToast("Excel report exported successfully");
    } catch {
      setToast("Could not export Excel. Please try again.");
    }
  }
  async function save(url, data, method, message) {
    setSaving(true);
    try {
      await api(url, data, method);
      await load();
      if (url !== "/attendance") setModal(null);
      setToast(
        message +
          (url === "/attendance"
            ? ". Select another employee to continue, or Cancel to close."
            : ""),
      );
    } catch (e) {
      setToast(e.message);
    } finally {
      setSaving(false);
    }
  }
  function selectAttendance(employeeId, entryDate) {
    const employee = employees.find((e) => e.id === Number(employeeId));
    const existing = records.find(
      (r) => r.employeeId === Number(employeeId) && r.date === entryDate,
    );
    const timing = effectiveRules(rules, employee);
    setModal({
      type: "attendance",
      data: {
        employeeId,
        date: entryDate,
        mode: existing?.mode || "time",
        inTime: existing?.inTime || timing.shiftStart,
        outTime: existing?.outTime || "",
        overnight: Boolean(existing?.overnight),
        status: ["Present", "Absent", "Half day", "Attended"].includes(
          existing?.status,
        )
          ? existing.status
          : "Present",
        notes: existing?.notes || "",
      },
    });
  }
  function openAttendance(row) {
    selectAttendance(row?.employeeId || active[0]?.id || "", row?.date || date);
  }
  const entryEmployee = employees.find(
    (e) => e.id === Number(modal?.data?.employeeId),
  );
  const entryRules = effectiveRules(rules, entryEmployee);
  const entryRuleSource = rules.employeeRules?.[entryEmployee?.id]
    ? "Custom employee timings"
    : rules.groupRules?.[entryEmployee?.department]
      ? entryEmployee.department + " group timings"
      : "Workspace timings";
  const changeDate = (n) => {
    const d = new Date(date + "T12:00:00");
    d.setDate(d.getDate() + n);
    setDate(d.toLocaleDateString("en-CA"));
  };
  const statusBadge = (s) => (
    <span className={"badge " + s.toLowerCase().replaceAll(" ", "-")}>
      <i />
      {s}
    </span>
  );
  function person(row) {
    return (
      <div className="person">
        <span className={"avatar color-" + ((row.employeeId || row.id) % 5)}>
          {initials(row.name)}
        </span>
        <span>
          <strong>{row.name}</strong>
          <small>{row.email || "No email added"}</small>
        </span>
      </div>
    );
  }
  const searchBox = (
    <div className="search">
      <Search size={17} />
      <input
        aria-label="Search employees"
        placeholder="Search employees..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <span>⌘ K</span>
    </div>
  );
  const departmentSelect = (
    <select
      aria-label="Department filter"
      value={department}
      onChange={(e) => setDepartment(e.target.value)}
    >
      <option>All departments</option>
      {departments.map((d) => (
        <option key={d}>{d}</option>
      ))}
    </select>
  );
  function attendanceTable(data, reportMode = false) {
    return (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              {reportMode && <th>Date</th>}
              <th>Department</th>
              <th>Status</th>
              <th>Clock in</th>
              <th>Clock out</th>
              <th>Work hours</th>
              {reportMode ? (
                <>
                  <th>Late</th>
                  <th>Early exit</th>
                  <th>Overtime</th>
                  <th>Method / notes</th>
                </>
              ) : (
                <th>Activity</th>
              )}
              <th />
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.employeeId + "-" + (row.date || date)}>
                <td>{person(row)}</td>
                {reportMode && <td>{shortDate(row.date)}</td>}
                <td>
                  <span className="department">{row.department}</span>
                </td>
                <td>{statusBadge(row.status)}</td>
                <td>{formatTime(row.inTime, rules.timeFormat)}</td>
                <td>
                  {formatTime(row.outTime, rules.timeFormat)}
                  {row.overnight ? <small>Next day</small> : null}
                </td>
                <td className="work-hours">{fmt(row.workedMinutes)}</td>
                {reportMode ? (
                  <>
                    <td>{fmt(row.lateMinutes)}</td>
                    <td>{fmt(row.earlyMinutes)}</td>
                    <td>{fmt(row.overtimeMinutes)}</td>
                    <td>
                      <small>
                        {row.mode === "manual"
                          ? "Direct status"
                          : "In / out time"}
                      </small>
                      <small>{row.notes || "—"}</small>
                    </td>
                  </>
                ) : (
                  <td>
                    {row.overtimeMinutes > 0 ? (
                      <span className="activity purple">
                        <Clock size={12} /> {fmt(row.overtimeMinutes)} OT
                      </span>
                    ) : row.mode === "manual" ? (
                      <span className="activity muted">Manual entry</span>
                    ) : row.status === "In progress" ? (
                      <span className="activity pending">
                        <Clock size={14} /> Awaiting clock out
                      </span>
                    ) : row.status === "Holiday" ? (
                      <span className="muted">
                        Holiday · no attendance required
                      </span>
                    ) : row.status === "Unmarked" ? (
                      <span className="muted">Not recorded</span>
                    ) : (
                      <span className="activity muted">
                        <CheckCheck size={14} />{" "}
                        {row.status === "Present"
                          ? "Full-day hours"
                          : row.status === "Half day"
                            ? "Half-day hours"
                            : row.status === "Attended"
                              ? "Attended · below half-day hours"
                              : "No qualifying hours"}
                      </span>
                    )}
                  </td>
                )}
                <td>
                  <button
                    className="icon-btn"
                    aria-label={"Edit attendance for " + row.name}
                    onClick={() => {
                      openAttendance(row);
                      if (row.date)
                        setModal((m) => ({
                          ...m,
                          data: { ...m.data, date: row.date },
                        }));
                    }}
                  >
                    <Ellipsis size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.length && (
          <div className="empty">
            <CalendarDays />
            <h3>
              {loading
                ? "Loading your workspace…"
                : "No attendance records found"}
            </h3>
            <p>
              {loading
                ? "This will only take a moment."
                : "Add employees and record attendance, or adjust your filters."}
            </p>
          </div>
        )}
      </div>
    );
  }
  return (
    <TimeFormatContext.Provider value={rules.timeFormat ?? "12h"}>
      <div className="app">
        <aside className="sidebar">
          <a
            className="brand"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              navigate("Overview");
            }}
          >
            <span className="brand-icon">
              d<span>•</span>
            </span>
            dayline<span className="brand-dot">.</span>
          </a>
          <span className="nav-label">WORKSPACE</span>
          <nav>
            {[
              [LayoutDashboard, "Overview"],
              [CalendarDays, "Attendance"],
              [CalendarDays, "Calendar"],
              [Users, "Employees"],
              [ChartNoAxesCombined, "Reports"],
            ].map(([Icon, name]) => (
              <button
                key={name}
                className={page === name ? "active" : ""}
                onClick={() => navigate(name)}
              >
                <Icon size={19} />
                {name}
                {name === "Employees" && (
                  <span className="nav-count">{employees.length}</span>
                )}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="help-card">
              <span className="help-icon">
                <Sun size={22} />
              </span>
              <strong>A little clarity. Every day.</strong>
              <p>
                Less admin, more time for
                <br />
                the people who matter.
              </p>
              <button onClick={() => navigate("Attendance")}>
                Manage attendance <ArrowUpRight size={15} />
              </button>
            </div>
            {user.role === "Admin" && (
              <button
                className={
                  "settings-nav " + (page === "Settings" ? "active" : "")
                }
                onClick={() => navigate("Settings")}
              >
                <Settings size={19} /> Settings
              </button>
            )}
            {user.role === "Admin" && (
              <button
                className="settings-nav"
                onClick={() => navigate("User management")}
              >
                <Users size={19} /> User management
              </button>
            )}
            <button
              className="settings-nav"
              onClick={() => navigate("My account")}
            >
              My account
            </button>
            <button
              className="settings-nav"
              onClick={() => onLogout().catch((e) => setToast(e.message))}
            >
              <LogOut size={19} /> Sign out
            </button>
            <div className="profile">
              <span className="avatar admin">AD</span>
              <div>
                <strong>{user.name}</strong>
                <small>{user.role}</small>
              </div>
              <span className="online-dot" />
            </div>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <div className="breadcrumb">
              Workspace <ChevronRight size={14} />
              <span>{page}</span>
            </div>
            <div className="topbar-right">
              <button
                className="button theme-toggle"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                aria-label={
                  theme === "dark"
                    ? "Switch to light mode"
                    : "Switch to dark mode"
                }
                title={
                  theme === "dark"
                    ? "Switch to light mode"
                    : "Switch to dark mode"
                }
              >
                {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
                <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
              </button>
              <span className="live-dot" /> Your people, in sync{" "}
              <span className="divider" />
              <details className="account-menu">
                <summary>
                  Account <ChevronDown size={16} aria-hidden="true" />
                </summary>
                <div className="account-menu-panel">
                  <strong>{user.name}</strong>
                  <small>{user.role}</small>
                  {[
                    "My account",
                    ...(user.role === "Admin"
                      ? ["Settings", "User management"]
                      : []),
                  ].map((destination) => (
                    <button
                      type="button"
                      key={destination}
                      onClick={(event) => {
                        event.currentTarget
                          .closest("details")
                          .removeAttribute("open");
                        navigate(destination);
                      }}
                    >
                      {destination}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.currentTarget
                        .closest("details")
                        .removeAttribute("open");
                      onLogout().catch((e) => setToast(e.message));
                    }}
                  >
                    <LogOut size={17} aria-hidden="true" /> Sign out
                  </button>
                </div>
              </details>
            </div>
          </header>
          <main>
            <div className="page-heading">
              <div>
                <div className="eyebrow">YOUR WORKDAY, AT A GLANCE</div>
                <h1>
                  {["User management", "My account"].includes(page)
                    ? page
                    : page === "Calendar"
                      ? "Attendance calendar"
                      : page === "Overview"
                        ? "Attendance overview"
                        : page === "Settings"
                          ? "Workspace settings"
                          : page === "Employees"
                            ? "Your people"
                            : page === "Reports"
                              ? "Attendance reports"
                              : "Attendance register"}
                </h1>
                <p>
                  {page === "Overview"
                    ? "A clear picture of who's in, who's out, and everything in between."
                    : page === "Employees"
                      ? "Good teams start with great people. Keep everyone in one place."
                      : page === "Reports"
                        ? "Every hour accounted for. Every detail, ready when you need it."
                        : page === "Settings"
                          ? "Set the rules that make sense for your team."
                          : "Keep each workday accurate, one entry at a time."}
                </p>
              </div>
              <div className="heading-actions">
                {page === "Employees" ? (
                  <button
                    className="primary"
                    onClick={() =>
                      setModal({
                        type: "employee",
                        data: {
                          name: "",
                          email: "",
                          department: departments.includes("Development")
                            ? "Development"
                            : departments[0] || "",
                          role: "",
                          status: "Active",
                        },
                      })
                    }
                  >
                    <Plus size={17} /> Add employee
                  </button>
                ) : (
                  page !== "Settings" && (
                    <>
                      {!(
                        page === "Reports" &&
                        [
                          "Daily report",
                          "Monthly report",
                          "Employee report",
                        ].includes(reportTab)
                      ) && (
                        <button
                          className="button"
                          onClick={() =>
                            exportExcel(page === "Reports" ? report : daily)
                          }
                        >
                          <Download size={16} /> Export Excel
                        </button>
                      )}
                      {(page === "Overview" || page === "Attendance") && (
                        <button
                          className="button"
                          onClick={() => setBulkOpen(true)}
                        >
                          Bulk absent
                        </button>
                      )}
                      <button
                        className="primary"
                        onClick={() => openAttendance()}
                      >
                        <Plus size={17} /> Record attendance
                      </button>
                    </>
                  )
                )}
              </div>
            </div>
            {error && (
              <div className="error-banner">
                <AlertCircle size={18} />
                <div>
                  <strong>Couldn’t connect to your workspace</strong>
                  <p>{error}</p>
                </div>
                <button className="button" onClick={load}>
                  Retry
                </button>
              </div>
            )}
            {page === "Calendar" && (
              <AttendanceCalendar
                employees={employees}
                records={records}
                holidays={holidays}
                weeklyOffDays={rules.weeklyOffDays ?? [0]}
                date={date}
                setDate={setDate}
                onEdit={openAttendance}
                canManageHolidays={user.role === "Admin"}
                onHolidaySave={async (holidayDate, data) => {
                  await api("/holidays/" + holidayDate, data, "PUT");
                  setHolidays(await api("/holidays"));
                  setAudit(await api("/audit"));
                  setToast(data.active ? "Holiday saved" : "Holiday removed");
                }}
              />
            )}
            {holiday && (page === "Overview" || page === "Attendance") && (
              <p className="holiday-banner">
                Holiday · {holiday.name}. Existing attendance is preserved;
                employees without entries are on holiday.
              </p>
            )}
            {(page === "Overview" || page === "Attendance") && (
              <>
                <div className="date-toolbar">
                  <div className="date-control">
                    <CalendarDays size={16} />
                    <input
                      type="date"
                      aria-label="Attendance date"
                      value={date}
                      onChange={(e) =>
                        e.target.value && setDate(e.target.value)
                      }
                    />
                    <button
                      aria-label="Previous day"
                      onClick={() => changeDate(-1)}
                    >
                      <ChevronLeft size={15} />
                    </button>
                    <button aria-label="Next day" onClick={() => changeDate(1)}>
                      <ChevronRight size={15} />
                    </button>
                  </div>
                  <button
                    className="today-button"
                    onClick={() => setDate(initialDate)}
                  >
                    Today
                  </button>
                  <span className="toolbar-note">
                    <span className="live-dot" />
                    {date === initialDate ? "Live overview" : "Daily overview"}
                    <span className="dot-separator">•</span>
                    {active.length} active employees
                  </span>
                </div>
                <div className="stat-grid">
                  {[
                    {
                      title: "Total employees",
                      value: active.length,
                      icon: Users,
                      color: "gray",
                      sub: "Across " + departments.length + " departments",
                      foot: "Your team, all in one place",
                    },
                    {
                      title: "Present today",
                      value: present,
                      icon: CheckCircle2,
                      color: "green",
                      sub:
                        (active.length
                          ? Math.round((present / active.length) * 100)
                          : 0) + "% of your team",
                      foot: "Showing up. Making things happen.",
                    },
                    {
                      title: "Absent today",
                      value: absent,
                      icon: CalendarDays,
                      color: "red",
                      sub: unmarked + " not yet marked",
                      foot: "A little visibility goes a long way",
                    },
                    {
                      title: "Late arrivals",
                      value: late,
                      icon: Clock,
                      color: "orange",
                      sub: rules.graceMinutes + " min grace period applied",
                      foot:
                        half +
                        " half-day" +
                        (half === 1 ? "" : "s") +
                        " recorded",
                    },
                  ].map((s) => (
                    <div className="stat-card" key={s.title}>
                      <div className="stat-top">
                        <span>{s.title}</span>
                        <span className={"stat-icon " + s.color}>
                          <s.icon size={18} />
                        </span>
                      </div>
                      <div className="stat-value">
                        {s.value}
                        <span className={"stat-sub " + s.color}>{s.sub}</span>
                      </div>
                      <div className="stat-foot">{s.foot}</div>
                    </div>
                  ))}
                </div>
                {page === "Overview" && (
                  <div className="chart-grid">
                    <section className="card trend-card">
                      <div className="card-heading">
                        <div>
                          <h2>
                            Attendance trends{" "}
                            <span className="tiny-tag">Last 7 days</span>
                          </h2>
                          <p>A little perspective on your team's week.</p>
                        </div>
                        <div className="chart-legend">
                          <span>
                            <i className="legend-green" />
                            Present
                          </span>
                          <span>
                            <i className="legend-yellow" />
                            Half day
                          </span>
                          <span>
                            <i className="legend-violet" />
                            Attended
                          </span>
                          <span>
                            <i className="legend-pink" />
                            Absent
                          </span>
                          <span>
                            <i className="legend-blue" />
                            In progress
                          </span>
                        </div>
                      </div>
                      <div className="chart">
                        <div className="chart-labels">
                          {[100, 75, 50, 25, 0].map((n) => (
                            <span key={n}>{n}%</span>
                          ))}
                        </div>
                        <div className="plot">
                          <div className="grid-lines">
                            {[0, 1, 2, 3, 4].map((n) => (
                              <div key={n} />
                            ))}
                          </div>
                          <div className="bars">
                            {Array.from({ length: 7 }, (_, i) => {
                              const d = new Date(date + "T12:00:00");
                              d.setDate(d.getDate() - 6 + i);
                              const ds = d.toLocaleDateString("en-CA");
                              const rs = records.filter((r) => r.date === ds);
                              const count = Math.max(
                                active.length,
                                rs.length,
                                1,
                              );
                              return (
                                <div
                                  className={
                                    "bar-column " +
                                    (ds === date ? "selected" : "")
                                  }
                                  key={ds}
                                >
                                  <div
                                    className="bar-track"
                                    title={`${shortDate(ds)}: ${rs.length} entries`}
                                  >
                                    {[
                                      "In progress",
                                      "Absent",
                                      "Half day",
                                      "Attended",
                                      "Present",
                                    ].map((status) => (
                                      <div
                                        key={status}
                                        className={
                                          "bar-segment " +
                                          status.toLowerCase().replace(" ", "-")
                                        }
                                        style={{
                                          height:
                                            (rs.filter(
                                              (r) => r.status === status,
                                            ).length /
                                              count) *
                                              100 +
                                            "%",
                                        }}
                                      />
                                    ))}
                                  </div>
                                  <span>
                                    {d.toLocaleDateString("en-US", {
                                      weekday: "short",
                                    })}
                                  </span>
                                  <small>
                                    {d.toLocaleDateString("en-US", {
                                      month: "short",
                                      day: "numeric",
                                    })}
                                  </small>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                      <div className="chart-footer">
                        <span>
                          <span className="live-dot" /> A consistent team is a
                          strong team.
                        </span>
                        <button onClick={() => navigate("Reports")}>
                          View reports <ArrowRight size={14} />
                        </button>
                      </div>
                    </section>
                    <section className="card day-card">
                      <div className="card-heading">
                        <div>
                          <h2>The shape of your day</h2>
                          <p>Today's attendance breakdown</p>
                        </div>
                        <span className="sun-icon">
                          <Sun size={20} />
                        </span>
                      </div>
                      <div className="donut-wrap">
                        <div
                          className="donut"
                          style={{
                            background: `conic-gradient(#25775a 0 ${(present / Math.max(active.length, daily.length, 1)) * 100}%, #efc36b 0 ${((present + half) / Math.max(active.length, daily.length, 1)) * 100}%,#a78bda 0 ${((present + half + attended) / Math.max(active.length, daily.length, 1)) * 100}%,#e89b9a 0 ${((present + half + attended + absent) / Math.max(active.length, daily.length, 1)) * 100}%,#7aabd4 0 ${((present + half + attended + absent + inProgress) / Math.max(active.length, daily.length, 1)) * 100}%,#edf0ee 0 100%)`,
                          }}
                        >
                          <div>
                            <strong>
                              {active.length
                                ? Math.round(
                                    ((present + half * 0.5) / active.length) *
                                      100,
                                  )
                                : 0}
                              <span>%</span>
                            </strong>
                            <small>attendance rate</small>
                          </div>
                        </div>
                      </div>
                      <div className="breakdown">
                        {[
                          ["Present", present, "legend-green"],
                          ["Half day", half, "legend-yellow"],
                          ["Attended", attended, "legend-violet"],
                          ["Absent", absent, "legend-pink"],
                          ["In progress", inProgress, "legend-blue"],
                          [
                            holiday ? "Holiday" : "Unmarked",
                            holiday
                              ? active.filter(
                                  (e) =>
                                    !daily.some((r) => r.employeeId === e.id),
                                ).length
                              : unmarked,
                            "legend-gray",
                          ],
                        ].map(([n, v, c]) => (
                          <div key={n}>
                            <span>
                              <i className={c} />
                              {n}
                            </span>
                            <strong>
                              {v}
                              <small>
                                {Math.round(
                                  (v /
                                    Math.max(active.length, daily.length, 1)) *
                                    100,
                                )}
                                %
                              </small>
                            </strong>
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>
                )}
                {page === "Attendance" && (
                  <section className="card register">
                    <div className="card-heading">
                      <div>
                        <h2>
                          Daily attendance{" "}
                          <span className="tiny-tag">
                            {date === initialDate ? "Today" : shortDate(date)}
                          </span>
                        </h2>
                        <p>
                          Your team’s check-ins, hours, and everything in
                          between.
                        </p>
                      </div>
                      <span className="record-count">
                        {daily.length} of {active.length} recorded
                      </span>
                    </div>
                    <div className="table-toolbar">
                      {searchBox}
                      <div className="filters">
                        {departmentSelect}
                        <select
                          aria-label="Status filter"
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                        >
                          {[
                            "All statuses",
                            "In progress",
                            "Present",
                            "Absent",
                            "Half day",
                            "Attended",
                            "Late arrival",
                            "Unmarked",
                            "Holiday",
                          ].map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {attendanceTable(rows)}
                    <div className="table-footer">
                      <span>Showing {rows.length} employees</span>
                      <span>
                        <span className="live-dot" /> All times in your team's
                        local time
                      </span>
                    </div>
                  </section>
                )}
              </>
            )}
            {page === "User management" && user.role === "Admin" && (
              <UserManagement api={api} user={user} onLogout={onLogout} />
            )}
            {page === "My account" && (
              <AccountSettings api={api} onLogout={onLogout} />
            )}
            {page === "Employees" && (
              <section className="card">
                <div className="card-heading">
                  <div>
                    <h2>
                      Employee directory{" "}
                      <span className="tiny-tag">
                        {employees.length} people
                      </span>
                    </h2>
                    <p>Manage profiles, departments, and employee status.</p>
                  </div>
                </div>
                <div className="table-toolbar">
                  {searchBox}
                  {departmentSelect}
                </div>
                <div className="employee-grid">
                  {employees.filter(match).map((e) => (
                    <div className="employee-card" key={e.id}>
                      <div className="employee-card-top">
                        <span
                          className={"avatar large-avatar color-" + (e.id % 5)}
                        >
                          {initials(e.name)}
                        </span>
                        {statusBadge(e.status)}
                      </div>
                      <h3>{e.name}</h3>
                      <p>{e.role}</p>
                      <span className="department">{e.department}</span>
                      <div className="employee-email">
                        <Mail size={14} />
                        {e.email || "No email added"}
                      </div>
                      <button
                        className="button"
                        onClick={() => setModal({ type: "employee", data: e })}
                      >
                        Edit employee <ArrowUpRight size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                {!employees.filter(match).length && (
                  <div className="empty">
                    <Users />
                    <h3>No employees yet</h3>
                    <p>
                      Add your first team member to start tracking attendance.
                    </p>
                  </div>
                )}
              </section>
            )}
            {page === "Reports" && (
              <div className="tabs report-tabs">
                {[
                  "Daily report",
                  "Monthly report",
                  "Employee report",
                  "Attendance details",
                  "Employee summary",
                  "Activity log",
                ].map((tab) => (
                  <button
                    key={tab}
                    className={reportTab === tab ? "selected" : ""}
                    onClick={() => setReportTab(tab)}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            )}
            {page === "Reports" && reportTab === "Daily report" && (
              <DailyReport
                employees={employees}
                records={records}
                date={date}
                setDate={setDate}
                holidays={holidays}
                weeklyOffDays={rules.weeklyOffDays ?? [0]}
              />
            )}
            {page === "Reports" && reportTab === "Employee report" && (
              <EmployeeReport
                employees={employees}
                records={records}
                holidays={holidays}
                rules={rules}
              />
            )}
            {page === "Reports" && reportTab === "Monthly report" && (
              <MonthlyReport
                employees={employees}
                records={records}
                holidays={holidays}
                rules={rules}
                onEdit={openAttendance}
              />
            )}
            {page === "Reports" &&
              !["Daily report", "Monthly report", "Employee report"].includes(
                reportTab,
              ) && (
                <>
                  <div className="report-controls">
                    <DateNavigator
                      label="From"
                      value={from}
                      onChange={setFrom}
                    />
                    <DateNavigator label="To" value={to} onChange={setTo} />
                    <RangeNavigator
                      from={from}
                      to={to}
                      onChange={(r) => {
                        setFrom(r.from);
                        setTo(r.to);
                      }}
                    />
                    {departmentSelect}
                  </div>
                  {from > to && (
                    <p className="error-text">
                      Start date must be before end date.
                    </p>
                  )}
                  <div className="stat-grid">
                    {[
                      ["Recorded days", report.length],
                      [
                        "Worked hours",
                        fmt(
                          report.reduce(
                            (s, r) => s + (r.workedMinutes || 0),
                            0,
                          ),
                        ),
                      ],
                      [
                        "Overtime",
                        fmt(
                          report.reduce(
                            (s, r) => s + (r.overtimeMinutes || 0),
                            0,
                          ),
                        ),
                      ],
                      [
                        "Late / early events",
                        report.filter((r) => r.lateMinutes > 0).length +
                          " / " +
                          report.filter((r) => r.earlyMinutes > 0).length,
                      ],
                    ].map(([n, v]) => (
                      <div className="stat-card" key={n}>
                        <div className="stat-top">{n}</div>
                        <div className="stat-value">{v}</div>
                        <small>Selected reporting period</small>
                      </div>
                    ))}
                  </div>
                  <section className="card">
                    {reportTab !== "Activity log" && (
                      <div className="table-toolbar">
                        {searchBox}
                        <select
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                          aria-label="Report status"
                        >
                          {[
                            "All statuses",
                            "In progress",
                            "Present",
                            "Absent",
                            "Half day",
                            "Attended",
                            "Late arrival",
                          ].map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    {reportTab === "Attendance details" ? (
                      attendanceTable(report, true)
                    ) : reportTab === "Employee summary" ? (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              {[
                                "Employee",
                                "Recorded",
                                "Present",
                                "Half days",
                                "Attended",
                                "Absent",
                                "In progress",
                                "Worked",
                                "Overtime",
                                "Late",
                                "Early",
                              ].map((x) => (
                                <th key={x}>{x}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {employees.filter(match).map((e) => {
                              const rs = report.filter(
                                (r) => r.employeeId === e.id,
                              );
                              return (
                                <tr key={e.id}>
                                  <td>{person(e)}</td>
                                  <td>{rs.length}</td>
                                  {[
                                    "Present",
                                    "Half day",
                                    "Attended",
                                    "Absent",
                                    "In progress",
                                  ].map((s) => (
                                    <td key={s}>
                                      {rs.filter((r) => r.status === s).length}
                                    </td>
                                  ))}
                                  {[
                                    "workedMinutes",
                                    "overtimeMinutes",
                                    "lateMinutes",
                                    "earlyMinutes",
                                  ].map((s) => (
                                    <td key={s}>
                                      {fmt(
                                        rs.reduce((a, r) => a + (r[s] || 0), 0),
                                      )}
                                    </td>
                                  ))}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="audit-list">
                        <p className="muted">
                          Latest 500 workspace events · expand an event to
                          inspect its before and after values.
                        </p>
                        {audit.map((a) => (
                          <details key={a.id}>
                            <summary>
                              <span className="audit-icon">
                                <History size={17} />
                              </span>
                              <strong>{a.action}</strong>
                              <span>
                                {a.entity} #{a.entityId}
                              </span>
                              <time>
                                {String(a.createdAt).slice(0, 10)}{" "}
                                {formatTime(
                                  String(a.createdAt).slice(11, 16),
                                  rules.timeFormat,
                                )}{" "}
                                UTC
                              </time>
                            </summary>
                            <pre>
                              {JSON.stringify(
                                typeof a.details === "string"
                                  ? JSON.parse(a.details)
                                  : a.details,
                                null,
                                2,
                              )}
                            </pre>
                          </details>
                        ))}
                        {!audit.length && (
                          <div className="empty">
                            Your workspace activity will appear here.
                          </div>
                        )}
                      </div>
                    )}
                    <div className="table-footer">
                      Manual status entries have no measured hours. Unmarked
                      days are not counted as absences.
                    </div>
                  </section>
                </>
              )}
            {page === "Settings" && (
              <WorkspaceSettings
                rules={rules}
                employees={employees}
                catalog={catalog}
                holidays={holidays}
                api={api}
                onReload={load}
                saving={saving}
                onSave={(next) =>
                  save("/settings", next, "PUT", "Settings saved")
                }
              />
            )}
            <footer className="page-footer">
              <span>Made for your people. Built for your everyday.</span>
              <span>
                dayline <span className="footer-dot">✳</span>
              </span>
            </footer>
          </main>
        </div>
        {toast && (
          <div className="toast" role="status">
            <AlertCircle size={18} />
            {toast}
            <button
              aria-label="Dismiss notification"
              onClick={() => setToast("")}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {bulkOpen && (
          <BulkAbsence
            employees={employees}
            date={date}
            api={api}
            onClose={() => setBulkOpen(false)}
            onApplied={async (r) => {
              await load();
              setToast(`${r.total} absence entries saved`);
            }}
          />
        )}
        {modal && (
          <div
            className="modal-backdrop"
            onClick={(e) => {
              if (
                modal.type !== "attendance" &&
                e.target === e.currentTarget &&
                !saving
              )
                setModal(null);
            }}
          >
            <section
              className="modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="modal-title"
            >
              <div className="modal-header">
                <div>
                  <span className="eyebrow">
                    {modal.type === "employee"
                      ? "YOUR PEOPLE"
                      : "MAKE EVERY DAY COUNT"}
                  </span>
                  <h2 id="modal-title">
                    {modal.type === "employee"
                      ? modal.data.id
                        ? "Edit employee"
                        : "Add employee"
                      : "Record attendance"}
                  </h2>
                </div>
                {modal.type !== "attendance" && (
                  <button
                    className="icon-btn"
                    aria-label="Close dialog"
                    onClick={() => setModal(null)}
                    disabled={saving}
                  >
                    <X size={20} />
                  </button>
                )}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const d = modal.data;
                  modal.type === "employee"
                    ? save(
                        "/employees" + (d.id ? "/" + d.id : ""),
                        d,
                        d.id ? "PUT" : "POST",
                        "Employee saved",
                      )
                    : save(
                        "/attendance",
                        { ...d, employeeId: Number(d.employeeId) },
                        "POST",
                        "Attendance saved",
                      );
                }}
              >
                <fieldset className="modal-fields" disabled={saving}>
                  <datalist id="employee-roles">
                    {[
                      ...new Set([
                        ...catalog.roles.map((r) => r.name),
                        ...employees.map((e) => e.role),
                      ]),
                    ].map((role) => (
                      <option key={role} value={role} />
                    ))}
                  </datalist>
                  <datalist id="employee-departments">
                    {[...new Set(departments)].map((group) => (
                      <option key={group} value={group} />
                    ))}
                  </datalist>
                  {modal.type === "employee" ? (
                    <div className="form-grid">
                      {[
                        ["name", "Full name", "text"],
                        ["email", "Email address (optional)", "email"],
                        ["department", "Department", "text"],
                        ["role", "Job title", "text"],
                      ].map(([k, l, t]) => (
                        <label key={k}>
                          {l}
                          <input
                            autoFocus={k === "name"}
                            required={k !== "email"}
                            type={t}
                            list={
                              k === "role"
                                ? "employee-roles"
                                : k === "department"
                                  ? "employee-departments"
                                  : undefined
                            }
                            maxLength={k === "email" ? 160 : 80}
                            value={modal.data[k] ?? ""}
                            onChange={(e) =>
                              setModal({
                                ...modal,
                                data: { ...modal.data, [k]: e.target.value },
                              })
                            }
                          />
                        </label>
                      ))}
                      <label>
                        Status
                        <select
                          value={modal.data.status}
                          onChange={(e) =>
                            setModal({
                              ...modal,
                              data: { ...modal.data, status: e.target.value },
                            })
                          }
                        >
                          <option>Active</option>
                          <option>Inactive</option>
                        </select>
                      </label>
                      <p className="muted">
                        Inactive employees retain their attendance history.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="form-grid">
                        <label>
                          Employee
                          <select
                            required
                            value={modal.data.employeeId}
                            onChange={(e) =>
                              selectAttendance(e.target.value, modal.data.date)
                            }
                          >
                            <option value="">Select employee</option>
                            {active.map((e) => (
                              <option value={e.id} key={e.id}>
                                {e.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <DateNavigator
                          label="Date"
                          value={modal.data.date}
                          onChange={(value) =>
                            selectAttendance(modal.data.employeeId, value)
                          }
                          required
                          disabled={saving}
                        />
                      </div>
                      <div className="mode-switch">
                        {[
                          ["time", "In / out time", Clock],
                          ["manual", "Direct status", CheckCircle2],
                        ].map(([v, l, I]) => (
                          <button
                            type="button"
                            key={v}
                            className={modal.data.mode === v ? "selected" : ""}
                            onClick={() =>
                              setModal({
                                ...modal,
                                data: { ...modal.data, mode: v },
                              })
                            }
                          >
                            <I size={16} />
                            {l}
                          </button>
                        ))}
                      </div>
                      {modal.data.mode === "time" ? (
                        <>
                          <div className="form-grid">
                            {[
                              ["inTime", "Clock in"],
                              ["outTime", "Clock out"],
                            ].map(([k, l]) => (
                              <div className="time-field" key={k}>
                                <div className="time-field-heading">
                                  <label htmlFor={"attendance-" + k}>{l}</label>
                                  {k === "outTime" && <small>optional</small>}
                                  <button
                                    type="button"
                                    className="clear-time"
                                    aria-label={"Clear " + l.toLowerCase()}
                                    onClick={() =>
                                      setModal({
                                        ...modal,
                                        data: { ...modal.data, [k]: "" },
                                        timeReset: {
                                          ...modal.timeReset,
                                          [k]: (modal.timeReset?.[k] || 0) + 1,
                                        },
                                      })
                                    }
                                  >
                                    Clear
                                  </button>
                                </div>
                                <TimeInput
                                  key={`${modal.data.employeeId}:${modal.data.date}:${modal.timeReset?.[k] || 0}`}
                                  id={"attendance-" + k}
                                  required={k === "inTime"}
                                  value={modal.data[k] ?? ""}
                                  onChange={(e) =>
                                    setModal({
                                      ...modal,
                                      data: {
                                        ...modal.data,
                                        [k]: e.target.value,
                                      },
                                    })
                                  }
                                />
                              </div>
                            ))}
                          </div>
                          <label className="checkbox">
                            <input
                              type="checkbox"
                              checked={modal.data.overnight}
                              onChange={(e) =>
                                setModal({
                                  ...modal,
                                  data: {
                                    ...modal.data,
                                    overnight: e.target.checked,
                                  },
                                })
                              }
                            />
                            Clock out is the following day
                          </label>
                          <div className="entry-hint">
                            <Clock size={17} />
                            <span>
                              Leave clock out blank to save an in-progress
                              shift. Add it later to calculate hours and the
                              final status.
                              <br />
                              {entryRuleSource}:{" "}
                              {formatTime(
                                entryRules.shiftStart,
                                rules.timeFormat,
                              )}
                              –
                              {formatTime(
                                entryRules.shiftEnd,
                                rules.timeFormat,
                              )}
                              <br />
                              Full day: {entryRules.fullDayHours}h · Half day:{" "}
                              {entryRules.halfDayHours}h<br />
                              Breaks are included. No time is deducted.
                            </span>
                          </div>
                        </>
                      ) : (
                        <label>
                          Attendance status
                          <select
                            value={modal.data.status}
                            onChange={(e) =>
                              setModal({
                                ...modal,
                                data: { ...modal.data, status: e.target.value },
                              })
                            }
                          >
                            <option>Present</option>
                            <option>Absent</option>
                            <option>Half day</option>
                            <option>Attended</option>
                          </select>
                        </label>
                      )}
                      <label className="notes-label">
                        Notes <span>optional</span>
                        <textarea
                          maxLength={2000}
                          placeholder="Add a little context…"
                          value={modal.data.notes}
                          onChange={(e) =>
                            setModal({
                              ...modal,
                              data: { ...modal.data, notes: e.target.value },
                            })
                          }
                        />
                      </label>
                      <p className="muted small-text">
                        Saving an existing employee/date updates that entry and
                        records the change in the activity log.
                      </p>
                    </>
                  )}
                </fieldset>
                <div className="form-footer">
                  <button
                    type="button"
                    className="button"
                    disabled={saving}
                    onClick={() => setModal(null)}
                  >
                    Cancel
                  </button>
                  <button
                    className="primary"
                    disabled={
                      saving || (modal.type === "attendance" && !active.length)
                    }
                  >
                    <Check size={16} />
                    {saving
                      ? "Saving…"
                      : modal.type === "employee"
                        ? "Save employee"
                        : "Save attendance"}
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}
      </div>
    </TimeFormatContext.Provider>
  );
}
