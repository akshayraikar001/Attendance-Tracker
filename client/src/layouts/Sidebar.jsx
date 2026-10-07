import React from "react";
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  ChartNoAxesCombined,
  MessageCircle,
  CheckCheck,
  Settings,
  LogOut,
} from "lucide-react";

export default function Sidebar({
  sidebarCollapsed,
  setSidebarCollapsed,
  user,
  page,
  navigate,
  employees,
  onLogout,
  setToast,
}) {
  return (
    <aside className={`sidebar${sidebarCollapsed ? " collapsed" : ""}`}>
      <a
        className="brand"
        href="#"
        onClick={(e) => {
          e.preventDefault();
          setSidebarCollapsed((v) => !v);
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
          [MessageCircle, "WhatsApp"],
          ...(user.role === "Admin" ? [[CheckCheck, "Leave Approval"]] : []),
        ].map(([Icon, name]) => (
          <button
            key={name}
            className={
              page === (name === "WhatsApp" ? "WhatsApp attendance" : name)
                ? "active"
                : ""
            }
            onClick={() =>
              navigate(name === "WhatsApp" ? "WhatsApp attendance" : name)
            }
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
        {user.role === "Admin" && (
          <button
            className={"settings-nav " + (page === "Settings" ? "active" : "")}
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
        <button className="settings-nav" onClick={() => navigate("My account")}>
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
  );
}
