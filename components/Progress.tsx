"use client";

import { summarize, type MetricTrend, type TrendDir } from "@/lib/trends";
import type { SavedMeta } from "@/lib/library";

// The library's retention loop: a single honest headline about whether the
// player is getting more repeatable, plus a sparkline + personal best + spread
// per metric. Reads only from SavedMeta (no payload fetch), so it's instant.

const DIR: Record<TrendDir, { en: string; zh: string; color: string } | null> = {
  improving: { en: "improving", zh: "进步中", color: "var(--accent)" },
  declining: { en: "drifting", zh: "退步", color: "var(--warn)" },
  steady: { en: "steady", zh: "稳定", color: "var(--data)" },
  "n/a": null,
};

function fmt(v: number, unit: string): string {
  return unit === ":1" ? `${v.toFixed(1)}:1` : `${Math.round(v)} ${unit}`;
}

// Tiny inline sparkline — last value dotted, with a faint ideal line for tempo.
function Spark({ t }: { t: MetricTrend }) {
  const W = 104,
    H = 30,
    pad = 3;
  const vals = t.points.map((p) => p.value);
  if (vals.length < 2) return null;
  const ideal = t.unit === ":1" ? 3 : null;
  const all = ideal != null ? [...vals, ideal] : vals;
  const lo = Math.min(...all),
    hi = Math.max(...all);
  const span = hi - lo || 1;
  const x = (i: number) => pad + (i / (vals.length - 1)) * (W - 2 * pad);
  const y = (v: number) => H - pad - ((v - lo) / span) * (H - 2 * pad);
  const dir = DIR[t.dir];
  const stroke = dir?.color ?? "var(--muted)";
  const d = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
      {ideal != null && (
        <line x1={pad} x2={W - pad} y1={y(ideal)} y2={y(ideal)} stroke="var(--line)" strokeDasharray="2 3" />
      )}
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(vals.length - 1)} cy={y(vals[vals.length - 1])} r="2.4" fill={stroke} />
    </svg>
  );
}

function Stat({ t }: { t: MetricTrend }) {
  if (t.points.length < 2 || t.latest == null) return null;
  const dir = DIR[t.dir];
  return (
    <div className="trendstat">
      <div className="trendhead">
        <span className="trendlabel">
          {t.labelEn} <span className="zh">{t.labelZh}</span>
        </span>
        {dir && (
          <span className="trendbadge" style={{ color: dir.color, borderColor: dir.color }}>
            {dir.en} · {dir.zh}
          </span>
        )}
      </div>
      <div className="trendnow num">{fmt(t.latest, t.unit)}</div>
      <Spark t={t} />
      <div className="trendfoot num">
        {t.best != null && <span>best {fmt(t.best, t.unit)}</span>}
        <span>± {t.unit === ":1" ? t.sd.toFixed(1) : Math.round(t.sd)} spread</span>
      </div>
    </div>
  );
}

export default function Progress({ metas }: { metas: SavedMeta[] }) {
  const s = summarize(metas);
  if (s.nSwings === 0) return null;

  return (
    <div className="card trends">
      <div className="section-title" style={{ marginTop: 0 }}>
        Your progress 你的进步
      </div>
      {s.headline && (
        <p className="trendline">
          {s.headline.en}
          <br />
          <span className="zh">{s.headline.zh}</span>
        </p>
      )}
      {s.trends.some((t) => t.points.length >= 2) && (
        <>
          <div className="trendrow">
            {s.trends.map((t) => (
              <Stat key={t.key} t={t} />
            ))}
          </div>
          <p className="note" style={{ marginBottom: 0 }}>
            Tighter spread = more repeatable — that&apos;s the skill the research ties to lower scores, more than any single
            number. 波动越小＝越可重复，这正是研究中与降低杆数最相关的能力，胜过任何单一数字。
          </p>
        </>
      )}
    </div>
  );
}
