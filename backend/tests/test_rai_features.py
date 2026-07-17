"""Tests for R-A.I. features: ad_spot, recent buffers, background_loop, kind identities."""
import os
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
# Fallback for testing environment: read frontend .env
if not BASE:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE = line.split("=", 1)[1].strip().strip('"').rstrip("/")

API = f"{BASE}/api"


@pytest.fixture(scope="module")
def s():
    return requests.Session()


# --- Smoke ---
def test_station_ok(s):
    r = s.get(f"{API}/station", timeout=30)
    assert r.status_code == 200
    d = r.json()
    assert isinstance(d.get("recent_intros", []), list)
    assert isinstance(d.get("recent_ads", []), list)


def test_segments_list(s):
    r = s.get(f"{API}/segments", timeout=30)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_djs_list(s):
    r = s.get(f"{API}/djs", timeout=30)
    assert r.status_code == 200
    assert len(r.json()) > 0


# --- ad_spot ---
FALLBACK_AD_KEYWORDS = ["SolarLuna", "Silenzio Premium", "Pigrini", "MemoriaLite", "Codex Fresh"]


def test_ad_spot_generate(s):
    r = s.post(f"{API}/segments/generate", params={"kind": "ad_spot"}, timeout=90)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["kind"] == "ad_spot"
    assert d["title"].startswith("📢 ")
    assert d["duration_sec"] == 25
    assert len(d.get("script", "")) > 50
    # Fallback pool check (LLM budget exhausted)
    assert any(k.lower() in d["script"].lower() for k in FALLBACK_AD_KEYWORDS), \
        f"Expected fallback ad, got: {d['script'][:200]}"


def test_ad_spot_anti_double(s):
    """5 consecutive ad_spot requests should never produce two ad_spot in a row."""
    kinds = []
    for _ in range(5):
        r = s.post(f"{API}/segments/generate", params={"kind": "ad_spot"}, timeout=90)
        assert r.status_code == 200
        kinds.append(r.json()["kind"])
    # No two consecutive ad_spot
    for i in range(1, len(kinds)):
        assert not (kinds[i] == "ad_spot" and kinds[i - 1] == "ad_spot"), f"Two ad_spot in a row: {kinds}"
    # At least one was flipped to music
    assert "music" in kinds, f"Expected forced-music flip: {kinds}"


def test_recent_ads_populated(s):
    r = s.get(f"{API}/station", timeout=30)
    ads = r.json().get("recent_ads", [])
    assert len(ads) >= 1, "recent_ads should be populated after ad_spot generations"


# --- recent_intros buffer ---
def test_recent_intros_populated(s):
    # Generate 2 music segments
    for _ in range(2):
        r = s.post(f"{API}/segments/generate", params={"kind": "music"}, timeout=120)
        assert r.status_code == 200
    r = s.get(f"{API}/station", timeout=30)
    intros = r.json().get("recent_intros", [])
    assert len(intros) >= 2, f"recent_intros should have >=2 lines, got {len(intros)}"


# --- Fallback identity per kind ---
def test_history_fallback(s):
    r = s.post(f"{API}/segments/generate", params={"kind": "history"}, timeout=90)
    d = r.json()
    assert d["title"] == "Storia della Musica"
    # Should mention a year or place-marker
    assert d.get("background_loop", "").startswith("/api/suno_audio/")


def test_weather_fallback(s):
    r = s.post(f"{API}/segments/generate", params={"kind": "weather"}, timeout=90)
    d = r.json()
    assert "Meteo Cosmico" in d["title"]
    assert d.get("background_loop", "").startswith("/api/suno_audio/")


def test_news_fallback(s):
    r = s.post(f"{API}/segments/generate", params={"kind": "news"}, timeout=90)
    d = r.json()
    assert d["title"] == "News 2087"


def test_motivation_fallback(s):
    r = s.post(f"{API}/segments/generate", params={"kind": "motivation"}, timeout=90)
    d = r.json()
    assert d["title"] == "Pillola"


def test_joke_fallback(s):
    r = s.post(f"{API}/segments/generate", params={"kind": "joke"}, timeout=90)
    d = r.json()
    assert d["title"] == "Battuta"
    assert d.get("background_loop", "").startswith("/api/suno_audio/")


def test_interview_fallback(s):
    r = s.post(f"{API}/segments/generate", params={"kind": "interview"}, timeout=90)
    d = r.json()
    assert d["title"].startswith("R-A.I. × ")


# --- Suno audio local ---
def test_suno_audio_served(s):
    files = os.listdir("/app/backend/static/suno")
    mp3 = next((f for f in files if f.endswith(".mp3")), None)
    assert mp3, "No local Suno mp3 present"
    r = s.get(f"{API}/suno_audio/{mp3}", timeout=30, stream=True)
    assert r.status_code == 200
    ct = r.headers.get("content-type", "")
    assert "audio" in ct, f"Unexpected content-type: {ct}"


# --- Round-robin music tracks ---
def test_music_round_robin(s):
    titles = []
    for _ in range(6):
        r = s.post(f"{API}/segments/generate", params={"kind": "music"}, timeout=120)
        assert r.status_code == 200
        titles.append(r.json()["title"])
    unique = set(titles)
    assert len(unique) >= 4, f"Expected diverse titles via round-robin, got: {titles}"
