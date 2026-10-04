import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
const emailSchema = z.string().trim().toLowerCase().email().max(254);
const scrypt = promisify(scryptCallback);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const credentials = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,60}$/),
  password: z.string().min(10).max(128),
});
const profile = z.object({
  name: z.string().trim().min(2).max(100),
  role: z.enum(["Admin", "Staff"]),
  active: z.boolean().default(true),
});
const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  email: u.email || null,
  name: u.name,
  role: u.role,
  active: Boolean(u.active),
});
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
export async function passwordHash(password) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + (await scrypt(password, salt, 64)).toString("hex");
}
async function verify(password, hash) {
  const [salt, key] = hash.split(":");
  const actual = await scrypt(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(key, "hex"));
}
export function registerAuth({ app, wrap, query, transaction, audit }) {
  const attempts = new Map();
  function limit(req) {
    const now = Date.now();
    for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
    const key = req.socket.remoteAddress + ":" + req.path;
    const item = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
    if (++item.count > 20)
      throw fail("Too many attempts. Try again in 15 minutes.", 429);
    if (attempts.size > 10000) throw fail("Please try again later.", 429);
    attempts.set(key, item);
  }
  function cookie(res, req, value, maxAge = 43200) {
    res.setHeader(
      "Set-Cookie",
      `dayline_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${req.secure || process.env.COOKIE_SECURE === "true" ? "; Secure" : ""}`,
    );
  }
  const sessionId = (req) =>
    digest(
      (req.headers.cookie || "")
        .split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith("dayline_session="))
        ?.slice(16) || "",
    );
  async function loginSession(req, res, u) {
    const token = randomBytes(32).toString("hex");
    await query(
      "INSERT INTO sessions (id,userId,expiresAt) VALUES (?,?,DATE_ADD(NOW(), INTERVAL 12 HOUR))",
      [digest(token), u.id],
    );
    cookie(res, req, token);
    return publicUser(u);
  }
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.get("X-Requested-With") !== "Dayline"
    )
      return res
        .status(403)
        .json({ error: "Request verification failed. Refresh the page." });
    next();
  });
  app.get(
    "/api/auth/status",
    wrap(async (req, res) => {
      const [row] = await query("SELECT COUNT(*) AS total FROM users");
      res.json({ setupRequired: row.total === 0 });
    }),
  );
  app.post(
    "/api/auth/register",
    wrap(async (req, res) => {
      limit(req);
      const data = z
        .object({
          name: profile.shape.name,
          email: emailSchema,
          password: credentials.shape.password,
          confirmPassword: z.string().max(128),
        })
        .refine((d) => d.password === d.confirmPassword, {
          message: "Passwords do not match.",
          path: ["confirmPassword"],
        })
        .parse(req.body);
      const hash = await passwordHash(data.password);
      const user = await transaction(async (c) => {
        // Serialize first-account creation so concurrent signups cannot both be administrators.
        await c.execute("SELECT id FROM settings WHERE id=1 FOR UPDATE");
        const [existing] = await c.execute(
          "SELECT id FROM users WHERE email=?",
          [data.email],
        );
        if (existing.length)
          throw fail(
            "An account with this email already exists. Please sign in.",
            409,
          );
        const [users] = await c.execute("SELECT id FROM users LIMIT 1");
        const role = users.length ? "Staff" : "Admin";
        const username = "email_" + randomBytes(16).toString("hex");
        const [r] = await c.execute(
          "INSERT INTO users (username,email,name,passwordHash,role,active) VALUES (?,?,?,?,?,1)",
          [username, data.email, data.name, hash, role],
        );
        await audit(c, "Account created", "user", r.insertId, {
          email: data.email,
          role,
        });
        return {
          id: r.insertId,
          username,
          email: data.email,
          name: data.name,
          role,
          active: true,
        };
      });
      res.status(201).json(await loginSession(req, res, user));
    }),
  );
  app.post(
    "/api/auth/login",
    wrap(async (req, res) => {
      limit(req);
      const data = z
        .object({
          email: emailSchema.optional(),
          username: credentials.shape.username.optional(),
          password: z.string().min(1).max(128),
        })
        .refine((d) => d.email || d.username, "Enter your email address.")
        .parse(req.body);
      const [u] = await query(
        data.email
          ? "SELECT * FROM users WHERE email=?"
          : "SELECT * FROM users WHERE username=? AND email IS NULL",
        [data.email || data.username],
      );
      const hash =
        u?.passwordHash ||
        "00000000000000000000000000000000:" + "00".repeat(64);
      if (!(await verify(data.password, hash)) || !u)
        throw fail("Incorrect email or password.", 401);
      if (!u.active)
        throw fail(
          "Your administrator needs to enable your account before you can sign in.",
          403,
        );
      res.json(await loginSession(req, res, u));
    }),
  );
  app.use(
    "/api",
    wrap(async (req, res, next) => {
      if (req.path === "/health") return next();
      const [u] = await query(
        "SELECT u.* FROM sessions s JOIN users u ON u.id=s.userId WHERE s.id=? AND s.expiresAt>NOW() AND u.active=1",
        [sessionId(req)],
      );
      if (!u) throw fail("Please sign in to continue.", 401);
      req.user = publicUser(u);
      if (
        req.method !== "GET" &&
        /^\/(settings|catalog|holidays)(\/|$)/.test(req.path) &&
        u.role !== "Admin"
      )
        throw fail("Administrator access required.", 403);
      next();
    }),
  );
  app.get("/api/auth/me", (req, res) => res.json(req.user));
  app.post(
    "/api/auth/logout",
    wrap(async (req, res) => {
      await query("UPDATE sessions SET expiresAt=NOW() WHERE id=?", [
        sessionId(req),
      ]);
      cookie(res, req, "", 0);
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/auth/password",
    wrap(async (req, res) => {
      limit(req);
      const data = z
        .object({
          currentPassword: z.string().max(128),
          password: credentials.shape.password,
        })
        .parse(req.body);
      const [u] = await query("SELECT * FROM users WHERE id=?", [req.user.id]);
      if (!(await verify(data.currentPassword, u.passwordHash)))
        throw fail("Current password is incorrect.", 400);
      const hash = await passwordHash(data.password);
      await transaction(async (c) => {
        await c.execute("UPDATE users SET passwordHash=? WHERE id=?", [
          hash,
          u.id,
        ]);
        await c.execute("UPDATE sessions SET expiresAt=NOW() WHERE userId=?", [
          u.id,
        ]);
        await audit(c, "Password changed", "user", u.id, { actorId: u.id });
      });
      cookie(res, req, "", 0);
      res.json({ ok: true });
    }),
  );
  app.use("/api/users", (req, res, next) =>
    req.user.role === "Admin"
      ? next()
      : res.status(403).json({ error: "Administrator access required." }),
  );
  app.get(
    "/api/users",
    wrap(async (req, res) =>
      res.json(
        (
          await query(
            "SELECT id,username,email,name,role,active FROM users ORDER BY name",
          )
        ).map(publicUser),
      ),
    ),
  );
  app.post(
    "/api/users",
    wrap(async (req, res) => {
      const data = credentials.merge(profile).parse(req.body);
      const hash = await passwordHash(data.password);
      const id = await transaction(async (c) => {
        const [r] = await c.execute(
          "INSERT INTO users (username,name,passwordHash,role,active) VALUES (?,?,?,?,?)",
          [data.username, data.name, hash, data.role, data.active],
        );
        await audit(c, "User created", "user", r.insertId, {
          actorId: req.user.id,
          username: data.username,
          role: data.role,
        });
        return r.insertId;
      });
      res.status(201).json({ id });
    }),
  );
  app.put(
    "/api/users/:id",
    wrap(async (req, res) => {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const data = profile
        .extend({ password: credentials.shape.password.optional() })
        .parse(req.body);
      const hash = data.password ? await passwordHash(data.password) : null;
      await transaction(async (c) => {
        await c.execute("SELECT id FROM settings WHERE id=1 FOR UPDATE");
        const [rows] = await c.execute(
          "SELECT * FROM users WHERE id=? FOR UPDATE",
          [id],
        );
        const old = rows[0];
        if (!old) throw fail("User not found.", 404);
        if (id === req.user.id && (!data.active || data.role !== "Admin"))
          throw fail("You cannot deactivate or demote your own account.");
        if (
          old.role === "Admin" &&
          old.active &&
          (!data.active || data.role !== "Admin")
        ) {
          const [admins] = await c.execute(
            "SELECT id FROM users WHERE role='Admin' AND active=1 FOR UPDATE",
          );
          if (admins.length <= 1)
            throw fail("At least one active administrator is required.");
        }
        await c.execute(
          "UPDATE users SET name=?,role=?,active=?,passwordHash=? WHERE id=?",
          [data.name, data.role, data.active, hash || old.passwordHash, id],
        );
        if (hash || !data.active || data.role !== old.role)
          await c.execute(
            "UPDATE sessions SET expiresAt=NOW() WHERE userId=?",
            [id],
          );
        await audit(c, "User updated", "user", id, {
          actorId: req.user.id,
          before: publicUser(old),
          after: { name: data.name, role: data.role, active: data.active },
          passwordReset: Boolean(hash),
        });
      });
      res.json({ ok: true });
    }),
  );
}
