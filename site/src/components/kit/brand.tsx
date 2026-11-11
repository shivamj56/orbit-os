import { useId } from "react";
import shivMarkUrl from "@/assets/brand/shiv-mark.svg";

/** Orbit OS's mark: a small planet (the TV) inside a tilted orbit, with the phone as its satellite. */
export function OrbitMark({ size = 30, className = "" }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`ring-${id}`} x1="0" x2="1">
          <stop offset="0" stopColor="#74D1FF" />
          <stop offset=".5" stopColor="#ADC6FF" />
          <stop offset="1" stopColor="#E9B3FF" />
        </linearGradient>
        <radialGradient id={`body-${id}`} cx=".35" cy=".3" r=".9">
          <stop offset="0" stopColor="#25325c" />
          <stop offset="1" stopColor="#0b1020" />
        </radialGradient>
      </defs>
      <path d="M3.2 19.7a13.6 4.6 -18 0 1 25.6-7.4" fill="none" stroke={`url(#ring-${id})`} strokeWidth="1.6" strokeLinecap="round" opacity=".55" />
      <circle cx="16" cy="16" r="7.2" fill={`url(#body-${id})`} stroke="#ADC6FF" strokeOpacity=".55" strokeWidth=".9" />
      <path d="M28.8 12.3a13.6 4.6 -18 0 1-25.6 7.4" fill="none" stroke={`url(#ring-${id})`} strokeWidth="1.9" strokeLinecap="round" />
      <circle cx="27.6" cy="11.4" r="2" fill="#fff" />
      <circle cx="27.6" cy="11.4" r="4" fill="#74D1FF" opacity=".22" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-display text-[1.25rem] leading-none font-normal tracking-[-0.01em] ${className}`}>
      Orbit <span className="font-semibold">OS</span>
    </span>
  );
}

/** The owner's S mark, from the boot film. */
export function ShivMark({ className = "", label = "Shiv" }: { className?: string; label?: string }) {
  return <img src={shivMarkUrl} alt={label} className={className} draggable={false} />;
}
