#!/system/bin/sh
# Orbit Setup's changes to a TV (phone/SPEC.md, "Orbit Setup"). The TV's own shell runs this, sent by the Orbit phone
# app over the TV's debugging connection; a computer can run it the same way through tools/tv.py.
#
#   sh /data/local/tmp/orbit/orbit-setup.sh install       switch off the chosen apps, install Orbit Home and Orbit Live
#                                                         TV, make Orbit Home the home screen, turn its helper on, and
#                                                         hand over the name and the phone's token
#   sh /data/local/tmp/orbit/orbit-setup.sh name          hand over a new name.txt and restart Home so the greeting
#                                                         shows it
#   sh /data/local/tmp/orbit/orbit-setup.sh switch stock  the TV's own home screen is Home again; Orbit Home, its helper
#                                                         and everything else stay
#   sh /data/local/tmp/orbit/orbit-setup.sh switch orbit  Orbit Home is Home again, and the stock home screen goes off
#
# It reads plan.txt, disable.txt, name.txt, token.txt, phone.txt and the two APKs from /data/local/tmp/orbit. Lines
# starting "@orbit" are for the phone; the rest is log. Every change goes into undo.txt (and out as "@orbit undo"),
# which orbit-undo.sh reads to put it all back. It never uninstalls a factory app (only an earlier build of Orbit's own
# two apps, once the new one is in its place), never switches off a core package or one of Orbit's own apps, and gives
# Home back to the stock launcher when the home step fails.
#
# Written for Android's mksh and toybox: no bash, and every pm, cmd and am reads /dev/null, never the list a loop reads.

D=${ORBIT_DIR:-/data/local/tmp/orbit}
PKG=dev.shiv.orbit.home
LIVE=dev.shiv.orbit.live
# The Java package Orbit Home's classes keep from their first version. It is not the app's id, so every component is written
# in full: $PKG/.HomeKeyService would name dev.shiv.orbit.home.HomeKeyService, which does not exist.
CLS=com.gathin.tvhome
# Orbit's two apps before 11 Nov, under their first ids. Install puts the new ones in their place
# (phone/SPEC.md, "From the earlier ids"). OLD_RE is OLD_PKG as a sed pattern.
OLD_PKG=com.gathin.tvhome
OLD_LIVE=com.gathin.livetv
OLD_RE='com\.gathin\.tvhome'
FILES=${ORBIT_FILES:-/sdcard/Android/data/$PKG/files}
OLD_FILES=${ORBIT_OLD_FILES:-/sdcard/Android/data/$OLD_PKG/files}
URI=content://$PKG.theme
OLD_URI=content://$OLD_PKG.theme
UNDO=$D/undo.txt
HOME_ACT=$PKG/$CLS.MainActivity
HELPER=$PKG/$CLS.HomeKeyService
LISTENER=$PKG/$CLS.GuardRevival
DREAM=$PKG/$CLS.ClockDream
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
# The record's lines of one kind ("home", "enable"), without the kind.
recorded() { sed -n "s/^$1 //p" "$UNDO" 2>/dev/null | tr -d '\r'; }

is_core() { echo "$1" | grep -Eq "$CORE_RE" && ! echo "$1" | grep -Eq "$CORE_OK"; }
# Orbit's own apps, under either id.
is_orbit() { case "$1" in "$PKG"|"$LIVE"|"$OLD_PKG"|"$OLD_LIVE") return 0 ;; esac; return 1; }

# A setting's value with an earlier Orbit Home's components written as the new app's, which takes its place.
renamed() { echo "$1" | sed -e "s#$OLD_RE/\.#$PKG/$CLS.#g" -e "s#$OLD_RE/$OLD_RE\.#$PKG/$CLS.#g"; }
# A colon list (the accessibility services) without the entries of the packages named after it.
without() {
  w=$1; shift
  for wp; do w=$(echo "$w" | tr ':' '\n' | grep -v "^$wp/" | tr '\n' ':'); done
  echo "$w" | sed 's/::*/:/g; s/^://; s/:$//'
}

switch_off() {
  case "$1" in ''|*[!A-Za-z0-9_.]*) echo "skip $1: not a package name"; return 0 ;; esac
  if is_core "$1"; then echo "skip $1: a core package"; return 0; fi
  if is_orbit "$1"; then echo "skip $1: one of Orbit's own apps"; return 0; fi
  has "$1" || { echo "skip $1: not on this TV"; return 0; }
  is_off "$1" && { echo "skip $1: already off"; return 0; }
  out=$(pm disable-user --user 0 "$1" </dev/null 2>&1 | tr -d '\r')
  case "$out" in
    *"new state: disabled-user"*) remember "enable $1"; echo "off $1" ;;
    *) echo "could not switch off $1: $out"; return 1 ;;
  esac
}

# Installs an APK over the same app or new. A new app goes on the undo record, so Undo can take it away again. One
# that takes the place of an earlier Orbit build ($3) counts as there before, unless setup had installed that one.
install_apk() {
  [ -s "$1" ] || { echo "missing $1"; return 1; }
  had=0; has "$2" && had=1
  if [ $had = 0 ] && [ -n "$3" ] && has "$3" && ! grep -qxF "uninstall $3" "$UNDO" 2>/dev/null; then had=1; fi
  out=$(pm install -r -g "$1" </dev/null 2>&1 | tr -d '\r')
  case "$out" in
    *Success*) [ $had = 0 ] && remember "uninstall $2"; return 0 ;;
    *) echo "pm install $2: $out"; return 1 ;;
  esac
}

# Gives a file to Orbit Home, at $2 under its theme folder (config.json, setup/name.txt): in through its own provider
# first, so the file belongs to Orbit Home. A file the shell makes in Android/data is the shell's, and Orbit Home
# cannot open it (tools/theme.sh found this). cp is the fallback, for firmware without the provider.
give() {
  rm -f "$FILES/$2" 2>/dev/null
  out=$(content write --uri "$URI/$2" < "$1" 2>&1)
  rc=$?
  case "$rc:$out" in
    0:*'Unsupported operation'*|0:*'Error while accessing provider'*|[1-9]*) ;;
    *) echo "handed over ${2##*/}"; return 0 ;;
  esac
  case "$2" in */*) mkdir -p "$FILES/${2%/*}" 2>/dev/null ;; *) mkdir -p "$FILES" 2>/dev/null ;; esac
  cat "$1" > "$FILES/$2" 2>/dev/null && { echo "copied ${2##*/}"; return 0; }
  echo "could not hand over ${2##*/}"; return 1
}

handover() { [ -f "$D/$1" ] || return 0; give "$D/$1" "setup/$1"; }

# One file out of a theme provider into $2. False when the provider, the file or `content read` is missing: content
# says so on stderr, or prints its usage when it does not know the word.
read_out() {
  err=$(content read --uri "$1" </dev/null 2>&1 >"$2")
  [ -z "$err" ] && [ -s "$2" ] && ! head -n 1 "$2" | grep -q '^usage:' && return 0
  rm -f "$2"; return 1
}

# The look of an earlier Orbit Home goes into the new one before the earlier app is removed, which takes its files
# with it. Through the earlier app's own provider first (some firmware locks the shell out of Android/data), else its
# file. A look the new app already has (tools/theme.sh) stays.
carry_look() {
  look=$D/look.json
  if read_out "$URI/config.json" "$look" || [ -s "$FILES/config.json" ]; then
    rm -f "$look"; echo "kept the look Orbit Home already has"; return 0
  fi
  read_out "$OLD_URI/config.json" "$look" || cat "$OLD_FILES/config.json" > "$look" 2>/dev/null
  if [ ! -s "$look" ]; then rm -f "$look"; echo "no look to carry over from $OLD_PKG"; return 0; fi
  if give "$look" config.json >/dev/null; then echo "carried over the look of $OLD_PKG"; else echo "could not carry over the look of $OLD_PKG"; fi
  rm -f "$look"
}

# An earlier build of one of Orbit's own apps ($1) goes once the new one ($2) is in its place. The record notes it for
# the phone; undo never puts it back.
retire() {
  has "$1" || return 0
  out=$(pm uninstall "$1" </dev/null 2>&1 | tr -d '\r')
  case "$out" in
    *Success*) remember "replaced $1 $2"; echo "removed $1"; return 0 ;;
    *) echo "could not remove $1: $out"; return 1 ;;
  esac
}

# Turns the helper on, keeping every other accessibility service. A service that was refused while its APK was
# replaced binds again only once the list changes, so the list is cleared and written back (as build-and-install does).
# An earlier Orbit Home's helper comes off the list: the new one takes its place.
helper_on() {
  cmd appops set $PKG AUTO_START allow </dev/null >/dev/null 2>&1
  cmd appops set $PKG APP_AUTO_START allow </dev/null >/dev/null 2>&1
  appops write-settings </dev/null >/dev/null 2>&1
  rest=$(without "$(setting secure enabled_accessibility_services)" $PKG $OLD_PKG)
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

# Back to the TV's own home screen, for a home step that failed half way. A TV whose Home was an earlier Orbit Home
# (still installed at that point) and that has no stock one on the record gets that one back.
give_back_home() {
  for p in $(recorded enable | grep -E "$LATE_RE"); do
    pm enable --user 0 "$p" </dev/null >/dev/null 2>&1
  done
  c=$(recorded home | head -n 1)
  [ -n "$c" ] || c=$was_home
  [ -n "$c" ] && cmd package set-home-activity --user 0 "$c" </dev/null >/dev/null 2>&1
  am start -a android.intent.action.MAIN -c android.intent.category.HOME </dev/null >/dev/null 2>&1
}

# Orbit Home started on its own, before the stock home screen is touched, as launcher/build-and-install.sh does:
# "Status: ok" means the activity really came up.
start_orbit_home() {
  out=$(am start -W -a android.intent.action.MAIN -c android.intent.category.HOME -n $HOME_ACT </dev/null 2>&1 | tr -d '\r')
  case "$out" in *"Status: ok"*) ;; *) return 1 ;; esac
  case "$out" in *Error*) return 1 ;; esac
  return 0
}

grants() {
  for perm in android.permission.WRITE_SECURE_SETTINGS android.permission.BLUETOOTH_CONNECT \
      android.permission.READ_TV_LISTINGS android.permission.ACCESS_FINE_LOCATION; do
    if pm grant $PKG $perm </dev/null >/dev/null 2>&1; then echo "granted $perm"; else echo "not granted $perm"; fi
  done
  cmd notification allow_listener $LISTENER </dev/null >/dev/null 2>&1 && echo "notification listener on"
  settings put secure screensaver_components $DREAM </dev/null
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

  # How the TV is before anything changes. Orbit's own home, under either id, is never the TV's own one. The helper
  # list and the screensaver are read here, before an earlier Orbit Home goes and takes its entries with it, and its
  # entries are written as the new app's, which takes its place.
  step record start
  now=$(home_now)
  case "$now" in
    ''|$PKG/*|$OLD_PKG/*) ;;
    *) grep -q '^home ' "$UNDO" || remember "home $now" ;;
  esac
  was_home=
  case "$now" in $OLD_PKG/*) was_home=$now ;; esac
  if [ "$home" = 1 ]; then
    grep -q '^a11y ' "$UNDO" || remember "a11y $(renamed "$(setting secure enabled_accessibility_services)")"
    grep -q '^a11y_on ' "$UNDO" || remember "a11y_on $(setting secure accessibility_enabled)"
    grep -q '^setting secure screensaver_components ' "$UNDO" ||
      remember "setting secure screensaver_components $(renamed "$(setting secure screensaver_components)")"
  fi
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
    install_apk "$D/orbit-home.apk" $PKG $OLD_PKG || { step home fail "Orbit Home did not install"; stop_fail "Orbit Home did not install; the TV keeps its own home screen"; }
    say progress 50
    am force-stop $PKG </dev/null
    start_orbit_home || { step home fail "Orbit Home did not start"; stop_fail "Orbit Home did not start; the TV keeps its own home screen"; }
    for p in $(names "$D/disable.txt" | grep -E "$LATE_RE"); do switch_off "$p"; done
    cmd package set-home-activity --user 0 $HOME_ACT </dev/null >/dev/null 2>&1
    case "$(home_now)" in
      $PKG/*) ;;
      *) give_back_home; step home fail "Android kept its own home screen"; stop_fail "Android kept its own home screen, so the TV was put back the way it was" ;;
    esac
    # Now that the new Orbit Home is Home, an earlier one hands over its look and goes. Its helper would otherwise
    # still hold the remote's keys and the phone's door.
    has $OLD_PKG && carry_look
    if retire $OLD_PKG $PKG; then step home ok; else step home ok "The earlier Orbit Home could not be removed"; fi
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
    if ! install_apk "$D/orbit-live.apk" $LIVE $OLD_LIVE; then step live fail "Orbit Live TV did not install"
    elif retire $OLD_LIVE $LIVE; then step live ok
    else step live ok "The earlier Live TV could not be removed"; fi
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

# The TV's own home screen, the one the record names, is Home again: the stock home packages setup switched off come
# back on first. Orbit Home stays installed, and its helper and everything else stay as they are.
switch_stock() {
  step switch start
  c=$(recorded home | head -n 1)
  if [ -z "$c" ]; then
    step switch fail "There is no record of the TV's own home screen"
    stop_fail "There is no record of the TV's own home screen, so Orbit Home stays Home"
  fi
  for p in $(recorded enable | grep -E "$LATE_RE"); do
    pm enable --user 0 "$p" </dev/null >/dev/null 2>&1 && echo "on $p"
  done
  cmd package set-home-activity --user 0 "$c" </dev/null >/dev/null 2>&1
  am start -a android.intent.action.MAIN -c android.intent.category.HOME </dev/null >/dev/null 2>&1
  case "$(home_now)" in
    "${c%%/*}"/*) step switch ok; say done ok ;;
    *) step switch fail "Android kept Orbit Home"; stop_fail "Android kept Orbit Home as the home screen" ;;
  esac
}

# Orbit Home is Home again, in install's order: it starts first, then the stock home packages the record names go off
# (recorded as before), then it is made Home, and Android is asked what Home is now.
switch_orbit() {
  step switch start
  has $PKG || { step switch fail "Orbit Home is not on this TV"; stop_fail "Orbit Home is not on this TV"; }
  start_orbit_home || { step switch fail "Orbit Home did not start"; stop_fail "Orbit Home did not start; the TV keeps its own home screen"; }
  for p in $(recorded enable | grep -E "$LATE_RE"); do switch_off "$p"; done
  cmd package set-home-activity --user 0 $HOME_ACT </dev/null >/dev/null 2>&1
  case "$(home_now)" in
    $PKG/*) step switch ok; say done ok ;;
    *) give_back_home; step switch fail "Android kept its own home screen"; stop_fail "Android kept its own home screen, so the TV was put back the way it was" ;;
  esac
}

case "$1" in
  install) cmd_install ;;
  name) cmd_name ;;
  switch)
    case "$2" in
      stock) switch_stock ;;
      orbit) switch_orbit ;;
      *) echo "usage: sh $0 switch stock|orbit" >&2; exit 2 ;;
    esac ;;
  *) echo "usage: sh $0 install|name|switch stock|switch orbit" >&2; exit 2 ;;
esac
