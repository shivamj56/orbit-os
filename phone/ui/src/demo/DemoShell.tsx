import { useEffect, useState } from "react";
import { App } from "../App";
import { MockTv } from "./MockTv";

function useWide() {
  const query = "(min-width: 900px) and (min-height: 600px)";
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

/** A phone, drawn plainly: the app is the point, not the hardware. */
function Phone({ children }: { children: React.ReactNode }) {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => setScale(Math.min(1, (window.innerHeight - 48) / 860));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return (
    <div style={{ width: 406 * scale, height: 860 * scale }} className="shrink-0">
      <div
        className="origin-top-left rounded-[58px] bg-[#16181f] p-[8px] shadow-[0_50px_140px_-40px_rgba(0,0,0,0.95)] ring-1 ring-white/10"
        style={{ width: 406, height: 860, transform: `scale(${scale})` }}
      >
        <div className="relative h-full w-full overflow-hidden rounded-[50px] bg-ink" style={{ transform: "translateZ(0)" }}>
          {children}
          <div className="pointer-events-none absolute top-[12px] left-1/2 z-[70] h-[10px] w-[10px] -translate-x-1/2 rounded-full bg-black ring-1 ring-white/10" />
        </div>
      </div>
    </div>
  );
}

export function DemoShell() {
  const wide = useWide();
  const [tvShown, setTvShown] = useState(true);
  if (!wide) {
    return (
      <div className="flex h-full flex-col bg-ink">
        {tvShown && (
          <div className="relative shrink-0">
            <MockTv compact />
            <button
              type="button"
              onClick={() => setTvShown(false)}
              className="absolute top-2 right-2 rounded-full bg-black/55 px-2.5 py-1 text-[11px] text-white/70 backdrop-blur"
            >
              Hide TV
            </button>
          </div>
        )}
        <div className="relative min-h-0 flex-1">
          <App />
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full items-center justify-center gap-16 overflow-hidden bg-[#030407] px-10">
      <Phone>
        <App />
      </Phone>
      <div className="w-full max-w-[660px]">
        <p className="mb-5 font-display text-[15px] font-light tracking-[0.02em] text-white/45">
          <span className="ribbon-text font-normal">Orbit</span> · a demo with a pretend TV
        </p>
        <MockTv />
        <ul className="mt-7 grid grid-cols-2 gap-x-8 gap-y-3 text-[14px] text-white/60">
          <li><span className="text-white/90">Roll the globe</span>: the TV's focus steps, like a BlackBerry ball.</li>
          <li><span className="text-white/90">Tap it</span>: OK. <span className="text-white/90">Hold it</span>: recent apps.</li>
          <li><span className="text-white/90">Cursor</span>: glide to point, tap to click, two fingers to scroll.</li>
          <li><span className="text-white/90">The code</span> shows at the top of the TV, here too.</li>
        </ul>
      </div>
    </div>
  );
}
