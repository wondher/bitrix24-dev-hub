#!/usr/bin/env bash
# update-repos.sh - Update all Bitrix24 dev-hub submodules
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "Updating all Bitrix24 submodules in $REPO_ROOT..."
echo ""

cd "$REPO_ROOT"

# Fetch and merge latest changes for all submodules
git submodule update --remote --merge

echo ""
echo "Submodule status:"
git submodule status
echo ""
echo "Done. All submodules updated to latest upstream."
