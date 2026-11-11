import type { ReactNode } from "react";
import BlurText from "@/components/reactbits/BlurText";

/** Eyebrow, a heading that resolves out of blur word by word (React Bits BlurText), and a short lede. */
export function SectionHead({
  eyebrow,
  title,
  lede,
  align = "left",
  id,
  className = "",
}: {
  eyebrow: string;
  title: string;
  lede?: ReactNode;
  align?: "left" | "center";
  id?: string;
  className?: string;
}) {
  const center = align === "center";
  return (
    <header className={`${center ? "mx-auto text-center" : ""} max-w-[46rem] ${className}`}>
      <p className={`eyebrow flex items-center gap-2.5 ${center ? "justify-center" : ""}`}>
        <span aria-hidden="true" className="h-px w-6 bg-[linear-gradient(90deg,transparent,#ADC6FF)]" />
        {eyebrow}
      </p>
      <BlurText
        as="h2"
        text={title}
        animateBy="words"
        delay={70}
        stepDuration={0.42}
        blur={12}
        distance={24}
        className={`mt-5 font-display text-[clamp(2.1rem,4.4vw,3.6rem)] leading-[1.04] font-[460] tracking-[-0.03em] text-ink ${center ? "justify-center" : ""}`}
      />
      {lede && <div className={`mt-5 text-[clamp(1.0625rem,1.3vw,1.1875rem)] leading-[1.6] text-soft ${center ? "mx-auto" : ""} max-w-[40rem]`}>{lede}</div>}
      {id && <span id={id} className="sr-only" />}
    </header>
  );
}
