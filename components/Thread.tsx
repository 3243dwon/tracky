"use client";

import { useEffect, useRef } from "react";

// The orange tracer escapes the ghost stage and threads down the landing,
// weaving between sections marked with [data-th]. Drawn progressively with a
// damped ScrollTrigger scrub. Hidden on small screens and reduced motion.
export default function Thread() {
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (window.innerWidth < 680) return;
    const svg = svgRef.current;
    const path = pathRef.current;
    const landing = svg?.parentElement;
    if (!svg || !path || !landing) return;

    let killTrigger: (() => void) | null = null;
    let destroyed = false;

    const build = () => {
      const lr = landing.getBoundingClientRect();
      const W = landing.clientWidth;
      const H = landing.scrollHeight;
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      svg.style.width = `${W}px`;
      svg.style.height = `${H}px`;

      const anchors = Array.from(landing.querySelectorAll("[data-th]"));
      if (anchors.length < 2) return false;
      const pts: [number, number][] = anchors.map((el, i) => {
        const r = el.getBoundingClientRect();
        const y = r.top - lr.top + r.height / 2;
        const x = i % 2 === 0 ? W * 0.1 : W * 0.9;
        return [x, y];
      });
      const ghost = landing.querySelector(".scrubsec.ghost");
      const gr = ghost?.getBoundingClientRect();
      const startY = gr ? gr.bottom - lr.top - 40 : Math.max(0, pts[0][1] - 400);
      let dStr = `M ${W / 2} ${startY}`;
      let prev: [number, number] = [W / 2, startY];
      for (const p of pts) {
        const dy = (p[1] - prev[1]) * 0.5;
        dStr += ` C ${prev[0]} ${prev[1] + dy}, ${p[0]} ${p[1] - dy}, ${p[0]} ${p[1]}`;
        prev = p;
      }
      path.setAttribute("d", dStr);
      const len = path.getTotalLength();
      path.style.strokeDasharray = `${len}`;
      path.style.strokeDashoffset = `${len}`;
      return true;
    };

    (async () => {
      const [{ gsap }, { ScrollTrigger }] = await Promise.all([import("gsap"), import("gsap/ScrollTrigger")]);
      if (destroyed) return;
      gsap.registerPlugin(ScrollTrigger);

      const arm = () => {
        killTrigger?.();
        if (!build()) return;
        const len = pathRef.current!.getTotalLength();
        const tw = gsap.fromTo(
          pathRef.current,
          { strokeDashoffset: len },
          {
            strokeDashoffset: 0,
            ease: "none",
            scrollTrigger: {
              trigger: landing,
              start: "top top",
              end: "bottom bottom",
              scrub: 0.6,
            },
          }
        );
        killTrigger = () => {
          tw.scrollTrigger?.kill();
          tw.kill();
        };
      };

      arm();
      let t: ReturnType<typeof setTimeout> | null = null;
      const ro = new ResizeObserver(() => {
        if (t) clearTimeout(t);
        t = setTimeout(arm, 250);
      });
      ro.observe(landing);
      const prevKill = killTrigger;
      void prevKill;
      const fullCleanup = () => {
        ro.disconnect();
        if (t) clearTimeout(t);
      };
      (svg as SVGSVGElement & { _cleanup?: () => void })._cleanup = fullCleanup;
    })();

    return () => {
      destroyed = true;
      killTrigger?.();
      (svg as SVGSVGElement & { _cleanup?: () => void })._cleanup?.();
    };
  }, []);

  return (
    <svg ref={svgRef} className="thread" aria-hidden="true">
      <path ref={pathRef} fill="none" />
    </svg>
  );
}
