import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "./config/db.js";
import { transaction, audit } from "./database/transactions.js";
import { registerAuth } from "./controllers/auth.js";
import { registerAdminRoutes } from "./controllers/admin.js";
import { registerWhatsApp } from "./controllers/whatsapp.js";
import { registerLeave } from "./controllers/leave.js";
import { registerWorkspaceRoutes } from "./controllers/workspace.js";
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
registerAuth({ app, wrap, transaction, audit, query });
registerAdminRoutes({ app, wrap, transaction, audit, query });
const whatsapp = registerWhatsApp({ app, wrap, transaction, audit, query });
registerLeave({ app, wrap, transaction, audit, query, whatsapp });
registerWorkspaceRoutes({ app, wrap, transaction, audit, query });
app.use("/api", (req, res) =>
  res.status(404).json({ error: "Endpoint not found" }),
);
const dist = fileURLToPath(new URL("../../client/dist", import.meta.url));
app.use(
  express.static(dist, {
    setHeaders(res, file) {
      if (file.endsWith(".html")) res.setHeader("Cache-Control", "no-store");
    },
  }),
);
app.get("*", (req, res) =>
  res.set("Cache-Control", "no-store").sendFile(path.join(dist, "index.html")),
);
app.use((err, req, res, next) => {
  console.error(err.message);
  res
    .status(
      err.status || (err.issues || err.code === "ER_DUP_ENTRY" ? 400 : 500),
    )
    .json({
      error:
        err.issues?.map((x) => x.message).join("; ") ||
        (err.code === "ER_DUP_ENTRY"
          ? "That email, username, or name already exists."
          : err.status
            ? err.message
            : "Database unavailable. Check MySQL and run npm run db:setup."),
    });
});

export { app, whatsapp };
