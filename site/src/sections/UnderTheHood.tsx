import { motion } from "motion/react";
import type { ReactNode } from "react";
import { AnimatedSpan, Terminal, TypingAnimation } from "@/components/magicui/terminal";
import { useReducedMotion } from "@/lib/hooks";
import { SectionHead } from "@/components/kit/SectionHead";
import * as I from "@/components/kit/icons";
import { REPO_URL } from "@/lib/links";

const STEPS = [
  {
    icon: <I.Phone size={18} />,
    title: "The phone opens the TV's own door",
    text: "Orbit finds the TV on the Wi-Fi and opens the TV's own debugging connection: ADB over Wi-Fi, port 5555, signed with the app's own key. The TV asks Allow once.",
    tag: "ADB · :5555",
  },
  {
    icon: <I.Terminal size={18} />,
    title: "One script does every change",
    text: "orbit-setup.sh goes to the TV with both apps and runs in the TV's own shell, so phone, computer and TV all do exactly the same thing. It refuses core packages and never uninstalls a factory app.",
    tag: "setup/tv/orbit-setup.sh",
  },
  {
    icon: <I.FileText size={18} />,
    title: "Every change is written down",
    text: "Each change becomes one line of undo.txt, kept on the TV and sent to the phone as it happens. Only packages Orbit's catalog knows are safe are ever offered.",
    tag: "undo.txt",
  },
  {
    icon: <I.Undo size={18} />,
    title: "One script puts it all back",
    text: "orbit-undo.sh reads the record: the TV's own home screen comes back first, so it is never left without one, and Orbit's own apps go last.",
    tag: "setup/tv/orbit-undo.sh",
  },
];

const DOCS = [
  { label: "How it is built", href: `${REPO_URL}/blob/main/docs/architecture.md` },
  { label: "Phone and TV contract", href: `${REPO_URL}/blob/main/phone/SPEC.md` },
  { label: "The setup script", href: `${REPO_URL}/blob/main/setup/tv/orbit-setup.sh` },
  { label: "Tested TVs", href: `${REPO_URL}/tree/main/devices` },
];

/** "Under the hood", for developers: phone → the TV's own debugging switch → one script → an undo record. */
export function UnderTheHood() {
  const reduce = useReducedMotion();
  return (
    <section id="hood" tabIndex={-1} aria-labelledby="hood-title" className="relative py-[clamp(5rem,11vw,9rem)] outline-none">
      <div className="wrap">
        <SectionHead
          eyebrow="Under the hood"
          title="One script, one record, nothing hidden."
          lede="For developers and the curious: how a phone sets up a TV with no computer, and how every change comes back."
        />
        <span id="hood-title" className="sr-only">
          Under the hood
        </span>

        <div className="mt-[clamp(2.5rem,5vw,4rem)] grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <ol className="relative">
            <span aria-hidden="true" className="absolute top-3 bottom-3 left-[1.125rem] w-px bg-line" />
            <motion.span
              aria-hidden="true"
              className="absolute top-3 left-[1.125rem] w-px origin-top"
              style={{ background: "var(--iris)", height: "calc(100% - 1.5rem)" }}
              initial={{ scaleY: 0 }}
              whileInView={{ scaleY: 1 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ duration: 1.6, ease: [0.65, 0, 0.35, 1] }}
            />
            {STEPS.map((s, i) => (
              <motion.li
                key={s.title}
                className="relative pb-7 pl-14 last:pb-0"
                initial={{ opacity: 0, x: -12 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, amount: 0.6 }}
                transition={{ duration: 0.6, delay: i * 0.12, ease: [0.19, 1, 0.22, 1] }}
              >
                <span className="absolute top-0 left-0 grid size-9 place-items-center rounded-full border border-line bg-surface text-accent shadow-[0_8px_24px_-12px_rgb(var(--shadow-rgb)/var(--shadow-a))]">{s.icon}</span>
                <h3 className="font-display text-[1.25rem] leading-snug font-medium text-ink">{s.title}</h3>
                <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-soft">{s.text}</p>
                <code className="mt-2 inline-block rounded-md border border-line bg-veil/[0.04] px-2 py-0.5 font-mono text-[0.75rem] text-accent-2">{s.tag}</code>
              </motion.li>
            ))}
          </ol>

          <div className="lg:sticky lg:top-28">
            <div className="rounded-xl shadow-[0_50px_100px_-40px_rgb(var(--shadow-rgb)/var(--shadow-a))]">
            <Terminal className="theme-night max-w-none" sequence={!reduce}>
              {reduce ? (
                <div className="font-mono text-[0.8125rem] text-[#f2f5ff]">$ sh /data/local/tmp/orbit/orbit-setup.sh install</div>
              ) : (
                <TypingAnimation className="font-mono text-[0.8125rem] text-[#f2f5ff]" duration={28}>$ sh /data/local/tmp/orbit/orbit-setup.sh install</TypingAnimation>
              )}
              <Line>@orbit step check ok</Line>
              <Line>@orbit step record ok</Line>
              <Line>@orbit step disable start</Line>
              <Line tone="undo">@orbit undo enable &lt;package&gt;</Line>
              <Line tone="undo">@orbit undo enable &lt;package&gt;</Line>
              <Line>@orbit progress 40</Line>
              <Line>@orbit step disable ok</Line>
              <Line tone="undo">@orbit undo home &lt;the TV's own launcher&gt;</Line>
              <Line>@orbit step home ok</Line>
              <Line>@orbit step helper ok</Line>
              <Line>@orbit step live ok</Line>
              <Line>@orbit step pair ok</Line>
              <Line tone="done">@orbit done ok</Line>
            </Terminal>
            </div>
            <p className="mt-4 text-[0.8125rem] text-dim">The script's own protocol, as the phone reads it. Placeholders stand where a TV's package names go.</p>
          </div>
        </div>

        <ul className="mt-12 flex flex-wrap gap-2.5" aria-label="Read the source">
          {DOCS.map((d) => (
            <li key={d.label}>
              <a
                href={d.href}
                target="_blank"
                rel="noopener"
                className="group inline-flex h-11 items-center gap-2 rounded-full border border-line bg-surface/70 px-4 text-[0.875rem] text-ink transition-[border-color,transform] duration-300 hover:-translate-y-0.5 hover:border-accent/50"
              >
                <I.Code size={16} className="text-accent" />
                {d.label}
                <I.ArrowUpRight size={15} className="text-dim transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Line({ children, tone }: { children: ReactNode; tone?: "undo" | "done" }) {
  const reduce = useReducedMotion();
  const color = tone === "undo" ? "text-[#e9b3ff]" : tone === "done" ? "text-[#7ee2b8]" : "text-[#adc6ff]";
  if (reduce) return <div className={`font-mono text-[0.8125rem] ${color}`}>{children}</div>;
  return <AnimatedSpan className={`font-mono text-[0.8125rem] ${color}`}>{children}</AnimatedSpan>;
}
