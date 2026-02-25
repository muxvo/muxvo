#!/bin/bash
# prepare-server-repo.sh
# Copy Muxvo server/ to a standalone clean directory for the server repo.
# Usage: ./prepare-server-repo.sh /path/to/new/muxvo-server [--dry-run]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_DIR="$PROJECT_ROOT/server"

if [ $# -lt 1 ]; then
  echo "Usage: $0 TARGET_DIR [--dry-run]"
  echo "  TARGET_DIR   Path where server repo will be created"
  echo "  --dry-run    Show what would be copied without copying"
  exit 1
fi

TARGET_DIR="$1"
DRY_RUN=""

if [ "${2:-}" = "--dry-run" ]; then
  DRY_RUN="--dry-run"
  echo "=== DRY RUN MODE ==="
fi

if [ ! -d "$SERVER_DIR" ]; then
  echo "ERROR: Server directory not found at $SERVER_DIR"
  exit 1
fi

# Refuse to overwrite existing non-empty target
if [ -d "$TARGET_DIR" ] && [ "$(ls -A "$TARGET_DIR" 2>/dev/null)" ]; then
  echo "ERROR: Target directory '$TARGET_DIR' already exists and is not empty."
  echo "Please remove it first or choose a different path."
  exit 1
fi

echo "Source:  $SERVER_DIR"
echo "Target:  $TARGET_DIR"
echo ""

# Create target directory
mkdir -p "$TARGET_DIR"

# Copy server files (excluding secrets, deps, build output)
rsync --archive --verbose $DRY_RUN \
  --exclude='node_modules/' \
  --exclude='dist/' \
  --exclude='.env' \
  --exclude='.env.local' \
  --exclude='.env.*.local' \
  --exclude='*.pem' \
  --exclude='.DS_Store' \
  "$SERVER_DIR/" "$TARGET_DIR/"

# Also copy shared docker and deploy config from project root
if [ -z "$DRY_RUN" ]; then
  # Copy docker configs
  mkdir -p "$TARGET_DIR/docker"
  rsync --archive --verbose \
    "$PROJECT_ROOT/docker/" "$TARGET_DIR/docker/"

  # Copy deploy workflow
  mkdir -p "$TARGET_DIR/.github/workflows"
  if [ -f "$PROJECT_ROOT/.github/workflows/deploy-server.yml" ]; then
    cp "$PROJECT_ROOT/.github/workflows/deploy-server.yml" "$TARGET_DIR/.github/workflows/deploy-server.yml"
    echo ".github/workflows/deploy-server.yml"
  fi

  # Create server-specific .gitignore
  cat > "$TARGET_DIR/.gitignore" << 'GITIGNORE'
# Dependencies
node_modules/

# Build
dist/

# Environment & secrets
.env
.env.local
.env.*.local
*.pem

# OS files
.DS_Store
Thumbs.db

# IDE
.idea/
.vscode/
*.swp

# Coverage
coverage/

# Docker volumes
postgres-data/
redis-data/
GITIGNORE
  echo ".gitignore (created)"
fi

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
