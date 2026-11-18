import React, { useEffect, useState } from "react";
import api from "../services/api.js";
import {
  ChevronRight,
  Sun,
  Moon,
  ChevronDown,
  LogOut,
  Menu,
  UserRound,
  Settings,
  Users,
} from "lucide-react";

export default function Topbar({
  mobileMenuOpen,
  onOpenMenu,
  page,
  theme,
  setTheme,
  user,
  navigate,
  onLogout,
  setToast,
}) {
  const [whatsapp, setWhatsapp] = useState(null);
  useEffect(() => {
    if (user.role !== "Admin") return;
    let alive = true,
      pending = false;
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        const status = await api("/whatsapp/status");
        if (alive) setWhatsapp(status);
      } catch {
        if (alive) setWhatsapp({ connected: false, available: false });
      } finally {
        pending = false;
      }
    }
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [user.role]);
  return (
    <header className="topbar">
      <button
        className="button mobile-nav-toggle"
        aria-label="Open navigation"
        aria-controls="workspace-sidebar"
        aria-expanded={mobileMenuOpen}
        onClick={onOpenMenu}
      >
        <Menu size={20} />
      </button>
      <div className="breadcrumb">
        <span className="breadcrumb-root">Workspace</span>{" "}
        <ChevronRight className="breadcrumb-root" size={14} />
        <span>{page}</span>
      </div>
      {user.role === "Admin" && (
        <span className="navbar-whatsapp-status" role="status">
          <span
            aria-hidden="true"
            style={{
              color: whatsapp?.connected
                ? "#16a34a"
                : whatsapp
                  ? "#dc2626"
                  : "#818682",
            }}
          >
            ●
          </span>
          Sync: WhatsApp{" "}
          {whatsapp === null
            ? "checking…"
            : whatsapp.available === false
              ? "unavailable"
              : whatsapp.connected
                ? "connected"
                : "disconnected"}
        </span>
      )}
      <div className="topbar-right">
        <button
          className="button theme-toggle"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label={
            theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
          }
          title={
            theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
          }
        >
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
        </button>
        <span className="divider" />
        <details className="account-menu">
          <summary>
            <span className="avatar admin" aria-hidden="true">
              {user.name
                .trim()
                .split(/\s+/)
                .map((part) => part[0])
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </span>
            <span className="account-profile">
              <strong>{user.name}</strong>
              <small>{user.role}</small>
            </span>
            <ChevronDown size={16} aria-hidden="true" />
          </summary>
          <div className="account-menu-panel">
            <strong>{user.name}</strong>
            <small>{user.role}</small>
            {[
              ["My account", UserRound],
              ...(user.role === "Admin"
                ? [
                    ["Settings", Settings],
                    ["User management", Users],
                  ]
                : []),
            ].map(([destination, Icon]) => (
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
                <Icon size={17} aria-hidden="true" />
                {destination}
              </button>
            ))}
            <button
              type="button"
              onClick={(event) => {
                event.currentTarget.closest("details").removeAttribute("open");
                onLogout().catch((e) => setToast(e.message));
              }}
            >
              <LogOut size={17} aria-hidden="true" /> Sign out
            </button>
          </div>
        </details>
      </div>
    </header>
  );
}
