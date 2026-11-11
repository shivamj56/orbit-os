import { useEffect } from "react";
import { MotionConfig } from "motion/react";
import { useStars } from "@/lib/stars";
import { startSmoothScroll } from "@/lib/scroll";
import { Nav } from "@/sections/Nav";
import { Hero } from "@/sections/Hero";
import { TryIt } from "@/sections/TryIt";
import { Setup } from "@/sections/Setup";
import { Calm } from "@/sections/Calm";
import { Superpowers } from "@/sections/Superpowers";
import { Safety } from "@/sections/Safety";
import { TestedTvs } from "@/sections/TestedTvs";
import { Faq } from "@/sections/Faq";
import { StarMoment } from "@/sections/StarMoment";
import { Credits } from "@/sections/Credits";
import { Footer } from "@/sections/Footer";

export function App() {
  const stars = useStars();
  useEffect(() => startSmoothScroll(), []);
  return (
    <MotionConfig reducedMotion="user">
      <a href="#try" className="sr-only z-[60] rounded-full bg-sky px-4 py-2 font-semibold text-on-sky focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to the demo
      </a>
      <Nav stars={stars} />
      <main>
        <Hero stars={stars} />
        <TryIt />
        <Setup />
        <Calm />
        <Superpowers />
        <Safety />
        <TestedTvs />
        <Faq />
        <StarMoment stars={stars} />
        <Credits stars={stars} />
      </main>
      <Footer />
      <div className="grain" aria-hidden="true" />
    </MotionConfig>
  );
}
