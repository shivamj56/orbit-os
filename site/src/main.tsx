import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { restoreTheme } from "./lib/theme";
import { ThemeProvider } from "./lib/themeContext";
import "./styles.css";

// The visitor's own choice of theme, if they made one, before the first paint (index.html does it too, when allowed).
restoreTheme();
// Inside a host page that drops our <html lang="en">, say the language again.
if (!document.documentElement.lang) document.documentElement.lang = "en";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
