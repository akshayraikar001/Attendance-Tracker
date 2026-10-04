import React from "react";
import { createRoot } from "react-dom/client";
import AuthGate from "./components/AuthGate.jsx";
import App from "./App.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <AuthGate>{(props) => <App {...props} />}</AuthGate>,
);
