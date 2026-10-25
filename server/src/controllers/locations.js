import { localDate, dayBounds } from "../../../shared/location-time.js";
import {
  lookupArea,
  lookupGeoapifyArea,
  geoapifyMapUrl,
} from "../services/location-area.js";
import { z } from "zod";
import { holidayDateSchema } from "../services/rules.js";
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const idSchema = z.coerce.number().int().positive();
export const locationSchema = z
  .object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    accuracy: z.number().finite().min(0).max(100000),
    capturedAt: z.string().datetime(),
    note: z.string().trim().max(500).default(""),
    photo: z.string().max(1400000).nullable().optional(),
  })
  .strict();
export function decodePhoto(photo) {
  if (!photo) return null;
  const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    photo,
  );
  if (!match) throw fail("Choose a JPEG or PNG photo.");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > 1024 * 1024) throw fail("Photo must be 1 MB or smaller.");
  const valid =
    match[1] === "jpeg"
      ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
      : bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (!valid || bytes.length < 12)
    throw fail("Invalid photo. Choose a JPEG or PNG image.");
  return { bytes, mime: "image/" + match[1] };
}
export function registerLocations({ app, wrap, query, transaction, audit }) {
  app.use("/api/locations", (req, res, next) =>
    req.user.role === "Admin"
      ? next()
      : res.status(403).json({ error: "Administrator access required." }),
  );
  async function attendanceZone() {
    const [settings] = await query("SELECT rules FROM settings WHERE id=1");
    const [whatsapp] = await query(
      "SELECT config FROM whatsapp_config WHERE id=1",
    );
    const parse = (value) =>
      typeof value === "string" ? JSON.parse(value) : value || {};
    const zone =
      parse(settings?.rules).attendanceTimeZone ||
      parse(whatsapp?.config).timeZone ||
      "Asia/Kolkata";
    try {
      new Intl.DateTimeFormat("en", { timeZone: zone });
      return zone;
    } catch {
      return "Asia/Kolkata";
    }
  }
  app.delete(
    "/api/locations/:id",
    wrap(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      await transaction(async (c) => {
        const [rows] = await c.execute(
          "SELECT employeeId,capturedAt,photo IS NOT NULL AS hasPhoto FROM location_checkins WHERE id=? FOR UPDATE",
          [id],
        );
        if (!rows[0]) throw fail("Location not found.", 404);
        await c.execute("DELETE FROM location_checkins WHERE id=?", [id]);
        await audit(c, "Location check-in deleted", "location_checkin", id, {
          actorId: req.user.id,
          employeeId: rows[0].employeeId,
          capturedAt: rows[0].capturedAt,
          hasPhoto: Boolean(rows[0].hasPhoto),
        });
      });
      res.json({ ok: true });
    }),
  );
  async function config() {
    const [stored] = await query(
      "SELECT embedKey,geocodingKey,provider,geoapifyKey FROM location_config WHERE id=1",
    );
    return {
      provider: stored?.provider || "google",
      geoapifyKey: stored?.geoapifyKey ?? process.env.GEOAPIFY_API_KEY ?? "",
      embedKey: stored?.embedKey ?? process.env.GOOGLE_MAPS_EMBED_API_KEY ?? "",
      geocodingKey:
        stored?.geocodingKey ?? process.env.GOOGLE_MAPS_GEOCODING_API_KEY ?? "",
    };
  }
  const configStatus = (c) => ({
    provider: c.provider,
    geoapifyConfigured: Boolean(c.geoapifyKey),
    embedConfigured: Boolean(c.embedKey),
    geocodingConfigured: Boolean(c.geocodingKey),
  });
  app.get(
    "/api/locations/config",
    wrap(async (req, res) => res.json(configStatus(await config()))),
  );
  app.put(
    "/api/locations/config",
    wrap(async (req, res) => {
      const key = z
        .string()
        .trim()
        .max(255)
        .regex(/^[A-Za-z0-9_-]*$/, "Invalid API key format.")
        .optional();
      const data = z
        .object({
          embedKey: key,
          geocodingKey: key,
          geoapifyKey: key,
          provider: z.enum(["google", "geoapify"]).optional(),
        })
        .strict()
        .parse(req.body);
      await transaction(async (c) => {
        await c.execute("SELECT id FROM location_config WHERE id=1 FOR UPDATE");
        for (const field of [
          "embedKey",
          "geocodingKey",
          "geoapifyKey",
          "provider",
        ])
          if (data[field] !== undefined)
            await c.execute(
              `UPDATE location_config SET ${field}=? WHERE id=1`,
              [data[field]],
            );
        await audit(c, "Location maps settings updated", "settings", 1, {
          actorId: req.user.id,
          changed: Object.keys(data),
        });
      });
      res.json(configStatus(await config()));
    }),
  );
  app.get(
    "/api/location-areas/:id",
    wrap(async (req, res) => {
      if (!["Admin", "Employee"].includes(req.user.role))
        throw fail("Access denied.", 403);
      const id = idSchema.parse(req.params.id);
      const [row] = await query(
        "SELECT latitude,longitude FROM location_checkins WHERE id=?" +
          (req.user.role === "Employee" ? " AND employeeId=?" : ""),
        req.user.role === "Employee" ? [id, req.user.employeeId] : [id],
      );
      if (!row) throw fail("Location not found.", 404);
      const maps = await config();
      res.json(
        await (maps.provider === "geoapify"
          ? lookupGeoapifyArea(row.latitude, row.longitude, maps.geoapifyKey)
          : lookupArea(row.latitude, row.longitude, maps.geocodingKey)),
      );
    }),
  );
  app.get(
    "/api/location-maps/:id",
    wrap(async (req, res) => {
      if (!["Admin", "Employee"].includes(req.user.role))
        throw fail("Access denied.", 403);
      const id = idSchema.parse(req.params.id);
      const [row] = await query(
        "SELECT latitude,longitude FROM location_checkins WHERE id=?" +
          (req.user.role === "Employee" ? " AND employeeId=?" : ""),
        req.user.role === "Employee" ? [id, req.user.employeeId] : [id],
      );
      if (!row) throw fail("Location not found.", 404);
      const maps = await config();
      if (maps.provider !== "geoapify" || !maps.geoapifyKey)
        throw fail("Configure your Geoapify API key in Map settings.", 400);
      let image;
      try {
        const response = await fetch(
          geoapifyMapUrl(row.latitude, row.longitude, maps.geoapifyKey),
          { signal: AbortSignal.timeout(15000) },
        );
        if (
          !response.ok ||
          !response.headers.get("content-type")?.startsWith("image/png")
        )
          throw new Error("Map unavailable");
        image = Buffer.from(await response.arrayBuffer());
        if (image.length > 4 * 1024 * 1024) throw new Error("Map too large");
      } catch {
        throw fail(
          "Map preview unavailable. Check your Geoapify key, restrictions, and quota.",
          502,
        );
      }
      res
        .set({
          "Content-Type": "image/png",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
        })
        .send(image);
    }),
  );
  app.put(
    "/api/locations/employees/:id",
    wrap(async (req, res) => {
      const id = idSchema.parse(req.params.id),
        { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
      await transaction(async (c) => {
        const [rows] = await c.execute(
          "SELECT id,locationTrackingEnabled FROM employees WHERE id=? FOR UPDATE",
          [id],
        );
        if (!rows.length) throw fail("Employee not found.", 404);
        await c.execute(
          "UPDATE employees SET locationTrackingEnabled=? WHERE id=?",
          [enabled, id],
        );
        await audit(c, "Location check-ins setting changed", "employee", id, {
          actorId: req.user.id,
          before: Boolean(rows[0].locationTrackingEnabled),
          enabled,
        });
      });
      res.json({ ok: true, enabled });
    }),
  );
  async function list(req, res) {
    if (!["Admin", "Employee"].includes(req.user.role))
      throw fail("Access denied.", 403);
    const employeeId =
      req.user.role === "Employee"
        ? req.user.employeeId
        : idSchema.parse(req.query.employeeId);
    const timeZone = await attendanceZone();
    const date = holidayDateSchema.parse(
      req.query.date ?? req.query.from ?? localDate(new Date(), timeZone),
    );
    const [start, end] = dayBounds(date, timeZone);
    if (req.query.to !== undefined && req.query.to !== date)
      throw fail("Select a single day.");
    const [employee] = await query(
      "SELECT id,name,locationTrackingEnabled FROM employees WHERE id=?",
      [employeeId],
    );
    if (!employee) throw fail("Employee not found.", 404);
    const records = await query(
      "SELECT id,employeeId,latitude,longitude,accuracy,capturedAt,receivedAt,note,photo IS NOT NULL AS hasPhoto FROM location_checkins WHERE employeeId=? AND capturedAt>=? AND capturedAt<? ORDER BY capturedAt DESC,receivedAt DESC,id DESC LIMIT 500",
      [employeeId, start, end],
    );
    const maps = await config();
    res.json({
      date,
      timeZone,
      enabled: Boolean(employee.locationTrackingEnabled),
      records,
      mapProvider: maps.provider,
      mapsKey: maps.provider === "google" ? maps.embedKey : "",
      mapsConfigured: Boolean(
        maps.provider === "geoapify" ? maps.geoapifyKey : maps.embedKey,
      ),
      areaNamesConfigured: Boolean(
        maps.provider === "geoapify" ? maps.geoapifyKey : maps.geocodingKey,
      ),
      limit: 500,
    });
  }
  app.get("/api/locations", wrap(list));
  app.get("/api/me/locations", wrap(list));
  app.post(
    "/api/me/locations",
    wrap(async (req, res) => {
      if (req.user.role !== "Employee")
        throw fail("Employee access required.", 403);
      const data = locationSchema.parse(req.body),
        captured = Date.parse(data.capturedAt),
        now = Date.now();
      if (captured < now - 120000 || captured > now + 30000)
        throw fail("Location expired. Capture your current location again.");
      const photo = decodePhoto(data.photo);
      const zone = await attendanceZone();
      const [dayStart, dayEnd] = dayBounds(
        localDate(new Date(now), zone),
        zone,
      );
      const id = await transaction(async (c) => {
        const [rows] = await c.execute(
          "SELECT id,status,locationTrackingEnabled FROM employees WHERE id=? FOR UPDATE",
          [req.user.employeeId],
        );
        if (!rows[0]?.locationTrackingEnabled || rows[0].status !== "Active")
          throw fail(
            "Location check-ins are not enabled for you. Contact your administrator.",
            403,
          );
        const [count] = await c.execute(
          "SELECT COUNT(*) AS total FROM location_checkins WHERE employeeId=? AND receivedAt>=? AND receivedAt<?",
          [req.user.employeeId, dayStart, dayEnd],
        );
        if (count[0].total >= 100)
          throw fail("Daily limit reached (100 check-ins).", 429);
        const [result] = await c.execute(
          "INSERT INTO location_checkins (employeeId,latitude,longitude,accuracy,capturedAt,receivedAt,note,photo,photoType) VALUES (?,?,?,?,?,UTC_TIMESTAMP(3),?,?,?)",
          [
            req.user.employeeId,
            data.latitude,
            data.longitude,
            data.accuracy,
            new Date(captured).toISOString().slice(0, 23).replace("T", " "),
            data.note,
            photo?.bytes || null,
            photo?.mime || null,
          ],
        );
        await audit(
          c,
          "Location check-in added",
          "location_checkin",
          result.insertId,
          {
            actorId: req.user.id,
            employeeId: req.user.employeeId,
            hasPhoto: Boolean(photo),
          },
        );
        return result.insertId;
      });
      res.status(201).json({ id });
    }),
  );
  app.get(
    "/api/location-photos/:id",
    wrap(async (req, res) => {
      if (!["Admin", "Employee"].includes(req.user.role))
        throw fail("Access denied.", 403);
      const id = idSchema.parse(req.params.id);
      const [record] = await query(
        "SELECT photo,photoType FROM location_checkins WHERE id=?" +
          (req.user.role === "Employee" ? " AND employeeId=?" : ""),
        req.user.role === "Employee" ? [id, req.user.employeeId] : [id],
      );
      if (!record?.photo) throw fail("Photo not found.", 404);
      res
        .set({
          "Content-Type": record.photoType,
          "X-Content-Type-Options": "nosniff",
          "Content-Disposition": "inline",
          "Cache-Control": "private, no-store",
        })
        .send(record.photo);
    }),
  );
}
