#!/usr/bin/env bash
#
# Dev helper: symlink this applet into Cinnamon's local applet dir and reload.
# Symlinking (not copying) means edits in the repo are picked up on next reload.
#
# Usage:  ./test.sh          # link + reload
#         ./test.sh --unlink # remove the symlink
#
set -euo pipefail

UUID="script-launcher@jamesa"
SRC="$(cd "$(dirname "$0")" && pwd)/files/${UUID}"
DEST="${HOME}/.local/share/cinnamon/applets/${UUID}"

if [[ "${1:-}" == "--unlink" ]]; then
    rm -rf "${DEST}"
    echo "Removed ${DEST}"
    exit 0
fi

mkdir -p "${HOME}/.local/share/cinnamon/applets"
rm -rf "${DEST}"
ln -s "${SRC}" "${DEST}"
echo "Linked ${DEST} -> ${SRC}"

echo "Reloading Cinnamon (X11)..."
# Start the replacement Cinnamon in its own systemd scope. A plain background
# `cinnamon --replace &` stays in this terminal's scope, so closing the
# terminal would kill the desktop shell along with it. setsid also drops the
# controlling terminal so it never gets SIGHUP.
setsid systemd-run --user --scope --quiet --collect \
    cinnamon --replace >/dev/null 2>&1 < /dev/null &
disown || true

echo
echo "Done. If this is the first install, add it via:"
echo "  right-click panel -> Applets    (or)    cinnamon-settings applets"
echo "Debug output: press Alt+F2, type 'lg', Enter -> Looking Glass."
