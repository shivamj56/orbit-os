import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { bridge } from "./bridge";
import { App } from "./App";
import { startDemo, useDemo } from "./demo";
import { DemoFrame } from "./demo/DemoFrame";
import { DemoShell } from "./demo/DemoShell";
import { Intro, prepareIntro } from "./intro/Intro";
import { startLanguage, useLanguage, type Catalog } from "./i18n";

// Before anything renders or says hello: whether this start plays the intro, and whether the app is in demo mode.
prepareIntro();
startDemo();

/** Inside the Orbit app the page is the whole screen (in demo mode with the pretend TV on top); in a plain browser it is
 * the demo, with the pretend TV beside a drawn phone. The intro plays over all of it. */
function Root() {
  // Settings › Language: every text on the page follows it.
  useLanguage();
  const demo = useDemo();
  if (!bridge.native) return <DemoShell />;
  return (
    <div className="relative h-full">
      {demo ? <DemoFrame /> : <App />}
      <Intro />
    </div>
  );
}

/** One language's texts: from the app's assets through Flutter, or, in a browser, from beside the page. */
function loadTexts(code: string): Promise<Catalog> {
  if (bridge.native) return bridge.call<{ texts: Catalog }>("language", { code }, 6000).then((r) => r.texts);
  return fetch(`./locales/${code}.json`).then((r) => (r.ok ? (r.json() as Promise<Catalog>) : Promise.reject(new Error(`HTTP ${r.status}`))));
}

let rendered = false;
function render() {
  if (rendered) return;
  rendered = true;
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
}

// The first frame waits for the language's texts, which take a moment, but never long: a slow phone shows English
// first and changes as soon as they come.
startLanguage(loadTexts).finally(render);
window.setTimeout(render, 1200);
