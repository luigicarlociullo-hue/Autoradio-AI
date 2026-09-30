#!/bin/sh
# Run as the LAST step before publishing, from anywhere inside the repo: overwrites the tracked
# backend/build_sha.txt with the short git SHA that GET /api/health reports when git is not
# available at runtime. Do not commit the modified file.
set -e
cd "$(git rev-parse --show-toplevel)"
git rev-parse --short HEAD > backend/build_sha.txt
echo "backend/build_sha.txt = $(cat backend/build_sha.txt)"
