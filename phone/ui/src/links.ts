// Orbit's public pages, on the Orbit OS site (shivamj56/orbit-os-site), the only places the `openUrl` op opens. The
// page cannot leave the app's WebView: inside the app the phone's own browser opens them; in a browser, a new tab.
import { bridge } from "./bridge";

export const LINKS = {
  privacy: "https://shivamj56.github.io/orbit-os-site/privacy.html",
  deleteAccount: "https://shivamj56.github.io/orbit-os-site/delete-account.html",
  issues: "https://github.com/shivamj56/orbit-os-site/issues",
} as const;

export function openLink(url: string) {
  if (!bridge.native) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  bridge.call("openUrl", { url }).catch(() => {});
}
