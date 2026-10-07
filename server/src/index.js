import { app, whatsapp } from "./app.js";
import { transaction, audit } from "./database/transactions.js";
import { createAutoClockOut } from "./services/auto-clockout.js";
import { ensureChatery } from "./integrations/chatery.js";
import { startLocalDatabaseMonitor } from "./services/local-database.js";
await startLocalDatabaseMonitor();
if (process.env.CHATERY_MANAGED_PATH)
  ensureChatery().catch((error) => console.error(error.message));
const whatsappTimer = setInterval(
  () => whatsapp.poll({ automatic: true }),
  15000,
);
whatsappTimer.unref();
const autoClockOut = createAutoClockOut({ transaction, audit });
const runAutoClockOut = () =>
  autoClockOut().catch((error) =>
    console.error("Automatic Out time:", error.message),
  );
// Check once on startup for overdue entries, then once per minute.
runAutoClockOut();
const autoClockOutTimer = setInterval(runAutoClockOut, 60000);
autoClockOutTimer.unref();
app.listen(process.env.PORT || 3001, "0.0.0.0", () =>
  console.log("Attendance API listening on port " + (process.env.PORT || 3001)),
);
