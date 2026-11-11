// Magic UI: android (https://magicui.design), by Dillion Verma. Licence: MIT.
// Installed with the shadcn CLI from https://magicui.design/r/android.json (the same component 21st.dev lists).
// Changes to the source: the view box is cropped to the phone itself (the original left 53 units of empty space on
// its right), the clip-path id is unique per phone, the screen can hold live content (children), not only a picture,
// and the frame takes Orbit's two themes through the page's `dark:` variant (a silver phone by day, graphite at night).
import { useId, type ReactNode, type SVGProps } from "react"

import { cn } from "@/lib/utils"

export interface AndroidProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  src?: string
  alt?: string
  /** Live content for the screen (a 360 x 800 area, with rounded corners). */
  children?: ReactNode
  className?: string
  screenClassName?: string
}

const W = 380
const H = 832
// The screen inside the frame, in the frame's units.
const SX = 9
const SY = 14
const SW = 360
const SH = 800

export function Android({ src, alt = "", children, className, screenClassName, ...props }: AndroidProps) {
  const clip = `android-screen-${useId().replace(/:/g, "")}`
  return (
    <div className={cn("relative aspect-[380/832] w-full", className)}>
      <svg viewBox={`0 0 ${W} ${H}`} fill="none" xmlns="http://www.w3.org/2000/svg" className="absolute inset-0 size-full" aria-hidden={!src} role={src ? "img" : undefined} aria-label={src ? alt : undefined} {...props}>
        <path d="M376 153H378C379.105 153 380 153.895 380 155V249C380 250.105 379.105 251 378 251H376V153Z" className="fill-[#cfd3dc] dark:fill-[#3a3f4b]" />
        <path d="M376 301H378C379.105 301 380 301.895 380 303V351C380 352.105 379.105 353 378 353H376V301Z" className="fill-[#cfd3dc] dark:fill-[#3a3f4b]" />
        <path
          d="M0 42C0 18.8041 18.804 0 42 0H336C359.196 0 378 18.804 378 42V788C378 811.196 359.196 830 336 830H42C18.804 830 0 811.196 0 788V42Z"
          className="fill-[#d9dce5] dark:fill-[#2a2f3d]"
        />
        <path
          d="M2 43C2 22.0132 19.0132 5 40 5H338C358.987 5 376 22.0132 376 43V787C376 807.987 358.987 825 338 825H40C19.0132 825 2 807.987 2 787V43Z"
          className="fill-[#f4f5f9] dark:fill-[#121521]"
        />
        <g clipPath={`url(#${clip})`}>
          <path
            d="M9.25 48C9.25 29.3604 24.3604 14.25 43 14.25H335C353.64 14.25 368.75 29.3604 368.75 48V780C368.75 798.64 353.64 813.75 335 813.75H43C24.3604 813.75 9.25 798.64 9.25 780V48Z"
            className="fill-[#05070d] stroke-[#05070d] stroke-[0.5]"
          />
        </g>
        {src && <image href={src} x={SX} y={SY} width={SW} height={SH} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clip})`} />}
        <circle cx="189" cy="28" r="9" className="fill-[#0b0e16]" />
        <circle cx="189" cy="28" r="4" className="fill-[#1d2230]" />
        <defs>
          <clipPath id={clip}>
            <rect width={SW} height={SH} rx="33" ry="25" transform={`translate(${SX} ${SY})`} />
          </clipPath>
        </defs>
      </svg>
      {children && (
        <div
          className={cn("absolute overflow-hidden bg-[#05070d]", screenClassName)}
          style={{
            left: `${(SX / W) * 100}%`,
            top: `${(SY / H) * 100}%`,
            width: `${(SW / W) * 100}%`,
            height: `${(SH / H) * 100}%`,
            borderRadius: `${(33 / SW) * 100}% / ${(25 / SH) * 100}%`,
          }}
        >
          {children}
        </div>
      )}
      {children && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute rounded-full bg-[#0b0e16] ring-[1.5px] ring-[#1d2230]"
          style={{ left: `${((189 - 9) / W) * 100}%`, top: `${((28 - 9) / H) * 100}%`, width: `${(18 / W) * 100}%`, aspectRatio: "1" }}
        />
      )}
    </div>
  )
}
