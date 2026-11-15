import { AnimatePresence, motion } from "motion/react";
import { useId, useState } from "react";
import { SectionHead } from "@/components/kit/SectionHead";
import * as I from "@/components/kit/icons";
import { useReducedMotion } from "@/lib/hooks";

const QA = [
  { q: "Do I need a computer?", a: "No. Orbit on your phone does everything over your home Wi-Fi. You only use the TV's remote to turn on developer mode and to press Allow once." },
  { q: "Can I go back to how my TV was?", a: "Yes. In Orbit, open Settings › This TV › Undo Orbit OS on this TV. Every app comes back on and the TV's own home screen returns." },
  { q: "Will Orbit affect my TV's warranty?", a: "Orbit doesn't root your TV, unlock it or change its firmware. It uses Android's own developer settings, installs two ordinary apps and switches off, never deletes, the preinstalled apps you choose, and Undo puts everything back. The warranty terms are your TV maker's, so if the TV ever goes for repair, use Undo everything first and it is just as it came." },
  { q: "Will my apps and accounts keep working?", a: "Yes. Netflix, YouTube, Prime Video and every other app you use stay as they are, signed in. Orbit only changes the home screen and switches off what you choose." },
  { q: "Does Live TV cost anything?", a: "No. The 30 channels are free streams from the channels themselves. Pay channels such as Star Plus or Sony SAB open in their own apps, where you need their plan." },
  { q: "I have an iPhone. Can I use Orbit?", a: "Not yet. Orbit needs an Android phone for now. A version you can run on the TV itself is on the way." },
  { q: "Is it really free?", a: "Yes. No ads, no subscription and no tracking. Orbit OS is also open source: its code is on GitHub under the GPL-3.0 licence." },
  { q: "Which TVs does it work on?", a: "It is tested and in daily use on a Xiaomi TV A Pro with Google TV 14. On other Google TV and Android TV sets, Orbit offers only the changes it knows are safe on any TV, and one tap puts everything back." },
  { q: "What exactly does it switch off?", a: "Only what you agree to after reading the list. On the tested TV that was 32 apps, in groups like ads and tracking, apps nobody uses and the stock home screen. They are switched off, never deleted, and the parts Android needs are never touched." },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  const reduce = useReducedMotion();
  const base = useId();
  return (
    <section id="faq" tabIndex={-1} aria-labelledby="faq-title" className="relative py-[clamp(4rem,9vw,7rem)] outline-none">
      <div className="wrap grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div>
          <SectionHead eyebrow="Questions" title="Before you start." lede="Short answers. Anything else, ask on GitHub." />
          <span id="faq-title" className="sr-only">
            Questions
          </span>
        </div>
        <div className="divide-y divide-line border-y border-line">
          {QA.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={item.q}>
                <h3>
                  <button
                    type="button"
                    id={`${base}-q${i}`}
                    aria-expanded={isOpen}
                    aria-controls={`${base}-a${i}`}
                    onClick={() => setOpen(isOpen ? null : i)}
                    className="group flex w-full items-center justify-between gap-6 py-5 text-left font-sans text-[1.0625rem] font-medium text-ink"
                  >
                    {item.q}
                    <span className={`grid size-8 shrink-0 place-items-center rounded-full border transition-all duration-300 ${isOpen ? "rotate-45 border-accent/50 bg-accent/10 text-accent" : "border-line text-soft group-hover:border-veil/20 group-hover:text-ink"}`}>
                      <I.Plus size={16} />
                    </span>
                  </button>
                </h3>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      id={`${base}-a${i}`}
                      role="region"
                      aria-labelledby={`${base}-q${i}`}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: reduce ? 0 : 0.35, ease: [0.19, 1, 0.22, 1] }}
                      className="overflow-hidden"
                    >
                      <p className="max-w-[40rem] pb-6 text-[1rem] leading-relaxed text-soft">{item.a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
