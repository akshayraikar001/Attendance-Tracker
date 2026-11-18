import { pool, query } from "../config/db.js";
import { defaults, calculate } from "../services/rules.js";
await query(
  `CREATE TABLE IF NOT EXISTS employees (id INT AUTO_INCREMENT PRIMARY KEY,name VARCHAR(100) NOT NULL,email VARCHAR(160) NULL UNIQUE,department VARCHAR(80) NOT NULL,role VARCHAR(100) NOT NULL,status VARCHAR(16) NOT NULL DEFAULT 'Active',createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
);
await query(`CREATE TABLE IF NOT EXISTS employee_report_sends (
 employeeId INT NOT NULL, month CHAR(7) NOT NULL, format VARCHAR(8) NOT NULL, detail VARCHAR(16) NOT NULL,
 state VARCHAR(16) NOT NULL, attemptId CHAR(36) NOT NULL, phone VARCHAR(16) NOT NULL,
 filename VARCHAR(255) NOT NULL, messageId VARCHAR(200) NULL, sentAt DATETIME NULL,
 updatedAt DATETIME NOT NULL, error VARCHAR(500) NULL,
 PRIMARY KEY(employeeId,month,format,detail), FOREIGN KEY(employeeId) REFERENCES employees(id)
)`);
// Upgrade existing installations without changing employee data.
const [emailColumn] = await query(
  "SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='email'",
);
if (emailColumn.IS_NULLABLE === "NO") {
  await query("ALTER TABLE employees MODIFY COLUMN email VARCHAR(160) NULL");
}
const [employeePhone] = await query(
  "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='phone'",
);
if (!employeePhone)
  await query("ALTER TABLE employees ADD COLUMN phone VARCHAR(16) NULL UNIQUE");
const [locationColumn] = await query(
  "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='locationTrackingEnabled'",
);
if (!locationColumn)
  await query(
    "ALTER TABLE employees ADD COLUMN locationTrackingEnabled BOOLEAN NOT NULL DEFAULT 0",
  );
await query(`CREATE TABLE IF NOT EXISTS location_checkins (
 id INT AUTO_INCREMENT PRIMARY KEY,employeeId INT NOT NULL,
 latitude DOUBLE NOT NULL,longitude DOUBLE NOT NULL,accuracy DOUBLE NOT NULL,
 capturedAt DATETIME(3) NOT NULL,receivedAt DATETIME(3) NOT NULL,
 note VARCHAR(500) NOT NULL DEFAULT '',photo MEDIUMBLOB NULL,photoType VARCHAR(30) NULL,
 FOREIGN KEY(employeeId) REFERENCES employees(id),INDEX(employeeId,receivedAt)
)`);
await query(
  `CREATE TABLE IF NOT EXISTS location_config (id INT PRIMARY KEY, embedKey VARCHAR(255) NULL, geocodingKey VARCHAR(255) NULL)`,
);
await query("INSERT IGNORE INTO location_config (id) VALUES (1)");
for (const [name, definition] of [
  ["provider", "VARCHAR(16) NOT NULL DEFAULT 'google'"],
  ["geoapifyKey", "VARCHAR(255) NULL"],
]) {
  const [column] = await query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='location_config' AND COLUMN_NAME=?",
    [name],
  );
  if (!column)
    await query(`ALTER TABLE location_config ADD COLUMN ${name} ${definition}`);
}

await query(
  `CREATE TABLE IF NOT EXISTS settings (id INT PRIMARY KEY, rules JSON NOT NULL)`,
);
await query(
  `CREATE TABLE IF NOT EXISTS attendance (id INT AUTO_INCREMENT PRIMARY KEY,employeeId INT NOT NULL,date DATE NOT NULL,mode VARCHAR(10) NOT NULL,inTime VARCHAR(5),outTime VARCHAR(5),overnight BOOLEAN NOT NULL DEFAULT 0,status VARCHAR(16) NOT NULL,workedMinutes INT,lateMinutes INT,earlyMinutes INT,overtimeMinutes INT,notes TEXT,rules JSON NOT NULL,updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,UNIQUE KEY employee_date(employeeId,date),FOREIGN KEY(employeeId) REFERENCES employees(id))`,
);
await query(
  `CREATE TABLE IF NOT EXISTS audit (id INT AUTO_INCREMENT PRIMARY KEY,action VARCHAR(100) NOT NULL,entity VARCHAR(30) NOT NULL,entityId INT,details JSON NOT NULL,createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
);
await query(
  `CREATE TABLE IF NOT EXISTS auto_clockouts (employeeId INT NOT NULL,date DATE NOT NULL,createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(employeeId,date))`,
);
await query(
  `CREATE TABLE IF NOT EXISTS auto_absences (employeeId INT NOT NULL,date DATE NOT NULL,snapshotHash CHAR(64) NULL,createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(employeeId,date))`,
);
await query(
  `CREATE TABLE IF NOT EXISTS holidays (id INT AUTO_INCREMENT PRIMARY KEY,date DATE NOT NULL UNIQUE,name VARCHAR(100) NOT NULL,active BOOLEAN NOT NULL DEFAULT 1,updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`,
);
await query("INSERT IGNORE INTO settings (id,rules) VALUES (1,?)", [
  JSON.stringify(defaults),
]);
await query(
  `CREATE TABLE IF NOT EXISTS catalog (id INT AUTO_INCREMENT PRIMARY KEY,kind VARCHAR(16) NOT NULL,name VARCHAR(100) NOT NULL,active BOOLEAN NOT NULL DEFAULT 1,UNIQUE KEY kind_name(kind,name))`,
);
await query(
  "INSERT IGNORE INTO catalog (kind,name) SELECT 'departments',department FROM employees",
);
await query(
  "INSERT IGNORE INTO catalog (kind,name) SELECT 'roles',role FROM employees",
);
const [catalogCount] = await query("SELECT COUNT(*) AS total FROM catalog");
if (catalogCount.total === 0) {
  for (const [kind, name] of [
    ["departments", "Development"],
    ["departments", "Sales"],
    ["roles", "Manager"],
    ["roles", "Developer"],
  ]) {
    await query("INSERT IGNORE INTO catalog (kind,name) VALUES (?,?)", [
      kind,
      name,
    ]);
  }
}
await query(
  `CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY,username VARCHAR(60) NOT NULL UNIQUE,name VARCHAR(100) NOT NULL,passwordHash VARCHAR(200) NOT NULL,role VARCHAR(16) NOT NULL,active BOOLEAN NOT NULL DEFAULT 1,createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
);
await query(
  `CREATE TABLE IF NOT EXISTS sessions (id CHAR(64) PRIMARY KEY,userId INT NOT NULL,expiresAt DATETIME NOT NULL,FOREIGN KEY(userId) REFERENCES users(id), INDEX (expiresAt))`,
);
// Nullable email preserves existing username accounts during migration.
const [userEmail] = await query(
  "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='email'",
);
if (!userEmail)
  await query("ALTER TABLE users ADD COLUMN email VARCHAR(254) NULL UNIQUE");
// Preserve existing accounts while adding employee and external identity links.
for (const [name, definition] of [
  [
    "employeeId",
    "INT NULL UNIQUE, ADD FOREIGN KEY (employeeId) REFERENCES employees(id)",
  ],
  [
    "keycloakSubject",
    "VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL UNIQUE",
  ],
]) {
  const [column] = await query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME=?",
    [name],
  );
  if (!column)
    await query(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
}
await query(`CREATE TABLE IF NOT EXISTS time_away (
  id INT AUTO_INCREMENT PRIMARY KEY, employeeId INT NOT NULL, date DATE NOT NULL,
  departedAt DATETIME NOT NULL, returnedAt DATETIME NULL, reason VARCHAR(500) NOT NULL DEFAULT '',
  createdBy INT NOT NULL, updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY(employeeId) REFERENCES employees(id), INDEX(employeeId,date)
)`);
await query(
  `CREATE TABLE IF NOT EXISTS whatsapp_config (id INT PRIMARY KEY,config JSON NOT NULL)`,
);
await query("INSERT IGNORE INTO whatsapp_config (id,config) VALUES (1,?)", [
  JSON.stringify({
    enabled: false,
    sessionId: "dayline-attendance",
    groupId: "",
    groupName: "Insight - Attendance",
    timeZone: "",
    autoApprove: false,
    autoOverwrite: false,
    since: 0,
  }),
]);
await query(`CREATE TABLE IF NOT EXISTS whatsapp_group_messages (
  id CHAR(64) PRIMARY KEY, sessionId VARCHAR(80) NOT NULL, groupId VARCHAR(160) NOT NULL,
  timestamp BIGINT NOT NULL, message JSON NOT NULL, clearedAt DATETIME NULL,
  INDEX source_time(sessionId,groupId,timestamp)
)`);
await query(`CREATE TABLE IF NOT EXISTS whatsapp_group_scans (
  id CHAR(64) PRIMARY KEY, version INT NOT NULL DEFAULT 0, pageCursor VARCHAR(160) NULL,
  state VARCHAR(20) NOT NULL DEFAULT 'idle', scanned INT NOT NULL DEFAULT 0
)`);
await query(
  `CREATE TABLE IF NOT EXISTS whatsapp_links (identity VARCHAR(160) PRIMARY KEY,employeeId INT NOT NULL,FOREIGN KEY(employeeId) REFERENCES employees(id))`,
);
await query(
  `CREATE TABLE IF NOT EXISTS whatsapp_events (id CHAR(64) PRIMARY KEY,sessionId VARCHAR(80) NOT NULL,groupId VARCHAR(160) NOT NULL,messageId VARCHAR(160) NOT NULL,senderId VARCHAR(160) NOT NULL,senderName VARCHAR(200) NOT NULL,text TEXT NOT NULL,timestamp BIGINT NOT NULL,employeeId INT NULL,date DATE NULL,state VARCHAR(20) NOT NULL,reason VARCHAR(500) NOT NULL,createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,INDEX(state),INDEX(timestamp))`,
);
for (const [name, definition] of [
  ["isEdited", "BOOLEAN NOT NULL DEFAULT 0"],
  ["manualOnly", "BOOLEAN NOT NULL DEFAULT 0"],
  ["previousText", "TEXT NULL"],
  ["correction", "JSON NULL"],
]) {
  const columns = await query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='whatsapp_events' AND COLUMN_NAME=?",
    [name],
  );
  if (!columns.length)
    await query(`ALTER TABLE whatsapp_events ADD COLUMN ${name} ${definition}`);
}
const clearedColumn = await query(
  "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='whatsapp_events' AND COLUMN_NAME='clearedAt'",
);
if (!clearedColumn.length)
  await query("ALTER TABLE whatsapp_events ADD COLUMN clearedAt DATETIME NULL");
await query(
  `CREATE TABLE IF NOT EXISTS whatsapp_days (employeeId INT NOT NULL,date DATE NOT NULL,snapshotHash CHAR(64) NOT NULL,PRIMARY KEY(employeeId,date))`,
);
await query(
  `CREATE TABLE IF NOT EXISTS whatsapp_sync_queue (id CHAR(64) PRIMARY KEY,timestamp BIGINT NOT NULL,message JSON NOT NULL,INDEX(timestamp))`,
);
await query(
  `CREATE TABLE IF NOT EXISTS leave_requests (id CHAR(64) PRIMARY KEY,sessionId VARCHAR(80) NOT NULL,groupId VARCHAR(160) NOT NULL,messageId VARCHAR(160) NOT NULL,senderId VARCHAR(160) NOT NULL,senderName VARCHAR(200) NOT NULL,text TEXT NOT NULL,timestamp BIGINT NOT NULL,employeeId INT NULL,kind VARCHAR(16) NOT NULL,fromDate DATE NULL,toDate DATE NULL,reason TEXT NOT NULL,state VARCHAR(16) NOT NULL DEFAULT 'pending',decidedBy INT NULL,decidedAt DATETIME NULL,createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,INDEX(groupId,state),INDEX(timestamp))`,
);
// Adopt an existing unambiguous international mapping, without guessing a country code.
const existingPhoneLinks = await query(
  "SELECT l.identity,l.employeeId,e.phone FROM whatsapp_links l JOIN employees e ON e.id=l.employeeId WHERE l.identity LIKE 'phone:%'",
);
for (const employeeId of new Set(existingPhoneLinks.map((l) => l.employeeId))) {
  const links = existingPhoneLinks.filter((l) => l.employeeId === employeeId);
  const valid = links.filter((l) => /^phone:[1-9]\d{10,14}$/.test(l.identity));
  if (!links[0].phone && valid.length === 1) {
    const phone = "+" + valid[0].identity.slice(6);
    const [owner] = await query(
      "SELECT id FROM employees WHERE phone=? AND id<>?",
      [phone, employeeId],
    );
    if (!owner) {
      await query("UPDATE employees SET phone=? WHERE id=? AND phone IS NULL", [
        phone,
        employeeId,
      ]);
      for (const link of links)
        if (
          link.identity !== valid[0].identity &&
          valid[0].identity.slice(6).endsWith(link.identity.slice(6))
        ) {
          await query(
            "DELETE FROM whatsapp_links WHERE identity=? AND employeeId=?",
            [link.identity, employeeId],
          );
        }
    }
  }
}
const [whatsappSettings] = await query(
  "SELECT config FROM whatsapp_config WHERE id=1",
);
if (whatsappSettings) {
  const config =
    typeof whatsappSettings.config === "string"
      ? JSON.parse(whatsappSettings.config)
      : whatsappSettings.config;
  if (
    !config.timeZone &&
    existingPhoneLinks.some((link) => link.identity.startsWith("phone:91"))
  ) {
    config.timeZone = "Asia/Kolkata";
    await query("UPDATE whatsapp_config SET config=? WHERE id=1", [
      JSON.stringify(config),
    ]);
  }
}
if (process.argv.includes("--seed")) {
  const names = [
    ["Olivia Rhye", "Design", "Product Designer"],
    ["Phoenix Baker", "Development", "Frontend Developer"],
    ["Lana Steiner", "People", "HR Manager"],
    ["Demi Wilkinson", "Marketing", "Marketing Lead"],
    ["Drew Cano", "Development", "Backend Developer"],
    ["Natali Craig", "Design", "UX Researcher"],
    ["Orlando Diggs", "Operations", "Operations Manager"],
    ["Andi Lane", "Marketing", "Content Strategist"],
  ];
  for (const [name, department, role] of names)
    await query(
      "INSERT IGNORE INTO employees (name,email,department,role) VALUES (?,?,?,?)",
      [
        name,
        name.toLowerCase().replace(" ", ".") + "@dayline.example",
        department,
        role,
      ],
    );
  const employees = await query("SELECT id FROM employees");
  for (let offset = 0; offset < 14; offset++) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - offset);
    if ([0, 6].includes(date.getUTCDay())) continue;
    for (let i = 0; i < employees.length; i++) {
      if (offset === 0 && i === 7) continue;
      const manual = (i + offset) % 7 === 0;
      const entry = {
        mode: manual ? "manual" : "time",
        status: i % 2 ? "Half day" : "Absent",
        inTime: i % 3 === 0 ? "09:24" : "09:00",
        outTime: i % 4 === 0 ? "19:15" : "18:00",
        overnight: false,
      };
      const result = calculate(entry, defaults);
      await query(
        "INSERT IGNORE INTO attendance (employeeId,date,mode,inTime,outTime,status,workedMinutes,lateMinutes,earlyMinutes,overtimeMinutes,notes,rules) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        [
          employees[i].id,
          date.toISOString().slice(0, 10),
          entry.mode,
          manual ? null : entry.inTime,
          manual ? null : entry.outTime,
          result.status,
          result.workedMinutes,
          result.lateMinutes,
          result.earlyMinutes,
          result.overtimeMinutes,
          "",
          JSON.stringify(defaults),
        ],
      );
    }
  }
}
console.log("MySQL schema ready.");
await pool.end();
