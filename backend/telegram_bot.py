"""Simple long-polling Telegram bot for listener questions.
Activates only when TELEGRAM_BOT_TOKEN is set in env.
"""
import os
import asyncio
import logging
import httpx

logger = logging.getLogger(__name__)

TELEGRAM_API = "https://api.telegram.org"


class TelegramBot:
    def __init__(self, token: str, db):
        self.token = token
        self.db = db
        self.offset = 0
        self.running = False
        self.username = None

    async def _get_me(self):
        async with httpx.AsyncClient(timeout=15) as h:
            r = await h.get(f"{TELEGRAM_API}/bot{self.token}/getMe")
            if r.status_code == 200:
                data = r.json()
                if data.get("ok"):
                    return data["result"]
        return None

    async def _reply(self, chat_id: int, text: str):
        try:
            async with httpx.AsyncClient(timeout=15) as h:
                await h.post(
                    f"{TELEGRAM_API}/bot{self.token}/sendMessage",
                    json={"chat_id": chat_id, "text": text},
                )
        except Exception as e:
            logger.warning(f"telegram reply failed: {e}")

    async def poll_forever(self):
        me = await self._get_me()
        if not me:
            logger.error("Telegram bot token invalid; bot disabled")
            return
        self.username = me.get("username")
        logger.info(f"Telegram bot online: @{self.username}")
        self.running = True
        while self.running:
            try:
                async with httpx.AsyncClient(timeout=35) as h:
                    r = await h.get(
                        f"{TELEGRAM_API}/bot{self.token}/getUpdates",
                        params={"offset": self.offset, "timeout": 25},
                    )
                    if r.status_code != 200:
                        await asyncio.sleep(3)
                        continue
                    data = r.json()
                for upd in data.get("result", []):
                    self.offset = upd["update_id"] + 1
                    msg = upd.get("message") or upd.get("edited_message")
                    if not msg:
                        continue
                    text = (msg.get("text") or "").strip()
                    if not text:
                        continue
                    chat_id = msg["chat"]["id"]
                    from_user = msg.get("from") or {}
                    name = (from_user.get("first_name") or "Ascoltatore")[:40]
                    # /start handshake
                    if text.startswith("/start"):
                        await self._reply(chat_id,
                            "Ciao! Sono il bot di NEURA·FM. Scrivimi la tua domanda: "
                            "un DJ AI ti risponderà in diretta durante il palinsesto.")
                        continue
                    # Insert question
                    import uuid, datetime
                    q = {
                        "id": str(uuid.uuid4()),
                        "name": name,
                        "question": text[:500],
                        "source": "telegram",
                        "answered": False,
                        "answer": None,
                        "answering_dj": None,
                        "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                        "telegram_chat_id": chat_id,
                    }
                    await self.db.questions.insert_one(q)
                    await self._reply(chat_id,
                        f"Ricevuta, {name}! La tua domanda è in coda. "
                        "Sintonizzati sulla radio, un DJ AI ti risponderà a breve.")
            except Exception as e:
                logger.warning(f"telegram poll error: {e}")
                await asyncio.sleep(5)


_bot: TelegramBot | None = None


def get_bot() -> TelegramBot | None:
    return _bot


async def start(db):
    global _bot
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        logger.info("TELEGRAM_BOT_TOKEN not set; telegram integration disabled")
        return
    _bot = TelegramBot(token, db)
    asyncio.create_task(_bot.poll_forever())


def status() -> dict:
    if not _bot:
        return {"enabled": False, "reason": "TELEGRAM_BOT_TOKEN non configurato"}
    return {
        "enabled": True,
        "running": _bot.running,
        "username": _bot.username,
        "link": f"https://t.me/{_bot.username}" if _bot.username else None,
    }
