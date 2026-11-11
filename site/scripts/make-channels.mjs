// Copies the Live TV line-up (number, name, group, and the app a pay channel opens) from Orbit Live TV's own
// channels.json into src/data, without the stream addresses. Run from site/: node scripts/make-channels.mjs
import { readFileSync, writeFileSync } from "node:fs";

const src = new URL("../../launcher/livetv/src/main/assets/channels.json", import.meta.url);
const { channels } = JSON.parse(readFileSync(src, "utf8"));
const out = channels.map((c) => ({
  num: c.num,
  name: c.name,
  group: c.group === "Paid" ? "Pay" : c.group,
  ...(c.appName ? { app: c.appName } : {}),
}));
writeFileSync(new URL("../src/data/channels.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
const count = (g) => out.filter((c) => c.group === g).length;
console.log(out.length, "channels;", ["News", "Serials", "Bhakti", "Kids", "Movies", "Pay"].map((g) => `${g} ${count(g)}`).join(", "));
