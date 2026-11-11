import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { bridge } from "./bridge";
import { App } from "./App";
import { startDemo, useDemo } from "./demo";
import { DemoFrame } from "./demo/DemoFrame";
import { DemoShell } from "./demo/DemoShell";
import { Intro, prepareIntro } from "./intro/Intro";

// Before anything renders or says hello: whether this start plays the intro, and whether the app is in demo mode.
prepareIntro();
startDemo();

/** Inside the Orbit app the page is the whole screen (in demo mode with the pretend TV on top); in a plain browser it is
 * the demo, with the pretend TV beside a drawn phone. The intro plays over all of it. */
function Root() {
  const demo = useDemo();
  if (!bridge.native) return <DemoShell />;
  return (
    <div className="relative h-full">
      {demo ? <DemoFrame /> : <App />}
      <Intro />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
