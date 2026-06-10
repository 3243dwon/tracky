"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Analysis, PhaseName } from "@/lib/analysis";
import { PHASES, L_WRIST, R_WRIST } from "@/lib/analysis";
import type { Extraction, SwingWindow } from "@/lib/pose";
import { drawPose, drawGeometry, drawTrail } from "@/lib/draw";

const LABEL: Record<PhaseName, string> = { address: "Address", top: "Top", impact: "Impact", finish: "Finish" };

function nearestIdx(ts: number[], t: number): number {
  let lo = 0;
  let hi = ts.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (ts[m] <= t) lo = m;
    else hi = m;
  }
  return t - ts[lo] <= ts[hi] - t ? lo : hi;
}

export default function Player({
  src,
  win,
  extraction,
  analysis,
  seekSignal,
}: {
  src: string;
  win: SwingWindow;
  extraction: Extraction;
  analysis: Analysis;
  seekSignal: { t: number; n: number } | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const rangeRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(0.5);
  const [overlay, setOverlay] = useState(true);

  const trail = useMemo(
    () =>
      extraction.frames.map((f) =>
        f ? ([(f[L_WRIST].x + f[R_WRIST].x) / 2, (f[L_WRIST].y + f[R_WRIST].y) / 2] as [number, number]) : null
      ),
    [extraction]
  );

  function clampSeek(t: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.min(Math.max(t, win.start), Math.max(win.start, win.end - 0.01));
  }

  // (Re)load when the selected swing changes.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.src = src;
    v.muted = true;
    v.playsInline = true;
    const onMeta = () => {
      v.playbackRate = rate;
      v.currentTime = analysis.times.address;
    };
    v.addEventListener("loadedmetadata", onMeta);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    setPlaying(false);
    return () => {
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, win.start, win.end]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.playbackRate = rate;
  }, [rate]);

  // Parent-driven seeks (clicking a key-position still).
  useEffect(() => {
    if (!seekSignal) return;
    videoRef.current?.pause();
    clampSeek(seekSignal.t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekSignal?.n]);

  // Draw loop: skeleton + geometry + hand tracer over the video.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const v = videoRef.current;
      const c = canvasRef.current;
      const stage = stageRef.current;
      if (!v || !c || !stage || !v.videoWidth) return;
      if (!v.paused && v.currentTime >= win.end - 0.02) v.currentTime = win.start;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = Math.min(Math.round(stage.clientWidth * dpr), 1280);
      const chh = Math.round((cw * extraction.height) / Math.max(1, extraction.width));
      if (c.width !== cw || c.height !== chh) {
        c.width = cw;
        c.height = chh;
      }
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, c.width, c.height);

      const t = v.currentTime;
      if (rangeRef.current) rangeRef.current.value = String(t);
      if (timeRef.current) timeRef.current.textContent = `${Math.max(0, t - win.start).toFixed(2)}s`;
      if (!overlay) return;

      const i = nearestIdx(extraction.times, t);
      drawTrail(ctx, trail, i, c.width, c.height);
      const fr = extraction.frames[i];
      if (fr) {
        drawPose(ctx, fr, c.width, c.height);
        drawGeometry(ctx, fr, c.width, c.height);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [extraction, trail, win, overlay]);

  function toggle() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime >= win.end - 0.05 || v.currentTime < win.start) v.currentTime = win.start;
      void v.play();
    } else v.pause();
  }

  function step(d: number) {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    clampSeek(v.currentTime + d / extraction.fps);
  }

  const ar = extraction.width / Math.max(1, extraction.height);

  return (
    <div className="player">
      <div
        ref={stageRef}
        className="stage"
        style={{ aspectRatio: `${extraction.width} / ${extraction.height}`, width: `min(100%, calc(62vh * ${ar.toFixed(4)}))` }}
        onClick={toggle}
      >
        <video ref={videoRef} playsInline muted preload="auto" />
        <canvas ref={canvasRef} />
        {!playing && <div className="bigplay">▶</div>}
      </div>

      <div className="controls">
        <button className="ctl play" onClick={toggle} aria-label="play/pause">
          {playing ? "❚❚" : "▶"}
        </button>
        <input
          ref={rangeRef}
          className="scrub"
          type="range"
          min={win.start}
          max={Math.max(win.start + 0.1, win.end)}
          step={0.01}
          defaultValue={win.start}
          onInput={(e) => {
            videoRef.current?.pause();
            clampSeek(parseFloat(e.currentTarget.value));
          }}
        />
        <span ref={timeRef} className="time num">
          0.00s
        </span>
      </div>

      <div className="controls sub">
        <div className="seg">
          {[0.25, 0.5, 1].map((r) => (
            <button key={r} className={rate === r ? "on" : ""} onClick={() => setRate(r)}>
              {r}×
            </button>
          ))}
        </div>
        <div className="seg">
          <button onClick={() => step(-1)}>−1f</button>
          <button onClick={() => step(1)}>+1f</button>
        </div>
        <div className="seg">
          {PHASES.map((p) => (
            <button
              key={p}
              onClick={() => {
                videoRef.current?.pause();
                clampSeek(analysis.times[p]);
              }}
            >
              {LABEL[p]}
            </button>
          ))}
        </div>
        <div className="seg">
          <button className={overlay ? "on" : ""} onClick={() => setOverlay((o) => !o)}>
            Overlay
          </button>
        </div>
      </div>
    </div>
  );
}
