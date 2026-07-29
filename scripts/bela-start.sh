#!/bin/bash
# ============================================================================
# BÉLA robust startup script — WSL2 + Telegram
# ============================================================================

set -euo pipefail

MARVEEN_DIR="$HOME/marveen"
PLUGIN_DIR="$HOME/.claude/plugins/cache/claude-plugins-official/telegram/0.0.6"
CHANNELS_DIR="$HOME/.claude/channels/telegram"
LOG="$MARVEEN_DIR/store/bela-start.log"
SESSION_NAME="bela-channels"
TELEGRAM_USER_ID="6209177290"

log() { echo "$(date '+%F %T') $*" | tee -a "$LOG"; }

log "=== BÉLA startup begin ==="

# ---- 1. NVM + Node --------------------------------------------------------
log "1. NVM betöltés..."
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
    source "$NVM_DIR/nvm.sh"
    if ! nvm use 22 --silent 2>/dev/null; then
        log "FATAL: Node 22 nem érhető el"
        exit 1
    fi
else
    log "FATAL: nvm.sh nem található"
    exit 1
fi

# ---- 2. Claude Code telepítés-ellenőrzés ----------------------------------
log "2. Claude Code ellenőrzés..."
# Symlink javítás: ha a local bin törött, linkeljük az nvm-esre
NVM_CLAUDE="$NVM_DIR/versions/node/$(nvm version 22)/bin/claude"
LOCAL_CLAUDE="$HOME/.local/bin/claude"
if [ -f "$NVM_CLAUDE" ] && [ ! -L "$LOCAL_CLAUDE" -o ! -e "$LOCAL_CLAUDE" ]; then
    log "   symlink javítás: $LOCAL_CLAUDE -> $NVM_CLAUDE"
    ln -sf "$NVM_CLAUDE" "$LOCAL_CLAUDE"
fi
if ! claude --version &>/dev/null; then
    log "   claude nem található, telepítés..."
    npm install -g @anthropic-ai/claude-code --prefer-offline 2>/dev/null ||     curl -L https://registry.npmjs.org/@anthropic-ai/claude-code/-/claude-code-2.1.195.tgz -o /tmp/claude-code.tgz && npm install -g /tmp/claude-code.tgz 2>/dev/null || {
        log "FATAL: claude telepítés sikertelen"
        exit 1
    }
fi
CLAUDE_BIN="$(command -v claude)"
log "   claude OK: $CLAUDE_BIN ($(claude --version 2>/dev/null || echo 'version unknown'))"

# ---- 3. Failure counter reset ---------------------------------------------
log "3. Failure counter reset..."
> "$MARVEEN_DIR/store/channels-failures.log" 2>/dev/null || true

# ---- 4. .mcp.json kulcsnév javítás ----------------------------------------
log "4. .mcp.json ellenőrzés..."
MCP_JSON="$PLUGIN_DIR/.mcp.json"
if [ -f "$MCP_JSON" ]; then
    if ! grep -q '"claude-plugins-official"' "$MCP_JSON"; then
        log "   .mcp.json kulcsnév javítás..."
        cat > "$MCP_JSON" << 'MCPEOF'
{
    "mcpServers": {
        "claude-plugins-official": {
            "command": "bun",
            "args": [
                "${CLAUDE_PLUGIN_ROOT}/server.ts"
            ]
        }
    }
}
MCPEOF
        log "   .mcp.json OK"
    else
        log "   .mcp.json kulcsnév OK"
    fi
else
    log "   WARN: .mcp.json nem található: $MCP_JSON"
fi

# ---- 5. managed-settings.json ellenőrzés ----------------------------------
log "5. managed-settings.json ellenőrzés..."
MANAGED="/etc/claude-code/managed-settings.json"
if [ ! -f "$MANAGED" ] || ! grep -q "telegram" "$MANAGED"; then
    log "   managed-settings.json javítás (sudo)..."
    sudo mkdir -p /etc/claude-code
    sudo tee "$MANAGED" > /dev/null << 'MANAGEDEOF'
{
  "channelsEnabled": true,
  "allowedChannelPlugins": [
    {
      "plugin": "telegram",
      "marketplace": "claude-plugins-official"
    }
  ]
}
MANAGEDEOF
    log "   managed-settings.json OK"
else
    log "   managed-settings.json OK"
fi

# ---- 6. Model, effort és plugin beállítások -------------------------------
log "6. Model/effort/plugins ellenőrzés..."
PROJECT_SETTINGS="$MARVEEN_DIR/.claude/settings.json"
if [ -f "$PROJECT_SETTINGS" ]; then
    python3 - << 'PYEOF'
import json
path = "/home/kisss/marveen/.claude/settings.json"
with open(path) as f: s = json.load(f)
changed = False
if s.get("model") != "claude-sonnet-5":
    s["model"] = "claude-sonnet-5"
    changed = True
if s.get("effort") != "high":
    s["effort"] = "high"
    changed = True
plugins = s.setdefault("enabledPlugins", {})
if plugins.get("telegram@claude-plugins-official") != True:
    plugins["telegram@claude-plugins-official"] = True
    changed = True
if plugins.get("slack-channel@marveen-marketplace") != False:
    plugins["slack-channel@marveen-marketplace"] = False
    changed = True
if changed:
    with open(path, "w") as f: json.dump(s, f, indent=4, ensure_ascii=False)
    print("   model/effort/plugins javítva")
else:
    print("   model/effort/plugins OK")
PYEOF
fi

# ---- 7. StopFailure hook ellenőrzés ---------------------------------------
log "7. StopFailure hook ellenőrzés..."
if [ -f "$PROJECT_SETTINGS" ]; then
    if ! grep -q "rate-limit-notify" "$PROJECT_SETTINGS"; then
        log "   StopFailure hook hiányzik — visszaírás..."
        python3 - << 'PYEOF'
import json
path = "/home/kisss/marveen/.claude/settings.json"
with open(path) as f: s = json.load(f)
hook = {"hooks": [{"type": "command","command": "python3 \"$CLAUDE_PROJECT_DIR/scripts/hooks/rate-limit-notify.py\"","timeout": 15,"async": True}]}
hooks = s.setdefault("hooks", {})
if not any("rate-limit-notify" in str(h) for h in hooks.get("StopFailure",[])):
    hooks["StopFailure"] = [hook]
with open(path, "w") as f: json.dump(s, f, indent=4, ensure_ascii=False)
PYEOF
        log "   StopFailure hook visszaírva OK"
    else
        log "   StopFailure hook OK"
    fi
fi

# ---- 8. installed_plugins.json projectPath ellenőrzés --------------------
log "8. installed_plugins.json ellenőrzés..."
python3 - << 'PYEOF'
import json, os
path = os.path.expanduser("~/.claude/plugins/installed_plugins.json")
try:
    with open(path) as f: d = json.load(f)
    changed = False
    for e in d.get("plugins", {}).get("telegram@claude-plugins-official", []):
        if e.get("projectPath") != "/home/kisss/marveen":
            e["projectPath"] = "/home/kisss/marveen"
            e["scope"] = "project"
            changed = True
    if changed:
        with open(path, "w") as f: json.dump(d, f, indent=4)
        print("   projectPath javítva")
    else:
        print("   projectPath OK")
except Exception as e:
    print(f"   WARN: {e}")
PYEOF

# ---- 9. Régi session cleanup -----------------------------------------------
log "9. Régi session cleanup..."
pkill -f "scripts/channels.sh" 2>/dev/null || true
sleep 1
tmux kill-session -t "$SESSION_NAME" 2>/dev/null && log "   régi session kilőve" || log "   nincs régi session"
sleep 2

# ---- 10. BÉLA indítás -------------------------------------------------------
log "10. BÉLA indítás..."
cd "$MARVEEN_DIR"
bash scripts/channels.sh telegram &
CHANNELS_PID=$!
log "   channels.sh PID: $CHANNELS_PID"

sleep 20
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    log "   BÉLA session él ✓"
else
    log "   WARN: BÉLA session nem található 20s után"
fi

# ---- 11. Kitchen szerver indítás -------------------------------------------
# LEÁLLÍTVA (2026-07-23, Istvan kérése) -- Béla Home konyhai asszisztens projekt
# leállítva, v2.0 verzió jön később. Ne indítsd automatikusan.
log "11. Kitchen szerver: leállítva (projekt szüneteltetve, v2.0-ra vár)"

log "=== BÉLA startup kész ==="
