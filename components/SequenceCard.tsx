"use client";

import type { Analysis } from "@/lib/analysis";

const COLOR: Record<string, string> = {
  pelvis: "#62d6ff",
  torso: "#4ce17e",
  hands: "#ffb056",
};
const NAME: Record<string, string> = { pelvis: "Pelvis", torso: "Torso", hands: "Hands" };

export default function SequenceCard({ analysis }: { analysis: Analysis }) {
  const seq = analysis.sequence;
  if (!seq) return null;

  const t0 = Math.max(seq.t[0], analysis.times.top - 0.45);
  const t1 = Math.min(seq.t[seq.t.length - 1], analysis.times.impact + 0.12);
  const W = 600;
  const H = 190;
  const padL = 12;
  const padR = 12;
  const padT = 16;
  const padB = 22;

  const idx: number[] = [];
  for (let i = 0; i < seq.t.length; i++) if (seq.t[i] >= t0 && seq.t[i] <= t1) idx.push(i);
  if (idx.length < 5) return null;

  const X = (t: number) => padL + ((t - t0) / (t1 - t0)) * (W - padL - padR);
  const Y = (r: number) => H - padB - r * (H - padT - padB);

  // Each trace normalized to its own in-window peak — this chart is about timing, not magnitude.
  const tracePath = (vals: number[]) => {
    let m = 0;
    for (const i of idx) if (vals[i] > m) m = vals[i];
    if (m <= 0) return null;
    return idx.map((i, k) => `${k ? "L" : "M"}${X(seq.t[i]).toFixed(1)},${Y(Math.max(0, vals[i]) / m).toFixed(1)}`).join(" ");
  };

  const paths = [
    { key: "pelvis", d: tracePath(seq.pelvis) },
    { key: "torso", d: tracePath(seq.torso) },
    { key: "hands", d: tracePath(seq.hands) },
  ];
  if (paths.some((p) => !p.d)) return null;

  const xf = analysis.xfactor;

  return (
    <div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="kinematic sequence">
        <line x1={X(analysis.times.impact)} y1={padT} x2={X(analysis.times.impact)} y2={H - padB} className="vline" />
        <text x={X(analysis.times.impact) + 4} y={padT + 9} className="axis">
          impact
        </text>
        {paths.map((p) => (
          <path key={p.key} d={p.d!} className="trace" style={{ stroke: COLOR[p.key] }} />
        ))}
        {seq.peaks.map((p) => (
          <circle key={p.name} cx={X(p.t)} cy={Y(1)} r="4" fill={COLOR[p.name]} />
        ))}
      </svg>

      <div className="order">
        {seq.peaks.map((p, i) => (
          <span key={p.name} className="orderitem">
            {i > 0 && <span className="arrow">→</span>}
            <span className="pill" style={{ borderColor: COLOR[p.name], color: COLOR[p.name] }}>
              {NAME[p.name]} <span className="num">−{Math.max(0, p.msBeforeImpact)}ms</span>
            </span>
          </span>
        ))}
      </div>

      <p className="note">
        {seq.textbook
          ? "Proximal-to-distal (pelvis → torso → hands) — the classic speed-summation chain."
          : "Not the textbook pelvis → torso → hands order — neither are ~75% of PGA swings. What matters is whether YOUR pattern repeats."}{" "}
        Peak rotation speeds, time before impact.
      </p>

      {xf && (
        <div className="xfactor">
          <div className="stat">
            <div className="k">X-factor at top</div>
            <div className="v num">
              {xf.topDeg.toFixed(0)}°
            </div>
          </div>
          <div className="stat">
            <div className="k">Peak in downswing</div>
            <div className="v num">
              {xf.peakDeg.toFixed(0)}°
            </div>
          </div>
          <div className="stat">
            <div className="k">Stretch</div>
            <div className="v num">
              {xf.stretchPct >= 0 ? "+" : ""}
              {xf.stretchPct.toFixed(0)}%
            </div>
          </div>
        </div>
      )}
      <p className="note">
        Research: the static top number does <b>not</b> separate skill levels — the downswing <b>stretch</b> does
        (elite ≈ +19% vs +13%). All rotation here comes from single-camera depth estimates: trust the order and trend,
        not the exact degrees.
      </p>
    </div>
  );
}
