#!/usr/bin/env bash
# Starts an image the way compose.yaml does and checks that it reports healthy and
# answers only for PUBLIC_URL's host. Used by CI and by the release before pushing.
#   scripts/docker-smoke.sh <image>
set -euo pipefail

image=${1:?usage: scripts/docker-smoke.sh <image>}
name=portal2-smoke

docker run -d --name "$name" --read-only -e PUBLIC_URL=https://portal.example.test \
  -p 127.0.0.1:4321:4321 "$image" > /dev/null
trap 'docker rm -f "$name" > /dev/null' EXIT

for _ in $(seq 30); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$name")" = healthy ] && break
  sleep 1
done

if ! docker inspect -f '{{.State.Health.Status}}' "$name" | grep -qx healthy; then
  docker logs "$name"
  echo "::error::The container didn't become healthy." >&2
  exit 1
fi

curl -fsS -H 'Host: portal.example.test' http://127.0.0.1:4321/api/openapi.json > /dev/null
test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4321/api/openapi.json)" = 403
echo "$image is healthy and checks the Host."
