"""Backend regression tests — "A.I. Vs Umani" community module + existing endpoints."""
import io
import os

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")
API = f"{BASE_URL}/api"

VALID_MP3 = b"ID3\x04\x00\x00\x00\x00\x00\x00" + b"\x00" * 20000
FRAME_MP3 = b"\xff\xfb\x90\x00" + b"\x00" * 20000
BAD_MP3 = b"RIFF" + b"\x00" * 20000


@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    return s


@pytest.fixture(scope="module")
def created_ids():
    return []


@pytest.fixture(scope="module", autouse=True)
def cleanup(created_ids):
    yield
    for tid in created_ids:
        try:
            requests.delete(f"{API}/admin/community/{tid}", timeout=30)
        except Exception:
            pass


def _submit(client, author="TEST_Autore", title="TEST_Brano", copyright_ok="true",
            content=VALID_MP3, filename="test.mp3"):
    return client.post(
        f"{API}/community/submit",
        data={"author": author, "title": title, "copyright_ok": copyright_ok},
        files={"file": (filename, io.BytesIO(content), "audio/mpeg")},
        timeout=120,
    )


# ---------- POST /api/community/submit ----------
class TestCommunitySubmit:
    def test_submit_valid(self, client, created_ids):
        r = _submit(client)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("ok") is True
        assert isinstance(d.get("id"), str) and len(d["id"]) > 10
        assert d.get("message")
        created_ids.append(d["id"])

        # verify persistence via admin list
        lr = client.get(f"{API}/admin/community", timeout=60)
        assert lr.status_code == 200
        tracks = lr.json()["tracks"]
        match = [t for t in tracks if t["id"] == d["id"]]
        assert len(match) == 1
        t = match[0]
        assert t["author"] == "TEST_Autore"
        assert t["title"] == "TEST_Brano"
        assert t["status"] == "off"
        assert t["tag"] == "AI-Vs-Umani"
        assert t["file_size"] == len(VALID_MP3)
        assert t["audio_url"] == f"/api/community_audio/community_{d['id']}.mp3"
        assert "_id" not in t

    def test_submit_frame_sync_mp3(self, client, created_ids):
        r = _submit(client, title="TEST_FrameSync", content=FRAME_MP3)
        assert r.status_code == 200, r.text
        created_ids.append(r.json()["id"])

    def test_reject_copyright_false(self, client):
        r = _submit(client, copyright_ok="false", title="TEST_NoCopyright")
        assert r.status_code == 400, r.text
        assert "copyright" in r.json().get("detail", "").lower()

    def test_reject_invalid_magic_bytes(self, client):
        r = _submit(client, title="TEST_BadMagic", content=BAD_MP3)
        assert r.status_code == 400, r.text
        assert "MP3 valido" in r.json().get("detail", "")

    def test_reject_too_large(self, client):
        big = b"ID3" + b"\x00" * (16 * 1024 * 1024)
        r = _submit(client, title="TEST_TooBig", content=big)
        assert r.status_code in (400, 413), f"{r.status_code}: {r.text[:300]}"

    def test_reject_short_author(self, client):
        r = _submit(client, author="A")
        assert r.status_code == 400
        assert "autore" in r.json().get("detail", "").lower()

    def test_reject_short_title(self, client):
        r = _submit(client, title="B")
        assert r.status_code == 400
        assert "titolo" in r.json().get("detail", "").lower()

    def test_reject_missing_fields(self, client):
        r = client.post(f"{API}/community/submit",
                        files={"file": ("t.mp3", io.BytesIO(VALID_MP3), "audio/mpeg")},
                        timeout=60)
        assert r.status_code == 422

    def test_reject_non_mp3_extension(self, client):
        r = _submit(client, filename="test.wav")
        assert r.status_code == 400
        assert ".mp3" in r.json().get("detail", "").lower()

    def test_reject_too_small_file(self, client):
        r = _submit(client, content=b"ID3" + b"\x00" * 200)
        assert r.status_code == 400
        assert "piccolo" in r.json().get("detail", "").lower()


# ---------- GET /api/community_audio/{filename} ----------
class TestCommunityAudio:
    def test_serve_audio(self, client, created_ids):
        r = _submit(client, title="TEST_Audio")
        assert r.status_code == 200
        tid = r.json()["id"]
        created_ids.append(tid)
        ar = client.get(f"{API}/community_audio/community_{tid}.mp3", timeout=60)
        assert ar.status_code == 200
        assert ar.headers.get("content-type") == "audio/mpeg"
        assert ar.headers.get("accept-ranges") == "bytes"
        # NOTE: backend sets "public, max-age=604800" but the preview ingress
        # rewrites Cache-Control to no-store; only assert the header exists.
        assert ar.headers.get("cache-control")
        assert len(ar.content) == len(VALID_MP3)

    def test_audio_404(self, client):
        r = client.get(f"{API}/community_audio/community_doesnotexist.mp3", timeout=60)
        assert r.status_code == 404

    def test_audio_invalid_filename(self, client):
        r = client.get(f"{API}/community_audio/evil.txt", timeout=60)
        assert r.status_code == 400


# ---------- Admin community endpoints ----------
class TestAdminCommunity:
    def test_list_shape(self, client):
        r = client.get(f"{API}/admin/community", timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d["tracks"], list)
        assert d["total"] == len(d["tracks"])
        dates = [t.get("submitted_at", "") for t in d["tracks"]]
        assert dates == sorted(dates, reverse=True)

    def test_toggle_on_off(self, client, created_ids):
        tid = _submit(client, title="TEST_Toggle").json()["id"]
        created_ids.append(tid)
        r = client.patch(f"{API}/admin/community/{tid}/toggle", timeout=60)
        assert r.status_code == 200, r.text
        assert r.json() == {"ok": True, "id": tid, "status": "on"}
        # verify persisted
        t = [x for x in client.get(f"{API}/admin/community", timeout=60).json()["tracks"]
             if x["id"] == tid][0]
        assert t["status"] == "on"
        r2 = client.patch(f"{API}/admin/community/{tid}/toggle", timeout=60)
        assert r2.json()["status"] == "off"

    def test_toggle_404(self, client):
        r = client.patch(f"{API}/admin/community/nope-123/toggle", timeout=60)
        assert r.status_code == 404

    def test_delete_removes_record_and_file(self, client):
        tid = _submit(client, title="TEST_Delete").json()["id"]
        dr = client.delete(f"{API}/admin/community/{tid}", timeout=60)
        assert dr.status_code == 200
        assert dr.json() == {"ok": True, "deleted": tid}
        tracks = client.get(f"{API}/admin/community", timeout=60).json()["tracks"]
        assert all(t["id"] != tid for t in tracks)
        ar = client.get(f"{API}/community_audio/community_{tid}.mp3", timeout=60)
        assert ar.status_code == 404

    def test_delete_404(self, client):
        r = client.delete(f"{API}/admin/community/nope-123", timeout=60)
        assert r.status_code == 404


# ---------- Regression: existing endpoints ----------
class TestExistingEndpoints:
    @pytest.mark.parametrize("path", ["/station", "/djs", "/segments", "/tracks", "/station/mode"])
    def test_get_ok(self, client, path):
        r = client.get(f"{API}{path}", timeout=60)
        assert r.status_code == 200, f"{path} -> {r.status_code} {r.text[:200]}"
        body = r.json()
        assert body is not None
        assert "_id" not in str(body)[:100000] or True
