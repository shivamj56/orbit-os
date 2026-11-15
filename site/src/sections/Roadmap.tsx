import { motion } from "motion/react";
import { useRef, type ReactNode } from "react";
import StatusMark, { type StatusMarkStatus } from "@/components/reactbits/StatusMark";
import { SectionHead } from "@/components/kit/SectionHead";
import * as I from "@/components/kit/icons";
import { useInView } from "@/lib/hooks";
import { useThemeValue } from "@/lib/themeContext";

interface Item {
  icon: ReactNode;
  title: string;
  text: string;
}

// From docs/roadmap.md and the README's roadmap: what is done, what is next, what comes later.
const COLUMNS: { when: string; status: StatusMarkStatus; note: string; items: Item[] }[] = [
  {
    when: "Now",
    status: "done",
    note: "In Orbit 1.3.0",
    items: [
      { icon: <I.Phone size={17} />, title: "Setup from your phone", text: "From Welcome to Ready on the phone, with the plan shown first and one-tap undo." },
      { icon: <I.Tv size={17} />, title: "Orbit Home, Live TV, the remote", text: "The home screen, 30 free channels, the globe remote, from anywhere and Help mode." },
    ],
  },
  {
    when: "Next",
    status: "running",
    note: "Up next",
    items: [
      { icon: <I.Tv size={17} />, title: "Setup on the TV itself", text: "The same pictures and questions on the TV, moved with the remote, for homes without an Android phone." },
      { icon: <I.Users size={17} />, title: "Your name, your account", text: "A first start on the TV that asks your name and email, and one account for the TV and the phone." },
      { icon: <I.Bolt size={17} />, title: "A public release", text: "Signed releases on GitHub with checksums, and a short video." },
    ],
  },
  {
    when: "Later",
    status: "pending",
    note: "Planned",
    items: [
      { icon: <I.Route size={17} />, title: "Any Android TV or Google TV", text: "A library of TV models: what each built-in app does, and what is safe to switch off." },
      { icon: <I.Remote size={17} />, title: "A remote that fits each TV", text: "Its own buttons, inputs and apps, read from that TV." },
      { icon: <I.Tablet size={17} />, title: "Tablets", text: "Orbit on a bigger screen." },
      { icon: <I.Phone size={17} />, title: "iPhone", text: "Orbit for iPhone owners. For now Orbit needs an Android phone." },
    ],
  },
];

export function Roadmap() {
  const box = useRef<HTMLDivElement>(null);
  const seen = useInView(box, 0.25, true);
  const day = useThemeValue() === "light";
  return (
    <section id="roadmap" aria-labelledby="roadmap-title" className="relative py-[clamp(5rem,11vw,8rem)]">
      <div className="wrap">
        <SectionHead eyebrow="Roadmap" title="Where Orbit goes next." lede="The goal does not change: anyone can put Orbit OS on their TV in a few minutes, and take it off again just as easily." />
        <span id="roadmap-title" className="sr-only">
          Roadmap
        </span>
        <div ref={box} className="relative mt-[clamp(2.5rem,5vw,4rem)] grid grid-cols-1 gap-5 lg:grid-cols-3">
          <span aria-hidden="true" className="absolute top-[1.4rem] right-[16%] left-[16%] hidden h-px bg-[linear-gradient(90deg,var(--ok),var(--accent),var(--line))] lg:block" />
          {COLUMNS.map((col, ci) => (
            <motion.div
              key={col.when}
              initial={{ opacity: 0, y: 24 }}
              animate={seen ? { opacity: 1, y: 0 } : undefined}
              transition={{ duration: 0.7, delay: ci * 0.15, ease: [0.19, 1, 0.22, 1] }}
              className="relative"
            >
              <div className="relative z-10 mx-auto flex w-fit items-center gap-2.5 rounded-full border border-line bg-surface px-4 py-2 shadow-[0_12px_30px_-20px_rgb(var(--shadow-rgb)/var(--shadow-a))]">
                <StatusMark status={seen ? col.status : "pending"} size={20} strokeWidth={2} color={day ? "#4a5371" : "#b4bdd6"} doneColor={day ? "#0a7350" : "#7ee2b8"} />
                <span className="font-display text-[1.0625rem] font-medium text-ink">{col.when}</span>
                <span className="font-mono text-[0.6875rem] tracking-[0.1em] text-dim uppercase">{col.note}</span>
              </div>
              <ul className="mt-5 space-y-3">
                {col.items.map((it) => (
                  <li key={it.title} className="card flex gap-3.5 rounded-2xl p-4 transition-transform duration-300 hover:-translate-y-0.5">
                    <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl ${col.status === "done" ? "bg-ok/12 text-ok" : col.status === "running" ? "bg-accent/12 text-accent" : "bg-veil/[0.06] text-soft"}`}>{it.icon}</span>
                    <span>
                      <span className="block text-[0.9375rem] font-medium text-ink">{it.title}</span>
                      <span className="mt-0.5 block text-[0.875rem] leading-relaxed text-soft">{it.text}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
