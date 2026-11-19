"""setup/tv/orbit-setup.sh and orbit-undo.sh against a pretend TV.

The pretend TV is a folder of small sh programs named after the TV's own commands (pm, cmd, am, settings, content,
getprop, appops, sleep), which keep their state in files. The scripts run under the Mac's sh with those first on
PATH, so every test reads what a real run would leave behind: what is switched off, what is Home, the helper list and
the undo record.

Orbit Home is dev.shiv.orbit.home and Orbit Live TV dev.shiv.orbit.live; their classes keep the Java packages
com.gathin.tvhome and com.gathin.livetv, which were also the apps' ids before 11 Nov. A TV can still have those.
"""

import os
import re
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SETUP = ROOT / "setup" / "tv" / "orbit-setup.sh"
UNDO = ROOT / "setup" / "tv" / "orbit-undo.sh"
STOCK = "com.google.android.apps.tv.launcherx"
STOCK_HOME = STOCK + "/.MainActivity"
HOME_PKG = "dev.shiv.orbit.home"
LIVE_PKG = "dev.shiv.orbit.live"
CLS = "com.gathin.tvhome"
ORBIT_HOME = f"{HOME_PKG}/{CLS}.MainActivity"
HELPER = f"{HOME_PKG}/{CLS}.HomeKeyService"
LISTENER = f"{HOME_PKG}/{CLS}.GuardRevival"
DREAM = f"{HOME_PKG}/{CLS}.ClockDream"
OLD_HOME_PKG = "com.gathin.tvhome"
OLD_LIVE_PKG = "com.gathin.livetv"
OLD_HOME = OLD_HOME_PKG + "/.MainActivity"
OLD_LOOK = '{"greeting_name": "Asha", "dock_glass": true}\n'
# Orbit Home's extras (TrialMode.java), and what `resolve-activity` says while Android asks which home screen to use.
TRIAL_SECONDS = "dev.shiv.orbit.home.extra.TRIAL_SECONDS"
TRIAL_ID = "dev.shiv.orbit.home.extra.TRIAL_ID"
SET_UP = "dev.shiv.orbit.home.extra.SET_UP"
CHOOSER = "android/com.android.internal.app.ResolverActivity"

FAKES = {
    "pm": r'''#!/bin/sh
S=$TV_STATE
echo "$*" >> "$S/pm-log"
echo "pm $*" >> "$S/calls"
case "$1" in
  list)
    shift; [ "$1" = packages ] && shift
    mode=all; [ "$1" = -e ] && { mode=e; shift; }; [ "$1" = -d ] && { mode=d; shift; }
    f=$1
    for p in $(cat "$S/installed"); do
      if [ -n "$f" ] && ! echo "$p" | grep -qF "$f"; then continue; fi
      off=0; grep -qx "$p" "$S/disabled" && off=1
      [ $mode = e ] && [ $off = 1 ] && continue
      [ $mode = d ] && [ $off = 0 ] && continue
      echo "package:$p"
    done ;;
  disable-user)
    p=$4; grep -qx "$p" "$S/installed" || { echo "Unknown package: $p"; exit 1; }
    grep -qx "$p" "$S/refuse" 2>/dev/null && { echo "Error: refused"; exit 1; }
    grep -qx "$p" "$S/disabled" || echo "$p" >> "$S/disabled"
    echo "Package $p new state: disabled-user" ;;
  enable)
    p=$4; grep -vx "$p" "$S/disabled" > "$S/d.tmp"; mv "$S/d.tmp" "$S/disabled"
    echo "Package $p new state: enabled" ;;
  install)
    for f; do :; done; case "$f" in *orbit-home.apk) p=dev.shiv.orbit.home ;; *orbit-live.apk) p=dev.shiv.orbit.live ;; esac
    [ -f "$S/fail-install" ] && { echo "Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]"; exit 1; }
    grep -qx "$p" "$S/installed" || echo "$p" >> "$S/installed"
    # A TV whose Home was an "always" choice asks again once a second home app arrives (Android 9 and earlier).
    if [ "$p" = dev.shiv.orbit.home ] && [ -f "$S/chooser-on-install" ] && ! grep -q '^android/' "$S/home"; then
      cp "$S/home" "$S/home-before"; echo android/com.android.internal.app.ResolverActivity > "$S/home"
    fi
    echo "Success" ;;
  uninstall)
    grep -qx "$2" "$S/installed" || { echo "Failure [DELETE_FAILED_INTERNAL_ERROR]"; exit 1; }
    grep -qx "$2" "$S/refuse-uninstall" 2>/dev/null && { echo "Failure [DELETE_FAILED_USER_RESTRICTED]"; exit 1; }
    grep -vx "$2" "$S/installed" > "$S/i.tmp"; mv "$S/i.tmp" "$S/installed"
    # Android takes the app's own files in Android/data with it.
    case "$2" in dev.shiv.orbit.home) rm -rf "$S/provider" ;; com.gathin.tvhome) rm -rf "$S/old-provider" ;; esac
    # With the second home app gone, the question goes too.
    if [ "$2" = dev.shiv.orbit.home ] && grep -q '^android/' "$S/home" && [ -f "$S/home-before" ]; then mv "$S/home-before" "$S/home"; fi
    echo "Success" ;;
  grant) echo "$2 $3" >> "$S/grants" ;;
esac
''',
    "cmd": r'''#!/bin/sh
S=$TV_STATE
echo "cmd $*" >> "$S/calls"
case "$1 $2" in
  "package resolve-activity")
    h=$(cat "$S/home" 2>/dev/null)
    hp=${h%%/*}
    # android/…ResolverActivity: Android asks which home screen to use.
    if [ -z "$h" ] || { [ "$hp" != android ] && { grep -qx "$hp" "$S/disabled" || ! grep -qx "$hp" "$S/installed"; }; }; then
      if grep -qx com.google.android.apps.tv.launcherx "$S/installed" && ! grep -qx com.google.android.apps.tv.launcherx "$S/disabled"; then
        h=com.google.android.apps.tv.launcherx/.MainActivity
      else h=com.android.tv.settings/.FallbackHome; fi
    fi
    echo "priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true"
    echo "$h" ;;
  "package set-home-activity")
    [ -f "$S/sticky-home" ] && { echo "Success: (ignored)"; exit 0; }
    echo "$5" > "$S/home"; rm -f "$S/home-before"; echo "Success: Activity $5 is now the home" ;;
  "package compile") echo Success ;;
  "notification allow_listener") echo "$3" > "$S/listener" ;;
esac
''',
    "am": r'''#!/bin/sh
S=$TV_STATE
echo "am $*" >> "$S/calls"
case "$1" in
  force-stop) echo "$2" >> "$S/stopped" ;;
  start)
    case "$*" in *-W*)
      [ -f "$S/fail-start" ] && { echo "Error: Activity not started"; exit 0; }
      echo "Starting: Intent { }"; echo "Status: ok" ;;
    esac ;;
esac
''',
    "settings": r'''#!/bin/sh
S=$TV_STATE
k="$S/setting-$2-$3"
case "$1" in
  get) [ -f "$k" ] && cat "$k" || echo null ;;
  put) printf '%s\n' "$4" > "$k" ;;
  delete) rm -f "$k" ;;
esac
''',
    "content": r'''#!/bin/sh
S=$TV_STATE
op=$1; uri=$3
echo "$op $uri" >> "$S/content-log"
auth=${uri#content://}; auth=${auth%%/*}; path=${uri#content://$auth/}
case "$auth" in
  dev.shiv.orbit.home.theme) pkg=dev.shiv.orbit.home; dir=$S/provider; off=$S/no-provider ;;
  com.gathin.tvhome.theme) pkg=com.gathin.tvhome; dir=$S/old-provider; off=$S/no-old-provider ;;
  *) pkg=; dir=; off= ;;
esac
if [ -z "$pkg" ] || [ -f "$off" ] || ! grep -qx "$pkg" "$S/installed"; then
  echo "Error while accessing provider:$auth" >&2
  echo "java.lang.IllegalStateException: Could not find provider: $auth" >&2
  exit 0
fi
case "$op" in
  write) mkdir -p "$dir/$(dirname "$path")"; cat > "$dir/$path" ;;
  read)
    if [ -f "$dir/$path" ]; then cat "$dir/$path"
    else echo "Error while accessing provider:$auth" >&2; echo "java.io.FileNotFoundException: $path" >&2; fi ;;
esac
''',
    "getprop": "#!/bin/sh\ncat \"$TV_STATE/sdk\"\n",
    "appops": "#!/bin/sh\nexit 0\n",
    "sleep": "#!/bin/sh\nexit 0\n",
}

TRACKING = ["com.miui.tv.analytics", "com.xiaomi.statistic", "com.google.android.feedback"]
LATE = [STOCK, "com.google.android.tungsten.setupwraith"]
FACTORY = TRACKING + LATE + ["com.android.systemui", "com.netflix.ninja", "com.mitv.overseaservice"]


class PretendTv:
    def __init__(self, test):
        self.tmp = Path(tempfile.mkdtemp())
        test.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.bin = self.tmp / "bin"
        self.state = self.tmp / "state"
        self.dir = self.tmp / "orbit"
        self.files = self.tmp / "files"
        self.old_files = self.tmp / "old-files"
        for d in (self.bin, self.state, self.dir):
            d.mkdir()
        for name, body in FAKES.items():
            p = self.bin / name
            p.write_text(body)
            p.chmod(p.stat().st_mode | stat.S_IEXEC)
        self.write("installed", "\n".join(FACTORY) + "\n")
        self.write("disabled", "")
        self.write("sdk", "34\n")
        self.write("setting-secure-enabled_accessibility_services", "com.other/.Helper\n")
        self.write("setting-secure-accessibility_enabled", "1\n")
        self.write("home", STOCK_HOME + "\n")

    def earlier_orbit(self, look=OLD_LOOK):
        """A TV like the family room's on 10 Nov: Orbit's apps under their earlier ids, the stock home screen switched
        off by tools/disable.sh (so not on Orbit Setup's record), the earlier helper on, and a look pushed to the
        earlier Orbit Home."""
        self.write("installed", "\n".join(FACTORY + [OLD_HOME_PKG, OLD_LIVE_PKG]) + "\n")
        self.write("disabled", "\n".join(LATE) + "\n")
        self.write("home", OLD_HOME + "\n")
        self.write("setting-secure-enabled_accessibility_services", f"com.other/.Helper:{OLD_HOME_PKG}/.HomeKeyService\n")
        self.write("setting-secure-screensaver_components", f"{OLD_HOME_PKG}/.ClockDream\n")
        if look is not None:
            (self.state / "old-provider").mkdir(exist_ok=True)
            (self.state / "old-provider" / "config.json").write_text(look)

    def write(self, name, text):
        (self.state / name).write_text(text)

    def read(self, name):
        p = self.state / name
        return p.read_text() if p.exists() else ""

    def lines(self, name):
        return [l for l in self.read(name).splitlines() if l]

    def plan(self, disable, home=1, live=1, name="Asha", token="0123456789abcdef0123456789abcdef"):
        (self.dir / "plan.txt").write_text(f"home={home}\nlive={live}\nstock={STOCK}\n")
        (self.dir / "disable.txt").write_text("\n".join(disable) + "\n")
        (self.dir / "name.txt").write_text(name + "\n")
        (self.dir / "token.txt").write_text(token + "\n")
        (self.dir / "phone.txt").write_text("Orbit\n")
        (self.dir / "orbit-home.apk").write_bytes(b"PK home")
        (self.dir / "orbit-live.apk").write_bytes(b"PK live")

    def run(self, script, *args):
        env = dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}", TV_STATE=str(self.state),
                   ORBIT_DIR=str(self.dir), ORBIT_FILES=str(self.files), ORBIT_OLD_FILES=str(self.old_files))
        done = subprocess.run(["sh", str(script), *args], env=env, capture_output=True, text=True, timeout=60)
        return done.returncode, done.stdout

    def home(self):
        return self.read("home").strip()

    def helpers(self):
        return self.read("setting-secure-enabled_accessibility_services").strip()

    def record(self):
        p = self.dir / "undo.txt"
        return p.read_text().splitlines() if p.exists() else []

    def pm_calls(self):
        return self.lines("pm-log")


def orbit_lines(out):
    return [l for l in out.splitlines() if l.startswith("@orbit")]


def steps(out):
    return {m[1]: m[2] for m in re.finditer(r"(?m)^@orbit step (\S+) (\S+)", out)}


GRAMMAR = re.compile(r"^@orbit (step \S+ (start|ok|skip|fail)( .*)?|progress \d{1,3}|undo .+|done (ok|fail)( .*)?)$")


class InstallTest(unittest.TestCase):
    def test_a_full_setup_switches_off_the_list_and_makes_orbit_home(self):
        tv = PretendTv(self)
        tv.plan(TRACKING + LATE + ["com.android.systemui", "com.not.on.this.tv", "bad name;rm"])
        rc, out = tv.run(SETUP, "install")
        self.assertEqual(0, rc, out)
        self.assertIn("@orbit done ok", out)
        off = tv.lines("disabled")
        for p in TRACKING + LATE:
            self.assertIn(p, off)
        self.assertNotIn("com.android.systemui", off, "a core package is never switched off")
        self.assertEqual(ORBIT_HOME, tv.home())
        self.assertEqual(f"com.other/.Helper:{HELPER}", tv.helpers())
        self.assertIn(LIVE_PKG, tv.lines("installed"))
        self.assertEqual({"check": "ok", "record": "ok", "disable": "ok", "home": "ok", "helper": "ok",
                          "grants": "ok", "live": "ok", "name": "ok", "pair": "ok"}, steps(out))

    def test_the_stock_home_screen_goes_only_after_orbit_home_started(self):
        tv = PretendTv(self)
        tv.plan(TRACKING + LATE)
        _, out = tv.run(SETUP, "install")
        logs = out.splitlines()
        started = next(i for i, l in enumerate(logs) if l.startswith("@orbit step home start"))
        stock_off = next(i for i, l in enumerate(logs) if l == f"@orbit undo enable {STOCK}")
        self.assertGreater(stock_off, started)

    def test_the_undo_record_holds_every_change(self):
        tv = PretendTv(self)
        tv.plan(TRACKING + LATE)
        _, out = tv.run(SETUP, "install")
        record = (tv.dir / "undo.txt").read_text().splitlines()
        self.assertIn(f"home {STOCK_HOME}", record)
        self.assertIn("a11y com.other/.Helper", record)
        self.assertIn("a11y_on 1", record)
        self.assertIn(f"uninstall {HOME_PKG}", record)
        self.assertIn(f"uninstall {LIVE_PKG}", record)
        self.assertIn("setting secure screensaver_components ", record)
        for p in TRACKING + LATE:
            self.assertIn(f"enable {p}", record)
        sent = [l[len("@orbit undo "):] for l in out.splitlines() if l.startswith("@orbit undo ")]
        self.assertEqual(sorted(set(record)), sorted(set(sent)), "the phone is sent the whole record")

    def test_the_name_and_token_reach_orbit_home_through_its_provider(self):
        tv = PretendTv(self)
        tv.plan(TRACKING)
        tv.run(SETUP, "install")
        self.assertEqual("Asha\n", (tv.state / "provider/setup/name.txt").read_text())
        self.assertEqual("0123456789abcdef0123456789abcdef\n", (tv.state / "provider/setup/token.txt").read_text())
        self.assertFalse((tv.dir / "token.txt").exists(), "the token does not stay in /data/local/tmp")
        self.assertFalse((tv.dir / "orbit-home.apk").exists())

    def test_without_a_provider_the_files_are_copied(self):
        tv = PretendTv(self)
        tv.write("no-provider", "")
        tv.plan(TRACKING)
        rc, out = tv.run(SETUP, "install")
        self.assertIn("@orbit done ok", out)
        self.assertEqual("Asha\n", (tv.files / "setup/name.txt").read_text())

    def test_orbit_home_that_does_not_start_leaves_the_tv_its_own_home(self):
        tv = PretendTv(self)
        tv.write("fail-start", "")
        tv.plan(TRACKING + LATE)
        rc, out = tv.run(SETUP, "install")
        self.assertEqual(1, rc)
        self.assertEqual("fail", steps(out)["home"])
        self.assertIn("@orbit done fail", out)
        self.assertNotIn(STOCK, tv.lines("disabled"))
        self.assertEqual(STOCK_HOME, tv.home())

    def test_an_install_that_fails_stops_before_the_home_screen(self):
        tv = PretendTv(self)
        tv.write("fail-install", "")
        tv.plan(TRACKING + LATE)
        rc, out = tv.run(SETUP, "install")
        self.assertEqual(1, rc)
        self.assertNotIn(STOCK, tv.lines("disabled"))

    def test_android_keeping_its_home_puts_the_stock_one_back(self):
        tv = PretendTv(self)
        tv.write("sticky-home", "")
        tv.plan(TRACKING + LATE)
        rc, out = tv.run(SETUP, "install")
        self.assertEqual(1, rc)
        self.assertEqual("fail", steps(out)["home"])
        for p in LATE:
            self.assertNotIn(p, tv.lines("disabled"), "the stock home screen is switched on again")

    def test_without_orbit_home_the_stock_home_screen_stays(self):
        tv = PretendTv(self)
        tv.plan(TRACKING + LATE, home=0)
        rc, out = tv.run(SETUP, "install")
        self.assertEqual(0, rc, out)
        self.assertNotIn(STOCK, tv.lines("disabled"))
        self.assertEqual("skip", steps(out)["home"])

    def test_a_second_run_keeps_the_first_record(self):
        tv = PretendTv(self)
        tv.plan(TRACKING + LATE)
        tv.run(SETUP, "install")
        tv.plan(TRACKING + LATE)
        rc, out = tv.run(SETUP, "install")
        self.assertEqual(0, rc, out)
        record = (tv.dir / "undo.txt").read_text().splitlines()
        self.assertEqual([f"home {STOCK_HOME}"], [l for l in record if l.startswith("home ")])
        self.assertEqual(["a11y com.other/.Helper"], [l for l in record if l.startswith("a11y ")])

    def test_every_orbit_line_follows_the_protocol(self):
        tv = PretendTv(self)
        tv.plan(TRACKING + LATE)
        _, out = tv.run(SETUP, "install")
        for line in orbit_lines(out):
            self.assertRegex(line, GRAMMAR)
        progress = [int(l.split()[2]) for l in orbit_lines(out) if l.startswith("@orbit progress")]
        self.assertEqual(sorted(progress), progress, "progress only goes up")
        self.assertEqual(100, progress[-1])

    def test_an_old_android_is_refused_before_anything_changes(self):
        tv = PretendTv(self)
        tv.write("sdk", "25\n")
        tv.plan(TRACKING)
        rc, out = tv.run(SETUP, "install")
        self.assertEqual(1, rc)
        self.assertEqual([], tv.lines("disabled"))

    def test_name_alone_hands_over_a_new_name(self):
        tv = PretendTv(self)
        tv.plan(TRACKING)
        tv.run(SETUP, "install")
        (tv.dir / "name.txt").write_text("Ravi\n")
        rc, out = tv.run(SETUP, "name")
        self.assertEqual(0, rc, out)
        self.assertEqual("Ravi\n", (tv.state / "provider/setup/name.txt").read_text())


class IdsTest(unittest.TestCase):
    """dev.shiv.orbit.home and dev.shiv.orbit.live, with every component of theirs written in full."""

    def test_every_component_names_the_class_in_full(self):
        tv = PretendTv(self)
        tv.plan(TRACKING + LATE)
        rc, out = tv.run(SETUP, "install")
        self.assertEqual(0, rc, out)
        self.assertEqual(ORBIT_HOME, tv.home())
        self.assertIn(HELPER, tv.helpers().split(":"))
        self.assertEqual(LISTENER, tv.read("listener").strip())
        self.assertEqual(DREAM, tv.read("setting-secure-screensaver_components").strip())
        self.assertEqual({HOME_PKG}, {l.split()[0] for l in tv.lines("grants")})
        # pkg/.Class would name dev.shiv.orbit.home.Class, which does not exist.
        for f in [*tv.state.iterdir(), tv.dir / "undo.txt"]:
            if f.is_file():
                for short in (f"{HOME_PKG}/.", f"{LIVE_PKG}/."):
                    self.assertNotIn(short, f.read_text(), f.name)
        self.assertNotIn(OLD_HOME_PKG + "/", out)

    def test_the_hand_over_goes_through_the_new_apps_provider(self):
        tv = PretendTv(self)
        tv.plan(TRACKING)
        tv.run(SETUP, "install")
        uris = [l.split()[1] for l in tv.lines("content-log")]
        self.assertTrue(uris)
        for uri in uris:
            self.assertTrue(uri.startswith(f"content://{HOME_PKG}.theme/"), uri)

    def test_orbits_own_apps_are_never_switched_off(self):
        tv = PretendTv(self)
        tv.write("installed", "\n".join(FACTORY + [OLD_HOME_PKG, OLD_LIVE_PKG]) + "\n")
        tv.plan(TRACKING + [HOME_PKG, LIVE_PKG, OLD_HOME_PKG, OLD_LIVE_PKG])
        rc, out = tv.run(SETUP, "install")
        self.assertEqual(0, rc, out)
        for p in (HOME_PKG, LIVE_PKG, OLD_HOME_PKG, OLD_LIVE_PKG):
            self.assertNotIn(p, tv.lines("disabled"))
            self.assertNotIn(f"enable {p}", tv.record())


class MigrationTest(unittest.TestCase):
    """A TV that still has Orbit's apps under the ids they had before 11 Nov."""

    def test_the_look_moves_over_and_the_earlier_apps_go(self):
        tv = PretendTv(self)
        tv.earlier_orbit()
        tv.plan(TRACKING + LATE)
        rc, out = tv.run(SETUP, "install")
        self.assertEqual(0, rc, out)
        self.assertEqual({"check": "ok", "record": "ok", "disable": "ok", "home": "ok", "helper": "ok",
                          "grants": "ok", "live": "ok", "name": "ok", "pair": "ok"}, steps(out))
        self.assertEqual(OLD_LOOK, (tv.state / "provider/config.json").read_text(), "the look is in the new app")
        installed = tv.lines("installed")
        for p in (OLD_HOME_PKG, OLD_LIVE_PKG):
            self.assertNotIn(p, installed)
        for p in (HOME_PKG, LIVE_PKG):
            self.assertIn(p, installed)
        self.assertEqual(ORBIT_HOME, tv.home())
        self.assertEqual(f"com.other/.Helper:{HELPER}", tv.helpers(), "the earlier helper is off the list")
        record = tv.record()
        self.assertIn(f"replaced {OLD_HOME_PKG} {HOME_PKG}", record)
        self.assertIn(f"replaced {OLD_LIVE_PKG} {LIVE_PKG}", record)
        self.assertEqual([], [l for l in record if l.startswith("home ")], "Orbit's own home is never the stock one")
        # They take the place of apps the TV had before setup, so undo keeps them.
        self.assertNotIn(f"uninstall {HOME_PKG}", record)
        self.assertNotIn(f"uninstall {LIVE_PKG}", record)
        self.assertIn(f"a11y com.other/.Helper:{HELPER}", record)
        self.assertIn(f"setting secure screensaver_components {DREAM}", record)
        for line in orbit_lines(out):
            self.assertRegex(line, GRAMMAR)

    def test_the_earlier_helper_and_door_go_before_the_new_helper_starts(self):
        tv = PretendTv(self)
        tv.earlier_orbit()
        tv.plan(TRACKING + LATE)
        _, out = tv.run(SETUP, "install")
        logs = out.splitlines()
        removed = logs.index(f"removed {OLD_HOME_PKG}")
        self.assertLess(logs.index("@orbit step home start"), removed)
        self.assertLess(removed, logs.index("@orbit step helper start"))

    def test_the_look_comes_from_the_file_when_the_earlier_provider_does_not_answer(self):
        tv = PretendTv(self)
        tv.earlier_orbit(look=None)
        tv.write("no-old-provider", "")
        tv.old_files.mkdir()
        (tv.old_files / "config.json").write_text(OLD_LOOK)
        tv.plan(TRACKING)
        rc, out = tv.run(SETUP, "install")
        self.assertEqual(0, rc, out)
        self.assertEqual(OLD_LOOK, (tv.state / "provider/config.json").read_text())

    def test_without_an_earlier_look_the_move_goes_on(self):
        tv = PretendTv(self)
        tv.earlier_orbit(look=None)
        tv.plan(TRACKING)
        rc, out = tv.run(SETUP, "install")
        self.assertEqual(0, rc, out)
        self.assertFalse((tv.state / "provider/config.json").exists())
        self.assertNotIn(OLD_HOME_PKG, tv.lines("installed"))

    def test_a_look_the_new_app_already_has_stays(self):
        tv = PretendTv(self)
        tv.earlier_orbit()
        tv.write("installed", tv.read("installed") + HOME_PKG + "\n")
        (tv.state / "provider").mkdir()
        (tv.state / "provider/config.json").write_text('{"dock_glass": false}\n')
        tv.plan(TRACKING)
        rc, out = tv.run(SETUP, "install")
        self.assertEqual(0, rc, out)
        self.assertEqual('{"dock_glass": false}\n', (tv.state / "provider/config.json").read_text())
        self.assertNotIn(OLD_HOME_PKG, tv.lines("installed"))

    def test_an_earlier_app_that_will_not_go_is_said_and_kept_off_the_record(self):
        tv = PretendTv(self)
        tv.earlier_orbit()
        tv.write("refuse-uninstall", OLD_LIVE_PKG + "\n")
        tv.plan(TRACKING)
        rc, out = tv.run(SETUP, "install")
        self.assertEqual(0, rc, out)
        self.assertIn("@orbit step live ok The earlier Live TV could not be removed", out)
        self.assertIn(OLD_LIVE_PKG, tv.lines("installed"))
        self.assertNotIn(f"replaced {OLD_LIVE_PKG} {LIVE_PKG}", tv.record())

    def test_a_home_step_that_fails_keeps_the_earlier_orbit_home(self):
        tv = PretendTv(self)
        tv.earlier_orbit()
        tv.write("fail-start", "")
        tv.plan(TRACKING + LATE)
        rc, out = tv.run(SETUP, "install")
        self.assertEqual(1, rc)
        self.assertEqual("fail", steps(out)["home"])
        self.assertEqual(OLD_HOME, tv.home())
        self.assertIn(OLD_HOME_PKG, tv.lines("installed"))
        self.assertEqual(OLD_LOOK, (tv.state / "old-provider/config.json").read_text())
        self.assertEqual([], [l for l in tv.record() if l.startswith("replaced ")])

    def test_undo_after_the_move_puts_no_earlier_app_back(self):
        tv = PretendTv(self)
        tv.earlier_orbit()
        tv.plan(TRACKING + LATE)
        tv.run(SETUP, "install")
        before = len(tv.pm_calls())
        rc, out = tv.run(UNDO)
        self.assertEqual(0, rc, out)
        self.assertIn("@orbit done ok", out)
        self.assertEqual([], [c for c in tv.pm_calls()[before:] if c.startswith("install")], "undo installs nothing")
        installed = tv.lines("installed")
        for p in (OLD_HOME_PKG, OLD_LIVE_PKG):
            self.assertNotIn(p, installed)
        # The TV had an Orbit Home with its helper before setup: the new one stays in its place, as it was.
        self.assertIn(HOME_PKG, installed)
        self.assertEqual(ORBIT_HOME, tv.home())
        self.assertEqual(f"com.other/.Helper:{HELPER}", tv.helpers())
        self.assertEqual(DREAM, tv.read("setting-secure-screensaver_components").strip())
        for p in TRACKING:
            self.assertNotIn(p, tv.lines("disabled"))

    def test_after_an_earlier_setup_undo_takes_the_new_apps_away_too(self):
        # The earlier ids came from an earlier Orbit Setup, whose record says it installed them.
        tv = PretendTv(self)
        tv.earlier_orbit()
        (tv.dir / "undo.txt").write_text("\n".join(
            [f"home {STOCK_HOME}", *[f"enable {p}" for p in LATE], f"uninstall {OLD_HOME_PKG}",
             "a11y com.other/.Helper", "a11y_on 1", "setting secure screensaver_components ",
             f"uninstall {OLD_LIVE_PKG}"]) + "\n")
        tv.plan(TRACKING + LATE)
        rc, out = tv.run(SETUP, "install")
        self.assertEqual(0, rc, out)
        record = tv.record()
        self.assertIn(f"uninstall {HOME_PKG}", record)
        self.assertIn(f"uninstall {LIVE_PKG}", record)
        self.assertEqual(["a11y com.other/.Helper"], [l for l in record if l.startswith("a11y ")])
        before = len(tv.pm_calls())
        rc, out = tv.run(UNDO)
        self.assertEqual(0, rc, out)
        self.assertEqual(STOCK_HOME, tv.home())
        self.assertEqual([], tv.lines("disabled"))
        self.assertEqual("com.other/.Helper", tv.helpers())
        self.assertEqual([], [c for c in tv.pm_calls()[before:] if c.startswith("install")], "undo installs nothing")
        for p in (HOME_PKG, LIVE_PKG, OLD_HOME_PKG, OLD_LIVE_PKG):
            self.assertNotIn(p, tv.lines("installed"))


class SwitchTest(unittest.TestCase):
    """switch stock and switch orbit: Android's Home goes back and forth, and Orbit Home stays installed."""

    def installed_tv(self):
        tv = PretendTv(self)
        tv.plan(TRACKING + LATE)
        rc, out = tv.run(SETUP, "install")
        self.assertEqual(0, rc, out)
        return tv

    def test_switch_stock_then_orbit_comes_back_to_where_it_was(self):
        tv = self.installed_tv()
        record = tv.record()
        helpers = tv.helpers()
        rc, out = tv.run(SETUP, "switch", "stock")
        self.assertEqual(0, rc, out)
        self.assertEqual({"switch": "ok"}, steps(out))
        self.assertIn("@orbit done ok", out)
        self.assertEqual(STOCK_HOME, tv.home())
        off = tv.lines("disabled")
        for p in LATE:
            self.assertNotIn(p, off, "the stock home screen is on again")
        for p in TRACKING:
            self.assertIn(p, off, "what the list switched off stays off")
        for p in (HOME_PKG, LIVE_PKG):
            self.assertIn(p, tv.lines("installed"))
        self.assertEqual(helpers, tv.helpers(), "the helper stays")
        self.assertEqual(DREAM, tv.read("setting-secure-screensaver_components").strip())
        self.assertEqual(record, tv.record())

        rc, out = tv.run(SETUP, "switch", "orbit")
        self.assertEqual(0, rc, out)
        self.assertEqual({"switch": "ok"}, steps(out))
        self.assertIn("@orbit done ok", out)
        self.assertEqual(ORBIT_HOME, tv.home())
        off = tv.lines("disabled")
        for p in TRACKING + LATE:
            self.assertIn(p, off)
        for p in LATE:
            self.assertIn(f"@orbit undo enable {p}", out, "the phone hears the record again")
        self.assertEqual(record, tv.record(), "the record is as install left it, nothing twice")
        self.assertEqual(helpers, tv.helpers())

    def test_every_switch_line_follows_the_protocol(self):
        tv = self.installed_tv()
        for target in ("stock", "orbit"):
            _, out = tv.run(SETUP, "switch", target)
            lines = orbit_lines(out)
            self.assertEqual("@orbit step switch start", lines[0])
            self.assertEqual("@orbit done ok", lines[-1])
            for line in lines:
                self.assertRegex(line, GRAMMAR)

    def test_switch_orbit_goes_in_installs_order(self):
        # Orbit Home starts, then the stock home screen goes off, and only then is Orbit Home made Home: Android drops
        # the choice of Home whenever the set of home apps changes.
        tv = self.installed_tv()
        tv.run(SETUP, "switch", "stock")
        tv.write("calls", "")
        rc, out = tv.run(SETUP, "switch", "orbit")
        self.assertEqual(0, rc, out)
        calls = tv.lines("calls")
        started = next(i for i, c in enumerate(calls) if c.startswith("am start -W") and f"-n {ORBIT_HOME}" in c)
        offs = [i for i, c in enumerate(calls) if c.startswith("pm disable-user")]
        made_home = next(i for i, c in enumerate(calls) if c == f"cmd package set-home-activity --user 0 {ORBIT_HOME}")
        self.assertEqual(len(LATE), len(offs))
        self.assertLess(started, min(offs))
        self.assertLess(max(offs), made_home)
        self.assertFalse(any(c.startswith("am force-stop") for c in calls), "the helper is not stopped")

    def test_switch_stock_turns_the_stock_home_on_before_making_it_home(self):
        tv = self.installed_tv()
        tv.write("calls", "")
        tv.run(SETUP, "switch", "stock")
        calls = tv.lines("calls")
        ons = [i for i, c in enumerate(calls) if c.startswith("pm enable")]
        made_home = calls.index(f"cmd package set-home-activity --user 0 {STOCK_HOME}")
        self.assertEqual(len(LATE), len(ons))
        self.assertLess(max(ons), made_home)
        self.assertFalse(any(c.startswith(("pm uninstall", "pm disable-user", "am force-stop")) for c in calls))

    def test_switch_stock_without_a_record_of_the_stock_home_changes_nothing(self):
        tv = PretendTv(self)
        tv.earlier_orbit()
        tv.plan(TRACKING + LATE)
        tv.run(SETUP, "install")
        rc, out = tv.run(SETUP, "switch", "stock")
        self.assertEqual(1, rc)
        self.assertEqual("fail", steps(out)["switch"])
        self.assertIn("@orbit done fail", out)
        self.assertEqual(ORBIT_HOME, tv.home())
        for p in LATE:
            self.assertIn(p, tv.lines("disabled"))

    def test_switch_orbit_without_orbit_home_says_so(self):
        tv = PretendTv(self)
        rc, out = tv.run(SETUP, "switch", "orbit")
        self.assertEqual(1, rc)
        self.assertIn("@orbit step switch fail Orbit Home is not on this TV", out)
        self.assertEqual(STOCK_HOME, tv.home())

    def test_switch_orbit_that_android_refuses_gives_the_stock_home_back(self):
        tv = self.installed_tv()
        tv.run(SETUP, "switch", "stock")
        tv.write("sticky-home", "")
        rc, out = tv.run(SETUP, "switch", "orbit")
        self.assertEqual(1, rc)
        self.assertEqual("fail", steps(out)["switch"])
        for p in LATE:
            self.assertNotIn(p, tv.lines("disabled"))
        self.assertEqual(STOCK_HOME, tv.home())

    def test_switch_orbit_that_does_not_start_leaves_the_stock_home(self):
        tv = self.installed_tv()
        tv.run(SETUP, "switch", "stock")
        tv.write("fail-start", "")
        rc, out = tv.run(SETUP, "switch", "orbit")
        self.assertEqual(1, rc)
        self.assertEqual(STOCK_HOME, tv.home())
        for p in LATE:
            self.assertNotIn(p, tv.lines("disabled"))

    def test_a_switch_to_nowhere_is_refused(self):
        tv = self.installed_tv()
        rc, out = tv.run(SETUP, "switch", "elsewhere")
        self.assertEqual(2, rc)
        self.assertEqual(ORBIT_HOME, tv.home())

    def test_undo_after_switch_stock_puts_the_tv_back(self):
        tv = self.installed_tv()
        tv.run(SETUP, "switch", "stock")
        rc, out = tv.run(UNDO)
        self.assertEqual(0, rc, out)
        self.assertEqual("ok", steps(out)["home"])
        self.assertEqual([], tv.lines("disabled"))
        self.assertEqual(STOCK_HOME, tv.home())
        self.assertEqual("com.other/.Helper", tv.helpers())
        self.assertNotIn(HOME_PKG, tv.lines("installed"))
        self.assertNotIn(LIVE_PKG, tv.lines("installed"))

    def test_undo_after_a_round_trip_puts_the_tv_back(self):
        tv = self.installed_tv()
        tv.run(SETUP, "switch", "stock")
        tv.run(SETUP, "switch", "orbit")
        rc, out = tv.run(UNDO)
        self.assertEqual(0, rc, out)
        self.assertEqual([], tv.lines("disabled"))
        self.assertEqual(STOCK_HOME, tv.home())
        self.assertEqual("com.other/.Helper", tv.helpers())
        self.assertNotIn(HOME_PKG, tv.lines("installed"))


class UndoTest(unittest.TestCase):
    def test_undo_puts_the_tv_back(self):
        tv = PretendTv(self)
        tv.plan(TRACKING + LATE)
        tv.run(SETUP, "install")
        rc, out = tv.run(UNDO)
        self.assertEqual(0, rc, out)
        self.assertIn("@orbit done ok", out)
        self.assertEqual([], tv.lines("disabled"))
        self.assertEqual(STOCK_HOME, tv.home())
        self.assertEqual("com.other/.Helper", tv.helpers())
        self.assertNotIn(HOME_PKG, tv.lines("installed"))
        self.assertNotIn(LIVE_PKG, tv.lines("installed"))
        self.assertFalse((tv.state / "setting-secure-screensaver_components").exists(), "a setting that was unset goes")

    def test_undo_never_removes_a_factory_app(self):
        tv = PretendTv(self)
        (tv.dir / "undo.txt").write_text("uninstall com.netflix.ninja\nenable com.miui.tv.analytics\n")
        rc, out = tv.run(UNDO)
        self.assertEqual(0, rc, out)
        self.assertIn("com.netflix.ninja", tv.lines("installed"))

    def test_undo_without_a_record_says_so(self):
        tv = PretendTv(self)
        rc, out = tv.run(UNDO)
        self.assertEqual(1, rc)
        self.assertIn("@orbit done fail", out)

    def test_undo_keeps_orbit_home_while_it_is_still_home(self):
        tv = PretendTv(self)
        tv.plan(TRACKING + LATE)
        tv.run(SETUP, "install")
        tv.write("sticky-home", "")
        rc, out = tv.run(UNDO)
        self.assertEqual(0, rc, out)
        self.assertEqual("fail", steps(out)["home"])
        self.assertIn(f"kept {HOME_PKG}: it is still the home screen", out)
        self.assertIn(HOME_PKG, tv.lines("installed"), "the TV is never left without a home screen")
        self.assertNotIn(LIVE_PKG, tv.lines("installed"))

    def test_undo_removes_an_earlier_setups_apps_under_their_earlier_ids(self):
        tv = PretendTv(self)
        tv.write("installed", "\n".join(FACTORY + [OLD_HOME_PKG, OLD_LIVE_PKG]) + "\n")
        (tv.dir / "undo.txt").write_text(f"home {STOCK_HOME}\nuninstall {OLD_HOME_PKG}\nuninstall {OLD_LIVE_PKG}\n"
                                         f"replaced {OLD_HOME_PKG} {HOME_PKG}\n")
        rc, out = tv.run(UNDO)
        self.assertEqual(0, rc, out)
        self.assertNotIn(OLD_HOME_PKG, tv.lines("installed"))
        self.assertNotIn(OLD_LIVE_PKG, tv.lines("installed"))
        self.assertNotIn("kept", out)


class TrialTest(unittest.TestCase):
    """`orbit-setup.sh trial`: Orbit Home for a look before setting up, the TV otherwise exactly as it was."""

    def trial(self, tv, *args):
        (tv.dir / "orbit-home.apk").write_bytes(b"PK home")
        return tv.run(SETUP, "trial", *args)

    def starts(self, tv):
        return [l for l in tv.lines("calls") if l.startswith("am start")]

    def test_a_trial_installs_orbit_home_and_changes_nothing_else(self):
        tv = PretendTv(self)
        rc, out = self.trial(tv, "900")
        self.assertEqual(0, rc, out)
        self.assertIn("@orbit done ok", out)
        self.assertEqual({"check": "ok", "record": "ok", "install": "ok", "keep": "ok", "open": "ok"}, steps(out))
        self.assertIn(HOME_PKG, tv.lines("installed"))
        self.assertNotIn(LIVE_PKG, tv.lines("installed"))
        self.assertEqual([], tv.lines("disabled"))
        self.assertEqual(STOCK_HOME, tv.home())
        self.assertEqual("com.other/.Helper", tv.helpers())
        self.assertEqual("", tv.read("grants"), "no permission is granted beyond the install's own")
        self.assertEqual("", tv.read("listener"))
        self.assertFalse((tv.state / "setting-secure-screensaver_components").exists())
        self.assertFalse(any("set-home-activity" in l for l in tv.lines("calls")), "Home was never touched")
        self.assertEqual([f"home {STOCK_HOME}", f"uninstall {HOME_PKG}"], tv.record())
        sent = [l[len("@orbit undo "):] for l in out.splitlines() if l.startswith("@orbit undo ")]
        self.assertEqual(tv.record(), sent, "the phone hears the record")
        self.assertFalse((tv.dir / "orbit-home.apk").exists(), "the APK does not stay behind")

    def test_orbit_home_opens_as_an_app_with_its_time_limit(self):
        tv = PretendTv(self)
        self.trial(tv, "900")
        starts = self.starts(tv)
        self.assertEqual(1, len(starts), starts)
        self.assertIn(f"-n {ORBIT_HOME}", starts[0])
        self.assertIn(f"--ei {TRIAL_SECONDS} 900", starts[0])
        self.assertIn(f"--es {TRIAL_ID} ", starts[0])
        self.assertNotIn("category.HOME", starts[0], "not as Home: the TV's own home screen stays Home")
        self.assertNotIn(SET_UP, starts[0])

    def test_the_time_limit_stays_between_a_minute_and_an_hour(self):
        for asked, given in (("5", "60"), ("99999", "3600"), ("", "900"), ("abc", "900"), ("1200", "1200")):
            with self.subTest(asked=asked):
                tv = PretendTv(self)
                rc, out = self.trial(tv, asked)
                self.assertEqual(0, rc, out)
                self.assertIn(f"--ei {TRIAL_SECONDS} {given}", self.starts(tv)[0])

    def test_a_tv_that_would_ask_which_home_keeps_its_own(self):
        tv = PretendTv(self)
        tv.write("chooser-on-install", "")
        rc, out = self.trial(tv)
        self.assertEqual(0, rc, out)
        self.assertEqual("ok", steps(out)["keep"])
        self.assertEqual(STOCK_HOME, tv.home())
        self.assertIn(f"cmd package set-home-activity --user 0 {STOCK_HOME}", tv.lines("calls"))

    def test_a_tv_that_will_not_keep_its_home_gets_orbit_home_taken_off_again(self):
        tv = PretendTv(self)
        tv.write("chooser-on-install", "")
        tv.write("sticky-home", "")
        rc, out = self.trial(tv)
        self.assertEqual(1, rc)
        self.assertEqual("fail", steps(out)["keep"])
        self.assertIn("@orbit done fail", out)
        self.assertNotIn(HOME_PKG, tv.lines("installed"))
        self.assertEqual(STOCK_HOME, tv.home())
        self.assertFalse((tv.dir / "undo.txt").exists(), "the record the trial began goes too")

    def test_orbit_home_that_does_not_open_is_taken_off_again(self):
        tv = PretendTv(self)
        tv.write("fail-start", "")
        rc, out = self.trial(tv)
        self.assertEqual(1, rc)
        self.assertEqual("fail", steps(out)["open"])
        self.assertNotIn(HOME_PKG, tv.lines("installed"))
        self.assertEqual(STOCK_HOME, tv.home())
        self.assertFalse((tv.dir / "undo.txt").exists())

    def test_an_install_that_fails_leaves_the_tv_as_it_was(self):
        tv = PretendTv(self)
        tv.write("fail-install", "")
        rc, out = self.trial(tv)
        self.assertEqual(1, rc)
        self.assertEqual("fail", steps(out)["install"])
        self.assertNotIn(HOME_PKG, tv.lines("installed"))
        self.assertFalse((tv.dir / "undo.txt").exists())

    def test_an_old_android_is_refused_and_keeps_no_trace(self):
        tv = PretendTv(self)
        tv.write("sdk", "25\n")
        rc, out = self.trial(tv)
        self.assertEqual(1, rc)
        self.assertEqual("fail", steps(out)["check"])
        self.assertNotIn(HOME_PKG, tv.lines("installed"))
        self.assertFalse((tv.dir / "undo.txt").exists())

    def test_a_tv_with_orbit_set_up_is_not_tried(self):
        tv = PretendTv(self)
        tv.plan(TRACKING + LATE)
        tv.run(SETUP, "install")
        before = tv.record()
        rc, out = self.trial(tv)
        self.assertEqual(1, rc)
        self.assertIn("@orbit done fail Orbit OS is already set up on this TV", out)
        self.assertEqual(before, tv.record())
        self.assertEqual(ORBIT_HOME, tv.home())

    def test_a_tv_switched_back_to_its_own_home_is_still_set_up(self):
        tv = PretendTv(self)
        tv.plan(TRACKING + LATE)
        tv.run(SETUP, "install")
        tv.run(SETUP, "switch", "stock")
        rc, out = self.trial(tv)
        self.assertEqual(1, rc)
        self.assertIn("@orbit done fail Orbit OS is already set up on this TV", out)

    def test_a_tv_an_earlier_setup_changed_is_not_tried(self):
        tv = PretendTv(self)
        (tv.dir / "undo.txt").write_text(f"home {STOCK_HOME}\nenable com.miui.tv.analytics\n")
        rc, out = self.trial(tv)
        self.assertEqual(1, rc)
        self.assertIn("Orbit Setup changed this TV before", out)
        self.assertNotIn(HOME_PKG, tv.lines("installed"))

    def test_an_orbit_home_put_there_another_way_is_left_alone(self):
        for pkg in (HOME_PKG, OLD_HOME_PKG):
            with self.subTest(pkg=pkg):
                tv = PretendTv(self)
                tv.write("installed", "\n".join(FACTORY + [pkg]) + "\n")
                rc, out = self.trial(tv)
                self.assertEqual(1, rc)
                self.assertIn("@orbit done fail Orbit Home is already on this TV", out)
                self.assertIn(pkg, tv.lines("installed"))
                self.assertEqual([], [l for l in tv.lines("pm-log") if l.startswith(("install", "uninstall"))])

    def test_a_trial_left_on_the_tv_can_run_again(self):
        tv = PretendTv(self)
        self.trial(tv)
        rc, out = self.trial(tv)
        self.assertEqual(0, rc, out)
        self.assertEqual([f"home {STOCK_HOME}", f"uninstall {HOME_PKG}"], tv.record())
        self.assertEqual([HOME_PKG, HOME_PKG], tv.lines("stopped"), "the earlier one stops first")

    def test_undo_after_a_trial_takes_orbit_home_off_and_nothing_else(self):
        tv = PretendTv(self)
        self.trial(tv)
        rc, out = tv.run(UNDO)
        self.assertEqual(0, rc, out)
        self.assertIn(f"removed {HOME_PKG}", out)
        self.assertNotIn(HOME_PKG, tv.lines("installed"))
        self.assertEqual(STOCK_HOME, tv.home())
        self.assertEqual([], tv.lines("disabled"))
        self.assertEqual("com.other/.Helper", tv.helpers())
        self.assertFalse((tv.state / "setting-secure-screensaver_components").exists())

    def test_a_setup_after_a_trial_keeps_its_record_so_undo_still_takes_orbit_home_off(self):
        tv = PretendTv(self)
        self.trial(tv)
        tv.plan(TRACKING + LATE)
        rc, out = tv.run(SETUP, "install")
        self.assertEqual(0, rc, out)
        self.assertEqual(ORBIT_HOME, tv.home())
        record = tv.record()
        self.assertEqual([f"home {STOCK_HOME}"], [l for l in record if l.startswith("home ")])
        self.assertEqual(1, record.count(f"uninstall {HOME_PKG}"))
        rc, out = tv.run(UNDO)
        self.assertEqual(0, rc, out)
        self.assertNotIn(HOME_PKG, tv.lines("installed"))
        self.assertEqual(STOCK_HOME, tv.home())

    def test_the_setup_tells_orbit_home_that_it_stays(self):
        tv = PretendTv(self)
        tv.plan(TRACKING)
        tv.run(SETUP, "install")
        starts = [l for l in self.starts(tv) if ORBIT_HOME in l]
        self.assertTrue(starts)
        for start in starts:
            self.assertIn(f"--ez {SET_UP} true", start)
        tv.run(SETUP, "switch", "stock")
        tv.run(SETUP, "switch", "orbit")
        for start in [l for l in self.starts(tv) if ORBIT_HOME in l]:
            self.assertIn(f"--ez {SET_UP} true", start)

    def test_every_trial_line_follows_the_protocol(self):
        tv = PretendTv(self)
        _, out = self.trial(tv)
        for line in orbit_lines(out):
            self.assertRegex(line, GRAMMAR)
        progress = [int(l.split()[2]) for l in orbit_lines(out) if l.startswith("@orbit progress")]
        self.assertEqual(sorted(progress), progress, "progress only goes up")
        self.assertEqual(100, progress[-1])


if __name__ == "__main__":
    unittest.main()
