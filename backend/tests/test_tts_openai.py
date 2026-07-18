"""Backend tests for R-A.I. TTS via OpenAI TTS-1 (Emergent Universal Key)."""
import os
import re
import time
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # try frontend .env
    envp = "/app/frontend/.env"
    if os.path.exists(envp):
        for line in open(envp):
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

assert BASE_URL, "REACT_APP_BACKEND_URL not set"

BACKEND_LOG = "/var/log/supervisor/backend.err.log"


@pytest.fixture(scope="module")
def s():
    return requests.Session()


def test_smoke_station(s):
    r = s.get(f"{BASE_URL}/api/station", timeout=15)
    assert r.status_code == 200, r.text[:300]


def test_smoke_segments(s):
    r = s.get(f"{BASE_URL}/api/segments", timeout=15)
    assert r.status_code == 200


def test_smoke_djs(s):
    r = s.get(f"{BASE_URL}/api/djs", timeout=15)
    assert r.status_code == 200


def _openai_provider_count():
    if not os.path.exists(BACKEND_LOG):
        return 0
    with open(BACKEND_LOG, "r", errors="ignore") as f:
        return sum(1 for l in f if "TTS synthesized via openai-tts-1" in l)


def _elevenlabs_count_since(start_line_count):
    if not os.path.exists(BACKEND_LOG):
        return 0
    with open(BACKEND_LOG, "r", errors="ignore") as f:
        lines = f.readlines()
    return sum(1 for l in lines if "TTS synthesized via elevenlabs" in l)


@pytest.mark.parametrize("kind", ["weather", "joke", "history", "news"])
def test_generate_segment_uses_openai_tts(s, kind):
    before = _openai_provider_count()
    r = s.post(f"{BASE_URL}/api/segments/generate", params={"kind": kind}, timeout=120)
    assert r.status_code == 200, f"generate {kind} -> {r.status_code}: {r.text[:300]}"
    data = r.json()
    # payload can be {segment: {...}} or direct object
    seg = data.get("segment", data)
    speech_url = seg.get("speech_audio_url")
    assert speech_url, f"No speech_audio_url in response for {kind}: {data}"
    assert "/api/tts/" in speech_url, f"Unexpected url: {speech_url}"

    # Fetch the mp3
    audio_url = speech_url if speech_url.startswith("http") else f"{BASE_URL}{speech_url}"
    ar = s.get(audio_url, timeout=30)
    assert ar.status_code == 200
    assert ar.headers.get("content-type", "").startswith("audio/mpeg"), ar.headers
    assert len(ar.content) > 20 * 1024, f"audio too small: {len(ar.content)} bytes"

    # verify log line incremented
    time.sleep(0.3)
    after = _openai_provider_count()
    assert after > before, f"Expected new 'openai-tts-1' log line after generating {kind}"


def test_no_elevenlabs_used_in_recent_runs():
    """After running the parametrized tests above, ensure elevenlabs was NOT used."""
    if not os.path.exists(BACKEND_LOG):
        pytest.skip("no backend log")
    with open(BACKEND_LOG, "r", errors="ignore") as f:
        # only inspect the last 400 lines for recency
        tail = f.readlines()[-400:]
    eleven_recent = [l for l in tail if "TTS synthesized via elevenlabs" in l]
    assert not eleven_recent, f"ElevenLabs was used recently: {eleven_recent[:3]}"
