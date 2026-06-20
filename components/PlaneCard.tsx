"use client";

import { useEffect, useMemo, useRef } from "react";
import type { ClubAnalysis } from "@/lib/club";
import type { Frame, Phases } from "@/lib/analysis";
import { analyzePlane, type PlaneVerdict } from "@/lib/plane";
import { drawPlaneLines } from "@/lib/draw";

// Draws the ideal plane line (dashed green) + your actual shaft at the top
// (purple, extended through the butt) over the top-of-backswing still, and reads
// where 杆尾 points vs the ball. Down-the-line only (the caller gates on view).

const VERDICT: Record<PlaneVerdict, { en: string; zh: string; cls: string } | null> = {
  on: { en: "on plane", zh: "在平面上", cls: "good" },
  out: { en: "outside the plane · steep tendency", zh: "偏外（偏陡倾向）", cls: "ok" },
  in: { en: "inside the plane · laid-off tendency", zh: "偏内（偏平倾向）", cls: "ok" },
  na: null,
};

export default function PlaneCard({
  frames,
  club,
  phases,
  backdropUrl,
  width,
  height,
}: {
  frames: Frame[];
  club: ClubAnalysis;
  phases: Phases;
  backdropUrl: string;
  width: number;
  height: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const plane = useMemo(() => analyzePlane(frames, club.path, phases), [frames, club, phases]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = width;
    canvas.height = height;
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, width, height);
      if (plane && plane.ok) drawPlaneLines(ctx, plane.idealLine, plane.topShaft, plane.ball, width, height);
    };
    img.src = backdropUrl;
  }, [plane, backdropUrl, width, height]);

  const v = plane && plane.ok ? VERDICT[plane.verdict] : null;
  const gap = plane && plane.ok && Number.isFinite(plane.gapPct) ? plane.gapPct : null;

  return (
    <div className="clubcard">
      <canvas ref={canvasRef} className="clubcanvas" />
      <div className="clublegend">
        <span><i className="sw green" /> ideal plane 理想平面</span>
        <span><i className="sw purple" /> your shaft (杆尾) 你的杆身</span>
      </div>

      {!plane || !plane.ok ? (
        <p className="note">
          Couldn&apos;t draw a reliable plane on this clip — it needs a down-the-line angle with the clubhead trackable at
          address and at the top (steady phone, plain background, whole club in frame).
          <br />
          这段视频画不出可靠的平面——需要后方视角（DTL），且瞄球和顶点都能追踪到杆头（稳定手机、干净背景、整支杆在画面里）。
        </p>
      ) : (
        <p className="note">
          The dashed green line is the <b>ideal plane</b>; the purple line is <b>your shaft at the top, extended through
          the 杆尾 (butt)</b>. On plane, the butt points back at the white ball dot — yours reads{" "}
          {v && <b className={`grade ${v.cls}`} style={{ background: "none", padding: 0 }}>{v.en} · {v.zh}</b>}
          {gap != null && (
            <>
              {" "}
              (clubhead ~{Math.abs(gap).toFixed(0)}% of body height {gap > 0 ? "outside" : "inside"} the plane)
            </>
          )}
          . Relative + experimental — one camera reads the shaft line, not the clubface. 虚线绿是<b>理想平面</b>，紫线是
          <b>你顶点时的杆身、延着杆尾延伸</b>；在平面上时杆尾应指回白点（球）。仅为相对读数、实验性：单摄像头只能读杆身线，读不到杆面。
        </p>
      )}
    </div>
  );
}
