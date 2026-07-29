#!/usr/bin/env python3
"""StopFailure hook: ha rate limit (429) vagy auth hiba (401, OAuth lejárat)
miatt áll le BÉLA, Slack üzenetet küld."""
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

def should_send_auth_notify():
    try:
        with open(DEBOUNCE_STATE_FILE) as f:
            last_sent = float(f.read().strip())
        if (time.time() - last_sent) / 60 < DEBOUNCE_MINUTES:
            return False
    except Exception:
        pass
    return True

def mark_auth_notify_sent():
    try:
        os.makedirs(os.path.dirname(DEBOUNCE_STATE_FILE), exist_ok=True)
        with open(DEBOUNCE_STATE_FILE, "w") as f:
            f.write(str(time.time()))
    except Exception:
        pass

def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    if payload.get("stop_hook_active"):
        sys.exit(0)
    reason = payload.get("stop_reason", "")
    error = str(payload.get("error", "") or "")
    error_type = str(payload.get("error_type", "") or "")
    is_rate_limit = (
        "429" in error or "rate_limit" in error_type.lower() or
        "rate limit" in error.lower() or "overloaded" in error.lower() or
        reason == "rate_limit"
    )
    is_auth_error = (
        "401" in error or "auth" in error_type.lower() or
        "invalid authentication" in error.lower() or
        "please run /login" in error.lower()
    )
    if not (is_rate_limit or is_auth_error):
        sys.exit(0)
    env = load_env(CHANNELS_ENV)
    token = env.get("SLACK_BOT_TOKEN", "")
    channel = env.get("SLACK_CHANNEL_ID", "")
    if not token or not channel:
        sys.exit(0)
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    if is_rate_limit:
        msg = f"⏸️ *BÉLA várakozik* ({now})\nElértem a Claude használati limitet. Automatikusan folytatom amint a limit reset-el. Addig nem tudok válaszolni."
        send_slack(token, channel, msg)
    else:
        if should_send_auth_notify():
            msg = f"🔴 *BÉLA leállt — OAuth token lejárt* ({now})\nHitelesítési hiba (401) miatt nem tudok dolgozni. Kérlek jelentkezz be újra:\n```claude login```\negy WSL terminálban, majd:\n```bash ~/marveen/scripts/bela-start.sh```\nAmíg ez nem történik meg, nem dolgozom fel új üzeneteket. (Ez az emlékeztető legfeljebb óránként egyszer jön.)"
            send_slack(token, channel, msg)
            mark_auth_notify_sent()
    sys.exit(0)

if __name__ == "__main__":
    main()
