// GTA VI Twitch CCU forecast (gta6-twitch-ccu-forecast-01).
//
// Model: comparable-launch median curve, conditioned on the launch being a
// console-only, rolling-midnight release like GTA VI (no PC, no simultaneous
// global unlock). For every comparable launch with a usable release-day curve
// we take log(viewers_h / viewers_1) for hours 2..24; the forecast median for
// hour h is hour 1's print times exp(median log-ratio at h), and the
// quantile spreads are the empirical quantiles of the residuals around that
// median, widened x1.6.
//
// Why this shape: hour 1 (00:00-01:00 UTC) only holds the regions already
// unlocked at local midnight (New Zealand, Australia, Japan, central Europe,
// the UK). The US east coast unlocks at 05:00Z (hour 6) and the west coast at
// 08:00Z (hour 9), and the evening peak lands at hours 18-22 UTC (Europe
// prime time + US afternoon). Across 37 past big launches the median curve
// dips to ~0.73x of hour 1 in hours 3-5, then climbs to ~2.4x at hour 19-20
// and stays ~2x at hour 24. A flat persistence forecast misses that whole
// rollout; the house baseline scores ~0.387 pinball loss on the four practice
// launches, this model ~0.255.
//
// What did NOT survive backtesting (kept out on purpose):
// - a log-log regression of the curve on hour-1 size: best in-sample
//   (0.204) but extrapolates to an evening collapse below hour 1 for a
//   GTA-VI-scale hour-1 print, and scores 0.72 mean / 1.56 worst on
//   scenario stress tests. The relationship is driven by small, sparsely
//   sampled categories, not by big launches.
// - aligning curves by each launch's detected "unlock jump" hour: it breaks
//   the evening peak (0.62 mean on practice).
// - Gaussian spreads from residual sds (0.396) and unscaled empirical
//   spreads (0.324): the x1.6 widening is what the practice cases reward.
//
// Backtest (practice cases p00-p03, answers from SullyGnome, the same public
// source the kit used; scorer = the contest's log-scale pinball loss):
//   house baseline .......... 0.3871 mean (p00 0.744, p01 0.287, p02 0.215, p03 0.303)
//   flat (all quantiles = p1)  0.6029 mean
//   this model .............. 0.2550 mean (p00 0.437, p01 0.171, p02 0.198, p03 0.214)
//   typical miss 23-35% on p01-p03; 90% coverage 0.74-1.00.
// Scenario stress test (truth = each practice curve, an Elden-Ring-shaped
// curve, and the median shape, rescaled to hour-1 prints of 300k-800k):
//   this model mean 0.254, worst 0.437 - the best mean and best worst case
//   of every candidate tried, and below the house baseline in every
//   console-launch scenario.
//
// Runtime behaviour: reads every <id>.in in the input directory, derives
// everything from that case file's own comparables (so the final case's 42
// comparables, practice launches included, are used at the deadline), and
// writes <id>.out. Deterministic, standard library only, no network.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** Standard normal quantiles at LEVELS (used only for the fallback path). */
const Z = [-1.6448536269514722, -0.6744897501960817, 0, 0.6744897501960817, 1.6448536269514722];
/** How much the empirical residual quantiles are widened. Tuned on practice. */
const SPREAD = 1.6;
/** A comparable counts only with a full release-day curve this complete. */
const MIN_CURVE_HOURS = 12;
/** Need this many console-only curves before trusting the console median. */
const MIN_CONSOLE_CURVES = 4;
/** Fallback spread (log units per sqrt hour) when no comparable curve exists. */
const FALLBACK_SIGMA = 0.15;

interface KnownRow { hour: number; viewers: number }
interface ForecastRow { hour: number }
interface HourlyRow { from: string; viewers: number | null }
interface Comparable {
  name: string;
  day_start: string;
  platforms?: string;
  hourly: HourlyRow[];
}
interface Case {
  levels: number[];
  known: KnownRow[];
  forecast: ForecastRow[];
  comparables: Comparable[];
}

/** x rounded to 2 decimals (half up), like the house baseline. */
const round2 = (x: number): number => Math.round(x * 100) / 100;

/** Median of a list of numbers (average of the two middles when even). */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** Linear-interpolation quantile of a sorted list at probability p. */
function quantile(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0];
  const i = p * (n - 1);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - i) + sorted[hi] * (i - lo);
}

/**
 * A comparable's release-day curve: viewers by hour 1..24 relative to its
 * day_start, from its hourly points. Returns null when hour 1 is missing or
 * the curve is too sparse to trust (small categories are sampled rarely, so a
 * sparse "hour 1" can be a near-empty point and would corrupt the ratios).
 */
function releaseDayCurve(c: Comparable): Map<number, number> | null {
  const start = Date.parse(c.day_start);
  if (Number.isNaN(start)) return null;
  const curve = new Map<number, number>();
  for (const row of c.hourly ?? []) {
    if (row.viewers === null || row.viewers === undefined || row.viewers <= 0) continue;
    const t = Date.parse(row.from);
    if (Number.isNaN(t)) continue;
    const h = Math.floor((t - start) / 3_600_000) + 1;
    if (h >= 1 && h <= 24 && !curve.has(h)) curve.set(h, row.viewers);
  }
  if (!curve.has(1) || curve.size < MIN_CURVE_HOURS) return null;
  return curve;
}

/** A launch is console-only (no PC) when its platforms string names no PC. */
function isConsoleOnly(c: Comparable): boolean {
  return !((c.platforms ?? '').includes('PC'));
}

/**
 * The forecast for one case: for each hour, the five quantiles around hour
 * 1's print. Median and spreads come from the case's own comparables, so the
 * final case automatically uses its 42 comparables (practice launches
 * included) and a practice case its 38.
 */
function forecastCase(c: Case): Array<{ hour: number; q: number[] }> {
  const first = c.known.find((k) => k.hour === 1);
  if (first === undefined) throw new Error('case has no hour-1 print');
  const p1 = Math.max(1, first.viewers);

  const curves: Array<{ curve: Map<number, number>; consoleOnly: boolean }> = [];
  for (const comp of c.comparables ?? []) {
    const curve = releaseDayCurve(comp);
    if (curve !== null) curves.push({ curve, consoleOnly: isConsoleOnly(comp) });
  }
  const consoleCurves = curves.filter((x) => x.consoleOnly);
  const use = consoleCurves.length >= MIN_CONSOLE_CURVES ? consoleCurves : curves;

  // Per hour: median log-ratio to hour 1, and the sorted residuals around it.
  const med = new Map<number, number>();
  const resid = new Map<number, number[]>();
  for (let h = 2; h <= 24; h++) {
    const ratios: number[] = [];
    for (const { curve } of use) {
      const v1 = curve.get(1);
      const vh = curve.get(h);
      if (v1 !== undefined && vh !== undefined) ratios.push(Math.log(vh / v1));
    }
    if (ratios.length >= 3) {
      const m = median(ratios);
      med.set(h, m);
      resid.set(h, ratios.map((r) => r - m).sort((a, b) => a - b));
    }
  }

  const levels = c.levels.length === LEVELS.length ? c.levels : LEVELS;
  // zAt: standard-normal quantile for the j-th level, clamped so an
  // unexpected levels array can never index past Z and produce NaN.
  const zAt = (j: number): number => Z[Math.min(j, Z.length - 1)];
  return c.forecast.map(({ hour }) => {
    const m = med.get(hour);
    let qs: number[];
    if (m !== undefined) {
      const rs = resid.get(hour) ?? [];
      qs = levels.map((tau, j) => {
        const e = rs.length >= 3 ? quantile(rs, tau) * SPREAD : zAt(j) * 0.35 * SPREAD;
        return p1 * Math.exp(m + e);
      });
    } else {
      // No comparable covers this hour: fall back to the house baseline shape.
      qs = levels.map((_, j) => p1 * Math.exp(zAt(j) * FALLBACK_SIGMA * Math.sqrt(hour - 1)));
    }
    qs = qs.map((q) => Math.min(1e9, Math.max(1, round2(q))));
    for (let i = 1; i < qs.length; i++) qs[i] = Math.max(qs[i], qs[i - 1]);
    return { hour, q: qs };
  });
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  const hours = forecastCase(c);
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ hours })}\n`);
}
