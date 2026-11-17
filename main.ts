// gta6-twitch-ccu-forecast-01 — forecast GTA VI's launch-day Twitch viewers, hours 2-24.
//
// Model: a launch-day SHAPE, learned from the case's own comparables at run time.
// Every past big console launch has an hourly Twitch curve.  For each comparable
// we take its 24 release-day hours and form the log-ratio to its own hour 1:
//
//     r_h = ln(viewers at hour h / viewers at hour 1),  h = 2..24
//
// The shape is NOT one curve for every launch: how steeply viewership climbs
// after hour 1 depends on how big hour 1 already is.  A launch whose hour 1 is
// huge (the game was already live in New Zealand / Australia / Japan for hours
// and Europe just unlocked) has most of its audience in hand, so its ratio to
// the evening peak is flat; a launch whose hour 1 is small (only the first
// timezones live) still has the whole US unlock ahead of it, so its ratio climbs
// several-fold.  Across the rolling-midnight launches the correlation between
// log(hour 1) and log(peak / hour 1) is about -0.67, so per hour we fit
//
//     r_h = a_h + b_h * (ln(p1) - ln(120000))
//
// by ordinary least squares over the usable comparables, where p1 is this
// case's hour-1 print.  The slopes b_h run from ~0 in the overnight hours
// (the dip after hour 1 does not depend on size) to about -0.5 in the evening
// (the peak ratio shrinks hard with size).  The spread around the fit is the
// residual standard deviation per hour, scaled by 0.8, and the five quantiles
// are the fitted median times exp(z_tau * spread), z the normal quantiles.
//
// Which comparables are usable: only launches whose unlock text says the launch
// was rolling midnight-local AND whose tier is "comparable".  Simultaneous
// global launches are excluded on purpose: their hour 1 falls BEFORE the single
// unlock, so their hour-1 print is near zero and their ratios are meaningless
// (thousands-fold).  Early-access-contaminated and weak launches are excluded
// too.  The Grand Theft Auto VI category's own pre-release history is also
// skipped: it is not a launch curve, so it has no complete 24 release hours.
//
// If too few usable comparables survive (under 6, or their hour-1 levels barely
// vary so the slope is unidentified), the program falls back to the fitted
// constants baked in below (fit offline on the same population).  If hour 1's
// print is missing or zero, it falls back to the last whole-hour history point,
// then to the median hour 1 of the comparables, then to 150000.
//
// Everything is computed from the case file.  No network, no clock, no random
// numbers: two runs on the same case write byte-identical output.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? "/input";
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";

/** The quantile levels the contest scores, in the order each row lists them. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each scored level. */
const Z_BY_LEVEL: Record<number, number> = {
  0.05: -1.645,
  0.25: -0.674,
  0.5: 0,
  0.75: 0.674,
  0.95: 1.645,
};
/** Reference hour-1 level, ln(120000): the centre of the level adjustment. */
const REF_LOG = Math.log(120000);
/** The level adjustment is clamped to this many log units either way, so an
 *  extreme hour-1 print (tiny or mega) cannot extrapolate the linear slope
 *  into an absurd shape. */
const LEVEL_CLAMP = 1.5;
/** Spread multiplier on the per-hour residual standard deviation. */
const SPREAD_K = 0.8;
/** Minimum usable comparables for a run-time fit; fewer falls back to the
 *  baked-in constants. */
const MIN_FIT_N = 6;
/** Minimum spread of log hour-1 across the fit set for the slope to be
 *  identified; narrower falls back to the baked-in constants. */
const MIN_LOG_H1_SPREAD = 1.0;

/**
 * Fallback fit, per hour 2..24, used when the run-time fit is not possible.
 * Fitted offline on the same population the run-time fit uses: the 14
 * rolling-midnight, tier-comparable launch curves (10 comparables shared by
 * the practice cases plus the 4 practice launches themselves, whose hours
 * 1..24 are public history).  Each entry is indexed by hour: a_h is the
 * intercept, b_h the slope on (ln hour-1 - ln 120000), sd_h the residual
 * standard deviation of the log-ratio.  Practice leave-one-out pinball loss
 * with this fit is ~0.16, against ~0.39 for the house baseline.
 */
const FALLBACK_A: number[] = [];
const FALLBACK_B: number[] = [];
const FALLBACK_SD: number[] = [];
{
  const aVals: Record<number, number> = {
    2: -0.1416, 3: -0.352, 4: -0.4073, 5: -0.0806, 6: 0.1694, 7: 0.1687,
    8: 0.1111, 9: 0.0499, 10: 0.0137, 11: 0.0254, 12: 0.0379, 13: 0.2022,
    14: 0.3651, 15: 0.5203, 16: 0.6273, 17: 0.7217, 18: 0.8252, 19: 0.8604,
    20: 0.8806, 21: 0.8846, 22: 0.8504, 23: 0.7719, 24: 0.6655,
  };
  const bVals: Record<number, number> = {
    2: 0.0511, 3: 0.0781, 4: -0.0014, 5: -0.1343, 6: -0.2125, 7: -0.2737,
    8: -0.2887, 9: -0.3694, 10: -0.3627, 11: -0.3765, 12: -0.404, 13: -0.4052,
    14: -0.4182, 15: -0.4258, 16: -0.4121, 17: -0.4293, 18: -0.4893,
    19: -0.4969, 20: -0.5381, 21: -0.5501, 22: -0.5506, 23: -0.5249,
    24: -0.5619,
  };
  const sdVals: Record<number, number> = {
    2: 0.1555, 3: 0.3447, 4: 0.2987, 5: 0.2767, 6: 0.3647, 7: 0.4371,
    8: 0.4544, 9: 0.4425, 10: 0.4633, 11: 0.471, 12: 0.5374, 13: 0.478,
    14: 0.4415, 15: 0.4172, 16: 0.432, 17: 0.4609, 18: 0.4694, 19: 0.4587,
    20: 0.4394, 21: 0.4024, 22: 0.3733, 23: 0.3657, 24: 0.3985,
  };
  for (let h = 2; h <= 24; h++) {
    FALLBACK_A[h] = aVals[h];
    FALLBACK_B[h] = bVals[h];
    FALLBACK_SD[h] = sdVals[h];
  }
}

interface HourlyRow {
  from: string;
  viewers: number;
  channels?: number | null;
}

interface Comparable {
  name: string;
  day_start: string;
  unlock: string;
  hourly: HourlyRow[];
}

interface Case {
  id: string;
  levels: number[];
  known: Array<{ hour: number; viewers: number }>;
  forecast: Array<{ hour: number }>;
  history_hourly?: Array<{ from: string; viewers: number }>;
  comparables: Comparable[];
}

/** x rounded to 2 decimals. */
const round2 = (x: number): number => Math.round(x * 100) / 100;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

const stdev = (xs: number[]): number => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / Math.max(1, xs.length - 1);
  return Math.sqrt(v);
};

/** "Tier: comparable" (etc.) parsed out of a comparable's unlock text. */
function parseTier(unlock: string): string {
  const m = /Tier:\s*([a-z-]+)/.exec(unlock ?? "");
  return m ? m[1] : "unknown";
}

/**
 * Rolling midnight-local launch, from the unlock text.  Returns null when the
 * text does not say either way.
 */
function isRolling(unlock: string): boolean | null {
  const u = (unlock ?? "").toLowerCase();
  if (
    u.includes("single simultaneous") ||
    u.includes("simultaneous global") ||
    u.includes("single global unlock")
  ) {
    return false;
  }
  if (u.includes("rolling") || u.includes("midnight local")) {
    return true;
  }
  return null;
}

/** The 24 release-day hourly viewer counts of one comparable, or null when
 *  any of hours 1..24 is missing or not positive. */
function extractCurve(comp: Comparable): number[] | null {
  const byFrom = new Map<string, number>();
  for (const row of comp.hourly ?? []) {
    if (typeof row.viewers === "number") byFrom.set(row.from, row.viewers);
  }
  const base = Date.parse(comp.day_start);
  if (!Number.isFinite(base)) return null;
  const out: number[] = [];
  for (let h = 0; h < 24; h++) {
    const t = new Date(base + h * 3600 * 1000).toISOString().slice(0, 19) + "Z";
    const v = byFrom.get(t);
    if (v === undefined || !(v > 0)) return null;
    out.push(v);
  }
  return out;
}

interface Fit {
  a: number[];
  b: number[];
  sd: number[];
}

/**
 * Per-hour least-squares fit of log-ratio on (log hour-1 - REF_LOG) over the
 * given curves.  Returns the intercept a_h, slope b_h and residual sd per
 * hour, indexed by hour (2..24).
 */
function fitModel(curves: Array<{ curve: number[]; h1: number }>): Fit {
  const a: number[] = [];
  const b: number[] = [];
  const sd: number[] = [];
  for (let h = 2; h <= 24; h++) {
    const xs = curves.map((c) => Math.log(c.h1) - REF_LOG);
    const ys = curves.map((c) => Math.log(c.curve[h - 1] / c.curve[0]));
    const mx = xs.reduce((p, v) => p + v, 0) / xs.length;
    const my = ys.reduce((p, v) => p + v, 0) / ys.length;
    let vx = 0;
    let cxy = 0;
    for (let i = 0; i < xs.length; i++) {
      vx += (xs[i] - mx) * (xs[i] - mx);
      cxy += (xs[i] - mx) * (ys[i] - my);
    }
    const slope = vx > 0 ? cxy / vx : 0;
    const inter = my - slope * mx;
    const resid = ys.map((y, i) => y - (inter + slope * xs[i]));
    a[h] = inter;
    b[h] = slope;
    sd[h] = stdev(resid);
  }
  return { a, b, sd };
}

/** Hour 1's print, with fallbacks so the output is always valid. */
function hour1Print(c: Case, curves: Array<{ h1: number }>): number {
  const k = (c.known ?? []).find((r) => r.hour === 1);
  if (k && k.viewers > 0 && Number.isFinite(k.viewers)) return k.viewers;
  const hist = c.history_hourly ?? [];
  for (let i = hist.length - 1; i >= 0; i--) {
    if (hist[i].viewers > 0 && Number.isFinite(hist[i].viewers)) {
      return hist[i].viewers;
    }
  }
  if (curves.length > 0) return median(curves.map((x) => x.h1));
  return 150000;
}

/** The forecast object for one case. */
function forecastCase(c: Case): { hours: Array<{ hour: number; q: number[] }> } {
  // Usable comparables: complete 24h curve, rolling midnight-local launch,
  // tier comparable.  The GTA VI category's own pre-release history has no
  // complete release day, so extractCurve already drops it.
  const curves: Array<{ curve: number[]; h1: number }> = [];
  for (const comp of c.comparables ?? []) {
    if (parseTier(comp.unlock ?? "") !== "comparable") continue;
    if (isRolling(comp.unlock ?? "") !== true) continue;
    const curve = extractCurve(comp);
    if (!curve) continue;
    curves.push({ curve, h1: curve[0] });
  }

  const p1 = hour1Print(c, curves);

  let fit: Fit;
  const logH1s = curves.map((x) => Math.log(x.h1));
  const logSpread =
    curves.length > 0 ? Math.max(...logH1s) - Math.min(...logH1s) : 0;
  if (curves.length >= MIN_FIT_N && logSpread >= MIN_LOG_H1_SPREAD) {
    fit = fitModel(curves);
  } else {
    fit = { a: FALLBACK_A, b: FALLBACK_B, sd: FALLBACK_SD };
  }

  const lp = Math.max(-LEVEL_CLAMP, Math.min(LEVEL_CLAMP, Math.log(p1) - REF_LOG));
  const z = (c.levels ?? LEVELS).map(
    (lv) => Z_BY_LEVEL[lv] ?? Z_BY_LEVEL[0.5],
  );
  const rows: Array<{ hour: number; q: number[] }> = [];
  for (let h = 2; h <= 24; h++) {
    const m = fit.a[h] + fit.b[h] * lp;
    const s = SPREAD_K * fit.sd[h];
    let q = z.map((zz) => p1 * Math.exp(m + zz * s));
    q = q.map((v) => {
      if (!Number.isFinite(v) || v <= 0) return 1;
      return Math.min(1_000_000_000, round2(v));
    });
    // Keep the five quantiles non-decreasing after rounding.
    for (let i = 1; i < q.length; i++) {
      if (q[i] < q[i - 1]) q[i] = q[i - 1];
    }
    rows.push({ hour: h, q });
  }
  return { hours: rows };
}

function main(): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const files = readdirSync(INPUT_DIR)
    .filter((f) => f.endsWith(".in"))
    .sort();
  for (const file of files) {
    const id = file.slice(0, -3);
    const c = JSON.parse(readFileSync(join(INPUT_DIR, file), "utf8")) as Case;
    const out = forecastCase(c);
    writeFileSync(join(OUTPUT_DIR, `${id}.out`), JSON.stringify(out), "utf8");
  }
}

main();
