#!/bin/bash
# 从云服务器拉取生产数据到本机（方案一：云端为准）。
# 覆盖两处：本机 MySQL 库（DROP/重建表级覆盖）与 backend/uploads 图片（镜像云端）。
# 用法: scripts/sync-from-cloud.sh [--yes]
set -euo pipefail

SERVER=root@111.230.226.241
BACKEND_DIR="$(cd "$(dirname "$0")/../backend" && pwd)"
ENV_FILE="$BACKEND_DIR/.env"
CONFIRM=0
[ "${1:-}" = "--yes" ] && CONFIRM=1

[ -f "$ENV_FILE" ] || { echo "缺少 $ENV_FILE"; exit 1; }

# 解析本机 DATABASE_URL: mysql://user:pass@host:port/db
URL=$(grep -E '^DATABASE_URL' "$ENV_FILE" | head -1 | sed -E 's#^DATABASE_URL="?##; s#"?$##')
CRED=$(echo "$URL" | sed -E 's#^mysql://([^@]+)@.*#\1#')
HOSTPORT=$(echo "$URL" | sed -E 's#^mysql://[^@]+@([^/]+).*#\1#')
DB=$(echo "$URL" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')
MYUSER="${CRED%%:*}"; MYPASS="${CRED#*:}"
MYHOST="${HOSTPORT%%:*}"; MYPORT="${HOSTPORT##*:}"

MY=$(command -v mysql || echo /opt/homebrew/opt/mysql@8.4/bin/mysql)
SQL() { MYSQL_PWD="$MYPASS" "$MY" -h "$MYHOST" -P "$MYPORT" -u "$MYUSER" "$@"; }

echo "云端: $SERVER  →  本机库: $DB@$MYHOST:$MYPORT"
if [ "$CONFIRM" -ne 1 ]; then
  read -p "将覆盖本机数据库与 backend/uploads 图片（镜像云端），确认? [y/N] " a
  [ "$a" = "y" ] || { echo "已取消"; exit 1; }
fi

echo "[1/3] 从云端导出数据库..."
ssh "$SERVER" 'source /root/deploy-secrets.env && docker exec mysql mysqldump -uroot -p"${MYSQL_PASSWORD}-root" --single-transaction --routines --triggers --events --set-gtid-purged=OFF soybean-admin-nest' 2>/dev/null | gzip > /tmp/paint-cloud-latest.sql.gz
[ -s /tmp/paint-cloud-latest.sql.gz ] || { echo "导出失败"; exit 1; }
echo "  导出 $(du -h /tmp/paint-cloud-latest.sql.gz | cut -f1)"

echo "[2/3] 导入本机 MySQL..."
SQL -e "CREATE DATABASE IF NOT EXISTS \`$DB\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
gzip -dc /tmp/paint-cloud-latest.sql.gz | MYSQL_PWD="$MYPASS" "$MY" -h "$MYHOST" -P "$MYPORT" -u "$MYUSER" --default-character-set=utf8mb4 "$DB"

echo "[3/3] 镜像同步 uploads 图片..."
rsync -az --delete "$SERVER:/opt/paint-count/backend/uploads/" "$BACKEND_DIR/uploads/"
find "$BACKEND_DIR/uploads" -name '._*' -type f -delete 2>/dev/null || true

TABLES=$(SQL -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB}';")
ORDERS=$(SQL -N -e "SELECT COUNT(*) FROM \`${DB}\`.paint_work_order;")
echo "同步完成 ✓ 本机库 ${DB}：${TABLES} 张表，${ORDERS} 个工单；图片 $(find "$BACKEND_DIR/uploads" -type f | wc -l | tr -d ' ') 个"
