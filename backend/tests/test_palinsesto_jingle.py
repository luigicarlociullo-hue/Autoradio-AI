"""Palinsesto 8-position cycle tests (jingle every 2 songs).

Pattern expected (positions modulo 8):
  0 -> music
  1 -> music
  2 -> jingle (kind == "jingle", track_meta.is_jingle == True)
  3 -> rubrica parlata (talk/history/interview/joke/motivation/horoscope/news)
  4 -> time_signal | ad_spot | weather
  5 -> music
  6 -> music
  7 -> jingle (kind == "jingle", track_meta.is_jingle == True)
"""
import os
import subprocess

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")

RUBRICS = {"talk", "history", "interview", "joke", "motivation", "horoscope", "news"}
SLOT4 = {"time_signal", "ad_spot", "weather"}


def reset_station_state():
    js = (
        "db.station.updateOne({_id:'state'},"
        "{$set:{playlist_position:0,last_time_signal_hour:null}},{upsert:true});"
        "print('ok')"
    )
    out = subprocess.run(
        ["mongosh", "--quiet", "test_database", "--eval", js],
        capture_output=True, text=True, timeout=60,
    )
    assert "ok" in out.stdout, f"reset failed: {out.stdout} {out.stderr}"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# --- Health / basics ---
class TestBasics:
    def test_station_endpoint(self, client):
        r = client.get(f"{BASE_URL}/api/station", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, dict)
        assert "_id" not in data

    def test_jingles_available(self, client):
        r = client.get(f"{BASE_URL}/api/tracks?limit=500", timeout=60)
        assert r.status_code == 200, r.text
        tracks = r.json()
        jingles = [t for t in tracks if t.get("is_jingle") and t.get("status") == "ready" and t.get("audio_url")]
        assert len(jingles) > 0, "No ready jingles in library — palinsesto jingle slots will degrade to music"


# --- Palinsesto 8-position cycle ---
class TestPalinsestoCycle:
    def test_eight_position_cycle(self, client):
        reset_station_state()
        results = []
        for i in range(8):
            r = client.post(f"{BASE_URL}/api/segments/generate", timeout=180)
            assert r.status_code == 200, f"pos {i} -> {r.status_code}: {r.text[:400]}"
            seg = r.json()
            assert "_id" not in seg
            # Ad-rotation hijack (does not consume a playlist position) -> retry
            retries = 0
            while seg.get("llm_provider") == "ad-campaign" and retries < 5:
                r = client.post(f"{BASE_URL}/api/segments/generate", timeout=180)
                assert r.status_code == 200, r.text[:400]
                seg = r.json()
                retries += 1
            results.append(seg)

        summary = [
            (i, s.get("kind"), bool((s.get("track_meta") or {}).get("is_jingle")), s.get("title"))
            for i, s in enumerate(results)
        ]
        print("\nPALINSESTO SEQUENCE:")
        for row in summary:
            print(row)

        failures = []
        for i, seg in enumerate(results):
            kind = seg.get("kind")
            is_jingle = bool((seg.get("track_meta") or {}).get("is_jingle"))
            if i in (0, 1, 5, 6):
                if kind != "music":
                    failures.append(f"pos {i}: expected music, got {kind}")
                if is_jingle:
                    failures.append(f"pos {i}: expected regular track, got jingle")
            elif i in (2, 7):
                if kind != "jingle":
                    failures.append(f"pos {i}: expected jingle, got {kind}")
                elif not is_jingle:
                    failures.append(f"pos {i}: expected track_meta.is_jingle=True, got {seg.get('title')}")
            elif i == 3:
                if kind not in RUBRICS:
                    failures.append(f"pos {i}: expected rubrica {RUBRICS}, got {kind}")
            elif i == 4:
                if kind not in SLOT4:
                    failures.append(f"pos {i}: expected one of {SLOT4}, got {kind}")

        assert not failures, "; ".join(failures)

    def test_jingle_segment_has_playable_audio(self, client):
        reset_station_state()
        # advance to position 2 (jingle slot)
        for _ in range(2):
            client.post(f"{BASE_URL}/api/segments/generate", timeout=180)
        r = client.post(f"{BASE_URL}/api/segments/generate", timeout=180)
        assert r.status_code == 200, r.text[:400]
        seg = r.json()
        if seg.get("llm_provider") == "ad-campaign":
            pytest.skip("ad hijack, rerun")
        assert seg["kind"] == "jingle"
        assert (seg.get("track_meta") or {}).get("is_jingle") is True, seg.get("title")
        url = seg.get("music_audio_url")
        assert url, "jingle segment missing music_audio_url"
        full = url if url.startswith("http") else f"{BASE_URL}{url}"
        head = requests.get(full, stream=True, timeout=60)
        assert head.status_code == 200, f"jingle audio not reachable: {full} -> {head.status_code}"


# --- Speech / TTS reachability (player fluidity dependency) ---
class TestSpeechAudio:
    def test_talk_segment_speech_audio_reachable(self, client):
        r = client.post(f"{BASE_URL}/api/segments/generate?kind=talk", timeout=180)
        assert r.status_code == 200, r.text[:400]
        seg = r.json()
        assert seg["kind"] == "talk"
        assert seg.get("script"), "talk segment has empty script"
        url = seg.get("speech_audio_url")
        if not url:
            pytest.fail(f"talk segment has no speech_audio_url (hd_status={seg.get('hd_status')})")
        full = url if url.startswith("http") else f"{BASE_URL}{url}"
        resp = requests.get(full, stream=True, timeout=60)
        assert resp.status_code == 200, f"speech audio 404/err: {full} -> {resp.status_code}"
        assert resp.elapsed.total_seconds() < 5, f"speech audio slow: {resp.elapsed.total_seconds()}s"
