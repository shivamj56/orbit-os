import { useEffect } from "react";
import { MotionConfig } from "motion/react";
import { useStars } from "@/lib/stars";
import { startSmoothScroll } from "@/lib/scroll";
import { Nav } from "@/sections/Nav";
import { Hero } from "@/sections/Hero";
import { TryIt } from "@/sections/TryIt";
import { Numbers } from "@/sections/Numbers";
import { Calm } from "@/sections/Calm";
import { Setup } from "@/sections/Setup";
import { IndianHomes } from "@/sections/IndianHomes";
import { Superpowers } from "@/sections/Superpowers";
import { Safety } from "@/sections/Safety";
import { TestedTvs } from "@/sections/TestedTvs";
import { UnderTheHood } from "@/sections/UnderTheHood";
import { Roadmap } from "@/sections/Roadmap";
import { Faq } from "@/sections/Faq";
import { StarMoment } from "@/sections/StarMoment";
import { Credits } from "@/sections/Credits";
import { Footer } from "@/sections/Footer";
import { StickyBar } from "@/sections/StickyBar";

export function App() {
  const stars = useStars();
  useEffect(() => startSmoothScroll(), []);
  return (
    <MotionConfig reducedMotion="user">
      <a href="#try" className="sr-only z-[60] rounded-full bg-surface px-4 py-2 font-semibold text-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to the demo
      </a>
      <Nav stars={stars} />
      <main>
        <Hero stars={stars} />
        <TryIt />
        <Numbers />
        <Calm />
        <Setup />
        <IndianHomes />
        <Superpowers />
        <Safety />
        <TestedTvs />
        <UnderTheHood />
        <Roadmap />
        <Faq />
        <StarMoment stars={stars} />
        <Credits stars={stars} />
      </main>
      <Footer />
      <StickyBar />
      <div className="grain" aria-hidden="true" />
    </MotionConfig>
  );
}
