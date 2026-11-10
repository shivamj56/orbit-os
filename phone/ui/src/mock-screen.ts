// The demo TV's screen for help mode: what the pretend Family room TV shows, drawn on a canvas the way the real TV
// photographs its own screen (640 x 360, the TV's 1280 x 720 at half size) and sent as a JPEG, as the real TV sends
// them. It follows the same events as the demo's TV picture (demo/MockTv.tsx), and knows what a click there hits.
import type { MockEvent } from "./mock";

export interface ScreenApp {
  label: string;
  tint: [string, string];
}

/** Where a click on the TV lands: a card of Home's row, or a row of Settings. */
export type ScreenHit = { card: number } | { row: number } | null;

// Home's row, in TV pixels: the cards are 13% of the width, 34% of the height, 118% of a card apart.
const CARD_W = 1280 * 0.13;
const CARD_H = 720 * 0.34;
const ROW_Y = 720 * 0.37 + CARD_H / 2;
const CARD_STEP = CARD_W * 1.18;
// Settings' list, on the right.
const LIST_X = 640;
const LIST_W = 548;
const LIST_Y = 150;
const ROW_H = 76;
const ROW_GAP = 8;

const cardScale = (d: number) => (d === 0 ? 1.18 : 1 - Math.min(0.22, Math.abs(d) * 0.07));

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good Morning" : h < 17 ? "Good Afternoon" : "Good Evening";
}

export class MockScreen {
  /** The app in front (its label), or null on Home. */
  app: string | null = null;
  /** The highlighted row while Settings is open. */
  menu = 0;
  private note = false;
  private overlay: { text: string; until: number } | null = null;
  private volume: { v: number; muted: boolean; until: number } | null = null;
  private cursor: { x: number; y: number; until: number } | null = null;
  private clickAt = 0;
  private asleepUntil = 0;
  private readonly canvas = document.createElement("canvas");
  private readonly g: CanvasRenderingContext2D;

  constructor(
    private readonly apps: ScreenApp[],
    private readonly settings: string[],
  ) {
    this.canvas.width = 640;
    this.canvas.height = 360;
    this.g = this.canvas.getContext("2d")!;
  }

  apply(e: MockEvent) {
    const now = Date.now();
    switch (e.type) {
      case "open":
        this.app = e.label;
        this.menu = 0;
        break;
      case "home":
      case "back":
        this.app = null;
        this.overlay = null;
        break;
      case "recents":
        this.overlay = { text: "Recent apps", until: now + 1600 };
        break;
      case "typed":
        this.overlay = { text: `Search: ${e.text}`, until: now + 2200 };
        break;
      case "overlay":
        this.overlay = { text: e.text, until: now + 1600 };
        break;
      case "volume":
        this.volume = { v: e.volume, muted: e.muted, until: now + 1600 };
        break;
      case "cursor":
        this.cursor = { x: e.x, y: e.y, until: now + 3000 };
        break;
      case "click":
        this.cursor = { x: e.x, y: e.y, until: now + 3000 };
        this.clickAt = now;
        break;
      case "menu":
        this.menu = e.index;
        break;
      case "help":
        this.note = e.on;
        break;
      case "sleep":
        this.asleepUntil = now + 2600;
        break;
      default:
        break;
    }
  }

  /** What a click at (x, y) in TV pixels hits now. */
  hit(x: number, y: number, focus: number): ScreenHit {
    if (Date.now() < this.asleepUntil) return null;
    if (this.app === null) {
      // The middle card is drawn last, on top: it is asked first.
      const order = [0, -1, 1, -2, 2, -3, 3, -4, 4];
      for (const d of order) {
        const i = focus + d;
        if (i < 0 || i >= this.apps.length) continue;
        const s = cardScale(d);
        const cx = 640 + d * CARD_STEP;
        if (Math.abs(x - cx) <= (CARD_W * s) / 2 && Math.abs(y - ROW_Y) <= (CARD_H * s) / 2) return { card: i };
      }
      return null;
    }
    if (this.app === "Settings" && x >= LIST_X && x <= LIST_X + LIST_W) {
      const row = Math.floor((y - LIST_Y) / (ROW_H + ROW_GAP));
      const inside = (y - LIST_Y) % (ROW_H + ROW_GAP) <= ROW_H;
      if (y >= LIST_Y && row < this.settings.length && inside) return { row };
    }
    return null;
  }

  /** A picture of the screen now, as base64 JPEG (no `data:` head). A video that is playing comes out grey, as on
   * the real TV, which cannot photograph its video layer. */
  picture(focus: number, videoPlaying: boolean): string {
    this.draw(focus, videoPlaying, Date.now());
    const url = this.canvas.toDataURL("image/jpeg", 0.72);
    return url.slice(url.indexOf(",") + 1);
  }

  private draw(focus: number, videoPlaying: boolean, now: number) {
    const g = this.g;
    g.setTransform(0.5, 0, 0, 0.5, 0, 0);
    if (now < this.asleepUntil) {
      g.fillStyle = "#000";
      g.fillRect(0, 0, 1280, 720);
      return;
    }
    if (this.app === null) this.drawHome(focus);
    else if (this.app === "Settings") this.drawSettings();
    else this.drawApp(this.app, videoPlaying);

    if (this.overlay && now < this.overlay.until) this.drawOverlay(this.overlay.text);
    if (this.volume && now < this.volume.until) this.drawVolume(this.volume.v, this.volume.muted);
    if (this.cursor && now < this.cursor.until) this.drawPointer(this.cursor.x, this.cursor.y, now - this.clickAt);
    if (this.note) this.drawNote();
  }

  private drawHome(focus: number) {
    const g = this.g;
    // The room's light: an ellipse of 60% by 70%, low in the middle (as Home's own background).
    g.save();
    g.fillStyle = "#030304";
    g.fillRect(0, 0, 1280, 720);
    g.translate(640, 446);
    g.scale(1, 504 / 768);
    const glow = g.createRadialGradient(0, 0, 0, 0, 0, 768);
    glow.addColorStop(0, "#3a0d2a");
    glow.addColorStop(0.55, "#12060f");
    glow.addColorStop(1, "#030304");
    g.fillStyle = glow;
    g.fillRect(-768, -768, 1536, 1536);
    g.restore();

    g.textAlign = "center";
    g.textBaseline = "top";
    g.fillStyle = "rgba(255,255,255,0.9)";
    g.font = "300 59px Outfit, Inter, sans-serif";
    g.fillText(`${greeting()}`, 640, 43);
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.font = "400 20px Inter, sans-serif";
    g.fillText("Hello, I wish you a wonderful day", 640, 122);

    const order = [-4, 4, -3, 3, -2, 2, -1, 1, 0];
    for (const d of order) {
      const i = focus + d;
      const app = this.apps[i];
      if (!app) continue;
      const s = cardScale(d);
      const w = CARD_W * s;
      const h = CARD_H * s;
      const x = 640 + d * CARD_STEP - w / 2;
      const y = ROW_Y - h / 2;
      g.globalAlpha = 1 - Math.abs(d) * 0.16;
      const tint = g.createLinearGradient(x, y, x + w, y + h);
      tint.addColorStop(0, app.tint[0]);
      tint.addColorStop(1, app.tint[1]);
      g.fillStyle = tint;
      roundRect(g, x, y, w, h, 15);
      g.fill();
      g.strokeStyle = "rgba(255,255,255,0.15)";
      g.lineWidth = 2;
      g.stroke();
      g.fillStyle = "#fff";
      g.textBaseline = "middle";
      g.font = `500 ${Math.round(20 * s)}px Outfit, Inter, sans-serif`;
      g.fillText(app.label, x + w / 2, y + h / 2);
      if (d === 0) {
        g.fillStyle = "rgba(255,255,255,0.8)";
        g.fillRect(x + w / 2 - 1, y, 2, h);
      }
      g.globalAlpha = 1;
    }
    g.textBaseline = "top";
    g.fillStyle = "#fff";
    g.font = "400 31px Outfit, Inter, sans-serif";
    g.fillText(this.apps[focus]?.label ?? "", 640, 547);
  }

  private drawApp(label: string, videoPlaying: boolean) {
    const g = this.g;
    if (videoPlaying) {
      g.fillStyle = "#2b2d33";
      g.fillRect(0, 0, 1280, 720);
      return;
    }
    const tint = this.apps.find((a) => a.label === label)?.tint ?? ["#2a3350", "#0b0f1c"];
    const fill = g.createLinearGradient(0, 0, 1280, 720);
    fill.addColorStop(0, tint[0]);
    fill.addColorStop(1, tint[1]);
    g.fillStyle = fill;
    g.fillRect(0, 0, 1280, 720);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#fff";
    g.font = "300 77px Outfit, Inter, sans-serif";
    g.fillText(label, 640, 360);
  }

  private drawSettings() {
    const g = this.g;
    const fill = g.createLinearGradient(0, 0, 1280, 720);
    fill.addColorStop(0, "#151a2b");
    fill.addColorStop(1, "#05060a");
    g.fillStyle = fill;
    g.fillRect(0, 0, 1280, 720);
    g.textAlign = "left";
    g.textBaseline = "top";
    g.fillStyle = "rgba(255,255,255,0.92)";
    g.font = "300 64px Outfit, Inter, sans-serif";
    g.fillText("Settings", 110, 150);
    g.fillStyle = "rgba(255,255,255,0.5)";
    g.font = "400 24px Inter, sans-serif";
    g.fillText("Family room", 112, 236);

    this.settings.forEach((item, i) => {
      const y = LIST_Y + i * (ROW_H + ROW_GAP);
      const on = i === this.menu;
      if (on) {
        g.fillStyle = "rgba(242,244,248,0.94)";
        roundRect(g, LIST_X, y, LIST_W, ROW_H, ROW_H / 2);
        g.fill();
      }
      g.beginPath();
      g.arc(LIST_X + 44, y + ROW_H / 2, 13, 0, Math.PI * 2);
      g.strokeStyle = on ? "rgba(5,6,10,0.6)" : "rgba(255,255,255,0.45)";
      g.lineWidth = 2.5;
      g.stroke();
      g.textBaseline = "middle";
      g.fillStyle = on ? "#05060a" : "rgba(255,255,255,0.82)";
      g.font = `${on ? 500 : 400} 27px Inter, sans-serif`;
      g.fillText(item, LIST_X + 80, y + ROW_H / 2);
    });
  }

  private drawOverlay(text: string) {
    const g = this.g;
    g.font = "400 22px Inter, sans-serif";
    const w = g.measureText(text).width + 52;
    g.fillStyle = "rgba(0,0,0,0.6)";
    roundRect(g, 640 - w / 2, 720 - 58 - 44, w, 44, 22);
    g.fill();
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#fff";
    g.fillText(text, 640, 720 - 58 - 22);
  }

  private drawVolume(v: number, muted: boolean) {
    const g = this.g;
    const x = 1280 - 38 - 300;
    const y = 720 - 58 - 40;
    g.fillStyle = "rgba(0,0,0,0.6)";
    roundRect(g, x, y, 300, 40, 20);
    g.fill();
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillStyle = "#fff";
    g.font = "400 19px Inter, sans-serif";
    g.fillText(muted ? "Muted" : "Volume", x + 18, y + 20);
    g.fillStyle = "rgba(255,255,255,0.2)";
    roundRect(g, x + 110, y + 17, 130, 6, 3);
    g.fill();
    const bar = g.createLinearGradient(x + 110, 0, x + 240, 0);
    bar.addColorStop(0, "#74d1ff");
    bar.addColorStop(0.5, "#ff74d1");
    bar.addColorStop(1, "#ffe9b3");
    g.fillStyle = bar;
    roundRect(g, x + 110, y + 17, Math.max(6, (130 * (muted ? 0 : v)) / 100), 6, 3);
    g.fill();
    g.textAlign = "right";
    g.fillStyle = "#fff";
    g.fillText(String(v), x + 282, y + 20);
  }

  /** The TV's pointer: a ring of the halo's colours with a white middle; a click sends a ring outwards. */
  private drawPointer(x: number, y: number, sinceClick: number) {
    const g = this.g;
    const conic = (g as CanvasRenderingContext2D & { createConicGradient?: (a: number, x: number, y: number) => CanvasGradient })
      .createConicGradient;
    let stroke: string | CanvasGradient = "#74d1ff";
    if (typeof conic === "function") {
      const c = conic.call(g, 0, x, y);
      c.addColorStop(0, "#74d1ff");
      c.addColorStop(0.33, "#ff74d1");
      c.addColorStop(0.66, "#ffe9b3");
      c.addColorStop(1, "#74d1ff");
      stroke = c;
    }
    g.beginPath();
    g.arc(x, y, 15, 0, Math.PI * 2);
    g.strokeStyle = stroke;
    g.lineWidth = 4;
    g.stroke();
    g.beginPath();
    g.arc(x, y, 3.4, 0, Math.PI * 2);
    g.fillStyle = "#fff";
    g.fill();
    if (sinceClick < 450) {
      const t = sinceClick / 450;
      g.beginPath();
      g.arc(x, y, 15 * (1 + 1.2 * t), 0, Math.PI * 2);
      g.strokeStyle = `rgba(255,255,255,${1 - t})`;
      g.lineWidth = 2;
      g.stroke();
    }
  }

  /** The note the TV shows while someone can see its screen. */
  private drawNote() {
    const g = this.g;
    const text = "Shiv can see this screen";
    g.font = "500 18px Inter, sans-serif";
    const w = g.measureText(text).width + 62;
    const x = 640 - w / 2;
    g.fillStyle = "rgba(8,9,14,0.74)";
    roundRect(g, x, 8, w, 34, 17);
    g.fill();
    g.strokeStyle = "rgba(255,255,255,0.12)";
    g.lineWidth = 1.5;
    g.stroke();
    g.beginPath();
    g.arc(x + 23, 25, 5, 0, Math.PI * 2);
    g.fillStyle = "#ff4757";
    g.fill();
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillStyle = "#fff";
    g.fillText(text, x + 38, 26);
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const k = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + k, y);
  g.arcTo(x + w, y, x + w, y + h, k);
  g.arcTo(x + w, y + h, x, y + h, k);
  g.arcTo(x, y + h, x, y, k);
  g.arcTo(x, y, x + w, y, k);
  g.closePath();
}
