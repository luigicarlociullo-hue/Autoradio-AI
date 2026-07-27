"""
One-shot migration: push all local .mp3 files to Emergent Object Storage.

USE:
  export USE_OBJECT_STORAGE=true
  python /app/backend/scripts/migrate_to_object_storage.py           # dry run
  python /app/backend/scripts/migrate_to_object_storage.py --apply   # do it

Behaviour:
  * Uploads /app/backend/static/suno/*.mp3  →  r-a-i/suno/<file>
  * Uploads /app/backend/tts_audio/*.mp3    →  r-a-i/tts/<file>
  * Idempotent — object storage returns 409 if the object already exists,
    which the helper treats as success.
  * Does NOT modify the MongoDB URLs. The `audio_url` / `speech_audio_url`
    values already point at /api/suno_audio/<name> and /api/tts/<name>, and
    those endpoints already fall back to object storage transparently.
"""
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, "/app/backend")  # allow "import object_storage"
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

# Force enable for this script even if the running server has it off.
os.environ["USE_OBJECT_STORAGE"] = "true"

import object_storage  # noqa: E402


SUNO_DIR = Path("/app/backend/static/suno")
TTS_DIR = Path("/app/backend/tts_audio")


async def _migrate(dir_path: Path, sub_prefix: str, apply: bool) -> tuple[int, int]:
    files = sorted(p for p in dir_path.glob("*.mp3") if p.is_file() and p.stat().st_size > 0)
    ok, fail = 0, 0
    for i, p in enumerate(files, 1):
        print(f"[{sub_prefix}] ({i}/{len(files)}) {p.name} ({p.stat().st_size:,} bytes)", end=" ")
        if not apply:
            print("[DRY-RUN skip]")
            continue
        result = await object_storage.upload_local_file(str(p), f"{sub_prefix}/{p.name}")
        if result:
            print("OK")
            ok += 1
        else:
            print("FAIL")
            fail += 1
    return ok, fail


async def main(apply: bool):
    print(f"USE_OBJECT_STORAGE={object_storage.is_enabled()}  APP_NAME={object_storage.APP_NAME}")
    if not object_storage.is_enabled():
        print("Object storage disabled — nothing to do.")
        return
    key = await object_storage.init_storage()
    if not key:
        print("Storage init failed — check EMERGENT_LLM_KEY.")
        return
    print(f"Storage initialized (key preview: {key[:12]}...)")

    total_ok, total_fail = 0, 0
    for dir_path, prefix in [(SUNO_DIR, "suno"), (TTS_DIR, "tts")]:
        if not dir_path.exists():
            print(f"[{prefix}] directory {dir_path} missing — skip")
            continue
        ok, fail = await _migrate(dir_path, prefix, apply)
        total_ok += ok
        total_fail += fail

    print(f"\nDONE — {total_ok} uploaded, {total_fail} failed. apply={apply}")


if __name__ == "__main__":
    apply = "--apply" in sys.argv
    asyncio.run(main(apply))
