#!/bin/bash
# prepare-clean-repo.sh
# Copy Muxvo source files to a clean directory, excluding bloat.
# Usage: ./prepare-clean-repo.sh /path/to/new/muxvo [--dry-run]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ $# -lt 1 ]; then
  echo "Usage: $0 TARGET_DIR [--dry-run]"
  echo "  TARGET_DIR   Path where clean repo will be created"
  echo "  --dry-run    Show what would be copied without copying"
  exit 1
fi

TARGET_DIR="$1"
DRY_RUN=""

if [ "${2:-}" = "--dry-run" ]; then
  DRY_RUN="--dry-run"
  echo "=== DRY RUN MODE ==="
fi

# Refuse to overwrite existing non-empty target
if [ -d "$TARGET_DIR" ] && [ "$(ls -A "$TARGET_DIR" 2>/dev/null)" ]; then
  echo "ERROR: Target directory '$TARGET_DIR' already exists and is not empty."
  echo "Please remove it first or choose a different path."
  exit 1
fi

echo "Source:  $PROJECT_ROOT"
echo "Target:  $TARGET_DIR"
echo ""

# Create target directory
mkdir -p "$TARGET_DIR"

# Rsync with exclusions
# Using --archive to preserve permissions/timestamps, --verbose for output
rsync --archive --verbose $DRY_RUN \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='dist/' \
  --exclude='out/' \
  --exclude='coverage/' \
  --exclude='.DS_Store' \
  --exclude='.env' \
  --exclude='.env.local' \
  --exclude='.env.*.local' \
  --exclude='*.pem' \
  --exclude='*.dmg' \
  --exclude='*.blockmap' \
  --exclude='builder-debug.yml' \
  --exclude='landing-designs-v2/' \
  --exclude='.claude-tmp/' \
  --exclude='.claude/settings.local.json' \
  --exclude='verify/node_modules/' \
  --exclude='verify/report/output/' \
  --exclude='server/node_modules/' \
  --exclude='server/.env' \
  --exclude='admin/node_modules/' \
  --exclude='admin/dist/' \
  --exclude='web/node_modules/' \
  --exclude='web/dist/' \
  --exclude='icon-designs/' \
  --exclude='prototype*.html' \
  --exclude='electron-builder.json5' \
  "$PROJECT_ROOT/" "$TARGET_DIR/"

echo ""
echo "=== Summary ==="
if [ -z "$DRY_RUN" ]; then
  FILE_COUNT=$(find "$TARGET_DIR" -type f | wc -l | tr -d ' ')
  TOTAL_SIZE=$(du -sh "$TARGET_DIR" | cut -f1)
  echo "Files copied: $FILE_COUNT"
  echo "Total size:   $TOTAL_SIZE"
  echo "Target:       $TARGET_DIR"
else
  echo "(dry-run mode, no files were actually copied)"
fi

echo ""
echo "Next steps:"
echo "  cd $TARGET_DIR"
echo "  git init && git add -A && git commit -m 'Initial commit'"
