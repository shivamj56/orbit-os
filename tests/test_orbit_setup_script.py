"""setup/tv/orbit-setup.sh and orbit-undo.sh against a pretend TV.

The pretend TV is a folder of small sh programs named after the TV's own commands (pm, cmd, am, settings, content,
getprop, appops, sleep), which keep their state in files. The scripts run under the Mac's sh with those first on
PATH, so every test reads what a real run would leave behind: what is switched off, what is Home, the helper list and
the undo record.
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

FAKES = {
    "pm": r'''#!/bin/sh
S=$TV_STATE
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
    for f; do :; done; case "$f" in *orbit-home.apk) p=com.gathin.tvhome ;; *orbit-live.apk) p=com.gathin.livetv ;; esac
    [ -f "$S/fail-install" ] && { echo "Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]"; exit 1; }
    grep -qx "$p" "$S/installed" || echo "$p" >> "$S/installed"
    echo "Success" ;;
  uninstall)
    grep -vx "$2" "$S/installed" > "$S/i.tmp"; mv "$S/i.tmp" "$S/installed"; echo "Success" ;;
  grant) echo "$2 $3" >> "$S/grants" ;;
esac
''',
    "cmd": r'''#!/bin/sh
S=$TV_STATE
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
[ -f "$S/no-provider" ] && { echo "Error while accessing provider:com.gathin.tvhome.theme"; exit 0; }
uri=$3; path=${uri#content://com.gathin.tvhome.theme/}
mkdir -p "$S/provider/$(dirname "$path")"; cat > "$S/provider/$path"
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
                   ORBIT_DIR=str(self.dir), ORBIT_FILES=str(self.files))
        done = subprocess.run(["sh", str(script), *args], env=env, capture_output=True, text=True, timeout=60)
        return done.returncode, done.stdout

    def home(self):
        return self.read("home").strip()

    def helpers(self):
        return self.read("setting-secure-enabled_accessibility_services").strip()


def orbit_lines(out):
    return [l for l in out.splitlines() if l.startswith("@orbit")]


def steps(out):
    return {m[1]: m[2] for m in re.finditer(r"(?m)^@orbit step (\S+) (\S+)", out)}


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
        self.assertEqual("com.gathin.tvhome/.MainActivity", tv.home())
        self.assertEqual("com.other/.Helper:com.gathin.tvhome/.HomeKeyService", tv.helpers())
        self.assertIn("com.gathin.livetv", tv.lines("installed"))
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
        self.assertIn("uninstall com.gathin.tvhome", record)
        self.assertIn("uninstall com.gathin.livetv", record)
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
        grammar = re.compile(r"^@orbit (step \S+ (start|ok|skip|fail)( .*)?|progress \d{1,3}|undo .+|done (ok|fail)( .*)?)$")
        for line in orbit_lines(out):
            self.assertRegex(line, grammar)
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
        self.assertNotIn("com.gathin.tvhome", tv.lines("installed"))
        self.assertNotIn("com.gathin.livetv", tv.lines("installed"))
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


if __name__ == "__main__":
    unittest.main()
