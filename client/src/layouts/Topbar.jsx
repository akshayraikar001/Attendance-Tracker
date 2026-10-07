import React from "react";
import { ChevronRight, Sun, Moon, ChevronDown, LogOut } from "lucide-react";

export default function Topbar({
  page,
  theme,
  setTheme,
  user,
  navigate,
  onLogout,
  setToast,
}) {
  return (
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
            theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
          }
          title={
            theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
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
              ...(user.role === "Admin" ? ["Settings", "User management"] : []),
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
