#!/usr/bin/env bash
#
# MySQL 数据库自动备份脚本
#
# 功能：
#   - 按日期生成 gzip 压缩的 SQL 备份
#   - 自动清理超过指定天数的旧备份
#   - 支持环境变量配置（DATABASE_URL 或单独的连接参数）
#
# 用法：
#   ./scripts/backup-db.sh                  # 立即执行一次备份
#   ./scripts/backup-db.sh --cron            # cron 模式（静默）
#
# 推荐的 crontab 配置（每天凌晨 3 点备份）：
#   0 3 * * * cd /path/to/backend && ./scripts/backup-db.sh --cron >> logs/backup.log 2>&1
#
# 环境变量（可选，覆盖 .env 默认值）：
#   BACKUP_RETENTION_DAYS  备份保留天数，默认 30
#   BACKUP_DIR             备份目录，默认 ./backups
#

set -euo pipefail

# ===== 配置 =====
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$BACKEND_DIR/backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

# 加载 .env 文件
if [ -f "$BACKEND_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$BACKEND_DIR/.env"
  set +a
fi

# 从 DATABASE_URL 解析连接参数
# 格式：mysql://user:password@host:port/database
DB_URL="${DATABASE_URL:-}"
if [ -z "$DB_URL" ]; then
  echo "ERROR: DATABASE_URL not set" >&2
  exit 1
fi

# 解析 URL
DB_USER=$(echo "$DB_URL" | sed -n 's|^mysql://\([^:]*\):.*|\1|p')
DB_PASS=$(echo "$DB_URL" | sed -n 's|^mysql://[^:]*:\([^@]*\)@.*|\1|p')
DB_HOST=$(echo "$DB_URL" | sed -n 's|^mysql://[^@]*@\([^:]*\):.*|\1|p')
DB_PORT=$(echo "$DB_URL" | sed -n 's|^mysql://[^@]*@[^:]*:\([^/]*\)/.*|\1|p')
DB_NAME=$(echo "$DB_URL" | sed -n 's|^mysql://[^@]*@[^/]*/\([^?]*\).*|\1|p')

DB_PORT="${DB_PORT:-3306}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.sql.gz"

# cron 模式静默输出
CRON_MODE=false
if [ "${1:-}" = "--cron" ]; then
  CRON_MODE=true
fi

log() {
  if [ "$CRON_MODE" = "false" ]; then
    echo "$@"
  fi
}

# ===== 执行 =====
log "=========================================="
log "Database Backup Start: $(date '+%Y-%m-%d %H:%M:%S')"
log "Database: $DB_NAME @ $DB_HOST:$DB_PORT"
log "Backup file: $BACKUP_FILE"
log "=========================================="

# 创建备份目录
mkdir -p "$BACKUP_DIR"

# 执行备份（使用 gzip 压缩）
# --single-transaction: InnoDB 一致性快照，不锁表
# --routines --triggers --events: 包含存储过程、触发器、事件
# --set-gtid-purged=OFF: 避免 GTID 警告
START_TIME=$(date +%s)

if [ -n "$DB_PASS" ]; then
  mysqldump \
    --host="$DB_HOST" \
    --port="$DB_PORT" \
    --user="$DB_USER" \
    --password="$DB_PASS" \
    --single-transaction \
    --routines \
    --triggers \
    --events \
    --set-gtid-purged=OFF \
    --quick \
    --default-character-set=utf8mb4 \
    "$DB_NAME" 2>/dev/null | gzip > "$BACKUP_FILE"
else
  mysqldump \
    --host="$DB_HOST" \
    --port="$DB_PORT" \
    --user="$DB_USER" \
    --single-transaction \
    --routines \
    --triggers \
    --events \
    --set-gtid-purged=OFF \
    --quick \
    --default-character-set=utf8mb4 \
    "$DB_NAME" 2>/dev/null | gzip > "$BACKUP_FILE"
fi

BACKUP_EXIT=$?
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

if [ $BACKUP_EXIT -ne 0 ] || [ ! -s "$BACKUP_FILE" ]; then
  echo "ERROR: Backup failed (exit code: $BACKUP_EXIT)" >&2
  # 清理空文件
  [ -f "$BACKUP_FILE" ] && [ ! -s "$BACKUP_FILE" ] && rm -f "$BACKUP_FILE"
  exit 1
fi

# 文件大小（人类可读）
BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)

log "Backup completed successfully!"
log "File size: $BACKUP_SIZE"
log "Duration: ${DURATION}s"
log ""

# ===== 清理旧备份 =====
log "Cleaning backups older than $BACKUP_RETENTION_DAYS days..."
DELETED_COUNT=$(find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -type f -mtime +$BACKUP_RETENTION_DAYS -print -delete | wc -l | tr -d ' ')
log "Deleted $DELETED_COUNT old backup(s)"

# 列出当前备份
log ""
log "Current backups:"
ls -lh "$BACKUP_DIR"/${DB_NAME}_*.sql.gz 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'
log ""
log "Done: $(date '+%Y-%m-%d %H:%M:%S')"
log "=========================================="
