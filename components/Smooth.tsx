"use client";

import { useEffect } from "react";

// Site-wide inertial smooth scrolling (Lenis) wired into GSAP ScrollTrigger,
// plus a subtle tracer-orange cursor ring on the landing (fine pointers only).
// Skips everything under prefers-reduced-motion.
export default function Smooth() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let destroyed = false;
    let lenis: { raf: (t: number) => void; destroy: () => void } | null = null;
    let ring: HTMLDivElement | null = null;
    let onMove: ((e: MouseEvent) => void) | null = null;

    (async () => {
      const [{ default: Lenis }, { gsap }, { ScrollTrigger }] = await Promise.all([
        import("lenis"),
        import("gsap"),
        import("gsap/ScrollTrigger"),
      ]);
      if (destroyed) return;
      gsap.registerPlugin(ScrollTrigger);
      const l = new Lenis({ duration: 1.05 });
      l.on("scroll", ScrollTrigger.update);
      lenis = l;
      const tick = (t: number) => {
        lenis?.raf(t);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    })();

    if (window.matchMedia("(pointer: fine)").matches) {
      ring = document.createElement("div");
      ring.className = "curring";
      document.body.appendChild(ring);
      let tx = -100;
      let ty = -100;
      let x = -100;
      let y = -100;
      let craf = 0;
      onMove = (e: MouseEvent) => {
        tx = e.clientX;
        ty = e.clientY;
        const overLanding = e.target instanceof Element && !!e.target.closest(".landing");
        if (ring) ring.style.opacity = overLanding ? "1" : "0";
      };
      window.addEventListener("mousemove", onMove, { passive: true });
      const lerp = () => {
        x += (tx - x) * 0.18;
        y += (ty - y) * 0.18;
        if (ring) ring.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
        craf = requestAnimationFrame(lerp);
      };
      craf = requestAnimationFrame(lerp);
      const oldRaf = raf;
      void oldRaf;
      const cleanupCursor = () => {
        cancelAnimationFrame(craf);
      };
      (ring as HTMLDivElement & { _cleanup?: () => void })._cleanup = cleanupCursor;
    }

    return () => {
      destroyed = true;
      cancelAnimationFrame(raf);
      lenis?.destroy();
      if (onMove) window.removeEventListener("mousemove", onMove);
      if (ring) {
        (ring as HTMLDivElement & { _cleanup?: () => void })._cleanup?.();
        ring.remove();
      }
    };
  }, []);

  return null;
}
