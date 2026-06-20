"use client";

import { useEffect, useMemo, useRef } from "react";
import type { ClubAnalysis } from "@/lib/club";
import type { Frame, Phases } from "@/lib/analysis";
import { analyzePlane, type PlaneVerdict } from "@/lib/plane";
import { drawClubArc, drawPlaneLine } from "@/lib/draw";

// Draws the ideal address-plane "stick" (white dashed) over the still, with your
// actual traced clubhead path on top, and reads how far the downswing ran off it.
// Down-the-line only (the caller gates on view); honest + experimental like the
// rest of the club tracking.

const VERDICT: Record<PlaneVerdict, { en: string; zh: string; cls: string } | null> = {
  on: { en: "on plane", zh: "在平面上", cls: "good" },
  above: { en: "above · over-the-top", zh: "偏上（过顶）", cls: "ok" },
  below: { en: "under · inside", zh: "偏下（内侧）", cls: "ok" },
  na: null,
};

export default function PlaneCard({
  frames,
  club,
  phases,
  impactUrl,
  width,
  height,
}: {
  frames: Frame[];
  club: ClubAnalysis;
  phases: Phases;
  impactUrl: string;
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
      if (plane && plane.ok) drawPlaneLine(ctx, plane.line, plane.grip, plane.head, width, height);
      drawClubArc(ctx, club.path, phases.address, phases.top, phases.impact, width, height);
    };
    img.src = impactUrl;
  }, [club, phases, impactUrl, width, height, plane]);

  const v = plane && plane.ok ? VERDICT[plane.verdict] : null;
  const dev = plane && plane.ok && Number.isFinite(plane.devPct) ? plane.devPct : null;

  return (
    <div className="clubcard">
      <canvas ref={canvasRef} className="clubcanvas" />
      <div className="clublegend">
        <span><i className="sw white" /> ideal plane 理想平面</span>
        <span><i className="sw cyan" /> backswing 上杆</span>
        <span><i className="sw mag" /> downswing 下杆</span>
      </div>

      {!plane || !plane.ok ? (
        <p className="note">
          Couldn&apos;t draw a reliable plane on this clip — it needs a down-the-line angle with the clubhead trackable at
          address (steady phone, plain background, whole club in frame). The body metrics above still hold.
          <br />
          这段视频画不出可靠的平面——需要后方视角（DTL），且瞄球时能追踪到杆头（稳定的手机、干净背景、整支杆在画面里）。
          上面的身体数据依然有效。
        </p>
      ) : (
        <p className="note">
          The white dashed stick is your <b>address shaft plane</b> — where the club should return. Your downswing reads{" "}
          {v && <b className={`grade ${v.cls}`} style={{ background: "none", padding: 0 }}>{v.en} · {v.zh}</b>}
          {dev != null && (
            <>
              {" "}
              (~{Math.abs(dev).toFixed(0)}% of body height {dev > 0 ? "outside" : "inside"} the plane)
            </>
          )}
          . Relative + experimental — one camera reads the path, not the clubface. 白色虚线是你的<b>瞄球杆身平面</b>
          ——球杆理想的回归线。仅为相对读数、实验性：单摄像头只能读路径，读不到杆面。
        </p>
      )}
    </div>
  );
}
