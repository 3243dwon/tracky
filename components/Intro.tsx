"use client";

import { useEffect, useState } from "react";

// One-second load moment: the wordmark rises letter by letter, then the
// curtain lifts. Shown once per session; skipped under reduced motion.
export default function Intro() {
  const [show, setShow] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    try {
      if (sessionStorage.getItem("introSeen")) return;
      sessionStorage.setItem("introSeen", "1");
    } catch {
      return;
    }
    setShow(true);
    const t1 = setTimeout(() => setDone(true), 1200);
    const t2 = setTimeout(() => setShow(false), 1950);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  if (!show) return null;

  return (
    <div className={done ? "intro done" : "intro"} aria-hidden="true">
      <div className="introword">
        {Array.from("SWING·CV").map((c, i) => (
          <span key={i} className={c === "·" ? "ich dot" : "ich"} style={{ animationDelay: `${120 + i * 65}ms` }}>
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}
