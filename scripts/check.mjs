import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Only isolated/mocked suites. Live workspace diagnostics are deliberately excluded.
const checks = [
  "test", "test:ui", "test:employee:ui", "test:auth:ui", "test:users:ui",
  "test:locations:ui", "test:time-away:ui", "test:time-picker",
  "test:whatsapp:ui", "test:leave:ui", "test:employee-reports:ui", "test:export",
  "test:admin", "test:auth", "test:holidays", "test:leave", "test:whatsapp",
  "test:automation", "test:employee-reports", "build",
];
if (process.argv.includes("--list")) {
  console.log(checks.join("\n"));
} else {
  for (const name of checks) {
    const result = spawnSync("npm", ["run", name], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      stdio: "inherit",
    });
    if (result.error || result.status !== 0) {
      console.error(`Check failed: ${name}`);
      if (result.error) console.error(result.error.message);
      process.exit(result.status || 1);
    }
  }
  console.log("All commit checks passed.");
}
