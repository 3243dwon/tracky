"use client";

import type { Analysis } from "@/lib/analysis";

// Nose-to-ankle (our normalization unit) ≈ 0.89 × standing height.
const M_PER_BH = 0.89;

export function bhToMph(vBh: number, heightCm: number): number {
  return vBh * (heightCm / 100) * M_PER_BH * 2.23694;
}

export default function SpeedChart({
  analysis,
  heightCm,
  onHeightCm,
}: {
  analysis: Analysis;
  heightCm: number;
  onHeightCm: (v: number) => void;
}) {
  const sp = analysis.speed;
  if (!sp) return null;

  const t0 = Math.max(sp.t[0], analysis.times.address - 0.15);
  const t1 = Math.min(sp.t[sp.t.length - 1], analysis.times.finish + 0.2);
  const W = 600;
  const H = 210;
  const padL = 46;
  const padR = 12;
  const padT = 16;
  const padB = 26;

  const pts: [number, number][] = [];
  let vmax = 0;
  for (let i = 0; i < sp.t.length; i++) {
    if (sp.t[i] < t0 || sp.t[i] > t1) continue;
    const mph = bhToMph(sp.v[i], heightCm);
    pts.push([sp.t[i], mph]);
    if (mph > vmax) vmax = mph;
  }
  if (pts.length < 4) return null;
  vmax = Math.max(vmax * 1.15, 1);

  const X = (t: number) => padL + ((t - t0) / (t1 - t0)) * (W - padL - padR);
  const Y = (v: number) => H - padB - (v / vmax) * (H - padT - padB);

  const line = pts.map(([t, v], i) => `${i ? "L" : "M"}${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${X(pts[pts.length - 1][0]).toFixed(1)},${Y(0)} L${X(pts[0][0]).toFixed(1)},${Y(0)} Z`;

  const peakMph = bhToMph(sp.peak, heightCm);
  const impactMph = bhToMph(sp.impact, heightCm);
  const gridVals = [vmax * 0.75, vmax * 0.5, vmax * 0.25].map((v) => Math.round(v));

  const marker = (t: number, label: string) =>
    t >= t0 && t <= t1 ? (
      <g key={label}>
        <line x1={X(t)} y1={padT} x2={X(t)} y2={H - padB} className="vline" />
        <text x={X(t) + 4} y={padT + 9} className="axis">
          {label}
        </text>
      </g>
    ) : null;

  return (
    <div>
      <div className="statrow">
        <div className="stat">
          <div className="k">Peak hand speed</div>
          <div className="v num">
            ~{peakMph.toFixed(0)} <small>mph</small>
          </div>
        </div>
        <div className="stat">
          <div className="k">At impact</div>
          <div className="v num">
            ~{impactMph.toFixed(0)} <small>mph</small>
          </div>
        </div>
        <div className="stat heightin">
          <div className="k">Your height (scales mph)</div>
          <div className="v">
            <input
              className="num"
              type="number"
              min={120}
              max={220}
              value={heightCm}
              onChange={(e) => onHeightCm(Math.min(220, Math.max(120, Number(e.target.value) || 175)))}
            />
            <small> cm</small>
          </div>
        </div>
      </div>

      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="hand speed over the swing">
        <defs>
          <linearGradient id="spfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,176,86,0.35)" />
            <stop offset="100%" stopColor="rgba(255,176,86,0)" />
          </linearGradient>
        </defs>
        {gridVals.map((v) => (
          <g key={v}>
            <line x1={padL} y1={Y(v)} x2={W - padR} y2={Y(v)} className="grid" />
            <text x={padL - 6} y={Y(v) + 3} textAnchor="end" className="axis">
              {v}
            </text>
          </g>
        ))}
        <text x={padL - 6} y={Y(0) + 3} textAnchor="end" className="axis">
          0
        </text>
        {marker(analysis.times.top, "top")}
        {marker(analysis.times.impact, "impact")}
        <path d={area} fill="url(#spfill)" />
        <path d={line} className="trace tracer" />
        <circle cx={X(sp.peakT)} cy={Y(peakMph)} r="4" className="peak" />
        <text x={Math.min(X(sp.peakT) + 6, W - 70)} y={Y(peakMph) - 6} className="axis bright">
          peak
        </text>
      </svg>

      <p className="note">
        Hands ≠ clubhead: the shaft&apos;s lever multiplies hand speed several-fold, and measuring the club needs club
        tracking or a launch monitor. What this number is good for: comparing <b>your own swings</b> to each other —
        speeds scale from your height, so they&apos;re ~estimates, but consistent ones.
      </p>
    </div>
  );
}
