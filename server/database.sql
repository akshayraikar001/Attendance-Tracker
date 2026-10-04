-- Run with a MySQL administrator account. Change the password for deployment.
CREATE DATABASE IF NOT EXISTS attendance_tracker CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'attendance'@'%' IDENTIFIED BY 'attendance_dev';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, REFERENCES ON attendance_tracker.* TO 'attendance'@'%';
