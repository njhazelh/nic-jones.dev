// The frame-time chart drawn on the home page (src/components/FrameChart.astro)
// and along the foot of every link-preview card (src/lib/og.ts).
//
// Frames run noisy and sometimes over budget, one runs badly over, and after
// the fix they sit low and stay there. Find it, fix it, keep it fixed. It's an
// illustration, not data: the values come from a seeded generator, so every
// build draws the same chart.

/** Milliseconds per frame at 60 Hz */
export const BUDGET = 1000 / 60;
/** Milliseconds at the top of the chart */
export const CEILING = 36;

const BARS = 64;
const SPIKE = 38;

// mulberry32: a tiny seeded PRNG
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = rng(16);

/** Frame times in milliseconds, left to right */
export const frames: number[] = Array.from({ length: BARS }, (_, i) => {
  if (i === SPIKE) return 34;
  if (i === SPIKE + 1) return 21;
  if (i === 13) return 18.6;
  if (i === 26) return 17.9;
  if (i < SPIKE) return 8.5 + rand() * 7;
  return 5.5 + rand() * 2.2;
});

/** A frame's height as a fraction of the chart, 0 to 1 */
export const share = (ms: number) => Math.min(ms, CEILING) / CEILING;
