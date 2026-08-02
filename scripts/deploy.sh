#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

if ! EXT_BUILD="$(git rev-list --count HEAD 2>/dev/null)"; then
	echo "not a git checkout - the extension will build without a version" >&2
	EXT_BUILD=""
fi
export EXT_BUILD

echo "deploying with extension build $EXT_BUILD"
docker compose up -d --build "$@"
