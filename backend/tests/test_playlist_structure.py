"""Regression: palinsesto strutturato posizionale (music,music,parlato,music,music,spot/orario)."""
import os
import asyncio
import pytest


def _api():
    return os.environ.get("TEST_API_URL", "http://localhost:8001")


def _post(path):
    import urllib.request, json
    req = urllib.request.Request(_api() + path, data=b"", method="POST")
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def _reset_position():
    import subprocess
    subprocess.run(["python3", "-c", """
import asyncio, os
os.environ.setdefault('MONGO_URL', 'mongodb://localhost:27017')
os.environ.setdefault('DB_NAME', 'test_database')
from motor.motor_asyncio import AsyncIOMotorClient
async def main():
    c = AsyncIOMotorClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
    await c.station.update_one({'_id': 'state'}, {'$set': {'playlist_position': 0, 'last_time_signal_hour': None}}, upsert=True)
asyncio.run(main())
"""], check=True, timeout=15)


MUSIC = {"music"}
SPEECH = {"talk", "history", "interview", "joke", "motivation"}
SPOT = {"ad_spot", "weather", "time_signal"}


def test_playlist_positional_sequence():
    """Generate 6 segments from a fresh position=0 and verify the structured order."""
    _reset_position()
    seq = []
    for _ in range(6):
        seg = _post("/api/segments/generate")
        seq.append(seg["kind"])
    print(f"\nSequence: {seq}")
    # pos 0,1,3,4 → music
    assert seq[0] in MUSIC, f"pos0 expected music, got {seq[0]}"
    assert seq[1] in MUSIC, f"pos1 expected music, got {seq[1]}"
    assert seq[3] in MUSIC, f"pos3 expected music, got {seq[3]}"
    assert seq[4] in MUSIC, f"pos4 expected music, got {seq[4]}"
    # pos 2 → parlato
    assert seq[2] in SPEECH, f"pos2 expected parlato, got {seq[2]}"
    # pos 5 → spot / weather / time_signal
    assert seq[5] in SPOT, f"pos5 expected spot/orario, got {seq[5]}"


def test_time_signal_italian_time():
    """time_signal script must contain a real HH:MM."""
    import re
    _reset_position()
    # Advance to position 5 with fresh time_signal hour
    for _ in range(5):
        _post("/api/segments/generate")
    seg = _post("/api/segments/generate")  # pos 5
    if seg["kind"] == "time_signal":
        assert re.search(r"\d{1,2}[:.]\d{2}", seg.get("script", "") or seg.get("title", "")), \
            f"time_signal doesn't contain HH:MM: {seg.get('script')}"


if __name__ == "__main__":
    test_playlist_positional_sequence(); print("palinsesto OK")
    test_time_signal_italian_time(); print("time_signal OK")
    print("\nALL PASS")
