#!/usr/bin/env bash
# Optional isolated MariaDB server for environments without Docker.
set -euo pipefail
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
local_dir="$project_dir/.local"
command -v mariadb-install-db >/dev/null || { echo 'Install MariaDB server, or use the MySQL Docker setup in README.md.'; exit 1; }
mkdir -p "$local_dir/mysql"
if [ ! -d "$local_dir/mysql/mysql" ]; then
  mariadb-install-db --datadir="$local_dir/mysql" --auth-root-authentication-method=normal --skip-test-db > "$local_dir/mysql-install.log" 2>&1
fi
if ! mysqladmin --socket="$local_dir/mysql.sock" -uroot ping >/dev/null 2>&1; then
  nohup mariadbd --no-defaults --user="$(id -un)" --datadir="$local_dir/mysql" --socket="$local_dir/mysql.sock" --port=3307 --bind-address=127.0.0.1 --pid-file="$local_dir/mysql.pid" --log-error="$local_dir/mysql.log" > "$local_dir/mysql-console.log" 2>&1 &
  for attempt in {1..30}; do
    if mysqladmin --socket="$local_dir/mysql.sock" -uroot ping >/dev/null 2>&1; then break; fi
    sleep 1
  done
fi
mysql --socket="$local_dir/mysql.sock" -uroot < "$project_dir/server/database.sql"
if [ ! -f "$project_dir/.env" ]; then
  sed 's/DB_PORT=3306/DB_PORT=3307/' "$project_dir/.env.example" > "$project_dir/.env"
fi
echo 'Isolated local database is ready on port 3307. Use DB_PORT=3307 in .env.'
