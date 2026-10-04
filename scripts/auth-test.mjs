// Integration check against an isolated database on the optional local MariaDB.
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
const admin = await mysql.createConnection({
  socketPath: process.cwd() + "/.local/mysql.sock",
  user: "root",
});
const database = "attendance_auth_test_" + Date.now();
const listener = createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const env = {
  ...process.env,
  AUTH_SETUP_TOKEN: "isolated-test-setup-token-123456789",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3307",
  DB_NAME: database,
  DB_USER: "attendance",
  DB_PASSWORD: "attendance_dev",
  PORT: String(port),
};
let child;
try {
  await admin.query(`CREATE DATABASE \`${database}\``);
  await admin.query(
    `GRANT SELECT, INSERT, UPDATE, CREATE, ALTER, REFERENCES ON \`${database}\`.* TO 'attendance'@'%'`,
  );
  const setup = spawnSync(process.execPath, ["server/src/setup.js"], {
    env,
    encoding: "utf8",
  });
  assert.equal(setup.status, 0, setup.stderr);
  child = spawn(process.execPath, ["server/src/index.js"], {
    env,
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}/api`;
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + "/health")).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  let cookie='';
  async function request(path, body, {method=body?'POST':'GET', expected=200, session=cookie, csrf=true}={}) {
    const response=await fetch(base+path,{method,headers:{Cookie:session,...(body?{'Content-Type':'application/json'}:{}),...(csrf?{'X-Requested-With':'Dayline'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const result=await response.json();assert.equal(response.status,expected,JSON.stringify(result));
    return {result,cookie:response.headers.get('set-cookie')?.split(';')[0],headers:response.headers};
  }
  assert.equal((await request('/auth/status')).result.setupRequired,true);
  await request('/employees',null,{expected:401});
  await request('/users',null,{expected:401});
  const initial={name:'Real Admin',username:'admin',password:'secure-password-123',setupToken:env.AUTH_SETUP_TOKEN};
  await request('/auth/setup',initial,{csrf:false,expected:403});
  await request('/auth/setup',{...initial,setupToken:'wrong-but-long-token-123456'},{expected:403});
  const initialLogin=await request('/auth/setup',initial,{expected:201});cookie=initialLogin.cookie;
  assert.match(initialLogin.headers.get('set-cookie'),/HttpOnly/);assert.match(initialLogin.headers.get('set-cookie'),/SameSite=Strict/);
  assert.equal(initialLogin.result.role,'Admin');assert.equal(initialLogin.result.passwordHash,undefined);
  await request('/auth/setup',initial,{expected:409});
  assert.equal((await request('/auth/status')).result.setupRequired,false);
  assert.equal((await request('/auth/me')).result.username,'admin');
  await request('/auth/login',{username:'admin',password:'incorrect-password'},{expected:401});
  const staff=(await request('/users',{username:'staff',name:'Staff User',password:'staff-password-123',role:'Staff',active:true},{expected:201})).result;
  await request('/users/'+initialLogin.result.id,{name:'Admin',role:'Staff',active:true},{method:'PUT',expected:400});
  await request('/users/'+initialLogin.result.id,{name:'Admin',role:'Admin',active:false},{method:'PUT',expected:400});
  const signedStaff=await request('/auth/login',{username:'staff',password:'staff-password-123'});const staffCookie=signedStaff.cookie;
  await request('/employees',null,{session:staffCookie});
  await request('/users',null,{session:staffCookie,expected:403});
  const settings=(await request('/settings')).result;
  await request('/settings',settings,{method:'PUT',session:staffCookie,expected:403});
  await request('/catalog/departments',{name:'Blocked'},{session:staffCookie,expected:403});
  await request('/employees',{name:'Allowed Employee',department:'Sales',role:'Sales'},{session:staffCookie,expected:201});
  await request('/users/'+staff.id,{name:'Staff User',role:'Staff',active:false},{method:'PUT'});
  await request('/employees',null,{session:staffCookie,expected:401});
  await request('/auth/login',{username:'staff',password:'staff-password-123'},{expected:401});
  await request('/users/'+staff.id,{name:'Staff User',role:'Staff',active:true,password:'reset-password-123'},{method:'PUT'});
  await request('/auth/login',{username:'staff',password:'staff-password-123'},{expected:401});
  const reset=await request('/auth/login',{username:'staff',password:'reset-password-123'});
  await request('/auth/password',{currentPassword:'reset-password-123',password:'changed-password-123'},{session:reset.cookie});
  await request('/auth/me',null,{session:reset.cookie,expected:401});
  const changed=await request('/auth/login',{username:'staff',password:'changed-password-123'});
  await request('/auth/logout',{}, {session:changed.cookie});
  await request('/auth/me',null,{session:changed.cookie,expected:401});
  const listed=(await request('/users')).result;assert.ok(listed.every(u=>!u.passwordHash&&!u.password));
  const audits=(await request('/audit')).result;assert.ok(!JSON.stringify(audits).includes('password-123'));
  await admin.query(`UPDATE \`${database}\`.sessions SET expiresAt=DATE_SUB(NOW(), INTERVAL 1 DAY)`);
  await request('/auth/me',null,{expected:401});
  console.log('PASS: one-time setup, login, secure cookie flags, CSRF checks, protected routes, role enforcement, self-lockout protection, disabled accounts, password reset/change, logout, expiry, and secret-free responses/audit.');
} finally {
  if (child && child.exitCode === null) {
    child.kill();
    await once(child, "exit");
  }
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await admin.query(
    `REVOKE ALL PRIVILEGES ON \`${database}\`.* FROM 'attendance'@'%'`,
  );
  await admin.end();
}
