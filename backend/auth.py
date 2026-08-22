"""Auth module — single-admin JWT auth per R-A.I. Regia.
Password + credenziali admin da .env. Nessuna registrazione utenti.
"""
import os
import uuid
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException, Request, Response, Depends
from pydantic import BaseModel


JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_TTL_HOURS = 8


def _jwt_secret() -> str:
    s = os.environ.get("JWT_SECRET")
    if not s:
        raise RuntimeError("JWT_SECRET non configurato")
    return s


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: str, email: str, role: str = "admin") -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "type": "access",
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_TTL_HOURS),
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGORITHM)


def _decode_token(token: str) -> dict:
    return jwt.decode(token, _jwt_secret(), algorithms=[JWT_ALGORITHM])


def _extract_token(request: Request) -> str | None:
    t = request.cookies.get("access_token")
    if t:
        return t
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return None


async def get_current_admin(request: Request) -> dict:
    token = _extract_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Autenticazione richiesta")
    try:
        payload = _decode_token(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token scaduto")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token non valido")
    if payload.get("type") != "access" or payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Permessi insufficienti")
    return {"id": payload.get("sub"), "email": payload.get("email"), "role": "admin"}


class LoginPayload(BaseModel):
    email: str
    password: str


def make_auth_router(db):
    """Crea il router auth con riferimento al DB motor."""
    r = APIRouter()

    @r.post("/regia/login")
    async def login(payload: LoginPayload, request: Request, response: Response):
        # Brute-force protection: 5 tentativi/15min per identifier
        ip = (request.headers.get("x-forwarded-for") or request.client.host if request.client else "unknown").split(",")[0].strip()
        identifier = f"{ip}:{(payload.email or '').lower().strip()}"
        now = datetime.now(timezone.utc)
        attempt = await db.login_attempts.find_one({"identifier": identifier})
        if attempt and attempt.get("locked_until") and attempt["locked_until"] > now:
            raise HTTPException(status_code=429, detail="Troppi tentativi. Riprova più tardi.")

        email = (payload.email or "").lower().strip()
        user = await db.users.find_one({"email": email, "role": "admin"})
        if not user or not verify_password(payload.password or "", user.get("password_hash", "")):
            # Incrementa tentativi
            count = (attempt.get("count", 0) if attempt else 0) + 1
            update = {"identifier": identifier, "count": count, "last_at": now}
            if count >= 5:
                update["locked_until"] = now + timedelta(minutes=15)
                update["count"] = 0
            await db.login_attempts.update_one(
                {"identifier": identifier}, {"$set": update}, upsert=True
            )
            raise HTTPException(status_code=401, detail="Credenziali non valide")

        # Reset tentativi
        await db.login_attempts.delete_one({"identifier": identifier})

        token = create_access_token(user["id"], user["email"], user.get("role", "admin"))
        response.set_cookie(
            key="access_token",
            value=token,
            httponly=True,
            secure=True,
            samesite="none",
            max_age=ACCESS_TOKEN_TTL_HOURS * 3600,
            path="/",
        )
        return {"ok": True, "user": {"id": user["id"], "email": user["email"], "role": user.get("role", "admin")}, "token": token}

    @r.post("/regia/logout")
    async def logout(response: Response):
        response.delete_cookie("access_token", path="/")
        return {"ok": True}

    @r.get("/regia/me")
    async def me(admin=Depends(get_current_admin)):
        return {"user": admin}

    return r


async def seed_admin(db):
    """Assicura che l'admin esista con la password corrente dell'env."""
    email = (os.environ.get("ADMIN_EMAIL") or "admin@r-ai.it").lower().strip()
    password = os.environ.get("ADMIN_PASSWORD") or "changeme"
    now = datetime.now(timezone.utc)
    existing = await db.users.find_one({"email": email})
    if not existing:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": email,
            "password_hash": hash_password(password),
            "name": "Admin",
            "role": "admin",
            "created_at": now,
        })
    elif not verify_password(password, existing.get("password_hash", "")):
        await db.users.update_one(
            {"email": email},
            {"$set": {"password_hash": hash_password(password), "role": "admin"}},
        )
    await db.users.create_index("email", unique=True)
    await db.login_attempts.create_index("identifier")


# --- Protezione globale /api/admin/* ---
ADMIN_PREFIX = "/api/admin"
# Endpoint dentro /api/admin che devono restare pubblici (nessuno per default)
ADMIN_WHITELIST_EXACT: set[str] = set()


async def admin_gate_middleware(request: Request, call_next):
    """Blocca qualunque richiesta a /api/admin/* senza JWT admin valido.
    Preflight OPTIONS sempre passa (gestito da CORS)."""
    if request.method == "OPTIONS":
        return await call_next(request)
    path = request.url.path
    if path.startswith(ADMIN_PREFIX) and path not in ADMIN_WHITELIST_EXACT:
        token = _extract_token(request)
        ok = False
        if token:
            try:
                p = _decode_token(token)
                ok = (p.get("type") == "access" and p.get("role") == "admin")
            except Exception:
                ok = False
        if not ok:
            from starlette.responses import JSONResponse
            return JSONResponse(
                status_code=401,
                content={"detail": "Regia protetta: login admin richiesto"},
            )
    return await call_next(request)
