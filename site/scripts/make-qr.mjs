// Draws the QR code for the download link as a small SVG (round modules, rounded finder eyes) into src/assets/brand.
// Run from site/: node scripts/make-qr.mjs
import { writeFileSync } from "node:fs";
import { encode } from "uqr";

const url = "https://play.google.com/store/apps/details?id=dev.shiv.orbit";
const qr = encode(url, { ecc: "M", border: 0 });
const n = qr.size;
const inFinder = (x, y) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
let dots = "";
for (let y = 0; y < n; y++) {
  for (let x = 0; x < n; x++) {
    if (qr.data[y][x] && !inFinder(x, y)) dots += `<circle cx="${x + 0.5}" cy="${y + 0.5}" r="0.44"/>`;
  }
}
const eye = (x, y) =>
  `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="1.8" fill="none" stroke="currentColor" stroke-width="1"/>` +
  `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="0.9"/>`;
const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${n + 2} ${n + 2}" fill="currentColor" shape-rendering="geometricPrecision">` +
  dots + eye(0, 0) + eye(n - 7, 0) + eye(0, n - 7) + `</svg>`;
writeFileSync(new URL("../src/assets/brand/qr-release.svg", import.meta.url), svg);
console.log("QR version", qr.version, "size", n, "bytes", svg.length);
