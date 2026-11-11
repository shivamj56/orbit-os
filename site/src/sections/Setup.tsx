import s01 from "@/assets/setup/01-welcome.webp";
import s02 from "@/assets/setup/02b-find-found.webp";
import s03 from "@/assets/setup/03-devmode.webp";
import s04 from "@/assets/setup/04-allow-waiting.webp";
import s06 from "@/assets/setup/06-question-cast.webp";
import s11 from "@/assets/setup/11-plan.webp";
import s13 from "@/assets/setup/13b-installing.webp";
import s14 from "@/assets/setup/14-you.webp";
import s15 from "@/assets/setup/15-ready.webp";
import ScrollStack from "@/components/reactbits/ScrollStack";
import { Android } from "@/components/magicui/android";
import { SectionHead } from "@/components/kit/SectionHead";
import * as I from "@/components/kit/icons";
import { useReducedMotion } from "@/lib/hooks";

interface Step {
  title: string;
  text: string;
  shot: string;
  alt: string;
  you: string;
  orbit: string;
}

// The real setup, screen by screen, from the phone app's own mock (no private data on any of them).
const STEPS: Step[] = [
  { title: "Start", text: "Download Orbit to your Android phone, open it on the same Wi-Fi as the TV, and tap Start setup.", shot: s01, alt: "Orbit's first screen: Put Orbit OS on your TV, no computer and no code, with a Start setup button", you: "Tap Start setup", orbit: "Checks the Wi-Fi" },
  { title: "Find the TV", text: "Orbit looks on your Wi-Fi and finds the TV by itself, by its own name.", shot: s02, alt: "Find your TV: Family room, Xiaomi TV A Pro, found on this Wi-Fi", you: "Tap your TV", orbit: "Finds it on the Wi-Fi" },
  { title: "Developer mode", text: "Pictures of your TV's own menus show where to press: About, OK seven times, then USB debugging. Orbit notices by itself.", shot: s03, alt: "Turn on developer mode, with a picture of the TV's About menu and three numbered steps", you: "Press OK seven times", orbit: "Notices by itself" },
  { title: "Allow, once", text: "The TV asks whether this phone may set it up. Tick Always allow and press OK on the remote.", shot: s04, alt: "Press Allow on the TV: the TV's Allow USB debugging question, with Always allow ticked", you: "Press Allow", orbit: "Connects to the TV" },
  { title: "Five questions", text: "Do you cast? Use voice search? Watch the maker's channels? Play films from USB? Switch off ads and tracking? Big buttons, plain words.", shot: s06, alt: "Question 1 of 5: Do you cast videos from your phone to this TV? Yes, keep casting, or No, switch it off", you: "Five taps", orbit: "Keeps what you use" },
  { title: "The plan, first", text: "Every app it would switch off is named and grouped before anything changes. Keep any of them.", shot: s11, alt: "Here's the plan: install Orbit Home and Orbit Live TV, switch off 32 apps, never deleted, in named groups", you: "Read, then continue", orbit: "Changes nothing yet" },
  { title: "Installing", text: "It saves how to undo all of it first, then puts Orbit Home and Live TV on the TV. Keep the app open for about two minutes.", shot: s13, alt: "Setting up Family room: saved how to undo all of it, switching off 31 apps, installing Orbit Home", you: "Wait about two minutes", orbit: "Saves the undo first" },
  { title: "Your name", text: "Your TV greets you by name. Sign in with Google to reach it from anywhere, now or later.", shot: s14, alt: "Make it yours: the TV's greeting Good Morning, Asha, a name field and Continue with Google", you: "Type your name", orbit: "Greets you on the TV" },
  { title: "Ready", text: "Orbit OS is on the TV and this phone is its remote. Undo everything is one tap away.", shot: s15, alt: "Your TV is ready: Orbit OS is on Family room and this phone is its remote", you: "Open the remote", orbit: "Undo stays one tap away" },
];

/** "Five minutes, no computer": the real setup screens as a deck of cards that stack as you scroll (React Bits ScrollStack). */
export function Setup() {
  const reduce = useReducedMotion();
  return (
    <section id="setup" tabIndex={-1} aria-labelledby="setup-title" className="relative pt-[clamp(5rem,10vw,8rem)] outline-none">
      <div className="wrap">
        <SectionHead
          eyebrow="Five minutes, no computer"
          title="Set up from your phone."
          lede="Orbit does the work over your home Wi-Fi. The one switch it cannot press for you, it shows you, with pictures of your TV's own menus."
        />
        <span id="setup-title" className="sr-only">
          Set up Orbit OS from your phone
        </span>
        <ul className="mt-7 flex flex-wrap gap-2.5" aria-label="At a glance">
          {[
            [<I.Phone size={15} key="p" />, "Android phone on the same Wi-Fi"],
            [<I.Timer size={15} key="t" />, "About five minutes"],
            [<I.Undo size={15} key="u" />, "Undo any time, one tap"],
          ].map(([icon, text]) => (
            <li key={text as string} className="inline-flex items-center gap-2 rounded-full border border-line bg-veil/[0.03] px-3.5 py-1.5 text-[0.875rem] text-soft">
              <span className="text-accent">{icon}</span>
              {text}
            </li>
          ))}
        </ul>
      </div>
      <div role="list" className="mt-[clamp(2rem,5vw,3.5rem)]" aria-label="The setup, step by step">
        <ScrollStack useWindowScroll smoothScroll={false} stackPosition="13%" itemDistance={90} itemStackDistance={16} itemScale={reduce ? 0 : 0.04} baseScale={reduce ? 1 : 0.84} dimAmount={0.22} holdDistance={120}>
          {STEPS.map((s, i) => (
            <div key={s.title} role="listitem" className="wrap origin-top will-change-transform">
              <StepCard step={s} index={i} total={STEPS.length} />
            </div>
          ))}
        </ScrollStack>
      </div>
    </section>
  );
}

function StepCard({ step, index, total }: { step: Step; index: number; total: number }) {
  return (
    <article className="relative mx-auto grid h-[min(36rem,76svh)] max-w-[60rem] grid-cols-1 grid-rows-[auto_1fr] overflow-hidden rounded-[2rem] border border-line bg-surface shadow-[0_-12px_40px_-24px_rgb(var(--shadow-rgb)/var(--shadow-a)),0_40px_80px_-40px_rgb(var(--shadow-rgb)/var(--shadow-a))] max-md:h-[min(41rem,84svh)] md:grid-cols-[minmax(0,1fr)_auto] md:grid-rows-1">
      {/* the card's own light */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: "var(--iris)" }} />
      <span aria-hidden="true" className="pointer-events-none absolute -top-24 -left-24 size-80 rounded-full bg-[radial-gradient(closest-side,var(--halo-1),transparent)]" />
      <span aria-hidden="true" data-contrast-skip="" className="pointer-events-none absolute -top-[6%] left-[2%] font-display text-[clamp(9rem,22vw,17rem)] leading-none font-[200] tracking-[-0.06em] text-veil/[0.05] select-none max-md:hidden">
        {String(index).padStart(2, "0")}
      </span>

      <div className="relative order-2 flex flex-col justify-start gap-3 p-5 sm:gap-4 sm:p-9 md:order-1 md:justify-center">
        <div className="flex items-center gap-3">
          <p className="font-mono text-[0.75rem] tracking-[0.14em] text-accent uppercase">
            Step {String(index).padStart(2, "0")} <span className="text-faint">/ {String(total - 1).padStart(2, "0")}</span>
          </p>
          <span aria-hidden="true" className="flex flex-1 gap-1">
            {Array.from({ length: total }, (_, k) => (
              <span key={k} className={`h-[3px] flex-1 rounded-full ${k <= index ? "bg-accent" : "bg-veil/10"}`} />
            ))}
          </span>
        </div>
        <h3 className="font-display text-[clamp(1.75rem,3.4vw,2.75rem)] leading-[1.05] font-[460] tracking-[-0.025em] text-ink">{step.title}</h3>
        <p className="max-w-[30rem] text-[clamp(0.9375rem,1.3vw,1.125rem)] leading-relaxed text-soft">{step.text}</p>
        <dl className="mt-1 grid max-w-[30rem] grid-cols-2 gap-2.5 text-[0.875rem] max-md:[@media(max-height:760px)]:hidden">
          <div className="rounded-2xl border border-line bg-veil/[0.03] px-3.5 py-2.5">
            <dt className="font-mono text-[0.6875rem] tracking-[0.12em] text-dim uppercase">You</dt>
            <dd className="mt-0.5 text-ink">{step.you}</dd>
          </div>
          <div className="rounded-2xl border border-line bg-veil/[0.03] px-3.5 py-2.5">
            <dt className="font-mono text-[0.6875rem] tracking-[0.12em] text-dim uppercase">Orbit</dt>
            <dd className="mt-0.5 text-ink">{step.orbit}</dd>
          </div>
        </dl>
      </div>

      <div className="relative order-1 flex items-start justify-center overflow-hidden px-6 pt-5 md:order-2 md:items-center md:px-10 md:pt-0">
        <span aria-hidden="true" className="halo pointer-events-none absolute inset-0" />
        <Android src={step.shot} alt={step.alt} className="relative w-[min(9rem,34vw)] drop-shadow-[0_30px_40px_rgb(var(--shadow-rgb)/calc(var(--shadow-a)*0.6))] md:w-[min(15rem,26vw)] max-md:[@media(max-height:700px)]:w-[min(7.5rem,30vw)]" />
      </div>
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] bg-page opacity-[var(--scroll-stack-dim,0)]" />
    </article>
  );
}
