"use client";

import { useEffect, useRef, useState } from "react";

// Landing showpiece v2: a right-handed ghost golfer made of ~1600 particles
// that spring toward a scroll-scrubbed skeleton pose (smoothed via GSAP
// ScrollTrigger scrub + an internal lerp), with the orange hand tracer.
// Faint bone lines sit under the particles for readability.

type P = [number, number];
type Pose = { shL: P; shR: P; hands: P; tip: P; hipL: P; hipR: P; head: P };

// Face-on, right-handed: backswing toward the viewer's left, finish to the right.
const KEY: Pose[] = [
  { shL: [116, 90], shR: [84, 90], hands: [97, 158], tip: [76, 200], hipL: [112, 144], hipR: [88, 144], head: [100, 64] },
  { shL: [114, 90], shR: [86, 92], hands: [74, 148], tip: [40, 182], hipL: [112, 144], hipR: [88, 144], head: [100, 64] },
  { shL: [110, 88], shR: [90, 95], hands: [54, 110], tip: [24, 68], hipL: [110, 144], hipR: [89, 145], head: [99, 64] },
  { shL: [106, 86], shR: [94, 97], hands: [60, 70], tip: [92, 40], hipL: [108, 143], hipR: [90, 146], head: [98, 64] },
  { shL: [108, 87], shR: [92, 96], hands: [58, 92], tip: [28, 58], hipL: [112, 143], hipR: [92, 145], head: [99, 64] },
  { shL: [118, 88], shR: [85, 93], hands: [103, 162], tip: [90, 203], hipL: [118, 142], hipR: [94, 143], head: [101, 63] },
  { shL: [120, 90], shR: [84, 92], hands: [142, 128], tip: [174, 140], hipL: [120, 141], hipR: [96, 142], head: [103, 63] },
  { shL: [112, 84], shR: [92, 88], hands: [136, 66], tip: [106, 32], hipL: [122, 140], hipR: [100, 140], head: [105, 60] },
];

function mix(a: P, b: P, t: number): P {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function pose(p: number): Pose {
  const f = Math.max(0, Math.min(0.9999, p)) * (KEY.length - 1);
  const i = Math.floor(f);
  let t = f - i;
  t = t * t * (3 - 2 * t);
  const a = KEY[i];
  const b = KEY[i + 1];
  return {
    shL: mix(a.shL, b.shL, t),
    shR: mix(a.shR, b.shR, t),
    hands: mix(a.hands, b.hands, t),
    tip: mix(a.tip, b.tip, t),
    hipL: mix(a.hipL, b.hipL, t),
    hipR: mix(a.hipR, b.hipR, t),
    head: mix(a.head, b.head, t),
  };
}

function label(p: number): string {
  if (p < 0.07) return "ADDRESS";
  if (p < 0.4) return "BACKSWING";
  if (p < 0.49) return "TOP";
  if (p < 0.6) return "DOWNSWING";
  if (p < 0.67) return "IMPACT";
  if (p < 0.85) return "FOLLOW-THROUGH";
  return "FINISH";
}

type Derived = { neck: P; hipM: P; kL: P; kR: P; aL: P; aR: P };
function derive(o: Pose): Derived {
  return {
    neck: [(o.shL[0] + o.shR[0]) / 2, (o.shL[1] + o.shR[1]) / 2],
    hipM: [(o.hipL[0] + o.hipR[0]) / 2, (o.hipL[1] + o.hipR[1]) / 2],
    kL: [o.hipL[0] + 2, 174],
    kR: [o.hipR[0] - 4, 174],
    aL: [120, 206],
    aR: [78, 206],
  };
}

const GREEN = "0,255,90";
const CYAN = "0,229,255";
const MAGENTA = "255,0,200";
const CLUB = "223,238,225";
const ORANGE = "255,176,86";

type Bone = { a: (o: Pose, d: Derived) => P; b: (o: Pose, d: Derived) => P; color: string; n: number };
const BONES: Bone[] = [
  { a: (o, d) => o.hipL, b: (o, d) => d.kL, color: GREEN, n: 90 },
  { a: (o, d) => d.kL, b: (o, d) => d.aL, color: GREEN, n: 90 },
  { a: (o, d) => o.hipR, b: (o, d) => d.kR, color: GREEN, n: 90 },
  { a: (o, d) => d.kR, b: (o, d) => d.aR, color: GREEN, n: 90 },
  { a: (o, d) => d.neck, b: (o, d) => d.hipM, color: CYAN, n: 150 },
  { a: (o) => o.shL, b: (o) => o.shR, color: MAGENTA, n: 80 },
  { a: (o) => o.hipL, b: (o) => o.hipR, color: MAGENTA, n: 70 },
  { a: (o) => o.shL, b: (o) => o.hands, color: GREEN, n: 130 },
  { a: (o) => o.shR, b: (o) => o.hands, color: GREEN, n: 130 },
  { a: (o) => o.hands, b: (o) => o.tip, color: CLUB, n: 130 },
];
const HEAD_N = 110;
const HANDS_N = 60;

export default function GhostHero() {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chipRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const [off, setOff] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setOff(true);
  }, []);

  useEffect(() => {
    if (off) return;
    let raf = 0;
    let killTrigger: (() => void) | null = null;
    let destroyed = false;

    const small = window.innerWidth < 640;
    const scaleN = small ? 0.62 : 1;
    type Part = { bone: number; t: number; ox: number; oy: number; x: number; y: number; vx: number; vy: number };
    const parts: Part[] = [];
    const rnd = (s: number) => (Math.random() - 0.5) * s;
    BONES.forEach((b, bi) => {
      const n = Math.round(b.n * scaleN);
      for (let i = 0; i < n; i++)
        parts.push({ bone: bi, t: Math.random(), ox: rnd(3.2), oy: rnd(3.2), x: 100, y: 120, vx: 0, vy: 0 });
    });
    for (let i = 0; i < HEAD_N * scaleN; i++)
      parts.push({ bone: -1, t: Math.random() * Math.PI * 2, ox: rnd(1.6), oy: rnd(1.6), x: 100, y: 64, vx: 0, vy: 0 });
    for (let i = 0; i < HANDS_N * scaleN; i++)
      parts.push({ bone: -2, t: 0, ox: rnd(4.5), oy: rnd(4.5), x: 100, y: 150, vx: 0, vy: 0 });

    let target = 0;
    let prog = 0;
    let lastLabel = "";

    (async () => {
      const [{ gsap }, { ScrollTrigger }] = await Promise.all([import("gsap"), import("gsap/ScrollTrigger")]);
      if (destroyed) return;
      gsap.registerPlugin(ScrollTrigger);
      const st = ScrollTrigger.create({
        trigger: sectionRef.current,
        start: "top top",
        end: "bottom bottom",
        scrub: 0.5,
        onUpdate: (self) => {
          target = self.progress;
        },
      });
      killTrigger = () => st.kill();
    })();

    // Fallback while GSAP hasn't loaded yet (or if it fails): plain rect math.
    const fallbackProgress = () => {
      const sec = sectionRef.current;
      if (!sec) return 0;
      const rect = sec.getBoundingClientRect();
      const span = rect.height - window.innerHeight;
      return span > 0 ? Math.max(0, Math.min(1, -rect.top / span)) : 0;
    };

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const c = canvasRef.current;
      const stage = stageRef.current;
      const sec = sectionRef.current;
      if (!c || !stage || !sec || document.hidden) return;
      const rect = sec.getBoundingClientRect();
      if (rect.bottom < -200 || rect.top > window.innerHeight + 200) return;

      if (!killTrigger) target = fallbackProgress();
      prog += (target - prog) * 0.14;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = Math.min(Math.round(stage.clientWidth * dpr), 980);
      const chh = Math.round((cw * 230) / 200);
      if (c.width !== cw || c.height !== chh) {
        c.width = cw;
        c.height = chh;
      }
      const ctx = c.getContext("2d");
      if (!ctx) return;
      const s = cw / 200;
      ctx.clearRect(0, 0, cw, chh);

      ctx.strokeStyle = "rgba(76,225,126,0.06)";
      ctx.lineWidth = 1.5;
      for (const r of [44, 86, 128]) {
        ctx.beginPath();
        ctx.arc(100 * s, 140 * s, r * s, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(148,190,158,0.16)";
      ctx.beginPath();
      ctx.moveTo(12 * s, 206 * s);
      ctx.lineTo(188 * s, 206 * s);
      ctx.stroke();

      const o = pose(prog);
      const d = derive(o);

      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // tracer trail
      const n = Math.max(2, Math.round(64 * prog));
      ctx.shadowColor = "rgba(255,176,86,0.7)";
      for (let j = 1; j <= n; j++) {
        const q0 = pose((j - 1) / 64).hands;
        const q1 = pose(j / 64).hands;
        const r = j / n;
        ctx.strokeStyle = `rgba(255,176,86,${(0.05 + 0.6 * Math.pow(r, 1.6)).toFixed(3)})`;
        ctx.lineWidth = (1 + 2.4 * r) * s * 0.5;
        ctx.shadowBlur = n - j < 5 ? 10 : 0;
        ctx.beginPath();
        ctx.moveTo(q0[0] * s, q0[1] * s);
        ctx.lineTo(q1[0] * s, q1[1] * s);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;

      // faint structural bones under the particles
      ctx.globalAlpha = 0.16;
      for (const b of BONES) {
        const pa = b.a(o, d);
        const pb = b.b(o, d);
        ctx.strokeStyle = `rgb(${b.color})`;
        ctx.lineWidth = 2.4 * s * 0.5;
        ctx.beginPath();
        ctx.moveTo(pa[0] * s, pa[1] * s);
        ctx.lineTo(pb[0] * s, pb[1] * s);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // particle pass — phase change gives the swarm a kick
      const lab = label(prog);
      const kick = lab !== lastLabel && lastLabel !== "";
      lastLabel = lab;
      const sz = Math.max(1.4, 1.1 * s * 0.5);
      for (const pt of parts) {
        let hx: number;
        let hy: number;
        if (pt.bone === -1) {
          hx = o.head[0] + Math.cos(pt.t) * 8.5 + pt.ox;
          hy = o.head[1] + Math.sin(pt.t) * 8.5 + pt.oy;
        } else if (pt.bone === -2) {
          hx = o.hands[0] + pt.ox;
          hy = o.hands[1] + pt.oy;
        } else {
          const b = BONES[pt.bone];
          const pa = b.a(o, d);
          const pb = b.b(o, d);
          hx = pa[0] + (pb[0] - pa[0]) * pt.t + pt.ox;
          hy = pa[1] + (pb[1] - pa[1]) * pt.t + pt.oy;
        }
        if (kick) {
          pt.vx += rnd(7);
          pt.vy += rnd(7);
        }
        pt.vx = (pt.vx + (hx - pt.x) * 0.16) * 0.8;
        pt.vy = (pt.vy + (hy - pt.y) * 0.16) * 0.8;
        pt.x += pt.vx;
        pt.y += pt.vy;
        const col = pt.bone === -2 ? ORANGE : pt.bone === -1 ? GREEN : BONES[pt.bone].color;
        ctx.fillStyle = `rgba(${col},0.85)`;
        ctx.fillRect(pt.x * s - sz / 2, pt.y * s - sz / 2, sz, sz);
      }

      if (chipRef.current && chipRef.current.textContent !== lab) chipRef.current.textContent = lab;
      if (barRef.current) barRef.current.style.width = `${Math.round(prog * 100)}%`;
      if (hintRef.current) hintRef.current.style.opacity = prog > 0.03 ? "0" : "1";
    };
    raf = requestAnimationFrame(loop);

    return () => {
      destroyed = true;
      cancelAnimationFrame(raf);
      killTrigger?.();
    };
  }, [off]);

  if (off) return null;

  return (
    <section ref={sectionRef} className="scrubsec ghost">
      <div className="pin">
        <p className="ghostlead">Scroll — this is what it does to your swing.</p>
        <div ref={stageRef} className="scrubstage" style={{ aspectRatio: "200 / 230", width: "min(100%, calc(66vh * 0.87))" }}>
          <canvas ref={canvasRef} />
          <div className="scrubbar">
            <div ref={barRef} />
          </div>
          <div className="scrubcap">
            <span ref={chipRef} className="chiplabel">
              ADDRESS
            </span>
          </div>
          <div ref={hintRef} className="scrubhint">
            <span>scroll</span>
            <svg viewBox="0 0 16 22" aria-hidden="true">
              <path d="M8 2 v14 M3 11 l5 6 5-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}
