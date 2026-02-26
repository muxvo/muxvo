#!/usr/bin/env bash
#
# PostgreSQL Daily Backup Script for Muxvo
#
# Usage:
#   ./scripts/backup-db.sh
#
# Crontab (run daily at 03:00):
#   0 3 * * * /opt/muxvo-server/scripts/backup-db.sh >> /var/log/muxvo-backup.log 2>&1
#
# Prerequisites:
#   - Docker is running with container "muxvo-postgres"
#   - Backup directory /opt/muxvo-backups/ exists
#

set -euo pipefail

# --- Configuration ---
CONTAINER_NAME="muxvo-postgres"
DB_NAME="muxvo"
DB_USER="muxvo"
BACKUP_DIR="/opt/muxvo-backups"
RETAIN_DAYS=7
DATE_TAG="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/muxvo_${DATE_TAG}.sql.gz"

# --- Pre-flight checks ---
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "[ERROR] $(date -Iseconds) Container '${CONTAINER_NAME}' is not running. Aborting."
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

# --- Backup ---
echo "[INFO] $(date -Iseconds) Starting backup → ${BACKUP_FILE}"

docker exec "${CONTAINER_NAME}" \
  pg_dump -U "${DB_USER}" -d "${DB_NAME}" --no-owner --no-acl \
  | gzip > "${BACKUP_FILE}"

# Verify the file is non-empty
if [ ! -s "${BACKUP_FILE}" ]; then
  echo "[ERROR] $(date -Iseconds) Backup file is empty. Something went wrong."
  rm -f "${BACKUP_FILE}"
  exit 1
fi

FILESIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
echo "[INFO] $(date -Iseconds) Backup complete: ${BACKUP_FILE} (${FILESIZE})"

# --- Cleanup old backups ---
DELETED=0
find "${BACKUP_DIR}" -name "muxvo_*.sql.gz" -type f -mtime +${RETAIN_DAYS} | while read -r old_file; do
  rm -f "${old_file}"
  echo "[INFO] $(date -Iseconds) Deleted old backup: ${old_file}"
  DELETED=$((DELETED + 1))
done

echo "[INFO] $(date -Iseconds) Retention policy: kept last ${RETAIN_DAYS} days."
echo "[DONE] $(date -Iseconds) Backup job finished."
