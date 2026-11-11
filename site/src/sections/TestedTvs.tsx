import { motion } from "motion/react";
import { SectionHead } from "@/components/kit/SectionHead";
import * as I from "@/components/kit/icons";
import { NEW_ISSUE_URL } from "@/lib/links";

const MEASURED = [
  { what: "Control Center, opening and moving", value: "60", unit: "fps", note: "no missed frames" },
  { what: "Scrolling the gallery", value: "≈11", unit: "ms a frame", note: "no janky frames in 400" },
  { what: "Live TV playing a channel", value: "54–62", unit: "MB", note: "of memory" },
  { what: "Home on screen after power-on", value: "≈39", unit: "s", note: "the boot film included" },
];

/** Tested TVs: the one in daily use, what was measured on it, and a call for the next model. */
export function TestedTvs() {
  return (
    <section id="tvs" tabIndex={-1} aria-labelledby="tvs-title" className="relative py-[clamp(5rem,11vw,8rem)] outline-none">
      <div className="wrap">
        <SectionHead eyebrow="Tested TVs" title="Tested on real TVs, one model at a time." lede="Orbit OS knows a TV before it changes one. Each tested model gets its own notes: what is safe to switch off, what must go together, and what its remote sends." />
        <span id="tvs-title" className="sr-only">
          Tested TVs
        </span>

        <div className="mt-[clamp(2.5rem,5vw,4rem)] grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)]">
          <article className="panel relative overflow-hidden rounded-[2rem] p-6 sm:p-8">
            <div aria-hidden="true" className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-[radial-gradient(closest-side,rgba(126,226,184,0.14),transparent)]" />
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="font-display text-[clamp(1.5rem,2.4vw,2rem)] leading-tight font-medium text-ink">Xiaomi TV A Pro</h3>
                <p className="mt-1 font-mono text-[0.8125rem] text-soft">MiTV-AXFU0 · Google TV 14</p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full border border-mint/30 bg-mint/[0.08] px-3 py-1.5 text-[0.8125rem] font-medium text-mint">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full rounded-full bg-mint/60 motion-safe:animate-ping" />
                  <span className="relative inline-flex size-2 rounded-full bg-mint" />
                </span>
                In daily use
              </span>
            </div>
            <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 border-y border-white/[0.07] py-5 text-[0.875rem] sm:grid-cols-4">
              {[
                ["System", "Android 14"],
                ["Panel", "1280 × 720, 60 Hz"],
                ["Chip", "4 × Cortex-A53"],
                ["Memory", "Low-RAM device"],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="font-mono text-[0.6875rem] tracking-[0.12em] text-dim uppercase">{k}</dt>
                  <dd className="mt-1 text-ink">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-5 font-mono text-[0.6875rem] tracking-[0.14em] text-dim uppercase">Measured on this TV</p>
            <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {MEASURED.map((m, i) => (
                <motion.li
                  key={m.what}
                  initial={{ opacity: 0, y: 14 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.6 }}
                  transition={{ duration: 0.5, delay: i * 0.07, ease: [0.19, 1, 0.22, 1] }}
                  className="rounded-2xl border border-white/[0.07] bg-black/20 p-4"
                >
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-display text-[2rem] leading-none font-light text-ink">{m.value}</span>
                    <span className="text-[0.875rem] text-soft">{m.unit}</span>
                  </div>
                  <div className="mt-2 text-[0.875rem] text-ink/90">{m.what}</div>
                  <div className="text-[0.8125rem] text-dim">{m.note}</div>
                </motion.li>
              ))}
            </ul>
          </article>

          <article className="relative flex flex-col justify-between overflow-hidden rounded-[2rem] border border-dashed border-[#ADC6FF]/25 p-6 sm:p-8">
            <div>
              <span className="grid size-12 place-items-center rounded-2xl border border-white/10 bg-white/[0.03] text-ice">
                <I.Tv size={22} />
              </span>
              <h3 className="mt-5 font-display text-[clamp(1.4rem,2.2vw,1.75rem)] leading-tight font-medium text-ink">Your TV could be next.</h3>
              <p className="mt-3 text-[0.9375rem] leading-relaxed text-soft">
                On a model it has not seen, Orbit only suggests the changes it knows are safe on any Google TV or Android TV. Tried it on
                another TV? Tell us how it went, and your model joins this list with its own notes.
              </p>
            </div>
            <a
              href={NEW_ISSUE_URL}
              target="_blank"
              rel="noopener"
              className="group mt-6 inline-flex h-12 items-center justify-center gap-2 self-start rounded-full border border-white/15 bg-white/[0.05] px-5 text-[0.9375rem] font-medium text-ink transition-colors hover:border-white/30 hover:bg-white/[0.08]"
            >
              Become a tester
              <I.ArrowUpRight size={17} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </a>
          </article>
        </div>
      </div>
    </section>
  );
}
