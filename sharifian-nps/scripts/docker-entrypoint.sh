#!/bin/sh
# Container start (D90). As root: make sure the data folder belongs to the unprivileged "node" user, then run
# the app as that user. If the platform's disk refuses the change of owner, keep running as root rather than
# fail to start on campaign day. Started by a platform as a non-root user already: just run the app.
set -e
DATA_DIR="$(dirname "${DATABASE_PATH:-/data/nps.db}")"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR" 2>/dev/null || true
  if setpriv --reuid=node --regid=node --init-groups test -w "$DATA_DIR"; then
    exec setpriv --reuid=node --regid=node --init-groups "$@"
  fi
  echo "warning: $DATA_DIR is not writable by user node; running as root" >&2
fi
exec "$@"
