"""Master plan backend tests: admin MP3 upload, searchable tracks, categorized exports,
object-storage fallback for /api/suno_audio, and /api/analytics regression."""
import os
import io
import time
import shutil
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

SUNO_DIR = Path("/app/backend/static/suno")

MP3_BYTES = b"ID3\x03\x00\x00\x00" + os.urandom(12000)
SMALL_BYTES = b"ID3\x03" + b"\x00" * 100


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    return s


@pytest.fixture(scope="module")
def created(client):
    ids = []
    yield ids
    # cleanup: remove DB docs + local files via mongo shell
    import subprocess
    for tid in ids:
        try:
            (SUNO_DIR / f"track_{tid}.mp3").unlink(missing_ok=True)
        except Exception:
            pass
    if ids:
        idlist = ",".join(f'"{i}"' for i in ids)
        env = dotenv_values("/app/backend/.env")
        dbname = env.get("DB_NAME")
        mongo = env.get("MONGO_URL")
        subprocess.run(
            ["mongosh", mongo, "--quiet", "--eval",
             f'db.getSiblingDB("{dbname}").tracks.deleteMany({{id: {{$in: [{idlist}]}}}})'],
            capture_output=True,
        )


# ---------------- upload: mode=new ----------------
class TestUploadNew:
    def test_upload_new_and_serve(self, client, created):
        r = client.post(
            f"{API}/admin/tracks/upload",
            files={"file": ("TEST_new.mp3", MP3_BYTES, "audio/mpeg")},
            data={"mode": "new", "title": "TEST_MasterPlan New", "artist": "TEST_ARTIST", "kind": "song"},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["ok"] is True
        assert j["mode"] == "new"
        tid = j["track_id"]
        assert isinstance(tid, str) and len(tid) > 10
        created.append(tid)
        assert j["audio_url"] == f"/api/suno_audio/track_{tid}.mp3"
        assert j["size_bytes"] == len(MP3_BYTES)

        # audio served back with matching bytes
        a = client.get(f"{API}/suno_audio/track_{tid}.mp3", timeout=60)
        assert a.status_code == 200, a.text
        assert a.headers.get("content-type", "").startswith("audio/")
        assert a.content == MP3_BYTES

        # present in searchable list
        s = client.get(f"{API}/admin/tracks/searchable", timeout=60)
        assert s.status_code == 200
        tracks = s.json()["tracks"]
        match = [t for t in tracks if t["id"] == tid]
        assert match, "uploaded track not in searchable list"
        assert match[0]["title"] == "TEST_MasterPlan New"
        assert match[0]["artist"] == "TEST_ARTIST"
        assert match[0]["kind"] == "song"

    def test_upload_jingle_kind(self, client, created):
        r = client.post(
            f"{API}/admin/tracks/upload",
            files={"file": ("TEST_j.mp3", MP3_BYTES, "audio/mpeg")},
            data={"mode": "new", "title": "TEST_MasterPlan Jingle", "kind": "jingle"},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        tid = r.json()["track_id"]
        created.append(tid)
        s = client.get(f"{API}/admin/tracks/searchable", timeout=60).json()["tracks"]
        m = [t for t in s if t["id"] == tid]
        assert m and m[0]["kind"] == "jingle"
        assert m[0]["artist"] == "R-A.I."  # default artist


# ---------------- upload: mode=replace ----------------
class TestUploadReplace:
    def test_replace_updates_title_keeps_url(self, client, created):
        r = client.post(
            f"{API}/admin/tracks/upload",
            files={"file": ("TEST_r.mp3", MP3_BYTES, "audio/mpeg")},
            data={"mode": "new", "title": "TEST_MasterPlan Original", "kind": "song"},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        tid = r.json()["track_id"]
        created.append(tid)
        orig_url = r.json()["audio_url"]

        new_bytes = b"ID3\x03\x00\x00\x00" + os.urandom(15000)
        r2 = client.post(
            f"{API}/admin/tracks/upload",
            files={"file": ("TEST_r2.mp3", new_bytes, "audio/mpeg")},
            data={"mode": "replace", "target_id": tid, "title": "TEST_MasterPlan Replaced", "kind": "song"},
            timeout=60,
        )
        assert r2.status_code == 200, r2.text
        j2 = r2.json()
        assert j2["mode"] == "replace"
        assert j2["track_id"] == tid
        assert j2["audio_url"] == orig_url

        s = client.get(f"{API}/admin/tracks/searchable", timeout=60).json()["tracks"]
        m = [t for t in s if t["id"] == tid]
        assert m, "replaced track missing"
        assert m[0]["title"] == "TEST_MasterPlan Replaced"
        # only one entry for that id (no duplicate insert)
        assert len(m) == 1

        a = client.get(f"{API}/suno_audio/track_{tid}.mp3", timeout=60)
        assert a.status_code == 200
        assert a.content == new_bytes

    def test_replace_without_target_id(self, client):
        r = client.post(
            f"{API}/admin/tracks/upload",
            files={"file": ("TEST_x.mp3", MP3_BYTES, "audio/mpeg")},
            data={"mode": "replace", "title": "TEST_x", "kind": "song"},
            timeout=60,
        )
        assert r.status_code == 400, r.text

    def test_replace_unknown_target_id(self, client):
        r = client.post(
            f"{API}/admin/tracks/upload",
            files={"file": ("TEST_x.mp3", MP3_BYTES, "audio/mpeg")},
            data={"mode": "replace", "target_id": "does-not-exist-1234", "title": "TEST_x", "kind": "song"},
            timeout=60,
        )
        assert r.status_code == 404, r.text


# ---------------- upload validation ----------------
class TestUploadValidation:
    def test_invalid_kind(self, client):
        r = client.post(
            f"{API}/admin/tracks/upload",
            files={"file": ("TEST_v.mp3", MP3_BYTES, "audio/mpeg")},
            data={"mode": "new", "title": "TEST_v", "kind": "invalid"},
            timeout=60,
        )
        assert r.status_code == 400, r.text

    def test_invalid_mode(self, client):
        r = client.post(
            f"{API}/admin/tracks/upload",
            files={"file": ("TEST_v.mp3", MP3_BYTES, "audio/mpeg")},
            data={"mode": "invalid", "title": "TEST_v", "kind": "song"},
            timeout=60,
        )
        assert r.status_code == 400, r.text

    def test_missing_file(self, client):
        r = client.post(
            f"{API}/admin/tracks/upload",
            data={"mode": "new", "title": "TEST_v", "kind": "song"},
            timeout=60,
        )
        assert r.status_code == 422, r.text

    def test_missing_title(self, client):
        r = client.post(
            f"{API}/admin/tracks/upload",
            files={"file": ("TEST_v.mp3", MP3_BYTES, "audio/mpeg")},
            data={"mode": "new", "kind": "song"},
            timeout=60,
        )
        assert r.status_code == 422, r.text

    def test_too_small_file(self, client):
        r = client.post(
            f"{API}/admin/tracks/upload",
            files={"file": ("TEST_v.mp3", SMALL_BYTES, "audio/mpeg")},
            data={"mode": "new", "title": "TEST_v", "kind": "song"},
            timeout=60,
        )
        assert r.status_code == 400, r.text

    def test_non_mp3_rejected(self, client):
        r = client.post(
            f"{API}/admin/tracks/upload",
            files={"file": ("TEST_v.txt", MP3_BYTES, "text/plain")},
            data={"mode": "new", "title": "TEST_v", "kind": "song"},
            timeout=60,
        )
        assert r.status_code == 400, r.text


# ---------------- categorized export ----------------
class TestCategorizedExport:
    @pytest.mark.parametrize("cat", ["music", "jingles", "anthem", "metadata", "talk", "news"])
    def test_export_category(self, client, cat):
        params = {"page": 1, "page_size": 50}
        r = client.get(f"{API}/admin/export/category/{cat}", params=params, timeout=300)
        assert r.status_code == 200, f"{cat}: {r.status_code} {r.text[:300]}"
        assert r.headers.get("content-type") == "application/zip", r.headers
        assert "X-Rai-Total-Available" in r.headers, r.headers
        size_mb = len(r.content) / 1024 / 1024
        print(f"[export {cat}] size={size_mb:.2f}MB total_available={r.headers.get('X-Rai-Total-Available')}")
        # valid zip
        import zipfile
        zf = zipfile.ZipFile(io.BytesIO(r.content))
        names = zf.namelist()
        assert "README.txt" in names
        assert zf.testzip() is None
        if cat == "music":
            assert size_mb < 250, f"music page1 too big: {size_mb}MB"
        if cat == "metadata":
            assert "rai_export/tracks.json" in names
            assert "rai_export/segments.json" in names

    def test_export_invalid_category(self, client):
        r = client.get(f"{API}/admin/export/category/invalidcat", timeout=60)
        assert r.status_code == 400, f"{r.status_code} {r.text[:300]}"


# ---------------- regressions ----------------
class TestRegressions:
    def test_analytics(self, client):
        r = client.get(f"{API}/analytics", timeout=60)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), dict)

    def test_suno_audio_invalid_filename(self, client):
        r = client.get(f"{API}/suno_audio/notanmp3.txt", timeout=30)
        assert r.status_code == 400

    def test_suno_audio_missing(self, client):
        r = client.get(f"{API}/suno_audio/track_nonexistent-zzz.mp3", timeout=60)
        assert r.status_code == 404


# ---------------- side effects of admin upload on other endpoints ----------------
class TestUploadSideEffects:
    """An admin-uploaded track must not break the existing read endpoints."""

    def test_tracks_endpoint_still_ok_after_upload(self, client, created):
        before = client.get(f"{API}/tracks", timeout=60)
        assert before.status_code == 200, f"/api/tracks broken before upload: {before.status_code}"

        r = client.post(
            f"{API}/admin/tracks/upload",
            files={"file": ("TEST_side.mp3", MP3_BYTES, "audio/mpeg")},
            data={"mode": "new", "title": "TEST_MasterPlan SideEffect", "kind": "song"},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        created.append(r.json()["track_id"])

        after = client.get(f"{API}/tracks", timeout=60)
        assert after.status_code == 200, (
            f"/api/tracks returns {after.status_code} after admin upload "
            "(Track model requires genre/mood/lyrics_excerpt/llm_provider/cover_seed and "
            "source Literal suno|stable_audio|procedural, admin upload writes source='admin_upload')"
        )
        assert client.get(f"{API}/analytics", timeout=60).status_code == 200
        assert client.get(f"{API}/library/stats", timeout=60).status_code == 200
        assert client.get(f"{API}/segments/list", timeout=60).status_code == 200


# ---------------- object storage fallback ----------------
class TestObjectStorageFallback:
    def test_fallback_after_local_delete(self, client, created):
        r = client.post(
            f"{API}/admin/tracks/upload",
            files={"file": ("TEST_os.mp3", MP3_BYTES, "audio/mpeg")},
            data={"mode": "new", "title": "TEST_MasterPlan ObjStore", "kind": "song"},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        tid = r.json()["track_id"]
        created.append(tid)
        local = SUNO_DIR / f"track_{tid}.mp3"
        assert local.exists(), "local file not written by upload"

        backup = Path("/tmp") / f"bk_track_{tid}.mp3"
        shutil.move(str(local), str(backup))
        assert not local.exists()
        try:
            time.sleep(1)
            a = client.get(f"{API}/suno_audio/track_{tid}.mp3", timeout=120)
            assert a.status_code == 200, f"object storage fallback failed: {a.status_code} {a.text[:200]}"
            assert a.content == MP3_BYTES
        finally:
            if not local.exists():
                shutil.move(str(backup), str(local))
            else:
                backup.unlink(missing_ok=True)
