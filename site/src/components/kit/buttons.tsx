import type { ReactNode } from "react";
import ClickSpark from "@/components/reactbits/ClickSpark";
import Magnet from "@/components/reactbits/Magnet";
import StarBorder from "@/components/reactbits/StarBorder";
import { DOWNLOAD_URL, REPO_URL } from "@/lib/links";
import { formatStars } from "@/lib/format";
import * as I from "./icons";

const SPARKS = ["#74D1FF", "#ADC6FF", "#E9B3FF", "#FFFFFF"];

type Size = "md" | "lg";

/**
 * The Download button: an iridescent pill that leans toward the cursor (React Bits Magnet) and throws sparks when
 * pressed (React Bits ClickSpark).
 */
export function DownloadButton({ size = "lg", label = "Download Orbit", sub = "for Android", magnetic = true }: { size?: Size; label?: string; sub?: string | null; magnetic?: boolean }) {
  const h = size === "lg" ? "h-[3.375rem] px-6 text-[1rem]" : "h-11 px-[1.125rem] text-[0.9375rem]";
  const button = (
    <ClickSpark sparkColor={SPARKS} sparkCount={14} sparkRadius={size === "lg" ? 56 : 40} sparkSize={12} shape="star" duration={650} glow={0.6} className="inline-block">
      <a
        href={DOWNLOAD_URL}
        target="_blank"
        rel="noopener"
        className={`group relative isolate inline-flex items-center gap-2.5 overflow-hidden rounded-full font-semibold whitespace-nowrap text-[#04101a] shadow-[0_18px_50px_-18px_rgba(116,209,255,0.75),inset_0_1px_0_rgba(255,255,255,0.65),inset_0_-1px_0_rgba(3,17,28,0.25)] transition-[box-shadow,transform] duration-300 ease-[var(--ease-out-expo)] hover:shadow-[0_22px_70px_-16px_rgba(173,198,255,0.85),inset_0_1px_0_rgba(255,255,255,0.75),inset_0_-1px_0_rgba(3,17,28,0.25)] active:scale-[0.98] ${h}`}
        style={{ background: "linear-gradient(100deg, #74D1FF 0%, #9fd0ff 38%, #ADC6FF 58%, #E9B3FF 100%)" }}
      >
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 -z-10 w-1/3 bg-gradient-to-r from-transparent via-white/55 to-transparent opacity-0 group-hover:animate-[sweep_1.1s_var(--ease-smooth)_1] group-hover:opacity-100" />
        <span className="grid size-6 place-items-center rounded-full bg-[#04101a]/10 transition-transform duration-300 group-hover:translate-y-0.5">
          <I.Download size={17} strokeWidth={2.2} />
        </span>
        <span>
          {label}
          {sub && <span className="max-[380px]:hidden"> {sub}</span>}
        </span>
      </a>
    </ClickSpark>
  );
  if (!magnetic) return button;
  return (
    <Magnet padding={70} magnetStrength={3.2} maxOffset={12} tilt={5} scale={1.02} wrapperClassName="inline-block" innerClassName="inline-block">
      {button}
    </Magnet>
  );
}

/** Star on GitHub: a dark pill with a star running its edge (React Bits StarBorder), and the live count when known. */
export function StarButton({ stars, size = "lg", label = "Star on GitHub", className = "" }: { stars: number | null; size?: Size; label?: ReactNode; className?: string }) {
  const h = size === "lg" ? "h-[3.375rem] !px-5 text-[1rem]" : "h-11 !px-4 text-[0.9375rem]";
  return (
    <ClickSpark sparkColor={["#FFE9B3", "#FFFFFF", "#E9B3FF"]} sparkCount={10} sparkRadius={44} sparkSize={11} shape="star" duration={600} className="inline-block">
      <StarBorder
        as="a"
        href={REPO_URL}
        target="_blank"
        rel="noopener"
        radius={999}
        thickness={1}
        color="#E9B3FF"
        trailColor="#74D1FF"
        duration={5.5}
        trailLength={0.35}
        glow={0.75}
        sparkle
        backgroundColor="rgba(11, 16, 32, 0.72)"
        textColor="#F2F5FF"
        borderColor="rgba(173, 198, 255, 0.22)"
        className={`!gap-2.5 !py-0 font-semibold whitespace-nowrap backdrop-blur-md ${h} ${className}`}
      >
        <I.GitHub size={19} />
        <span>{label}</span>
        {stars !== null && (
          <span className="ml-0.5 inline-flex items-center gap-1 rounded-full bg-white/8 px-2 py-0.5 font-mono text-[0.75rem] text-[#FFE9B3]">
            <I.Star size={12} filled />
            {formatStars(stars)}
          </span>
        )}
      </StarBorder>
    </ClickSpark>
  );
}
