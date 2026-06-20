// Turns raw metrics into a good / okay / needs-work read + a suggestive, data-driven
// summary — so "Tempo 2.0" reads as "a touch quick" rather than a bare number, and the
// metrics lead-in + "what to work on" change with the actual swing instead of a fixed line.
// Thresholds align with the fault gates in analysis.ts: sway and vert are symmetrical
// (grade "work" at >15 / >12 exactly where the fault fires), while tempo is intentionally
// asymmetric — the rushed fault is stricter (fires <1.8) than the grade "ok" edge (2.0),
// so a 1.9 tempo reads "a touch quick" without firing a fault. Badges never contradict it.
import type { Metrics, SpeedAnalysis } from "./analysis";

export type Level = "good" | "ok" | "work";
export type Grade = { level: Level; en: string; zh: string };

const RANK: Record<Level, number> = { good: 0, ok: 1, work: 2 };

export function gradeTempo(t: number): Grade | null {
  if (!Number.isFinite(t)) return null;
  if (t >= 2.5 && t <= 3.6) return { level: "good", en: "smooth", zh: "流畅" };
  if (t >= 2.0 && t < 2.5) return { level: "ok", en: "a touch quick", zh: "略快" };
  if (t > 3.6 && t <= 4.5) return { level: "ok", en: "a touch slow", zh: "略慢" };
  if (t < 2.0) return { level: "work", en: "rushed", zh: "偏急" };
  return { level: "work", en: "very slow", zh: "偏慢" };
}

export function gradeSway(p: number): Grade {
  if (p < 10) return { level: "good", en: "steady", zh: "稳" };
  if (p <= 15) return { level: "ok", en: "a little loose", zh: "略大" };
  return { level: "work", en: "too much", zh: "过大" };
}

export function gradeVert(p: number): Grade {
  if (p < 8) return { level: "good", en: "steady", zh: "稳" };
  if (p <= 12) return { level: "ok", en: "a little loose", zh: "略大" };
  return { level: "work", en: "too much", zh: "过大" };
}

// Hand speed is genuinely hard to grade (it's HAND speed, not clubhead, and "good" depends
// on club/level), so this is a soft orientation only — never the harsh "work" band — and the
// UI labels it rough. Bands are on body-heights/sec (height-independent).
export function gradeHandSpeed(bh: number | null | undefined): Grade | null {
  if (!bh || !Number.isFinite(bh)) return null;
  if (bh >= 2.6) return { level: "good", en: "quick", zh: "偏快" };
  if (bh >= 1.9) return { level: "ok", en: "solid", zh: "中等" };
  return { level: "ok", en: "developing", zh: "发展中" };
}

// A suggestive sentence about the single metric most worth attention.
function suggest(key: "tempo" | "sway" | "vert", m: Metrics): { en: string; zh: string } {
  if (key === "tempo") {
    const t = m.tempoRatio.toFixed(1);
    return m.tempoRatio < 2.5
      ? {
          en: `Your tempo is ${t}:1 — quicker than the smooth ~3:1, so easing the transition is the first thing I'd work on.`,
          zh: `你的节奏是 ${t}:1——比流畅的约 3:1 更快，所以放缓转换是我最先会练的。`,
        }
      : {
          en: `Your tempo is ${t}:1 — a bit slower than the smooth ~3:1; a touch more flow through the top would help.`,
          zh: `你的节奏是 ${t}:1——比流畅的约 3:1 略慢；过顶点时再顺一点会更好。`,
        };
  }
  if (key === "sway") {
    return {
      en: `Your head drifts ${m.headSwayPct.toFixed(0)}% side-to-side — quieting that is the cheapest strike gain here.`,
      zh: `你的头横向漂移 ${m.headSwayPct.toFixed(0)}%——把它压住，是这里成本最低的触球进步。`,
    };
  }
  return {
    en: `Your head moves ${m.headVertPct.toFixed(0)}% up-and-down — steadying it levels out where the club bottoms.`,
    zh: `你的头上下移动 ${m.headVertPct.toFixed(0)}%——稳住它，触地点就会更一致。`,
  };
}

export type MetricRead = {
  tempo: Grade | null;
  sway: Grade;
  vert: Grade;
  hand: Grade | null;
  worstKey: "tempo" | "sway" | "vert";
  allGood: boolean;
  leadEn: string;
  leadZh: string;
  focusEn: string; // one-line "the thing to nudge", for "what to work on"
  focusZh: string;
};

export function readMetrics(m: Metrics, speed: SpeedAnalysis | null): MetricRead {
  const tempo = gradeTempo(m.tempoRatio);
  const sway = gradeSway(m.headSwayPct);
  const vert = gradeVert(m.headVertPct);
  const hand = gradeHandSpeed(speed?.peak);

  const core: { key: "tempo" | "sway" | "vert"; g: Grade }[] = [
    ...(tempo ? [{ key: "tempo" as const, g: tempo }] : []),
    { key: "sway", g: sway },
    { key: "vert", g: vert },
  ];
  const worst = core.slice().sort((a, b) => RANK[b.g.level] - RANK[a.g.level])[0];
  const allGood = core.every((c) => c.g.level === "good");
  const s = suggest(worst.key, m);

  return {
    tempo,
    sway,
    vert,
    hand,
    worstKey: worst.key,
    allGood,
    leadEn: allGood
      ? "These all read steady — so the next gain isn't a prettier position, it's repeating them. Film a few swings and watch the spread."
      : `${s.en} The rest read steadier — treat these as repeatability markers, not a report card.`,
    leadZh: allGood
      ? "这些数字都挺稳——所以下一步的进步不是某个更好看的姿势，而是把它们重复出来。多拍几次挥杆，看看波动。"
      : `${s.zh} 其余的更稳一些——把它们当作可重复性的标尺，而不是成绩单。`,
    focusEn: allGood
      ? "Nothing here is off — your highest-leverage move is repeating it (film 3+) and finding leaks the camera can't see (log a round)."
      : `Closest to watch: ${s.en}`,
    focusZh: allGood
      ? "这里没有明显问题——回报最高的是把它重复出来（拍 3 次以上），并找出镜头看不到的漏洞（记录一轮）。"
      : `最该留意的：${s.zh}`,
  };
}
