#!/usr/bin/env python3
"""Önálló segédscript: Slack üzenet küldése akkor is, ha a teljes BÉLA
session/process halott."""
import sys
import os
import json
import time
import urllib.request
from datetime import datetime

CHANNELS_ENV = os.path.expanduser("~/.claude/channels/slack/.env")
DEBOUNCE_STATE_FILE = os.path.expanduser("~/marveen/store/.auth-notify-last-sent")
DEBOUNCE_MINUTES = 60

def load_env(path):
    env = {}
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if "=" in line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip()
    except Exception:
        pass
    return env

def send_slack(token, channel, text):
    payload = json.dumps({"channel": channel, "text": text, "unfurl_links": False}).encode()
    req = urllib.request.Request(
        "https://slack.com/api/chat.postMessage",
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"}
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except Exception:
        return None

def should_send():
    try:
        with open(DEBOUNCE_STATE_FILE) as f:
            last_sent = float(f.read().strip())
        if (time.time() - last_sent) / 60 < DEBOUNCE_MINUTES:
            return False
    except Exception:
        pass
    return True

def mark_sent():
    try:
        os.makedirs(os.path.dirname(DEBOUNCE_STATE_FILE), exist_ok=True)
        with open(DEBOUNCE_STATE_FILE, "w") as f:
            f.write(str(time.time()))
    except Exception:
        pass

def main():
    if not should_send():
        sys.exit(0)
    env = load_env(CHANNELS_ENV)
    token = env.get("SLACK_BOT_TOKEN", "")
    channel = env.get("SLACK_CHANNEL_ID", "")
    if not token or not channel:
        sys.exit(0)
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    msg = f"🔴 *BÉLA leállt — OAuth token lejárt* ({now})\nA teljes session leállt, valószínűleg hitelesítési hiba miatt. Kérlek jelentkezz be újra:\n```claude login```\negy WSL terminálban, majd:\n```bash ~/marveen/scripts/bela-start.sh```\n(Ez az emlékeztető legfeljebb óránként egyszer jön.)"
    send_slack(token, channel, msg)
    mark_sent()
    sys.exit(0)

if __name__ == "__main__":
    main()
