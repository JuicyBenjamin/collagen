#!/bin/bash
# The in-app updater, end to end, against a fake registry: the current build is
# installed globally into a temp prefix; a local registry serves the same build
# as 9.9.9-alpha (and proxies everything else to npm); the TUI notices, `u`
# installs it (npm is pointed at the registry and the prefix via npm_config_*),
# the app exits with the RESTART code and the bin shim brings the new version up
# in the same pty. Needs network (dependencies come from the real registry).
source "$(dirname "$0")/lib.sh"
kill_all; fresh_logs; prep_profiles
PREFIX="$OUT/prefix"; REG=48731; NEXT=9.9.9-alpha
rm -rf "$PREFIX" "$OUT"/collagen-cli-*.tgz "$OUT/update-next.tgz"; mkdir -p "$PREFIX"

echo "## pack the current build, and the same build as $NEXT"
pnpm build > /dev/null 2>&1 && pnpm pack --pack-destination "$OUT" > /dev/null 2>&1
CUR=$(ls "$OUT"/collagen-cli-*.tgz | head -1); echo "  current: $(basename "$CUR")"
python3 - "$CUR" "$OUT/update-next.tgz" "$NEXT" <<'PY'
import io, json, sys, tarfile
src, dst, nxt = sys.argv[1], sys.argv[2], sys.argv[3]
with tarfile.open(src) as t:
    cur = json.load(t.extractfile("package/package.json"))["version"]
with tarfile.open(src) as t, tarfile.open(dst, "w:gz") as o:
    for m in t.getmembers():
        f = t.extractfile(m)
        if f is None:
            o.addfile(m); continue
        b = f.read()
        if m.name == "package/package.json":
            d = json.loads(b); d["version"] = nxt; b = json.dumps(d, indent=2).encode()
        elif m.name.endswith("dist/index.js") or m.name.endswith("dist/headless.js"):
            b = b.replace(json.dumps(cur).encode(), json.dumps(nxt).encode())  # the baked-in VERSION
        m.size = len(b); o.addfile(m, io.BytesIO(b))
print(f"  next: {dst} ({cur} → {nxt})")
PY

echo "## fake registry on :$REG, current build installed into $PREFIX"
python3 "$E2E/fake-registry.py" $REG $NEXT "$OUT/update-next.tgz" & REGPID=$!
sleep 1
expect "the fake registry serves $NEXT as latest" "$(curl -s "http://127.0.0.1:$REG/@collagen%2Fcli/latest")" "\"version\": \"$NEXT\""
npm install -g --prefix "$PREFIX" "$CUR" --silent --no-audit --no-fund --prefer-offline 2>&1 | grep -v "npm warn" | tail -2
expect "installed the current version globally" "$(node -e "console.log(require('$PREFIX/lib/node_modules/@collagen/cli/package.json').version)")" "^0\."

echo "## TUI: wait for the update notice, press u, watch the relaunch"
PTY="$OUT/update.out"; MARKS="$OUT/update.marks"; rm -f "$PTY" "$MARKS" "$OUT/update.log" "$OUT/update.log.keys"
mark() { echo "$1 $(wc -c < "$PTY")" >> "$MARKS"; }
( until grep -q "update available" "$OUT/update.log" 2>/dev/null; do sleep 1; done; sleep 2; mark M0_notice; printf 'u'
  until grep -q "update installed" "$OUT/update.log" 2>/dev/null; do sleep 1; done; sleep 12; mark M1_relaunched; sleep 1; printf 'q' ) | \
  COLLAGEN_REGISTRY="http://127.0.0.1:$REG" npm_config_registry="http://127.0.0.1:$REG" npm_config_prefix="$PREFIX" \
  HOME="$SHOME" npm_config_cache="$HOME/.npm" COLLAGEN_LOG="$OUT/update.log" script -F -q "$PTY" bash -c "stty rows 40 cols 120; '$PREFIX/bin/collagen' --profile $(profile alice); echo EXIT=\$?" > /dev/null 2>&1 &
for i in $(seq 1 150); do grep -q M1_relaunched "$MARKS" 2>/dev/null && break; sleep 2; done
for i in $(seq 1 10); do grep -q "EXIT=" "$PTY" 2>/dev/null && break; sleep 1; done
kill $REGPID 2>/dev/null; pkill -9 -f "prefix/bin/collagen|dist/index.js --profile $(profile alice)|script -F -q $PTY" 2>/dev/null

LOG=$(cat "$OUT/update.log" 2>/dev/null)
expect "the app noticed the newer version" "$LOG" "update available: collagen $NEXT"
expect "u ran the installer" "$LOG" "update: npm install -g @collagen/cli@$NEXT"
expect "the install succeeded" "$LOG" "update installed: collagen $NEXT"
expect "the new version is what's installed now" "$(node -e "console.log(require('$PREFIX/lib/node_modules/@collagen/cli/package.json').version)")" "^$NEXT$"
expect "the shim relaunched the app (a second start in the same log)" "$(grep -c 'room open: dev room' "$OUT/update.log")" "^2$"
expect "q quit the relaunched app and the shim exited 0" "$(tr -d '\r' < "$PTY" | grep -o 'EXIT=[0-9]*' | tail -1)" "^EXIT=0$"
if python3 -c "import pyte" 2>/dev/null || [ -n "${PYTE_PATH:-}" ]; then
  SCREEN=$(python3 "$E2E/render.py" "$PTY" "$MARKS" 40 120 M1_relaunched)
  expect "the relaunched TUI reports $NEXT" "$SCREEN" "collagen $NEXT"
fi
summary
