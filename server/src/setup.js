import { pool, query } from "./db.js";
import { defaults, calculate } from "./rules.js";
await query(
  `CREATE TABLE IF NOT EXISTS employees (id INT AUTO_INCREMENT PRIMARY KEY,name VARCHAR(100) NOT NULL,email VARCHAR(160) NULL UNIQUE,department VARCHAR(80) NOT NULL,role VARCHAR(100) NOT NULL,status VARCHAR(16) NOT NULL DEFAULT 'Active',createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
);
// Upgrade existing installations without changing employee data.
const [emailColumn] = await query(
  "SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='email'",
);
if (emailColumn.IS_NULLABLE === "NO") {
  await query("ALTER TABLE employees MODIFY COLUMN email VARCHAR(160) NULL");
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
