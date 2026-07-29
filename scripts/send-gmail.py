#!/usr/bin/env python3
"""Send an email FROM kiss.i.god@gmail.com via Gmail SMTP (implicit TLS:465).

The password is a Gmail *App Password* (16 chars, generated at
https://myaccount.google.com/apppasswords with 2FA on). It lives ONLY in the
dashboard vault under VAULT_KEY and is fetched at runtime -- never on disk/printed.

Usage:
  python3 send-gmail.py --to a@b.hu --subject "..." --body "..." [--cc x@y.hu] [--html]
Body may also be piped on stdin if --body is omitted.
"""
import sys, os, ssl, json, smtplib, argparse, urllib.request
from email.message import EmailMessage
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FROM_EMAIL = os.environ.get("GMAIL_FROM_EMAIL", "kiss.i.god@gmail.com")
FROM_NAME = os.environ.get("GMAIL_FROM_NAME", "Béla")
SMTP_HOST = os.environ.get("GMAIL_SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("GMAIL_SMTP_PORT", "465"))
VAULT_KEY = os.environ.get("GMAIL_VAULT_KEY", "gmail_kiss_i_god_app_pw")
WEB_PORT = os.environ.get("WEB_PORT", "3420")


def password() -> str:
    tok = (ROOT / "store" / ".dashboard-token").read_text().strip()
    req = urllib.request.Request(
        f"http://localhost:{WEB_PORT}/api/vault/{VAULT_KEY}",
        headers={"Authorization": "Bearer " + tok},
    )
    pw = json.load(urllib.request.urlopen(req, timeout=10)).get("value", "")
    if not pw:
        raise RuntimeError(f"vault key '{VAULT_KEY}' empty -- store the Gmail App Password first")
    return pw.replace(" ", "")  # Google shows app passwords with spaces; strip them


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--to", required=True)
    ap.add_argument("--subject", required=True)
    ap.add_argument("--body", default=None)
    ap.add_argument("--cc", default=None)
    ap.add_argument("--html", action="store_true")
    a = ap.parse_args()
    body = a.body if a.body is not None else sys.stdin.read()

    msg = EmailMessage()
    msg["From"] = f"{FROM_NAME} <{FROM_EMAIL}>"
    msg["To"] = a.to
    if a.cc:
        msg["Cc"] = a.cc
    msg["Subject"] = a.subject
    if a.html:
        msg.set_content("A levél HTML formátumú; nézd HTML-képes kliensben.")
        msg.add_alternative(body, subtype="html")
    else:
        msg.set_content(body)

    rcpts = [a.to] + ([a.cc] if a.cc else [])
    with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT,
                          local_hostname="gmail.com",
                          context=ssl.create_default_context(), timeout=45) as s:
        s.login(FROM_EMAIL, password())
        s.send_message(msg, to_addrs=rcpts)
    print(f"SENT from {FROM_EMAIL} to {a.to}" + (f" cc {a.cc}" if a.cc else ""))


if __name__ == "__main__":
    main()
