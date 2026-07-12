"""PayPal REST API integration (Orders v2).
Works in three modes controlled by PAYPAL_MODE env variable:
  - "live"     -> https://api-m.paypal.com
  - "sandbox"  -> https://api-m.sandbox.paypal.com
  - "demo"     -> no PayPal call, campaigns are auto-marked as paid (front-end
                  shows a clear "DEMO" banner). Used when PAYPAL_CLIENT_ID is
                  missing so the whole ad flow can be demoed end-to-end.
"""
import os
import time
import logging
from typing import Optional, Tuple
import httpx

logger = logging.getLogger(__name__)


def _mode() -> str:
    m = os.environ.get("PAYPAL_MODE", "").strip().lower()
    if m in ("live", "sandbox", "demo"):
        return m
    cid = os.environ.get("PAYPAL_CLIENT_ID", "").strip()
    sec = os.environ.get("PAYPAL_CLIENT_SECRET", "").strip()
    if cid and sec:
        return "sandbox"
    return "demo"


def _base_url() -> str:
    return "https://api-m.paypal.com" if _mode() == "live" else "https://api-m.sandbox.paypal.com"


class _TokenCache:
    token: Optional[str] = None
    expires_at: float = 0

_cache = _TokenCache()


async def _get_access_token() -> str:
    if _cache.token and time.time() < _cache.expires_at - 30:
        return _cache.token
    cid = os.environ["PAYPAL_CLIENT_ID"]
    sec = os.environ["PAYPAL_CLIENT_SECRET"]
    async with httpx.AsyncClient(timeout=20) as h:
        r = await h.post(
            f"{_base_url()}/v1/oauth2/token",
            auth=(cid, sec),
            data={"grant_type": "client_credentials"},
            headers={"Accept": "application/json", "Accept-Language": "en_US"},
        )
        r.raise_for_status()
        data = r.json()
    _cache.token = data["access_token"]
    _cache.expires_at = time.time() + int(data.get("expires_in", 3000))
    return _cache.token


def is_demo() -> bool:
    return _mode() == "demo"


def current_mode() -> str:
    return _mode()


async def create_order(amount_eur: float, description: str, return_url: str, cancel_url: str) -> Tuple[str, Optional[str]]:
    """Create a PayPal order and return (order_id, approval_url).
    In demo mode returns synthetic ids so callers can proceed without PayPal.
    """
    if is_demo():
        fake_id = f"DEMO-{int(time.time()*1000)}"
        # In demo mode we return the return_url directly so the frontend can
        # skip PayPal and go straight to the confirmation page.
        sep = "&" if "?" in return_url else "?"
        approval = f"{return_url}{sep}token={fake_id}&demo=1"
        return fake_id, approval

    payload = {
        "intent": "CAPTURE",
        "purchase_units": [{
            "amount": {"currency_code": "EUR", "value": f"{amount_eur:.2f}"},
            "description": description[:120],
        }],
        "application_context": {
            "brand_name": "NEURA·FM",
            "shipping_preference": "NO_SHIPPING",
            "user_action": "PAY_NOW",
            "return_url": return_url,
            "cancel_url": cancel_url,
        },
    }
    token = await _get_access_token()
    async with httpx.AsyncClient(timeout=20) as h:
        r = await h.post(
            f"{_base_url()}/v2/checkout/orders",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json=payload,
        )
        r.raise_for_status()
        data = r.json()
    approval = None
    for link in data.get("links", []):
        if link.get("rel") == "approve":
            approval = link["href"]
            break
    return data["id"], approval


async def capture_order(order_id: str) -> dict:
    """Capture the order. In demo mode returns a fake COMPLETED payload."""
    if is_demo() or order_id.startswith("DEMO-"):
        return {
            "id": order_id,
            "status": "COMPLETED",
            "demo": True,
            "purchase_units": [{"payments": {"captures": [{"amount": {"value": "0.00", "currency_code": "EUR"}, "id": order_id}]}}],
        }
    token = await _get_access_token()
    async with httpx.AsyncClient(timeout=20) as h:
        r = await h.post(
            f"{_base_url()}/v2/checkout/orders/{order_id}/capture",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        r.raise_for_status()
        return r.json()
