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
        <span><i className="sw cyan" /> backswing</span>
        <span><i className="sw mag" /> downswing</span>
        <span className="num">trace {club.quality.toFixed(2)}/1.0 · {club.coveragePct.toFixed(0)}% tracked</span>
      </div>

      {weak ? (
        <p className="note">
          Weak trace on this clip — motion tracking needs a steady phone, plain background and the whole club in
          frame. The arc read below is unreliable here; the body metrics above still hold.
        </p>
      ) : (
        <p className="note">
          Relative read only — one camera can&apos;t give mph or clubface angle.{" "}
          {loopKnown && (
            <>
              Transition loop:{" "}
              <b>
                {overTop
                  ? `downswing ~${club.loopPct.toFixed(0)}% of body height wider/outside the backswing (over-the-top tendency)`
                  : `downswing tracks inside the backswing (in-to-out tendency)`}
              </b>
              .{" "}
            </>
          )}
          {!Number.isNaN(club.peakSpeedPct) && <>Peak speed {club.peakSpeedPct.toFixed(0)}% body-height/frame near impact.</>}
        </p>
      )}
    </div>
  );
}
