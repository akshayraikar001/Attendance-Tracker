import React from "react";
import { createRoot } from "react-dom/client";
import AuthGate from "./pages/auth/AuthGate.jsx";
import App from "./App.jsx";
import "./assets/styles/main.css";

createRoot(document.getElementById("root")).render(
  <AuthGate>{(props) => <App {...props} />}</AuthGate>,
);
