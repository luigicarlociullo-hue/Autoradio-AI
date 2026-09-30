#!/bin/sh
# Run at publish/build time, from anywhere inside the repo: records the short git SHA
# that GET /api/health reports when git is not available at runtime.
set -e
cd "$(git rev-parse --show-toplevel)"
git rev-parse --short HEAD > backend/BUILD_SHA
echo "backend/BUILD_SHA = $(cat backend/BUILD_SHA)"
