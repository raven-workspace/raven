/**
 * The lock screen's ciphertext field: faint hex pairs on black, drawn on one canvas.
 *
 * - Intro: cells decode outward from the form, once, about 1s.
 * - Pulse: a ring from the password field's centre that brightens and re-rolls the cells it passes
 *   (accent per keystroke, warn on a wrong password).
 * - Sweep: on unlock an accent ring clears the field outward and reveals the app underneath.
 * - Close: on lock the same ring runs in reverse, closing the field in from the edges onto the password field.
 *
 * Frames are drawn only while something moves; at rest the canvas holds still. Reduced motion draws the settled
 * field and nothing else. All colours come from the Ink tokens.
 */

type Rgb = readonly [number, number, number];

interface Cell {
  x: number;
  y: number;
  g: string;
  base: Rgb;
  delay: number;
  roll: number;
  ring: number;
}

interface Ring {
  id: number;
  t0: number;
  x: number;
  y: number;
  col: Rgb;
  speed: number;
  band: number;
  life: number;
  sweep: boolean;
  /** A sweep that runs inward (the lock): its radius shrinks from the far corner to the origin. */
  reverse?: boolean;
}

export type PulseKind = "key" | "error";

const HEX = "0123456789abcdef";
const CELL_W = 30;
const CELL_H = 22;
/** Cells left out at random, so the field reads as sparse data, not a wall. */
const SKIP = 0.35;
/** Space kept clear round the form, then a dithered edge this wide. */
const CLEAR_PAD = 32;
const FALLOFF = 170;
const INTRO_MS = 1100;
const SCRAMBLE_MS = 240;

const hex2 = () => HEX[(Math.random() * 16) | 0]! + HEX[(Math.random() * 16) | 0]!;

function parseColour(v: string): Rgb {
  const h = v.trim().replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return Number.isNaN(n) ? [0, 0, 0] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const css = (c: Rgb) => `rgb(${c[0]},${c[1]},${c[2]})`;
const mix = (a: Rgb, b: Rgb, t: number) =>
  `rgb(${(a[0] + (b[0] - a[0]) * t) | 0},${(a[1] + (b[1] - a[1]) * t) | 0},${(a[2] + (b[2] - a[2]) * t) | 0})`;

function rectDist(x: number, y: number, r: { l: number; t: number; r: number; b: number }) {
  return Math.hypot(Math.max(r.l - x, 0, x - r.r), Math.max(r.t - y, 0, y - r.b));
}

export class CipherField {
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly palette: { bg: Rgb; tiers: Rgb[]; accent: Rgb; warn: Rgb };
  private readonly font: string;
  private cells: Cell[] = [];
  private rings: Ring[] = [];
  private w = 0;
  private h = 0;
  private raf = 0;
  private introT0 = 0;
  private introEnd = 0;
  private ringId = 0;
  private origin = { x: 0, y: 0 };
  private sweepDone: (() => void) | null = null;
  /** Set once the lock's reverse sweep has closed: every later frame paints the solid backdrop, so the frozen copy
   * of the app under the canvas never shows through between the sweep's end and its removal. */
  private covered = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly reduced: boolean,
  ) {
    this.ctx = canvas.getContext("2d");
    const s = getComputedStyle(document.documentElement);
    const v = (name: string) => parseColour(s.getPropertyValue(name));
    this.palette = {
      bg: v("--bg"),
      tiers: [v("--line"), v("--line-2"), v("--line-strong")],
      accent: v("--accent"),
      warn: v("--warn"),
    };
    this.font = `400 13px ${s.getPropertyValue("--font-mono").trim() || "monospace"}`;
  }

  /** Font the canvas draws with, so callers can wait for it before the first layout. */
  get fontSpec(): string {
    return this.font;
  }

  /**
   * Sizes the canvas and lays the cells out round `clear` (the form) with the ring origin at `origin`
   * (both in canvas coordinates). `intro` plays the decode; otherwise the field appears settled.
   */
  layout(clear: DOMRect | null, origin: { x: number; y: number }, intro: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.w = rect.width;
    this.h = rect.height;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.origin = origin;

    const box = clear
      ? { l: clear.left - CLEAR_PAD, t: clear.top - CLEAR_PAD, r: clear.right + CLEAR_PAD, b: clear.bottom + CLEAR_PAD }
      : { l: this.w / 2, t: this.h / 2, r: this.w / 2, b: this.h / 2 };
    const cx = (box.l + box.r) / 2;
    const cy = (box.t + box.b) / 2;
    const cols = Math.ceil(this.w / CELL_W) + 1;
    const rows = Math.ceil(this.h / CELL_H) + 1;
    const ox = (this.w - (cols - 1) * CELL_W) / 2;
    const oy = (this.h - (rows - 1) * CELL_H) / 2;
    const [t1, t2, t3] = this.palette.tiers as [Rgb, Rgb, Rgb];
    const animate = intro && !this.reduced;
    this.cells = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const x = ox + i * CELL_W;
        const y = oy + j * CELL_H;
        const d = rectDist(x, y, box);
        // Dithered clearing round the form: cells that aren't there, not a gradient.
        if (d === 0 || Math.random() > d / FALLOFF || Math.random() < SKIP) continue;
        const r = Math.random();
        this.cells.push({
          x,
          y,
          g: hex2(),
          base: r < 0.6 ? t1 : r < 0.94 ? t2 : t3,
          delay: animate ? Math.hypot(x - cx, y - cy) * 0.45 + Math.random() * 260 : -Infinity,
          roll: 0,
          ring: -1,
        });
      }
    }
    this.introT0 = performance.now();
    this.introEnd = animate ? this.introT0 + INTRO_MS : 0;
    this.kick();
  }

  /** Where rings start (the password field's centre), in canvas coordinates. */
  setOrigin(origin: { x: number; y: number }): void {
    this.origin = origin;
  }

  /** A ring from the password field: accent for a keystroke, warn for a wrong password. */
  pulse(kind: PulseKind): void {
    if (this.reduced || !this.ctx || this.rings.some((r) => r.sweep)) return;
    const error = kind === "error";
    this.rings.push({
      id: ++this.ringId,
      t0: performance.now(),
      ...this.origin,
      col: error ? this.palette.warn : this.palette.accent,
      speed: error ? 1 : 0.8,
      band: error ? 64 : 40,
      life: error ? 1300 : 1500,
      sweep: false,
    });
    this.kick();
  }

  /** The unlock: an accent ring clears the field from the password field outward. Resolves when it's gone. */
  sweep(): Promise<void> {
    return this.ringSweep(false);
  }

  private ringSweep(reverse: boolean): Promise<void> {
    if (this.reduced || !this.ctx) return Promise.resolve();
    this.finishSweep();
    // The unlock sweep must reveal the app when it ends, even on a field that a lock's sweep closed.
    this.covered = false;
    const { x, y } = this.origin;
    const far = Math.max(Math.hypot(x, y), Math.hypot(this.w - x, y), Math.hypot(x, this.h - y), Math.hypot(this.w - x, this.h - y));
    const speed = Math.hypot(this.w, this.h) / 420;
    const band = 80;
    this.rings = [];
    this.rings.push({ id: ++this.ringId, t0: performance.now(), x, y, col: this.palette.accent, speed, band, life: (far + band) / speed, sweep: true, reverse });
    this.kick();
    return new Promise((resolve) => {
      this.sweepDone = resolve;
    });
  }

  /** The lock: the unlock sweep in reverse, closing the field in onto the password field. Resolves when it's closed. */
  close(): Promise<void> {
    return this.ringSweep(true);
  }

  /** Stops drawing. Any pending sweep resolves. */
  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.finishSweep();
  }

  /** Pauses while the window is hidden; time-based, so it resumes where the clock says. */
  setHidden(hidden: boolean): void {
    if (hidden) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    } else this.kick();
  }

  private finishSweep() {
    const done = this.sweepDone;
    this.sweepDone = null;
    done?.();
  }

  private kick() {
    if (!this.raf && this.ctx) this.raf = requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number) => {
    this.raf = 0;
    const sweepWas = this.rings.some((r) => r.sweep);
    if (this.rings.some((r) => r.reverse && now - r.t0 >= r.life)) this.covered = true;
    this.rings = this.rings.filter((r) => now - r.t0 < r.life);
    this.draw(now);
    if (sweepWas && !this.rings.some((r) => r.sweep)) this.finishSweep();
    if (now < this.introEnd || this.rings.length) this.raf = requestAnimationFrame(this.frame);
  };

  private draw(now: number) {
    const ctx = this.ctx!;
    const { bg, tiers } = this.palette;
    ctx.clearRect(0, 0, this.w, this.h);
    const s = this.rings.find((r) => r.sweep);
    // The ring's radius: outward from 0 for the unlock, inward from past the far corner to 0 for the lock.
    const sr = s ? (s.reverse ? s.life - (now - s.t0) : now - s.t0) * s.speed : 0;
    if (!s && this.covered) {
      ctx.fillStyle = css(bg);
      ctx.fillRect(0, 0, this.w, this.h);
    } else if (s) {
      // Everything not yet decrypted stays covered; the app shows through the hole.
      ctx.fillStyle = css(bg);
      ctx.beginPath();
      ctx.rect(0, 0, this.w, this.h);
      ctx.arc(s.x, s.y, Math.max(0, sr - s.band / 2), 0, Math.PI * 2, true);
      ctx.fill("evenodd");
    }
    ctx.font = this.font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const t = now - this.introT0;
    for (const c of this.cells) {
      if (t < c.delay) continue;
      let col = c.base;
      if (t < c.delay + SCRAMBLE_MS) {
        if (now - c.roll > 45) {
          c.g = hex2();
          c.roll = now;
        }
        col = tiers[2]!;
      }
      if (s) {
        const d = Math.hypot(c.x - s.x, c.y - s.y);
        if (d < sr - s.band / 2) continue;
        const f = 1 - Math.abs(d - sr) / s.band;
        if (f > 0) {
          if (c.ring !== s.id) {
            c.ring = s.id;
            c.g = hex2();
          }
          ctx.fillStyle = mix(col, s.col, f);
          ctx.fillText(c.g, c.x, c.y);
          continue;
        }
      }
      let best = 0;
      let hi: Rgb | null = null;
      let id = -1;
      for (const r of this.rings) {
        if (r.sweep) continue;
        const age = now - r.t0;
        const k = 1 - Math.abs(Math.hypot(c.x - r.x, c.y - r.y) - age * r.speed) / r.band;
        if (k <= 0) continue;
        const v = k * Math.pow(1 - age / r.life, 1.5);
        if (v > best) {
          best = v;
          hi = r.col;
          id = r.id;
        }
      }
      if (hi) {
        if (best > 0.55 && c.ring !== id) {
          c.ring = id;
          c.g = hex2();
        }
        ctx.fillStyle = mix(col, hi, best);
      } else ctx.fillStyle = css(col);
      ctx.fillText(c.g, c.x, c.y);
    }
  }
}
