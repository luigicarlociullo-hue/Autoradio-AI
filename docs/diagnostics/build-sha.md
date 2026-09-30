# Build SHA on /api/health

`GET /api/health` returns `sha`, resolved once at startup (`_resolve_build_sha` in `backend/server.py`):
1. `git rev-parse --short HEAD` in `backend/` (works when `.git` ships with the deploy),
2. else the contents of the tracked file `backend/build_sha.txt` (`unknown` or empty counts as no value),
3. else `"unknown"`.

The file is **tracked** (committed content: `unknown`) so that a deploy which snapshots the working tree while
ignoring git-ignored files still ships it. Production images usually have no `.git`, so as the **last step before
publishing**, run:

    scripts/write_build_sha.sh

It overwrites `backend/build_sha.txt` with `git rev-parse --short HEAD`. The file then shows as modified in the
working tree; that is expected and the deploy snapshots the working tree. **Do not commit that modification**
(`git checkout backend/build_sha.txt` restores the placeholder). Never hardcode a SHA. Verify after deploy:
`curl <host>/api/health` -> `"sha"` equals `git rev-parse --short HEAD` of the published commit.
