#!/system/bin/sh
# Orbit Setup's changes to a TV (phone/SPEC.md, "Orbit Setup"). The TV's own shell runs this, sent by the Orbit phone
# app over the TV's debugging connection; a computer can run it the same way through tools/tv.py.
#
#   sh /data/local/tmp/orbit/orbit-setup.sh install   switch off the chosen apps, install Orbit Home and Orbit Live TV,
#                                                     make Orbit Home the home screen, turn its helper on, and hand
#                                                     over the name and the phone's token
#   sh /data/local/tmp/orbit/orbit-setup.sh name      hand over a new name.txt and restart Home so the greeting shows it
#
# It reads plan.txt, disable.txt, name.txt, token.txt, phone.txt and the two APKs from /data/local/tmp/orbit. Lines
# starting "@orbit" are for the phone; the rest is log. Every change goes into undo.txt (and out as "@orbit undo"),
# which orbit-undo.sh reads to put it all back. It never uninstalls a factory app, never switches off a core package,
# and gives Home back to the stock launcher when the home step fails.
#
# Written for Android's mksh and toybox: no bash, and every pm, cmd and am reads /dev/null, never the list a loop reads.

D=${ORBIT_DIR:-/data/local/tmp/orbit}
PKG=com.gathin.tvhome
LIVE=com.gathin.livetv
FILES=${ORBIT_FILES:-/sdcard/Android/data/$PKG/files}
URI=content://$PKG.theme
UNDO=$D/undo.txt
HOME_ACT=$PKG/.MainActivity
HELPER=$PKG/.HomeKeyService
# Kept in step with tools/disable.sh (CORE_RE, CORE_OK) and phone/ui/src/setup/catalog.json.
CORE_RE='^(android|android\.ext\.(services|shared)|com\.android\.sdksandbox|com\.android\.location\.fused|com\.android\.systemui|com\.android\.shell|com\.android\.phone|com\.android\.settings|com\.android\.tv\.settings|com\.(google\.)?android\.(permissioncontroller|packageinstaller|ext\.services|ext\.shared|modulemetadata)|com\.google\.android\.overlay\.modules.*|com\.android\.providers\..*|com\.cltv\.mal|com\.mediatek\.(tis|tv\.service|tv\.agent))$'
CORE_OK='^com\.android\.providers\.(calendar|contacts|userdictionary|blockednumber)$'
# The stock home screen and what must go with it: switched off only once Orbit Home has started and is Home.
LATE_RE='^(com\.google\.android\.apps\.tv\.launcherx(\.overlay)?|com\.google\.android\.tungsten\.setupwraith|com\.google\.android\.apps\.tv\.dreamx)$'

say() { echo "@orbit $*"; }
step() { say step "$@"; }
stop_fail() { say done fail "$*"; exit 1; }
plan() { sed -n "s/^$1=//p" "$D/plan.txt" 2>/dev/null | head -n 1 | tr -d '\r '; }
has() { pm list packages "$1" </dev/null 2>/dev/null | tr -d '\r' | grep -qx "package:$1"; }
is_off() { pm list packages -d "$1" </dev/null 2>/dev/null | tr -d '\r' | grep -qx "package:$1"; }
home_now() {
  cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME </dev/null 2>/dev/null |
    tr -d '\r' | tail -n 1
}
setting() { v=$(settings get "$1" "$2" </dev/null 2>/dev/null | tr -d '\r'); [ "$v" = null ] && v=; echo "$v"; }
# One line of the undo record, written once; the phone keeps every line it is sent.
remember() { grep -qxF "$*" "$UNDO" 2>/dev/null || echo "$*" >> "$UNDO"; say undo "$*"; }
# The packages a list names, one per line: comments, blank lines and stray spaces dropped.
names() { sed 's/#.*//' "$1" 2>/dev/null | tr -d '\r\t ' | grep -v '^$'; }

is_core() { echo "$1" | grep -Eq "$CORE_RE" && ! echo "$1" | grep -Eq "$CORE_OK"; }

switch_off() {
  case "$1" in ''|*[!A-Za-z0-9_.]*) echo "skip $1: not a package name"; return 0 ;; esac
  if is_core "$1"; then echo "skip $1: a core package"; return 0; fi
  has "$1" || { echo "skip $1: not on this TV"; return 0; }
  is_off "$1" && { echo "skip $1: already off"; return 0; }
  out=$(pm disable-user --user 0 "$1" </dev/null 2>&1 | tr -d '\r')
  case "$out" in
    *"new state: disabled-user"*) remember "enable $1"; echo "off $1" ;;
    *) echo "could not switch off $1: $out"; return 1 ;;
  esac
}

# Installs an APK over the same app or new; a new app goes on the undo record, so Undo can take it away again.
install_apk() {
  [ -s "$1" ] || { echo "missing $1"; return 1; }
  had=0; has "$2" && had=1
  out=$(pm install -r -g "$1" </dev/null 2>&1 | tr -d '\r')
  case "$out" in
    *Success*) [ $had = 0 ] && remember "uninstall $2"; return 0 ;;
    *) echo "pm install $2: $out"; return 1 ;;
  esac
}

# Hand-over files go in through Orbit Home's own provider first, so the files belong to Orbit Home: a file the shell
# makes in Android/data is the shell's, and Orbit Home cannot open it (tools/theme.sh found this). cp is the fallback.
handover() {
  [ -f "$D/$1" ] || return 0
  rm -f "$FILES/setup/$1" 2>/dev/null
  out=$(content write --uri "$URI/setup/$1" < "$D/$1" 2>&1)
  rc=$?
  case "$rc:$out" in
    0:*'Unsupported operation'*|0:*'Error while accessing provider'*|[1-9]*) ;;
    *) echo "handed over $1"; return 0 ;;
  esac
  mkdir -p "$FILES/setup" 2>/dev/null && cat "$D/$1" > "$FILES/setup/$1" 2>/dev/null && { echo "copied $1"; return 0; }
  echo "could not hand over $1"; return 1
}

# Turns the helper on, keeping every other accessibility service. A service that was refused while its APK was
# replaced binds again only once the list changes, so the list is cleared and written back (as build-and-install does).
helper_on() {
  cmd appops set $PKG AUTO_START allow </dev/null >/dev/null 2>&1
  cmd appops set $PKG APP_AUTO_START allow </dev/null >/dev/null 2>&1
  appops write-settings </dev/null >/dev/null 2>&1
  s=$(setting secure enabled_accessibility_services)
  grep -q '^a11y ' "$UNDO" 2>/dev/null || remember "a11y $s"
  grep -q '^a11y_on ' "$UNDO" 2>/dev/null || remember "a11y_on $(setting secure accessibility_enabled)"
  rest=$(echo "$s" | tr ':' '\n' | grep -v "^$PKG/" | tr '\n' ':' | sed 's/:*$//; s/^:*//')
  settings put secure enabled_accessibility_services "" </dev/null
  settings put secure accessibility_enabled 0 </dev/null
  sleep 1
  settings put secure enabled_accessibility_services "${rest:+$rest:}$HELPER" </dev/null
  settings put secure accessibility_enabled 1 </dev/null
  case "$(setting secure enabled_accessibility_services)" in *"$HELPER"*) return 0 ;; *) return 1 ;; esac
}

# A force stop takes the helper off Android's bound services; it binds again only when the list changes.
restart_home() {
  s=$(setting secure enabled_accessibility_services)
  a=$(setting secure accessibility_enabled)
  am force-stop $PKG </dev/null
  am start -W -a android.intent.action.MAIN -c android.intent.category.HOME -n $HOME_ACT </dev/null >/dev/null 2>&1
  case "$s" in *"$PKG/"*)
    settings put secure enabled_accessibility_services "" </dev/null
    settings put secure accessibility_enabled 0 </dev/null
    sleep 2
    settings put secure enabled_accessibility_services "$s" </dev/null
    settings put secure accessibility_enabled "${a:-1}" </dev/null ;;
  esac
}

# Back to the TV's own home screen, for a home step that failed half way.
give_back_home() {
  for p in $(sed -n 's/^enable //p' "$UNDO" 2>/dev/null | grep -E "$LATE_RE"); do
    pm enable --user 0 "$p" </dev/null >/dev/null 2>&1
  done
  c=$(sed -n 's/^home //p' "$UNDO" 2>/dev/null | head -n 1)
  [ -n "$c" ] && cmd package set-home-activity --user 0 "$c" </dev/null >/dev/null 2>&1
  am start -a android.intent.action.MAIN -c android.intent.category.HOME </dev/null >/dev/null 2>&1
}

grants() {
  for perm in android.permission.WRITE_SECURE_SETTINGS android.permission.BLUETOOTH_CONNECT \
      android.permission.READ_TV_LISTINGS android.permission.ACCESS_FINE_LOCATION; do
    if pm grant $PKG $perm </dev/null >/dev/null 2>&1; then echo "granted $perm"; else echo "not granted $perm"; fi
  done
  cmd notification allow_listener $PKG/.GuardRevival </dev/null >/dev/null 2>&1 && echo "notification listener on"
  grep -q '^setting secure screensaver_components ' "$UNDO" 2>/dev/null ||
    remember "setting secure screensaver_components $(setting secure screensaver_components)"
  settings put secure screensaver_components $PKG/.ClockDream </dev/null
}

cmd_install() {
  [ -f "$D/plan.txt" ] || stop_fail "plan.txt is missing"
  touch "$UNDO" || stop_fail "Orbit cannot write to $D"
  # A second run on the same TV keeps the first run's record: it is the one that knows how the TV was.
  while IFS= read -r line; do [ -n "$line" ] && say undo "$line"; done < "$UNDO"
  home=$(plan home); live=$(plan live)

  step check start
  sdk=$(getprop ro.build.version.sdk | tr -dc '0-9')
  if [ "${sdk:-0}" -lt 26 ]; then step check fail "Android 8 or later is needed"; stop_fail "This TV's Android is too old for Orbit OS"; fi
  if [ "$home" = 1 ] && [ ! -s "$D/orbit-home.apk" ]; then step check fail "Orbit Home is missing"; stop_fail "Orbit Home was not sent to the TV"; fi
  if [ "$live" = 1 ] && [ ! -s "$D/orbit-live.apk" ]; then step check fail "Orbit Live TV is missing"; stop_fail "Orbit Live TV was not sent to the TV"; fi
  step check ok
  say progress 5

  step record start
  now=$(home_now)
  case "$now" in
    ''|$PKG/*) ;;
    *) grep -q '^home ' "$UNDO" || remember "home $now" ;;
  esac
  step record ok
  say progress 8

  step disable start
  total=$(names "$D/disable.txt" | grep -c .)
  n=0; off=0; failed=0
  for p in $(names "$D/disable.txt"); do
    n=$((n + 1))
    say progress $((8 + 30 * n / (total > 0 ? total : 1)))
    if echo "$p" | grep -Eq "$LATE_RE"; then
      [ "$home" = 1 ] && echo "later $p" || echo "skip $p: the TV keeps its own home screen without Orbit Home"
      continue
    fi
    if switch_off "$p"; then off=$((off + 1)); else failed=$((failed + 1)); fi
  done
  if [ $failed -gt 0 ]; then step disable ok "$failed could not be switched off"; else step disable ok; fi
  say progress 40

  if [ "$home" = 1 ]; then
    step home start
    install_apk "$D/orbit-home.apk" $PKG || { step home fail "Orbit Home did not install"; stop_fail "Orbit Home did not install; the TV keeps its own home screen"; }
    say progress 50
    # Started on its own before the stock home screen is touched, as launcher/build-and-install.sh does: "Status: ok"
    # means the activity really came up.
    am force-stop $PKG </dev/null
    out=$(am start -W -a android.intent.action.MAIN -c android.intent.category.HOME -n $HOME_ACT </dev/null 2>&1 | tr -d '\r')
    case "$out" in *"Status: ok"*) ;; *) step home fail "Orbit Home did not start"; stop_fail "Orbit Home did not start; the TV keeps its own home screen" ;; esac
    case "$out" in *Error*) step home fail "Orbit Home did not start"; stop_fail "Orbit Home did not start; the TV keeps its own home screen" ;; esac
    for p in $(names "$D/disable.txt" | grep -E "$LATE_RE"); do switch_off "$p"; done
    cmd package set-home-activity --user 0 $HOME_ACT </dev/null >/dev/null 2>&1
    case "$(home_now)" in
      $PKG/*) ;;
      *) give_back_home; step home fail "Android kept its own home screen"; stop_fail "Android kept its own home screen, so the TV was put back the way it was" ;;
    esac
    step home ok
    say progress 60

    step helper start
    if helper_on; then step helper ok; else step helper fail "The remote helper did not turn on"; fi
    say progress 66

    step grants start
    grants
    # Opening Home quickly from the first press: Android compiles it in the background otherwise.
    cmd package compile -m speed -f $PKG </dev/null >/dev/null 2>&1
    step grants ok
    say progress 78
  else
    step home skip; step helper skip; step grants skip
  fi

  if [ "$live" = 1 ]; then
    step live start
    if install_apk "$D/orbit-live.apk" $LIVE; then step live ok; else step live fail "Orbit Live TV did not install"; fi
  else
    step live skip
  fi
  say progress 88

  if [ "$home" = 1 ]; then
    step name start
    if [ -s "$D/name.txt" ]; then handover name.txt >/dev/null; step name ok; else step name skip; fi
    step pair start
    if [ -s "$D/token.txt" ] && handover token.txt; then handover phone.txt >/dev/null; step pair ok; else step pair fail "The phone could not be paired"; fi
    restart_home
  else
    step name skip; step pair skip
  fi
  # The token is a key to the TV's door, and the APKs are large: neither stays behind.
  rm -f "$D/token.txt" "$D/orbit-home.apk" "$D/orbit-live.apk"
  say progress 100
  say done ok
}

cmd_name() {
  has $PKG || stop_fail "Orbit Home is not on this TV"
  handover name.txt || stop_fail "The name could not be handed over"
  restart_home
  say done ok
}

case "$1" in
  install) cmd_install ;;
  name) cmd_name ;;
  *) echo "usage: sh $0 install|name" >&2; exit 2 ;;
esac
