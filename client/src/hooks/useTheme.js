import { useEffect, useState } from "react";

export default function useTheme() {
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
  return [theme, setTheme];
}
