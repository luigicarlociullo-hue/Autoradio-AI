"""Tests for the "A.I. Vs Umani" community config endpoints + palinsesto injection.

Covers:
- GET/PATCH /api/admin/community/config
- POST /api/admin/community/config/jingle_intro | jingle_outro
- GET /api/community_jingle/{filename}
- community block injection inside pick_next_segment (POST /api/segments/generate)
"""
import os
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")
API = f"{BASE_URL}/api"
COMMUNITY_DIR = Path("/app/backend/static/community")


def valid_mp3(size: int = 20_000) -> bytes:
    return b"ID3\x04\x00\x00\x00\x00\x00\x00" + b"\x00" * size


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    yield s
    # restore disabled state
    s.patch(f"{API}/admin/community/config", json={"frequency": 0}, timeout=30)
    s.close()


# ---------------- config GET / PATCH ----------------
class TestCommunityConfig:
    def test_config_get_shape(self, client):
        r = client.get(f"{API}/admin/community/config", timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("frequency", "intro_jingle_url", "outro_jingle_url", "songs_since_community"):
            assert k in d, f"missing key {k}: {d}"
        assert isinstance(d["frequency"], int)
        assert isinstance(d["songs_since_community"], int)

    def test_patch_frequency_3_persists(self, client):
        r = client.patch(f"{API}/admin/community/config", json={"frequency": 3}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json().get("frequency") == 3
        g = client.get(f"{API}/admin/community/config", timeout=30)
        assert g.json()["frequency"] == 3

    def test_patch_frequency_0_disables(self, client):
        r = client.patch(f"{API}/admin/community/config", json={"frequency": 0}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json().get("frequency") == 0
        assert client.get(f"{API}/admin/community/config", timeout=30).json()["frequency"] == 0

    def test_patch_frequency_out_of_range_rejected(self, client):
        r = client.patch(f"{API}/admin/community/config", json={"frequency": 51}, timeout=30)
        assert r.status_code == 400, f"expected 400 for frequency=51, got {r.status_code} {r.text}"

    def test_patch_frequency_non_integer_rejected(self, client):
        r = client.patch(f"{API}/admin/community/config", json={"frequency": "abc"}, timeout=30)
        assert r.status_code == 400, r.text

    def test_patch_frequency_missing_rejected(self, client):
        r = client.patch(f"{API}/admin/community/config", json={}, timeout=30)
        assert r.status_code == 400, r.text


# ---------------- jingle uploads ----------------
class TestCommunityJingles:
    def test_upload_intro_jingle(self, client):
        files = {"file": ("intro.mp3", valid_mp3(), "audio/mpeg")}
        r = client.post(f"{API}/admin/community/config/jingle_intro", files=files, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("ok") is True and d.get("role") == "intro"
        assert d["url"] == "/api/community_jingle/community_jingle_intro.mp3"
        assert (COMMUNITY_DIR / "community_jingle_intro.mp3").exists()
        cfg = client.get(f"{API}/admin/community/config", timeout=30).json()
        assert cfg["intro_jingle_url"] == d["url"]

    def test_upload_outro_jingle(self, client):
        files = {"file": ("outro.mp3", valid_mp3(), "audio/mpeg")}
        r = client.post(f"{API}/admin/community/config/jingle_outro", files=files, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["url"] == "/api/community_jingle/community_jingle_outro.mp3"
        assert (COMMUNITY_DIR / "community_jingle_outro.mp3").exists()
        cfg = client.get(f"{API}/admin/community/config", timeout=30).json()
        assert cfg["outro_jingle_url"] == d["url"]

    def test_reject_non_mp3_magic_bytes(self, client):
        bad = b"RIFF" + b"\x00" * 20_000  # WAV-ish renamed to .mp3
        r = client.post(f"{API}/admin/community/config/jingle_intro",
                        files={"file": ("fake.mp3", bad, "audio/mpeg")}, timeout=60)
        assert r.status_code == 400, r.text

    def test_reject_non_mp3_extension(self, client):
        r = client.post(f"{API}/admin/community/config/jingle_intro",
                        files={"file": ("a.wav", valid_mp3(), "audio/wav")}, timeout=60)
        assert r.status_code == 400, r.text

    def test_reject_too_large(self, client):
        big = valid_mp3(6 * 1024 * 1024)
        r = client.post(f"{API}/admin/community/config/jingle_outro",
                        files={"file": ("big.mp3", big, "audio/mpeg")}, timeout=120)
        assert r.status_code == 400, f"expected 400 for >5MB, got {r.status_code}"

    def test_serve_intro_jingle(self, client):
        r = client.get(f"{API}/community_jingle/community_jingle_intro.mp3", timeout=30)
        assert r.status_code == 200, r.text
        assert r.headers.get("Accept-Ranges") == "bytes", dict(r.headers)
        assert "audio" in r.headers.get("Content-Type", "")

    def test_serve_outro_jingle(self, client):
        r = client.get(f"{API}/community_jingle/community_jingle_outro.mp3", timeout=30)
        assert r.status_code == 200, r.text
        assert r.headers.get("Accept-Ranges") == "bytes"

    def test_whitelist_enforced(self, client):
        r = client.get(f"{API}/community_jingle/qualsiasi_altro.mp3", timeout=30)
        assert r.status_code == 404, f"expected 404, got {r.status_code}"


# ---------------- palinsesto injection ----------------
class TestCommunityInjection:
    def test_community_segment_injected(self, client):
        # 1) submit a community track
        sub = client.post(
            f"{API}/community/submit",
            data={"author": "TEST_Artista", "title": "TEST_Brano", "copyright_ok": "true"},
            files={"file": ("t.mp3", valid_mp3(), "audio/mpeg")},
            timeout=60,
        )
        assert sub.status_code == 200, sub.text
        track_id = sub.json()["id"]
        try:
            # 2) toggle ON
            tog = client.patch(f"{API}/admin/community/{track_id}/toggle", timeout=30)
            assert tog.status_code == 200, tog.text
            assert tog.json().get("status") == "on", tog.text
            # 3) frequency = 1
            assert client.patch(f"{API}/admin/community/config",
                                json={"frequency": 1}, timeout=30).status_code == 200

            found = None
            for _ in range(8):
                r = client.post(f"{API}/segments/generate", timeout=180)
                assert r.status_code == 200, r.text
                seg = r.json()
                if seg.get("kind") == "community":
                    found = seg
                    break
            assert found is not None, "no kind='community' segment produced in 8 calls"

            assert found["pre_jingle_url"] == "/api/community_jingle/community_jingle_intro.mp3"
            assert found["post_jingle_url"] == "/api/community_jingle/community_jingle_outro.mp3"
            assert "A-I contro Umani" in (found.get("script") or "")
            assert "TEST_Brano" in found["script"] and "TEST_Artista" in found["script"]
            assert found["music_audio_url"] == f"/api/community_audio/community_{track_id}.mp3"
            assert found["dj_name"] in ("Leo", "Aria", "Max")
            assert found["voice_key"] in ("onyx", "nova", "echo")
            assert found["track_meta"]["is_community"] is True
            assert found["track_meta"]["id"] == track_id
            assert found["llm_provider"] == "community"

            # counter reset after community segment
            cfg = client.get(f"{API}/admin/community/config", timeout=30).json()
            assert cfg["songs_since_community"] == 0, cfg
        finally:
            client.patch(f"{API}/admin/community/config", json={"frequency": 0}, timeout=30)
            client.delete(f"{API}/admin/community/{track_id}", timeout=30)

    def test_no_community_track_on_does_not_break(self, client):
        """With freq=1 but no ON track, generate must still work (fallback to music)."""
        lst = client.get(f"{API}/admin/community", timeout=30)
        assert lst.status_code == 200
        on_tracks = [t for t in lst.json().get("tracks", lst.json()) if isinstance(t, dict) and t.get("status") == "on"]
        if on_tracks:
            pytest.skip("existing ON community tracks in DB; cannot test empty fallback")
        client.patch(f"{API}/admin/community/config", json={"frequency": 1}, timeout=30)
        try:
            r = client.post(f"{API}/segments/generate", timeout=180)
            assert r.status_code == 200, r.text
            assert r.json()["kind"] != "community"
        finally:
            client.patch(f"{API}/admin/community/config", json={"frequency": 0}, timeout=30)
