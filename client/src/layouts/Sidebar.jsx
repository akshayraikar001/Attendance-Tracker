import React, { useEffect, useRef } from "react";
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  ChartNoAxesCombined,
  MessageCircle,
  CheckCheck,
  X,
} from "lucide-react";

export default function Sidebar({
  mobileMenuOpen,
  setMobileMenuOpen,
  sidebarCollapsed,
  setSidebarCollapsed,
  user,
  page,
  navigate,
  employees,
}) {
  const sidebar = useRef(null);
  useEffect(() => {
    const media = window.matchMedia?.("(min-width: 951px)");
    if (!media) return;
    const closeOnDesktop = () => {
      if (media.matches) setMobileMenuOpen(false);
    };
    media.addEventListener("change", closeOnDesktop);
    return () => media.removeEventListener("change", closeOnDesktop);
  }, [setMobileMenuOpen]);
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sidebar.current.querySelector(".mobile-nav-close")?.focus();
    const keydown = (event) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
      if (event.key !== "Tab") return;
      const items = [
        ...sidebar.current.querySelectorAll("button, a[href]"),
      ].filter((el) => el.getClientRects().length && !el.disabled);
      const first = items[0],
        last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, [mobileMenuOpen, setMobileMenuOpen]);
  return (
    <>
      {mobileMenuOpen && (
        <button
          className="workspace-shade"
          aria-label="Close navigation backdrop"
          tabIndex={-1}
          onClick={() => setMobileMenuOpen(false)}
        />
      )}
      <aside
        id="workspace-sidebar"
        ref={sidebar}
        aria-label="Workspace sidebar"
        className={`sidebar${sidebarCollapsed ? " collapsed" : ""}${mobileMenuOpen ? " is-open" : ""}`}
      >
        <button
          className="mobile-nav-close button"
          aria-label="Close navigation"
          onClick={() => setMobileMenuOpen(false)}
        >
          <X size={20} />
        </button>
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
        <nav aria-label="Workspace navigation">
          {[
            [LayoutDashboard, "Overview"],
            [CalendarDays, "Attendance"],
            [CalendarDays, "Calendar"],
            [Users, "Employees"],
            [ChartNoAxesCombined, "Reports"],
            [MessageCircle, "WhatsApp"],
            ...(user.role === "Admin"
              ? [
                  [CheckCheck, "Leave Approval"],
                  [CalendarDays, "Time away"],
                  [CalendarDays, "Location tracking"],
                ]
              : []),
          ].map(([Icon, name]) => (
            <button
              key={name}
              title={name}
              aria-label={name}
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
      </aside>
    </>
  );
}
