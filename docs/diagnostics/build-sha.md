# Build SHA on /api/health

`GET /api/health` returns `sha`, resolved once at startup (`_resolve_build_sha` in `backend/server.py`):
1. `git rev-parse --short HEAD` in `backend/` (works when `.git` ships with the deploy),
2. else the contents of `backend/BUILD_SHA`,
3. else `"unknown"`.

Production images usually have no `.git`, so run this **at publish/build time, after checkout and before packaging**:

    scripts/write_build_sha.sh

It runs `git rev-parse --short HEAD > backend/BUILD_SHA`. The file is git-ignored (never commit a SHA) and must be
included in the deployed artifact. Verify after deploy: `curl <host>/api/health` -> `"sha": "<expected>"`.
