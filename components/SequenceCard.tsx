"use client";

import type { Analysis } from "@/lib/analysis";
import { useInView } from "./useInView";

const COLOR: Record<string, string> = {
  pelvis: "#62d6ff",
  torso: "#4ce17e",
  hands: "#ffb056",
};
const NAME: Record<string, string> = { pelvis: "Pelvis 骨盆", torso: "Torso 躯干", hands: "Hands 手" };

export default function SequenceCard({ analysis }: { analysis: Analysis }) {
  const { ref, inView } = useInView<HTMLDivElement>(0.25);
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
    <div ref={ref}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="kinematic sequence">
        <line x1={X(analysis.times.impact)} y1={padT} x2={X(analysis.times.impact)} y2={H - padB} className="vline" />
        <text x={X(analysis.times.impact) + 4} y={padT + 9} className="axis">
          impact
        </text>
        {paths.map((p, i) => (
          <path
            key={p.key}
            d={p.d!}
            className="trace"
            pathLength={100}
            style={{
              stroke: COLOR[p.key],
              strokeDasharray: 100,
              strokeDashoffset: inView ? 0 : 100,
              transition: `stroke-dashoffset 1.2s ease ${0.15 + i * 0.25}s`,
            }}
          />
        ))}
        {seq.peaks.map((p) => (
          <circle
            key={p.name}
            cx={X(p.t)}
            cy={Y(1)}
            r="4"
            fill={COLOR[p.name]}
            style={{ opacity: inView ? 1 : 0, transition: "opacity 0.5s ease 1.5s" }}
          />
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
          ? "Proximal-to-distal (pelvis → torso → hands) — the classic speed-summation chain. 由近到远（骨盆 → 躯干 → 手）——经典的速度叠加动力链。"
          : "Not the textbook pelvis → torso → hands order — neither are ~75% of PGA swings. What matters is whether YOUR pattern repeats. 不是教科书式的骨盆 → 躯干 → 手顺序——约 75% 的 PGA 球员也不是。关键在于你自己的发力模式是否稳定重复。"}{" "}
        Peak rotation speeds, time before impact. 峰值旋转速度，及触球前的时间。
      </p>

      {xf && (
        <div className="xfactor">
          <div className="stat">
            <div className="k">X-factor at top 顶点 X-factor</div>
            <div className="v num">
              {xf.topDeg.toFixed(0)}°
            </div>
          </div>
          <div className="stat">
            <div className="k">Peak in downswing 下杆峰值</div>
            <div className="v num">
              {xf.peakDeg.toFixed(0)}°
            </div>
          </div>
          <div className="stat">
            <div className="k">Stretch 拉伸</div>
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
        <br />
        研究表明：顶点的静态数字<b>区分不了</b>水平高低——真正区分的是下杆时的<b>拉伸</b>（高手约 +19%，普通约
        +13%）。这里所有旋转数据都来自单摄像头深度估算：相信顺序和趋势，别太较真具体度数。
      </p>
    </div>
  );
}
