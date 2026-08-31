#!/bin/bash
set -e

POB_DIR="/root/pob-core"
SRC_DIR="$POB_DIR/src"
APP_DIR="/root/pathofexile-viethoa"
LOG_FILE="/var/log/pob-core-update.log"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Checking for Path of Building PoE2 updates..." >> "$LOG_FILE"

if [ ! -d "$POB_DIR" ]; then
    echo "Cloning Path of Building PoE2..." >> "$LOG_FILE"
    git clone --depth 1 https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2.git "$POB_DIR" >> "$LOG_FILE" 2>&1
fi

cd "$POB_DIR"
git fetch origin dev >> "$LOG_FILE" 2>&1

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/dev)

if [ "$LOCAL" != "$REMOTE" ] || [ ! -f "$SRC_DIR/calculate.lua" ]; then
    echo "Syncing updates ($LOCAL -> $REMOTE)..." >> "$LOG_FILE"
    git reset --hard origin/dev >> "$LOG_FILE" 2>&1
    
    # Ensure calculation script is deployed
    cp "$APP_DIR/scripts/pob-calculate.lua" "$SRC_DIR/calculate.lua"
    
    # Apply LuaJIT compatibility fixes
    sed -i 's/count += 1/count = count + 1/g' "$SRC_DIR/Modules/Main.lua" 2>/dev/null || true
    sed -i 's/depth += 1/depth = depth + 1/g' "$SRC_DIR/Classes/Tooltip.lua" 2>/dev/null || true
    sed -i 's/depth -= 1/depth = depth - 1/g' "$SRC_DIR/Classes/Tooltip.lua" 2>/dev/null || true
    sed -i 's/closeBrace += 1/closeBrace = closeBrace + 1/g' "$SRC_DIR/Classes/Tooltip.lua" 2>/dev/null || true
    sed -i 's/line += 1/line = line + 1/g' "$SRC_DIR/Classes/Tooltip.lua" 2>/dev/null || true
    sed -i 's/lastLine += 1/lastLine = lastLine + 1/g' "$SRC_DIR/Classes/Tooltip.lua" 2>/dev/null || true
    
    echo "Updated successfully to $REMOTE" >> "$LOG_FILE"
else
    echo "pob-core is already up to date." >> "$LOG_FILE"
fi
