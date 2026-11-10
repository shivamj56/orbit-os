import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { bridge } from "./bridge";
import { App } from "./App";
import { DemoShell } from "./demo/DemoShell";

// Inside the Orbit app the page is the whole screen; in a plain browser it is the demo, with a pretend TV beside it.
createRoot(document.getElementById("root")!).render(<StrictMode>{bridge.native ? <App /> : <DemoShell />}</StrictMode>);
