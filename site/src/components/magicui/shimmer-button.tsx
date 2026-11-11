// Magic UI: shimmer-button (https://magicui.design), by Dillion Verma. Licence: MIT.
// Installed with the shadcn CLI from https://magicui.design/r/shimmer-button.json (the same component 21st.dev lists).
// Changes to the source: it can render as a link (`as="a"`), the shimmer ring is a little wider so it reads on a light
// fill, and a stray class with spaces in it (`border-oklch(0.922 0 0)`) is gone. Used for the Download button only.
import React, { type CSSProperties } from "react"

import { cn } from "@/lib/utils"

type Shared = {
  shimmerColor?: string
  shimmerSize?: string
  borderRadius?: string
  shimmerDuration?: string
  background?: string
  className?: string
  children?: React.ReactNode
}

export type ShimmerButtonProps =
  | (Shared & { as?: "button" } & Omit<React.ComponentPropsWithoutRef<"button">, keyof Shared>)
  | (Shared & { as: "a" } & Omit<React.ComponentPropsWithoutRef<"a">, keyof Shared>)

export const ShimmerButton = React.forwardRef<HTMLElement, ShimmerButtonProps>(
  (
    {
      shimmerColor = "#ffffff",
      shimmerSize = "0.12em",
      shimmerDuration = "3s",
      borderRadius = "100px",
      background = "rgba(0, 0, 0, 1)",
      className,
      children,
      as = "button",
      ...props
    },
    ref
  ) => {
    const Tag = as as "button"
    return (
      <Tag
        ref={ref as React.Ref<HTMLButtonElement>}
        style={
          {
            "--spread": "90deg",
            "--shimmer-color": shimmerColor,
            "--radius": borderRadius,
            "--speed": shimmerDuration,
            "--cut": shimmerSize,
            "--bg": background,
          } as CSSProperties
        }
        className={cn(
          "group relative z-0 flex cursor-pointer items-center justify-center overflow-hidden [border-radius:var(--radius)] px-6 py-3 whitespace-nowrap [background:var(--bg)]",
          "transform-gpu transition-transform duration-300 ease-in-out active:translate-y-px",
          className
        )}
        {...(props as React.ComponentPropsWithoutRef<"button">)}
      >
        {/* spark container */}
        <div className={cn("-z-30 blur-[2px]", "@container-[size] absolute inset-0 overflow-visible")}>
          {/* spark */}
          <div className="animate-shimmer-slide absolute inset-0 aspect-[1] h-[100cqh] rounded-none [mask:none]">
            {/* spark before */}
            <div className="animate-spin-around absolute -inset-full w-auto [translate:0_0] rotate-0 [background:conic-gradient(from_calc(270deg-(var(--spread)*0.5)),transparent_0,var(--shimmer-color)_var(--spread),transparent_var(--spread))]" />
          </div>
        </div>
        {children}

        {/* Highlight */}
        <div
          className={cn(
            "pointer-events-none absolute inset-0 size-full [border-radius:var(--radius)] shadow-[inset_0_-8px_10px_#ffffff1f]",
            "transform-gpu transition-all duration-300 ease-in-out",
            "group-hover:shadow-[inset_0_-6px_10px_#ffffff3f]",
            "group-active:shadow-[inset_0_-10px_10px_#ffffff3f]"
          )}
        />

        {/* backdrop */}
        <div className={cn("absolute inset-(--cut) -z-20 [border-radius:var(--radius)] [background:var(--bg)]")} />
      </Tag>
    )
  }
)

ShimmerButton.displayName = "ShimmerButton"
