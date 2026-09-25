#!/usr/bin/env python3
"""Wire Jellyseerr notifications to Telegram.

Web push was the first choice but browsers refuse the Push API outside a secure
context, and Jellyseerr answers on plain HTTP over the LAN. Telegram has no such
constraint: Jellyseerr just posts to api.telegram.org.

The chat id is not something you look up in the app, so this reads it back from
the bot`s own update queue -- which is why you have to message the bot first.

Usage: python3 jellyseerr-telegram.py <bot-token> [chat-id]

Pass a chat id to target a group instead: add the bot to the group, then take
the id from the web.telegram.org URL (the leading minus is part of it).

Token comes from @BotFather -> /newbot. Send the new bot any message before
running this, or it has no update to read the chat id from.
"""
import json, subprocess, sys, urllib.parse, urllib.request

CFG = "/app/config/settings.json"
# MEDIA_AVAILABLE (8) + MEDIA_FAILED (16)
TYPES = 24

def tg(token, method):
    url = "https://api.telegram.org/bot%s/%s" % (token, method)
    return json.load(urllib.request.urlopen(url, timeout=30))

def js(path, key, body, method="POST"):
    req = urllib.request.Request(
        "http://localhost:5055/api/v1" + path,
        data=json.dumps(body).encode(),
        headers={"X-Api-Key": key, "Content-Type": "application/json"},
        method=method)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status

def main():
    if len(sys.argv) not in (2, 3):
        sys.exit(__doc__)
    token = sys.argv[1].strip()
    forced_chat = sys.argv[2].strip() if len(sys.argv) == 3 else None

    me = tg(token, "getMe")["result"]
    print("bot:", me["username"])

    if forced_chat:
        chat = tg(token, "getChat?chat_id=" + urllib.parse.quote(forced_chat))["result"]
        chat_id = str(chat["id"])
        print("chat:", chat_id, chat.get("title") or chat.get("username"), "(%s)" % chat["type"])
        return configure(token, me, chat_id)

    updates = tg(token, "getUpdates")["result"]
    chats = {}
    for u in updates:
        msg = u.get("message") or u.get("channel_post") or {}
        chat = msg.get("chat")
        if chat:
            chats[str(chat["id"])] = chat.get("username") or chat.get("title") or chat.get("first_name")
    if not chats:
        sys.exit("No messages in the bot`s queue. Open Telegram, send @%s any "
                 "message, then run this again." % me["username"])
    if len(chats) > 1:
        print("several chats seen:", chats)
    chat_id, who = sorted(chats.items())[0]
    print("chat:", chat_id, who)
    configure(token, me, chat_id)

def configure(token, me, chat_id):
    raw = subprocess.run(["docker", "exec", "jellyseerr", "cat", CFG],
                         capture_output=True, text=True, check=True).stdout
    key = json.loads(raw)["main"]["apiKey"]

    body = {"enabled": True, "types": TYPES, "options": {
        "botUsername": me["username"], "botAPI": token,
        "chatId": chat_id, "messageThreadId": "", "sendSilently": False}}

    print("test message:", js("/settings/notifications/telegram/test", key, body))
    print("save agent:", js("/settings/notifications/telegram", key, body))
    # Web push can never fire over plain HTTP; leaving it on would only look
    # like a working channel that silently never delivers.
    print("web push off:", js("/settings/notifications/webpush", key,
                              {"enabled": False, "types": 0, "options": {}}))

main()
