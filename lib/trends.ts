// Progress-over-time engine: turns the saved-swing library (SavedMeta rows) into
// a trend read, so the library stops being a passive archive and becomes the
// retention loop the product was missing — "are my swings getting more
// repeatable?" That question is the whole thesis of the app (skill is repeating
// YOUR motion, r≈0.80), so consistency (spread) is a first-class signal here, not
// just the raw averages.
//
// Everything runs off SavedMeta alone (loaded instantly by listMeta) — no payload
// fetch — so the panel is cheap to render. Pure + deterministic = unit-testable.
import type { SavedMeta } from "./library";
import { bhToMph } from "./units";

const TEMPO_IDEAL = 3.0;
const MIN_FOR_TREND = 4; // below this, a "trend" is noise — say so instead of faking one
const MOVE = 0.08; // relative change that counts as a real move, not jitter

export function peakMph(m: Pick<SavedMeta, "peakBh" | "heightCmAtSave">): number | null {
  if (m.peakBh == null || !Number.isFinite(m.peakBh)) return null;
  return bhToMph(m.peakBh, m.heightCmAtSave);
}

export type TrendPoint = { t: number; value: number };
export type TrendDir = "improving" | "steady" | "declining" | "n/a";
export type MetricKey = "tempo" | "speed";

export type MetricTrend = {
  key: MetricKey;
  labelEn: string;
  labelZh: string;
  unit: string;
  points: TrendPoint[]; // chronological, oldest → newest
  latest: number | null;
  best: number | null; // personal best (closest-to-ideal for tempo, fastest for speed)
  mean: number;
  sd: number; // spread across the window — the repeatability number
  cv: number; // sd / |mean| — scale-free repeatability
  slope: number; // least-squares change per swing
  dir: TrendDir; // interpreted toward the metric's ideal
};

export type TrendSummary = {
  nSwings: number;
  spanDays: number;
  trends: MetricTrend[]; // only metrics with at least one data point
  headline: { en: string; zh: string } | null;
};

// ---------- small stats (population, NaN-free inputs) ----------

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : NaN;
}

function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length);
}

// Least-squares slope of value vs swing index (0..n-1): change per swing.
export function slopePerSwing(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const xb = (n - 1) / 2;
  const yb = mean(xs);
  let num = 0,
    den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xb) * (xs[i] - yb);
    den += (i - xb) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

// First vs second half. For an ODD count the middle swing is shared by both
// halves (overlap) rather than silently dropped — every saved swing counts.
function halves<T>(xs: T[]): [T[], T[]] {
  const h = Math.ceil(xs.length / 2);
  return [xs.slice(0, h), xs.slice(xs.length - h)];
}

// Direction toward an ideal (tempo) or "more is better" (speed). Uses the two
// halves so one fluke swing can't flip the read.
function direction(values: number[], ideal: number | null): TrendDir {
  if (values.length < MIN_FOR_TREND) return "n/a";
  const [a, b] = halves(values);
  if (ideal != null) {
    const da = mean(a.map((v) => Math.abs(v - ideal)));
    const db = mean(b.map((v) => Math.abs(v - ideal)));
    // Degenerate baseline: a perfectly-on-ideal first half has no error to take a
    // RELATIVE change against. Only call it declining if the second half has
    // drifted by a MATERIAL absolute amount; tiny db is just noise around perfect.
    if (da === 0) return db > MOVE * ideal ? "declining" : "steady";
    const rel = (db - da) / da; // closer to ideal ⇒ negative
    if (rel < -MOVE) return "improving";
    if (rel > MOVE) return "declining";
    return "steady";
  }
  const ma = mean(a),
    mb = mean(b);
  if (ma === 0) return "steady";
  const rel = (mb - ma) / Math.abs(ma);
  if (rel > MOVE) return "improving";
  if (rel < -MOVE) return "declining";
  return "steady";
}

// Is the swing-to-swing spread tightening (getting more repeatable)?
export function repeatability(values: number[]): "tightening" | "loosening" | "steady" {
  if (values.length < MIN_FOR_TREND) return "steady";
  const [a, b] = halves(values);
  const sa = sd(a),
    sb = sd(b);
  // Degenerate baseline (perfectly repeatable first half, sa=0): only "loosening"
  // if the second half's spread is materially large vs the overall scale, not noise.
  if (sa === 0) {
    const scale = Math.abs(mean(values)) || 1;
    return sb / scale > MOVE ? "loosening" : "steady";
  }
  const rel = (sb - sa) / sa;
  if (rel < -MOVE) return "tightening";
  if (rel > MOVE) return "loosening";
  return "steady";
}

// ---------- per-metric series ----------

function ascByTime(metas: SavedMeta[]): SavedMeta[] {
  return [...metas].sort((p, q) => p.createdAt - q.createdAt);
}

function valueOf(m: SavedMeta, key: MetricKey): number | null {
  if (key === "tempo") return Number.isFinite(m.tempoRatio) ? m.tempoRatio : null;
  return peakMph(m);
}

const META: Record<MetricKey, { labelEn: string; labelZh: string; unit: string; ideal: number | null }> = {
  tempo: { labelEn: "Tempo", labelZh: "节奏", unit: ":1", ideal: TEMPO_IDEAL },
  speed: { labelEn: "Hand speed", labelZh: "手部速度", unit: "mph", ideal: null },
};

export function buildMetricTrend(metas: SavedMeta[], key: MetricKey): MetricTrend {
  const info = META[key];
  const points: TrendPoint[] = [];
  for (const m of ascByTime(metas)) {
    const v = valueOf(m, key);
    if (v != null && Number.isFinite(v)) points.push({ t: m.createdAt, value: v });
  }
  const values = points.map((p) => p.value);
  const m = mean(values);
  const best =
    values.length === 0
      ? null
      : info.ideal != null
      ? values.reduce((a, b) => (Math.abs(b - info.ideal!) < Math.abs(a - info.ideal!) ? b : a))
      : Math.max(...values);
  return {
    key,
    labelEn: info.labelEn,
    labelZh: info.labelZh,
    unit: info.unit,
    points,
    latest: values.length ? values[values.length - 1] : null,
    best,
    mean: values.length ? m : NaN,
    sd: sd(values),
    cv: values.length && m !== 0 ? sd(values) / Math.abs(m) : 0,
    slope: slopePerSwing(values),
    dir: direction(values, info.ideal),
  };
}

// ---------- top-level summary + headline ----------

export function summarize(metas: SavedMeta[]): TrendSummary {
  const times = metas.map((m) => m.createdAt);
  const spanDays = times.length ? (Math.max(...times) - Math.min(...times)) / 86_400_000 : 0;
  const tempo = buildMetricTrend(metas, "tempo");
  const speed = buildMetricTrend(metas, "speed");
  const trends = [tempo, speed].filter((t) => t.points.length > 0);
  return { nSwings: metas.length, spanDays, trends, headline: headline(metas, tempo, speed) };
}

function fmt(v: number, unit: string): string {
  return unit === ":1" ? `${v.toFixed(1)}:1` : `${Math.round(v)} ${unit}`;
}

// One honest, encouraging-where-true sentence. Priority: a real improvement to
// celebrate → tightening repeatability (the on-brand win) → a gentle drift flag
// → steady. Returns null until there's enough history to say anything truthful.
function headline(metas: SavedMeta[], tempo: MetricTrend, speed: MetricTrend): { en: string; zh: string } | null {
  if (metas.length < MIN_FOR_TREND) {
    if (metas.length === 0) return null;
    const left = MIN_FOR_TREND - metas.length;
    return {
      en: `${metas.length} swing${metas.length > 1 ? "s" : ""} saved — film ${left} more to unlock your trend. Repeatability is the whole game.`,
      zh: `已保存 ${metas.length} 次挥杆——再拍 ${left} 次就能看到趋势。可重复性才是关键。`,
    };
  }

  if (tempo.dir === "improving")
    return {
      en: `Your tempo is settling toward a smooth 3:1 — recent swings average ${fmt(tempo.mean, tempo.unit)}. Keep grooving that transition.`,
      zh: `你的节奏正在向流畅的 3:1 靠拢——近期平均 ${fmt(tempo.mean, tempo.unit)}。继续把这个转换练成习惯。`,
    };

  const tempoVals = tempo.points.map((p) => p.value);
  if (repeatability(tempoVals) === "tightening")
    return {
      en: `Your tempo is getting more repeatable — the spread across your last ${tempoVals.length} swings is tightening. That's exactly the skill that lowers scores.`,
      zh: `你的节奏越来越稳定——最近 ${tempoVals.length} 次挥杆的波动在收窄。这正是能降低杆数的能力。`,
    };

  if (speed.dir === "improving" && speed.latest != null)
    return {
      en: `Hand speed is trending up — recent swings peak around ${fmt(speed.mean, speed.unit)}. Make sure it's not costing you repeatability.`,
      zh: `手部速度在上升——近期峰值约 ${fmt(speed.mean, speed.unit)}。注意别为了速度牺牲了稳定性。`,
    };

  if (tempo.dir === "declining")
    return {
      en: `Your tempo has drifted to ${fmt(tempo.latest ?? tempo.mean, tempo.unit)} lately — a few calm-transition reps would pull it back toward 3:1.`,
      zh: `最近你的节奏漂到了 ${fmt(tempo.latest ?? tempo.mean, tempo.unit)}——练几次平稳转换就能拉回 3:1 附近。`,
    };

  return {
    en: `Steady across ${metas.length} swings — tempo holding near ${fmt(tempo.mean, tempo.unit)}. Consistency like this is what transfers to the course.`,
    zh: `${metas.length} 次挥杆都很稳——节奏保持在 ${fmt(tempo.mean, tempo.unit)} 附近。这种一致性才能带到球场上。`,
  };
}

// ---------- library sort (pure — lives here so it's unit-testable, not buried
// in the Library client component) ----------

export type SortKey = "newest" | "fast" | "smooth";

// Missing values sort LAST either way, so a half-tracked swing never jumps to
// the top: fastest uses −Infinity for an unknown speed, smoothest uses +Infinity
// for a non-finite tempo (it's sorted by distance-from-ideal, ascending).
export function sortMetas(metas: SavedMeta[], key: SortKey): SavedMeta[] {
  const m = [...metas];
  if (key === "fast") return m.sort((a, b) => (peakMph(b) ?? -Infinity) - (peakMph(a) ?? -Infinity));
  if (key === "smooth")
    return m.sort(
      (a, b) =>
        (Number.isFinite(a.tempoRatio) ? Math.abs(a.tempoRatio - TEMPO_IDEAL) : Infinity) -
        (Number.isFinite(b.tempoRatio) ? Math.abs(b.tempoRatio - TEMPO_IDEAL) : Infinity)
    );
  return m.sort((a, b) => b.createdAt - a.createdAt); // newest
}
