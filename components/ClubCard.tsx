"use client";

import { useEffect, useRef } from "react";
import type { ClubAnalysis } from "@/lib/club";
import type { Phases } from "@/lib/analysis";
import { drawClubArc } from "@/lib/draw";

// Renders the traced clubhead arc over the impact still and explains the read.
// Honest by construction: if the trace is weak/jittery we say the read is
// unreliable rather than calling a fault.
export default function ClubCard({
  club,
  phases,
  impactUrl,
  width,
  height,
}: {
  club: ClubAnalysis;
  phases: Phases;
  impactUrl: string;
  width: number;
  height: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
      drawClubArc(ctx, club.path, phases.address, phases.top, phases.impact, width, height);
    };
    img.src = impactUrl;
  }, [club, phases, impactUrl, width, height]);

  const weak = club.coveragePct < 45 || club.quality < 0.4;
  const loopKnown = !Number.isNaN(club.loopPct);
  const overTop = loopKnown && club.loopPct > 0;

  return (
    <div className="clubcard">
      <canvas ref={canvasRef} className="clubcanvas" />
      <div className="clublegend">
        <span><i className="sw cyan" /> backswing 上杆</span>
        <span><i className="sw mag" /> downswing 下杆</span>
        <span className="num">trace {club.quality.toFixed(2)}/1.0 · {club.coveragePct.toFixed(0)}% tracked</span>
      </div>

      {weak ? (
        <p className="note">
          Weak trace on this clip — motion tracking needs a steady phone, plain background and the whole club in
          frame. The arc read below is unreliable here; the body metrics above still hold.
          <br />
          这段视频的轨迹偏弱——运动追踪需要稳定的手机、干净的背景，以及整支球杆都在画面里。下面这条弧线在这里不可靠；
          上面的身体数据依然有效。
        </p>
      ) : (
        <p className="note">
          Relative read only — one camera can&apos;t give mph or clubface angle. 仅为相对读数——单摄像头给不了 mph
          或杆面角度。{" "}
          {loopKnown && (
            <>
              Transition loop 转换轨迹:{" "}
              <b>
                {overTop
                  ? `downswing ~${club.loopPct.toFixed(0)}% of body height wider/outside the backswing (over-the-top tendency) · 下杆比上杆更宽/更外侧，约占身高 ${club.loopPct.toFixed(0)}%（有过顶倾向）`
                  : `downswing tracks inside the backswing (in-to-out tendency) · 下杆走在上杆内侧（有由内向外的倾向）`}
              </b>
              .{" "}
            </>
          )}
          {!Number.isNaN(club.peakSpeedPct) && <>Peak speed {club.peakSpeedPct.toFixed(0)}% body-height/frame near impact. 触球附近峰值速度 {club.peakSpeedPct.toFixed(0)}% 身高/帧。</>}
        </p>
      )}
    </div>
  );
}
