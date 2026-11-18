import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { MOCK_APPS, MOCK_CONTROL, MOCK_SETTINGS, type MockEvent } from "../mock";
import { t, tm } from "../i18n";

const spring = { type: "spring", stiffness: 380, damping: 32 } as const;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? t("Good Morning") : h < 17 ? t("Good Afternoon") : t("Good Evening");
}

/** The pretend TV of the demo: a small picture of the Family room Home that answers what the phone does. */
export function MockTv({ compact = false }: { compact?: boolean }) {
  const [focus, setFocus] = useState(1);
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [linkCode, setLinkCode] = useState<string | null>(null);
  // Only one Island at a time: the link code wins (the Wi-Fi pairing is the other way in).
  const code = linkCode ?? pairCode;
  const codeTitle = linkCode ? "Orbit link code" : "Phone code";
  const codeText = code ? (linkCode ? `${code.slice(0, 4)} ${code.slice(4)}` : `${code.slice(0, 3)} ${code.slice(3)}`) : "";
  const [cursor, setCursor] = useState<{ x: number; y: number; on: boolean; click: number }>({ x: 640, y: 360, on: false, click: 0 });
  const [app, setApp] = useState<string | null>(null);
  const [volume, setVolume] = useState<{ v: number; muted: boolean; n: number } | null>(null);
  const [overlay, setOverlay] = useState<string | null>(null);
  const [asleep, setAsleep] = useState(false);
  const [menu, setMenu] = useState(0);
  // Orbit OS's Control Center: the chosen tile, -1 while closed.
  const [control, setControl] = useState(-1);
  // Help mode: the note the TV shows while someone can see its screen.
  const [watched, setWatched] = useState(false);
  // Orbit Setup: Android's own question while the phone waits for Allow, and the name the greeting now says.
  const [asking, setAsking] = useState(false);
  const [greetName, setGreetName] = useState("");
  const timers = useRef<Record<string, number>>({});

  const later = (name: string, ms: number, f: () => void) => {
    window.clearTimeout(timers.current[name]);
    timers.current[name] = window.setTimeout(f, ms);
  };

  useEffect(() => {
    const on = (e: Event) => {
      const m = (e as CustomEvent<MockEvent>).detail;
      switch (m.type) {
        case "focus":
          setFocus(m.index);
          break;
        case "open":
          setApp(m.label);
          setMenu(0);
          break;
        case "menu":
          setMenu(m.index);
          break;
        case "control":
          setControl(m.index);
          break;
        case "overlay":
          setOverlay(m.text);
          later("overlay", 1600, () => setOverlay(null));
          break;
        case "help":
          setWatched(m.on);
          break;
        case "adb":
          setAsking(m.on);
          break;
        case "greetname":
          setGreetName(m.name);
          break;
        case "home":
          setApp(null);
          setOverlay(null);
          break;
        case "back":
          setOverlay(null);
          setApp(null);
          break;
        case "recents":
          setOverlay(t("Recent apps"));
          later("overlay", 1600, () => setOverlay(null));
          break;
        case "cursor":
          setCursor((c) => ({ ...c, x: m.x, y: m.y, on: true }));
          later("cursor", 3000, () => setCursor((c) => ({ ...c, on: false })));
          break;
        case "click":
          setCursor((c) => ({ ...c, on: true, click: c.click + 1 }));
          later("cursor", 3000, () => setCursor((c) => ({ ...c, on: false })));
          break;
        case "code":
          setPairCode(m.code);
          break;
        case "linkcode":
          setLinkCode(m.code);
          break;
        case "volume":
          setVolume((v) => ({ v: m.volume, muted: m.muted, n: (v?.n ?? 0) + 1 }));
          later("volume", 1600, () => setVolume(null));
          break;
        case "typed":
          setOverlay(t("Search: {text}", { text: m.text }));
          later("overlay", 2200, () => setOverlay(null));
          break;
        case "sleep":
          setAsleep(true);
          later("sleep", 2600, () => setAsleep(false));
          break;
        default:
          break;
      }
    };
    window.addEventListener("orbit-mock", on);
    return () => window.removeEventListener("orbit-mock", on);
  }, []);

  const tint = MOCK_APPS.find((a) => a.label === app)?.tint ?? ["#2a3350", "#0b0f1c"];
  return (
    <div className={`relative w-full ${compact ? "" : "rounded-[22px] bg-[#0b0d12] p-[10px] shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)] ring-1 ring-white/6"}`}>
      <div className={`relative aspect-video w-full overflow-hidden bg-black ${compact ? "" : "rounded-[12px]"}`} style={{ containerType: "inline-size" }}>
        {/* Home */}
        <div className="absolute inset-0" style={{ background: "radial-gradient(60% 70% at 50% 62%, #3a0d2a 0%, #12060f 55%, #030304 100%)" }} />
        {/* The greeting steps aside while the Island speaks, as it does on the TV. */}
        <motion.div animate={{ opacity: code ? 0 : 1, y: code ? "1.4cqw" : 0 }} transition={{ duration: code ? 0.38 : 0.52 }}>
          <div className="absolute inset-x-0 top-[6%] text-center font-display font-light text-white/90" style={{ fontSize: "4.6cqw" }}>
            {greeting()}
            {greetName ? `, ${greetName}` : ""}
          </div>
          <div className="absolute inset-x-0 top-[17%] text-center text-white/55" style={{ fontSize: "1.6cqw" }}>
            {t("Hello, I wish you a wonderful day")}
          </div>
        </motion.div>
        <div className="absolute inset-x-0 top-[37%] h-[34%]">
          {MOCK_APPS.map((a, i) => {
            const d = i - focus;
            if (Math.abs(d) > 4) return null;
            return (
              <motion.div
                key={a.pkg}
                className="absolute top-0 h-full overflow-hidden rounded-[1.2cqw] border border-white/15"
                style={{ width: "13%", left: "43.5%", background: `linear-gradient(135deg, ${a.tint[0]}, ${a.tint[1]})` }}
                animate={{ x: `${d * 118}%`, scale: d === 0 ? 1.18 : 1 - Math.min(0.22, Math.abs(d) * 0.07), opacity: 1 - Math.abs(d) * 0.16, rotateY: d * -14 }}
                transition={spring}
              >
                <div className="grid h-full place-items-center font-display font-medium text-white" style={{ fontSize: "1.55cqw" }}>
                  {t(a.label)}
                </div>
                {d === 0 && <div className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-white/80 blur-[1px]" />}
              </motion.div>
            );
          })}
        </div>
        <div className="absolute inset-x-0 top-[76%] text-center font-display text-white" style={{ fontSize: "2.4cqw" }}>
          {t(MOCK_APPS[focus]?.label ?? "")}
        </div>

        {/* An app in front */}
        <AnimatePresence>
          {app && (
            <motion.div
              key={app}
              className="absolute inset-0 grid place-items-center"
              style={{ background: `linear-gradient(135deg, ${tint[0]}, ${tint[1]})` }}
              initial={{ clipPath: "inset(37% 43.5% 29% 43.5% round 1.2cqw)" }}
              animate={{ clipPath: "inset(0% 0% 0% 0% round 0cqw)" }}
              exit={{ clipPath: "inset(37% 43.5% 29% 43.5% round 1.2cqw)", opacity: 0.6 }}
              transition={{ duration: 0.42, ease: [0.25, 1, 0.5, 1] }}
            >
              {app === "Settings" ? (
                <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, #151a2b, #05060a)" }}>
                  <div className="absolute top-[20.8%] left-[8.6%] font-display font-light text-white/90" style={{ fontSize: "5cqw" }}>{t("Settings")}</div>
                  <div className="absolute top-[32.8%] left-[8.75%] text-white/50" style={{ fontSize: "1.9cqw" }}>{t("Family room")}</div>
                  <ul className="absolute top-[20.8%] left-1/2 w-[42.8%]">
                    {MOCK_SETTINGS.map((item, i) => (
                      <li
                        key={item}
                        className={`flex items-center gap-[2cqw] rounded-full pl-[2.4cqw] transition-colors duration-200 ${i === menu ? "bg-[#f2f4f8] font-medium text-ink" : "text-white/82"}`}
                        style={{ height: "5.94cqw", marginBottom: "0.625cqw", fontSize: "2.1cqw" }}
                      >
                        <span className={`h-[2cqw] w-[2cqw] rounded-full border-2 ${i === menu ? "border-ink/60" : "border-white/45"}`} />
                        {t(item)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : app === "Live TV" ? (
                <LiveTvPicture />
              ) : (
                <div className="font-display font-light text-white" style={{ fontSize: "6cqw" }}>{app}</div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Orbit OS's Control Center, on the remote's Settings key. */}
        <AnimatePresence>
          {control >= 0 && (
            <motion.div
              className="absolute top-[16.7%] right-[3.9%] w-[36.7%] rounded-[2.6cqw] bg-[#0c0e16]/90 p-[2.6cqw] text-white shadow-2xl ring-1 ring-white/10 backdrop-blur"
              initial={{ opacity: 0, x: "8%" }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: "8%" }}
              transition={spring}
            >
              <div className="font-display font-normal" style={{ fontSize: "2.3cqw" }}>
                {t("Control Center")}
              </div>
              <div className="mt-[2cqw] grid grid-cols-3 gap-[1.25cqw]">
                {MOCK_CONTROL.map((label, i) => (
                  <div
                    key={label}
                    className={`grid aspect-[0.95] place-items-center rounded-[1.9cqw] text-center transition-colors duration-200 ${i === control ? "bg-[#f2f4f8] font-semibold text-ink" : "bg-white/8 text-white/85"}`}
                    style={{ fontSize: "1.55cqw" }}
                  >
                    {t(label)}
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Help mode: the TV says so at its top while someone can see its screen. */}
        <AnimatePresence>
          {watched && (
            <motion.div
              className="absolute top-[1.1%] left-1/2 flex items-center gap-[0.75cqw] rounded-full border border-white/12 bg-[#08090e]/75 px-[1.3cqw] py-[0.5cqw] text-white backdrop-blur"
              style={{ fontSize: "1.4cqw", x: "-50%" }}
              initial={{ opacity: 0, y: "-40%" }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: "-40%" }}
              transition={spring}
            >
              <span className="h-[0.8cqw] w-[0.8cqw] rounded-full bg-[#ff4757]" />
              {t("Shiv can see this screen")}
            </motion.div>
          )}
        </AnimatePresence>

        {/* The Island, with the pairing code */}
        <AnimatePresence>
          {code && (
            <motion.div className="absolute inset-x-0 top-0" initial={{ opacity: 0, y: "-30%" }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: "-30%" }} transition={spring}>
              <div className="ribbon-line mx-auto h-[0.35cqw] w-[52%]" />
              <div className="mx-auto mt-[1.2cqw] w-fit text-center" style={{ fontSize: "1.9cqw" }}>
                <div className="font-medium text-white">
                  {codeTitle} <span className="tabular tracking-[0.12em]">{codeText}</span>
                </div>
                <div className="text-white/55" style={{ fontSize: "1.25cqw" }}>{t("Type it into Orbit on your phone")}</div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {overlay && (
            <motion.div className="absolute inset-x-0 bottom-[8%] mx-auto w-fit rounded-full bg-black/60 px-[2cqw] py-[0.8cqw] text-white backdrop-blur" style={{ fontSize: "1.7cqw" }}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              {tm(overlay)}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {volume && (
            <motion.div key="vol" className="absolute right-[3%] bottom-[8%] flex items-center gap-[0.8cqw] rounded-full bg-black/60 px-[1.4cqw] py-[0.7cqw] text-white backdrop-blur" style={{ fontSize: "1.5cqw" }}
              initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <span>{volume.muted ? t("Muted") : t("Volume")}</span>
              <span className="h-[0.5cqw] w-[9cqw] overflow-hidden rounded-full bg-white/20">
                <motion.span className="ribbon-line block h-full" animate={{ width: `${volume.muted ? 0 : volume.v}%` }} />
              </span>
              <span className="tabular">{volume.v}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* The pointer */}
        <motion.div
          className="pointer-events-none absolute h-[3.4cqw] w-[3.4cqw] -translate-x-1/2 -translate-y-1/2"
          animate={{ left: `${(cursor.x / 1280) * 100}%`, top: `${(cursor.y / 720) * 100}%`, opacity: cursor.on ? 1 : 0 }}
          transition={{ left: { duration: 0.06, ease: "linear" }, top: { duration: 0.06, ease: "linear" }, opacity: { duration: 0.3 } }}
        >
          <div className="absolute inset-[18%] rounded-full" style={{ background: "conic-gradient(#74d1ff, #ff74d1, #ffe9b3, #74d1ff)", WebkitMask: "radial-gradient(circle, transparent 54%, #000 57%)", mask: "radial-gradient(circle, transparent 54%, #000 57%)" }} />
          <div className="absolute top-1/2 left-1/2 h-[0.5cqw] w-[0.5cqw] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
          <AnimatePresence>
            <motion.div key={cursor.click} className="absolute inset-[18%] rounded-full border border-white" initial={{ scale: 1, opacity: cursor.click ? 1 : 0 }} animate={{ scale: 2.2, opacity: 0 }} transition={{ duration: 0.45 }} />
          </AnimatePresence>
        </motion.div>

        <AnimatePresence>
          {asking && (
            <motion.div className="absolute inset-0 grid place-items-center bg-black/55" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <motion.div
                className="w-[40%] rounded-[1cqw] bg-[#2b2f3a] p-[1.6cqw] text-white shadow-2xl"
                style={{ fontSize: "1.3cqw" }}
                initial={{ scale: 0.92 }}
                animate={{ scale: 1 }}
                transition={spring}
              >
                <div className="font-semibold" style={{ fontSize: "1.7cqw" }}>{t("Allow USB debugging?")}</div>
                <div className="mt-[0.6cqw] text-white/70">{t("The computer's RSA key fingerprint is shown here.")}</div>
                <div className="mt-[0.8cqw] flex items-center gap-[0.6cqw] rounded-[0.5cqw] px-[0.6cqw] py-[0.4cqw] ring-2 ring-[#74d1ff]/70">
                  <span className="h-[1.3cqw] w-[1.3cqw] rounded-[0.25cqw] bg-[#74d1ff]" /> {t("Always allow from this computer")}
                </div>
                <div className="mt-[1cqw] flex justify-end gap-[0.8cqw]">
                  <span className="px-[1cqw] py-[0.4cqw] text-white/70">{t("Cancel")}</span>
                  <span className="rounded-[0.5cqw] bg-white px-[1.2cqw] py-[0.4cqw] font-semibold text-black">{t("Allow")}</span>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {asleep && (
            <motion.div className="absolute inset-0 grid place-items-center bg-black text-white/40" style={{ fontSize: "1.8cqw" }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {t("Sleeping")}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Orbit Live TV on the pretend TV: a channel on air, its name and the programme, and the next ones under it. */
function LiveTvPicture() {
  const guide = [
    { at: "20:00", title: t("Evening Raga"), on: true },
    { at: "21:00", title: t("City News") },
    { at: "21:30", title: t("Monsoon Kitchen") },
  ];
  return (
    <div className="absolute inset-0" style={{ background: "radial-gradient(70% 90% at 30% 40%, #5b2a8a 0%, #1c0b33 55%, #07040d 100%)" }}>
      <div className="absolute top-[7%] left-[5%] flex items-center gap-[1cqw]" style={{ fontSize: "1.5cqw" }}>
        <span className="rounded-[0.5cqw] bg-[#ff4757] px-[0.8cqw] py-[0.2cqw] font-semibold tracking-[0.1em] text-white">{t("LIVE")}</span>
        <span className="text-white/75">{t("101 · Orbit Live TV")}</span>
      </div>
      <div className="absolute top-[38%] left-[5%] font-display font-light text-white" style={{ fontSize: "5.4cqw" }}>
        {t("Evening Raga")}
      </div>
      <div className="absolute top-[52%] left-[5%] text-white/60" style={{ fontSize: "1.7cqw" }}>
        {t("Music · until 21:00")}
      </div>
      <div className="absolute inset-x-[5%] bottom-[8%] flex gap-[1.2cqw]" style={{ fontSize: "1.4cqw" }}>
        {guide.map((g) => (
          <div key={g.at} className={`flex-1 rounded-[0.8cqw] px-[1.2cqw] py-[0.9cqw] ${g.on ? "bg-white/18 text-white" : "bg-white/7 text-white/60"}`}>
            <div className="tabular text-white/55">{g.at}</div>
            <div className="mt-[0.2cqw] truncate">{g.title}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
