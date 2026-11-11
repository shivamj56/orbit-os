// Magic UI: globe (https://magicui.design), by Dillion Verma, drawn with cobe (MIT). Licence: MIT.
// Installed with the shadcn CLI from https://magicui.design/r/globe.json (the same component 21st.dev lists).
// Changes to the source: the pixel ratio is capped at 2, it stops drawing while off screen (and does not start until
// it is near), it takes Orbit's night and daylight looks, and it can turn to face a longitude.
import { useEffect, useRef } from "react"
import createGlobe, { type COBEOptions } from "cobe"
import { useMotionValue, useSpring } from "motion/react"

import { cn } from "@/lib/utils"

const MOVEMENT_DAMPING = 1400

export type GlobeLook = "night" | "day"

const LOOKS: Record<GlobeLook, Partial<COBEOptions>> = {
  night: {
    dark: 1,
    diffuse: 1.25,
    mapBrightness: 5,
    mapBaseBrightness: 0.02,
    baseColor: [0.22, 0.27, 0.46],
    markerColor: [0.46, 0.82, 1],
    glowColor: [0.36, 0.48, 0.95],
  },
  day: {
    dark: 0,
    diffuse: 1.4,
    mapBrightness: 2.4,
    mapBaseBrightness: 0.05,
    baseColor: [0.82, 0.86, 0.98],
    markerColor: [0.04, 0.42, 0.66],
    glowColor: [0.6, 0.66, 0.96],
  },
}

export function Globe({
  className,
  look = "night",
  markers = [],
  phi0 = 0,
  theta = 0.3,
  spin = 0.003,
}: {
  className?: string
  look?: GlobeLook
  markers?: COBEOptions["markers"]
  /** Where it starts turned to, in radians. */
  phi0?: number
  theta?: number
  spin?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const phiRef = useRef(phi0)
  const widthRef = useRef(0)
  const pointerInteracting = useRef<number | null>(null)

  const r = useMotionValue(0)
  const rs = useSpring(r, { mass: 1, damping: 30, stiffness: 100 })

  const updatePointerInteraction = (value: number | null) => {
    pointerInteracting.current = value
    if (canvasRef.current) canvasRef.current.style.cursor = value !== null ? "grabbing" : "grab"
  }
  const updateMovement = (clientX: number) => {
    if (pointerInteracting.current !== null) {
      const delta = clientX - pointerInteracting.current
      r.set(r.get() + delta / MOVEMENT_DAMPING)
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current!
    const onResize = () => {
      widthRef.current = canvas.offsetWidth
    }
    window.addEventListener("resize", onResize)
    onResize()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches

    const globe = createGlobe(canvas, {
      ...(LOOKS[look] as COBEOptions),
      width: widthRef.current * dpr,
      height: widthRef.current * dpr,
      devicePixelRatio: dpr,
      phi: phi0,
      theta,
      mapSamples: 16000,
      markers,
      onRender: (state) => {
        if (!pointerInteracting.current && !reduce) phiRef.current += spin
        state.phi = phiRef.current + rs.get()
        state.width = widthRef.current * dpr
        state.height = widthRef.current * dpr
      },
    })
    const io = new IntersectionObserver(([e]) => globe.toggle(e.isIntersecting))
    io.observe(canvas)
    const show = window.setTimeout(() => (canvas.style.opacity = "1"), 0)
    return () => {
      window.clearTimeout(show)
      io.disconnect()
      globe.destroy()
      window.removeEventListener("resize", onResize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rs, look])

  return (
    <div className={cn("relative mx-auto aspect-square w-full", className)}>
      <canvas
        className="size-full opacity-0 transition-opacity duration-700 contain-[layout_paint_size]"
        ref={canvasRef}
        aria-hidden="true"
        onPointerDown={(e) => updatePointerInteraction(e.clientX)}
        onPointerUp={() => updatePointerInteraction(null)}
        onPointerOut={() => updatePointerInteraction(null)}
        onMouseMove={(e) => updateMovement(e.clientX)}
        onTouchMove={(e) => e.touches[0] && updateMovement(e.touches[0].clientX)}
      />
    </div>
  )
}
