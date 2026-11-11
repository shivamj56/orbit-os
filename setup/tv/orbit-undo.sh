#!/system/bin/sh
# Puts back what orbit-setup.sh changed, from its record, /data/local/tmp/orbit/undo.txt (phone/SPEC.md, "Orbit
# Setup"). The phone sends its own copy of the record first when the TV has lost it. The TV's own home screen comes
# back first, so the TV is never left without one; Orbit's own apps go last, and never the one that is still Home.
#
#   sh /data/local/tmp/orbit/orbit-undo.sh
#
# The record's lines:  enable <package>           switched off by setup: switch it on again
#                      home <component>           the home screen before setup
#                      a11y <list> / a11y_on <0|1> the accessibility settings before setup
#                      setting <secure|global> <key> <value>   a setting before setup (empty: it was not set)
#                      uninstall <package>        installed by setup: only Orbit's own apps are ever removed
#                      replaced <old> <new>       an earlier build of an Orbit app that setup removed once the new
#                                                 one was in its place: information only, never put back

D=${ORBIT_DIR:-/data/local/tmp/orbit}
UNDO=$D/undo.txt
PKG=dev.shiv.orbit.home
LIVE=dev.shiv.orbit.live
# Orbit's two apps under the ids they had before 11 Nov, from a record an earlier setup wrote.
OLD_PKG=com.gathin.tvhome
OLD_LIVE=com.gathin.livetv
LATE_RE='^(com\.google\.android\.apps\.tv\.launcherx(\.overlay)?|com\.google\.android\.tungsten\.setupwraith|com\.google\.android\.apps\.tv\.dreamx)$'

say() { echo "@orbit $*"; }
step() { say step "$@"; }
field() { sed -n "s/^$1 //p" "$UNDO" | tr -d '\r'; }
home_now() {
  cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME </dev/null 2>/dev/null |
    tr -d '\r' | tail -n 1
}

[ -s "$UNDO" ] || { say done fail "There is no record of what Orbit Setup changed on this TV"; exit 1; }

step home start
for p in $(field enable | grep -E "$LATE_RE"); do pm enable --user 0 "$p" </dev/null >/dev/null 2>&1 && echo "on $p"; done
c=$(field home | head -n 1)
if [ -n "$c" ]; then
  cmd package set-home-activity --user 0 "$c" </dev/null >/dev/null 2>&1
  am start -a android.intent.action.MAIN -c android.intent.category.HOME </dev/null >/dev/null 2>&1
fi
case "$(home_now)" in
  $PKG/*|$OLD_PKG/*) step home fail "Orbit Home is still the home screen" ;;
  *) step home ok ;;
esac
say progress 30

step enable start
n=0
for p in $(field enable); do
  case "$p" in ''|*[!A-Za-z0-9_.]*) continue ;; esac
  pm enable --user 0 "$p" </dev/null >/dev/null 2>&1 && n=$((n + 1)) && echo "on $p"
done
step enable ok "$n switched on"
say progress 60

step helper start
if grep -q '^a11y ' "$UNDO"; then
  settings put secure enabled_accessibility_services "$(field a11y | head -n 1)" </dev/null
  a=$(field a11y_on | head -n 1)
  [ -n "$a" ] && settings put secure accessibility_enabled "$a" </dev/null
fi
field setting | while read -r ns key value; do
  case "$ns" in secure|global|system) ;; *) continue ;; esac
  if [ -n "$value" ]; then settings put "$ns" "$key" "$value" </dev/null; else settings delete "$ns" "$key" </dev/null >/dev/null 2>&1; fi
done
step helper ok
say progress 75

step apps start
for p in $(field uninstall); do
  case "$p" in
    $PKG|$LIVE|$OLD_PKG|$OLD_LIVE)
      # The TV would be left with no home screen at all.
      case "$(home_now)" in "$p"/*) echo "kept $p: it is still the home screen"; continue ;; esac
      pm uninstall "$p" </dev/null >/dev/null 2>&1 && echo "removed $p" ;;
    *) echo "kept $p: only Orbit's own apps are removed" ;;
  esac
done
step apps ok
mv "$UNDO" "$D/undo-done.txt" 2>/dev/null
say progress 100
say done ok
