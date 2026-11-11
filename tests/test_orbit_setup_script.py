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
    echo "Success" ;;
  uninstall)
    grep -qx "$2" "$S/installed" || { echo "Failure [DELETE_FAILED_INTERNAL_ERROR]"; exit 1; }
    grep -qx "$2" "$S/refuse-uninstall" 2>/dev/null && { echo "Failure [DELETE_FAILED_USER_RESTRICTED]"; exit 1; }
    grep -vx "$2" "$S/installed" > "$S/i.tmp"; mv "$S/i.tmp" "$S/installed"
    # Android takes the app's own files in Android/data with it.
    case "$2" in dev.shiv.orbit.home) rm -rf "$S/provider" ;; com.gathin.tvhome) rm -rf "$S/old-provider" ;; esac
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
    if [ -z "$h" ] || grep -qx "$hp" "$S/disabled" || ! grep -qx "$hp" "$S/installed"; then
      if grep -qx com.google.android.apps.tv.launcherx "$S/installed" && ! grep -qx com.google.android.apps.tv.launcherx "$S/disabled"; then
        h=com.google.android.apps.tv.launcherx/.MainActivity
      else h=com.android.tv.settings/.FallbackHome; fi
    fi
    echo "priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true"
    echo "$h" ;;
  "package set-home-activity")
    [ -f "$S/sticky-home" ] && { echo "Success: (ignored)"; exit 0; }
    echo "$5" > "$S/home"; echo "Success: Activity $5 is now the home" ;;
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
        started = next(i for i, c in enumerate(calls) if c.startswith("am start -W") and c.endswith(f"-n {ORBIT_HOME}"))
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


if __name__ == "__main__":
    unittest.main()
