import React from "react";
import WorkspaceLayout from "./layouts/WorkspaceLayout.jsx";

import EmployeeWorkspace from "./pages/employee/EmployeeWorkspace.jsx";
export default function App(props) {
  if (props.user?.role === "Employee") return <EmployeeWorkspace {...props} />;
  return <WorkspaceLayout {...props} />;
}
