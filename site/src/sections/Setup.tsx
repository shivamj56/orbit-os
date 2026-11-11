import { AnimatePresence, motion, useMotionValueEvent, useScroll, useSpring } from "motion/react";
import { useRef, useState } from "react";
import s01 from "@/assets/setup/01-welcome.webp";
import s02 from "@/assets/setup/02b-find-found.webp";
import s03 from "@/assets/setup/03-devmode.webp";
import s04 from "@/assets/setup/04-allow-waiting.webp";
import s06 from "@/assets/setup/06-question-cast.webp";
import s09 from "@/assets/setup/09-question-ads.webp";
import s11 from "@/assets/setup/11-plan.webp";
import s13 from "@/assets/setup/13b-installing.webp";
import s14 from "@/assets/setup/14-you.webp";
import s15 from "@/assets/setup/15-ready.webp";
import { SectionHead } from "@/components/kit/SectionHead";
import { useReducedMotion } from "@/lib/hooks";

interface Step {
  title: string;
  text: string;
  shots: string[];
  alt: string;
}

const STEPS: Step[] = [
  { title: "Start", text: "Download Orbit to your Android phone, open it on the same Wi-Fi as the TV, and tap Start setup.", shots: [s01], alt: "Orbit's first screen: Put Orbit OS on your TV, no computer and no code, with a Start setup button" },
  { title: "Find the TV", text: "Orbit looks on your Wi-Fi and finds the TV by itself, by its own name.", shots: [s02], alt: "Find your TV: Family room, Xiaomi TV A Pro, found on this Wi-Fi" },
  { title: "Developer mode", text: "Pictures of your TV's own menus show where to press: About, OK seven times, then USB debugging. Orbit notices by itself.", shots: [s03], alt: "Turn on developer mode, with a picture of the TV's About menu and three numbered steps" },
  { title: "Allow, once", text: "The TV asks whether this phone may set it up. Tick Always allow and press OK on the remote.", shots: [s04], alt: "Press Allow on the TV: the TV's Allow USB debugging question, with Always allow ticked" },
  { title: "Five questions", text: "Do you cast? Use voice search? Watch the maker's channels? Play films from USB? Switch off ads and tracking? Big buttons, plain words.", shots: [s06, s09], alt: "Question 1 of 5: Do you cast videos from your phone to this TV? Yes, keep casting, or No, switch it off" },
  { title: "The plan, first", text: "Every app it would switch off is named and grouped before anything changes. Keep any of them.", shots: [s11], alt: "Here's the plan: install Orbit Home and Orbit Live TV, switch off 32 apps, never deleted, in named groups" },
  { title: "Installing", text: "It saves how to undo all of it first, then puts Orbit Home and Live TV on the TV. Keep the app open for about two minutes.", shots: [s13], alt: "Setting up Family room: saved how to undo all of it, switching off 31 apps, installing Orbit Home" },
  { title: "Your name", text: "Your TV greets you by name. Sign in with Google to reach it from anywhere, now or later.", shots: [s14], alt: "Make it yours: the TV's greeting Good Morning, Asha, a name field and Continue with Google" },
  { title: "Ready", text: "Orbit OS is on the TV and this phone is its remote. Undo everything is one tap away.", shots: [s15], alt: "Your TV is ready: Orbit OS is on Family room and this phone is its remote" },
];

/** "Five minutes, no computer": a pinned phone that steps through the real setup screens as you scroll. */
export function Setup() {
  const outer = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: outer, offset: ["start start", "end end"] });
  const smooth = useSpring(scrollYProgress, { stiffness: 120, damping: 28, mass: 0.6 });
  const [step, setStep] = useState(0);
  const [sub, setSub] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", (p) => {
    const x = Math.min(STEPS.length - 0.001, Math.max(0, p * STEPS.length));
    const i = Math.floor(x);
    setStep(i);
    const shots = STEPS[i].shots.length;
    setSub(Math.min(shots - 1, Math.floor((x - i) * shots)));
  });

  const current = STEPS[step];
  const shot = current.shots[sub] ?? current.shots[0];

  return (
    <section id="setup" tabIndex={-1} aria-labelledby="setup-title" className="relative outline-none">
      <div className="wrap pt-[clamp(5rem,10vw,8rem)] lg:hidden">
        <SectionHead eyebrow="Five minutes, no computer" title="Set up from your phone." lede="Orbit does the work over your home Wi-Fi. The one switch it cannot press for you, it shows you, with pictures of your TV's own menus." />
      </div>
      <div ref={outer} style={{ height: `${STEPS.length * 58 + 42}vh` }} className="relative">
        <div className="sticky top-0 flex h-[100svh] items-center overflow-hidden">
          <div aria-hidden="true" className="pointer-events-none absolute top-1/2 right-[8%] -z-10 h-[70vh] w-[50vw] -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(116,209,255,0.09),transparent)] max-lg:right-1/2 max-lg:translate-x-1/2" />
          <div className="wrap grid grid-cols-1 items-center gap-x-16 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="hidden lg:block">
              <SectionHead
                eyebrow="Five minutes, no computer"
                title="Set up from your phone."
                lede="Orbit does the work over your home Wi-Fi. The one switch it cannot press for you, it shows you, with pictures of your TV's own menus."
              />
              <span id="setup-title" className="sr-only">
                Set up Orbit OS from your phone
              </span>
              <ol className="relative mt-10 max-w-[30rem]">
                <span aria-hidden="true" className="absolute top-2 bottom-2 left-[0.9375rem] w-px bg-white/10" />
                <motion.span
                  aria-hidden="true"
                  className="absolute top-2 left-[0.9375rem] w-px origin-top bg-[linear-gradient(180deg,#74D1FF,#ADC6FF,#E9B3FF)]"
                  style={{ height: "calc(100% - 1rem)", scaleY: smooth }}
                />
                {STEPS.map((s, i) => (
                  <li key={s.title} className="relative pl-12">
                    <span
                      className={`absolute top-[0.55rem] left-0 grid size-[1.9rem] place-items-center rounded-full border font-mono text-[0.6875rem] transition-all duration-500 ${
                        i < step ? "border-[#ADC6FF]/30 bg-[#1a2340] text-ice" : i === step ? "border-sky bg-sky text-night shadow-[0_0_24px_rgba(116,209,255,0.6)]" : "border-white/15 bg-[#070a12] text-faint"
                      }`}
                    >
                      {String(i).padStart(2, "0")}
                    </span>
                    <div className={`py-2.5 transition-colors duration-500 ${i === step ? "text-ink" : i < step ? "text-soft" : "text-faint"}`}>
                      <div className="font-display text-[1.125rem] font-medium">{s.title}</div>
                      <AnimatePresence initial={false}>
                        {i === step && (
                          <motion.p
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: reduce ? 0 : 0.4, ease: [0.19, 1, 0.22, 1] }}
                            className="overflow-hidden text-[0.9375rem] leading-relaxed text-soft"
                          >
                            <span className="block pt-1.5">{s.text}</span>
                          </motion.p>
                        )}
                      </AnimatePresence>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <div className="flex flex-col items-center">
              <PhoneShot src={shot} alt={current.alt} reduce={reduce} step={step} />
              {/* the caption on a phone, under the pinned screen */}
              <div className="mt-6 w-full max-w-[24rem] text-center lg:hidden" aria-live="polite">
                <div className="flex items-center justify-center gap-3">
                  <span className="font-mono text-[0.75rem] text-sky">
                    {String(step).padStart(2, "0")} / {String(STEPS.length - 1).padStart(2, "0")}
                  </span>
                  <span className="font-display text-[1.25rem] text-ink">{current.title}</span>
                </div>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.p
                    key={step}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: reduce ? 0 : 0.3 }}
                    className="mt-2 min-h-[4.5rem] text-[0.9375rem] leading-relaxed text-soft"
                  >
                    {current.text}
                  </motion.p>
                </AnimatePresence>
                <div className="mt-3 flex justify-center gap-1.5" aria-hidden="true">
                  {STEPS.map((_, i) => (
                    <span key={i} className={`h-1 rounded-full transition-all duration-500 ${i === step ? "w-6 bg-sky" : i < step ? "w-1.5 bg-ice/50" : "w-1.5 bg-white/15"}`} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function PhoneShot({ src, alt, reduce, step }: { src: string; alt: string; reduce: boolean; step: number }) {
  return (
    <div className="relative">
      {/* an orbit around the phone, drawn a little further each step */}
      <svg aria-hidden="true" viewBox="0 0 400 400" className="pointer-events-none absolute top-1/2 left-1/2 -z-10 w-[170%] -translate-1/2 overflow-visible max-lg:w-[150%]">
        <defs>
          <linearGradient id="setup-orbit" x1="0" x2="1">
            <stop offset="0" stopColor="#74D1FF" />
            <stop offset=".5" stopColor="#ADC6FF" />
            <stop offset="1" stopColor="#E9B3FF" />
          </linearGradient>
        </defs>
        <g transform="rotate(-16 200 200)">
          <ellipse cx="200" cy="200" rx="190" ry="62" fill="none" stroke="rgba(173,198,255,0.10)" strokeWidth="1" />
          <motion.ellipse
            cx="200"
            cy="200"
            rx="190"
            ry="62"
            fill="none"
            stroke="url(#setup-orbit)"
            strokeWidth="1.6"
            strokeLinecap="round"
            initial={false}
            animate={{ pathLength: (step + 1) / STEPS.length }}
            transition={{ duration: reduce ? 0 : 0.8, ease: [0.19, 1, 0.22, 1] }}
          />
        </g>
      </svg>
      <div className="relative w-[min(18.5rem,58vw)] rounded-[2.9rem] bg-[linear-gradient(160deg,#2a3048,#0c1020_45%,#1b2136)] p-[0.55rem] shadow-[0_60px_120px_-40px_rgba(0,0,0,0.95),inset_0_1px_0_rgba(255,255,255,0.18),0_0_0_1px_rgba(173,198,255,0.14)] max-lg:w-[min(15.5rem,52vw)] [@media(max-height:760px)]:w-[min(14rem,50vw)]">
        <div className="relative aspect-[780/1688] overflow-hidden rounded-[2.4rem] bg-night">
          <AnimatePresence initial={false}>
            <motion.img
              key={src}
              src={src}
              alt={alt}
              draggable={false}
              className="absolute inset-0 h-full w-full object-cover"
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.04, filter: "blur(6px)" }}
              animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
              transition={{ duration: reduce ? 0 : 0.5, ease: [0.19, 1, 0.22, 1] }}
            />
          </AnimatePresence>
          <div className="pointer-events-none absolute top-2.5 left-1/2 h-[1.3rem] w-[5rem] -translate-x-1/2 rounded-full bg-black" />
        </div>
      </div>
      <div className="absolute -top-10 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-night/80 px-3 py-1 font-mono text-[0.6875rem] text-ice backdrop-blur max-lg:hidden">
        {String(step).padStart(2, "0")} / {String(STEPS.length - 1).padStart(2, "0")}
      </div>
    </div>
  );
}
