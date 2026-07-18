"""Backend regression: verify that the local Suno music library is preferred
over any Suno API call. See /app/memory/PRD.md — task "Suno cost optimization".
"""
import os
import subprocess


def _api():
    # Use local backend directly for pytest; external URL requires UA header
    return os.environ.get("TEST_API_URL", "http://localhost:8001")


def _get(path):
    import urllib.request, json
    with urllib.request.urlopen(_api() + path, timeout=15) as r:
        return json.loads(r.read())


def _post(path):
    import urllib.request, json
    req = urllib.request.Request(_api() + path, data=b"", method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def test_library_stats_shape():
    s = _get("/api/library/stats")
    assert "target_ready" in s and s["target_ready"] == 10
    assert "autogen_enabled" in s
    assert "tracks" in s and "ready" in s["tracks"]
    assert "local_files" in s and s["local_files"]["count"] >= 0


def test_suno_status_reports_flags():
    s = _get("/api/suno/status")
    assert "autogen_enabled" in s
    assert "library_target" in s


def test_music_slot_uses_library_no_new_suno_task():
    before = _get("/api/library/stats")["tracks"]["pending"]
    seg = _post("/api/segments/generate?kind=music")
    assert seg["kind"] == "music"
    assert seg.get("track_meta", {}).get("audio_url"), "music segment should have cached audio"
    import time; time.sleep(1)
    after = _get("/api/library/stats")["tracks"]["pending"]
    assert after == before, f"pending grew ({before}->{after}) — Suno was called!"


def test_autogen_toggle_persists():
    _post("/api/library/autogen?enabled=false")
    assert _get("/api/library/stats")["autogen_enabled"] is False
    with open("/app/backend/.env") as f:
        assert "SUNO_AUTOGEN_ENABLED=false" in f.read()
    _post("/api/library/autogen?enabled=true")
    assert _get("/api/library/stats")["autogen_enabled"] is True


if __name__ == "__main__":
    test_library_stats_shape(); print("stats OK")
    test_suno_status_reports_flags(); print("suno status OK")
    test_music_slot_uses_library_no_new_suno_task(); print("music slot cached OK")
    test_autogen_toggle_persists(); print("toggle OK")
    print("\nALL PASS")
