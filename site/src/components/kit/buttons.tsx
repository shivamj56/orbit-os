import type { ReactNode } from "react";
import ClickSpark from "@/components/reactbits/ClickSpark";
import Magnet from "@/components/reactbits/Magnet";
import StarBorder from "@/components/reactbits/StarBorder";
import { ShimmerButton } from "@/components/magicui/shimmer-button";
import { DOWNLOAD_URL, REPO_URL } from "@/lib/links";
import { formatStars } from "@/lib/format";
import { useThemeValue } from "@/lib/themeContext";
import * as I from "./icons";

const SPARKS = ["#74D1FF", "#ADC6FF", "#E9B3FF", "#FFFFFF"];
const SPARKS_DAY = ["#0a76b3", "#4a5bd6", "#9a3fd0", "#74D1FF"];

type Size = "md" | "lg";

/**
 * The Download button, the page's one main call: an iridescent pill with Magic UI's shimmer running its edge (the
 * only shimmer on the page), leaning toward the cursor (React Bits Magnet) and throwing sparks (React Bits ClickSpark).
 */
export function DownloadButton({ size = "lg", label = "Download Orbit", sub = "for Android", magnetic = true, className = "" }: { size?: Size; label?: string; sub?: string | null; magnetic?: boolean; className?: string }) {
  const day = useThemeValue() === "light";
  const h = size === "lg" ? "h-[3.375rem] !px-6 text-[1rem]" : "h-11 !px-[1.125rem] text-[0.9375rem]";
  const button = (
    <ClickSpark sparkColor={day ? SPARKS_DAY : SPARKS} sparkCount={14} sparkRadius={size === "lg" ? 56 : 40} sparkSize={12} shape="star" duration={650} glow={0.6} className={`inline-block ${className}`}>
      <ShimmerButton
        as="a"
        href={DOWNLOAD_URL}
        target="_blank"
        rel="noopener"
        background="var(--cta)"
        shimmerColor={day ? "#ffffff" : "#ffffff"}
        shimmerDuration="3.2s"
        className={`gap-2.5 !py-0 font-semibold text-cta-ink shadow-[0_18px_50px_-18px_var(--cta-glow)] transition-[box-shadow,transform] duration-300 ease-[var(--ease-out-expo)] hover:-translate-y-0.5 hover:shadow-[0_24px_70px_-16px_var(--cta-glow)] focus-visible:outline-offset-4 ${h}`}
      >
        <span className="relative grid size-6 place-items-center rounded-full bg-current/12 transition-transform duration-300 group-hover:translate-y-0.5">
          <I.Download size={17} strokeWidth={2.2} />
        </span>
        <span className="relative">
          {label}
          {sub && <span className="max-[380px]:hidden"> {sub}</span>}
        </span>
      </ShimmerButton>
    </ClickSpark>
  );
  if (!magnetic) return button;
  return (
    <Magnet padding={70} magnetStrength={3.2} maxOffset={12} tilt={5} scale={1.02} wrapperClassName="inline-block" innerClassName="inline-block">
      {button}
    </Magnet>
  );
}

/** Star on GitHub: a pill with a star running its edge (React Bits StarBorder), and the live count when known. */
export function StarButton({ stars, size = "lg", label = "Star on GitHub", className = "" }: { stars: number | null; size?: Size; label?: ReactNode; className?: string }) {
  const day = useThemeValue() === "light";
  const h = size === "lg" ? "h-[3.375rem] !px-5 text-[1rem]" : "h-11 !px-4 text-[0.9375rem]";
  return (
    <ClickSpark sparkColor={day ? ["#b7791f", "#4a5bd6", "#9a3fd0"] : ["#FFE9B3", "#FFFFFF", "#E9B3FF"]} sparkCount={10} sparkRadius={44} sparkSize={11} shape="star" duration={600} className="inline-block">
      <StarBorder
        as="a"
        href={REPO_URL}
        target="_blank"
        rel="noopener"
        radius={999}
        thickness={1}
        color={day ? "#9a3fd0" : "#E9B3FF"}
        trailColor={day ? "#0a76b3" : "#74D1FF"}
        duration={5.5}
        trailLength={0.35}
        glow={day ? 0.4 : 0.75}
        sparkle
        backgroundColor="var(--glass-1)"
        textColor="var(--ink)"
        borderColor="var(--line)"
        className={`!gap-2.5 !py-0 font-semibold whitespace-nowrap shadow-[0_18px_40px_-24px_rgb(var(--shadow-rgb)/var(--shadow-a))] backdrop-blur-md transition-transform duration-300 hover:-translate-y-0.5 ${h} ${className}`}
      >
        <I.GitHub size={19} />
        <span>{label}</span>
        {stars !== null && (
          <span className="ml-0.5 inline-flex items-center gap-1 rounded-full bg-veil/8 px-2 py-0.5 font-mono text-[0.75rem] text-accent-3">
            <I.Star size={12} filled />
            {formatStars(stars)}
          </span>
        )}
      </StarBorder>
    </ClickSpark>
  );
}
