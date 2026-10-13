# Tracky

On-device golf swing analyzer. Pick or film swings in the browser → MediaPipe
pose runs **entirely client-side** (your video never leaves the device) →
slow-mo player with skeleton + hand-tracer overlay, auto-detected key positions,
tempo, hand speed, kinematic sequence, clubhead path and swing-to-swing
consistency.

**Live:** https://tracky816.vercel.app

Formerly `swing-cv-web` (the package name hasn't changed); the web sibling of
the Python `swing-cv` tool. Honest by design: it measures what 2D pose is
actually validated for, flags only mishit-causing faults, and — per
strokes-gained research — tells you when your swing isn't your real scoring leak.

## Features
- **Slow-mo player** — skeleton + hand-path tracer drawn live over your video;
  0.25×/0.5×/1×, frame stepping, jump to address/top/impact/finish
- **Hand speed** — speed curve with peak & impact markers, scaled to mph from
  your height (clearly labeled an estimate; hands ≠ clubhead)
- **Pace** — tempo-based "too quick / on pace / too slow" read, plus where your
  peak hand speed sits against a typical range for your height
- **Kinematic sequence (experimental)** — pelvis/torso/hands firing order +
  timing before impact, X-factor top vs downswing stretch, from single-camera
  depth estimates with honesty caveats
- **Clubhead path** — traces the clubhead from frame-to-frame motion and reads
  whether the downswing comes down wider than the backswing (the over-the-top,
  slice/pull-producing path). Gated on trace quality, so a noisy track stays
  quiet instead of inventing a fault
- **Swing plane guide** — ideal plane vs where the butt of the club points at
  the top; experimental, shown for down-the-line clips only
- **Ball outcome (optional)** — tell it what the ball did and it relates that to
  what was measured. It never promotes a fault that didn't fire on its own
  thresholds, hedges when your report contradicts the measurement, and relates
  nothing on a low-confidence trace
- **Posture faults** — early extension and similar spine signals, flagged only
  where the camera view and angle are clear enough to trust
- **Long videos** — a motion-energy scan finds each swing in a range session
  (up to 3 min), then each swing is analyzed separately; multiple files work too
- **Consistency panel** — mean ± SD across swings, most-variable metric
  highlighted; repeatability of your own motion is the skill marker the
  research actually supports (r = 0.801, same 2D method)
- **Swing Library + progress** — saves analyses on-device (IndexedDB), compares
  swings side by side, and reads a trend over time (it needs at least 4 swings
  before it will call anything a trend)
- **Bilingual** — feedback in English and 中文
- **AI coaching (optional, off by default)** — turns the numbers on the page
  into one coaching read written by Claude. See Privacy below

## Privacy
Your video, images and pose landmarks never leave the device, and the Swing
Library stores only derived numbers and stills locally. The one exception is
opt-in: if you turn on AI coaching and tap "Get AI coaching", the
measured-numbers payload (never video, image or landmarks) is sent to this
app's `/api/coach` route, which forwards it to Claude. Without that, nothing
is uploaded.

## Stack
- **Next.js 15** (App Router, TypeScript) + React 19 — deploys to Vercel; the
  only server code is `app/api/coach/route.ts`
- **@mediapipe/tasks-vision** Pose Landmarker (WASM + model from CDN; GPU delegate
  with a timeout fallback to CPU, because GPU init can hang on some iOS GPUs)
- **@anthropic-ai/sdk** — AI coaching only; GSAP + Lenis for the landing scroll
- Analysis: `lib/analysis.ts` · club path: `lib/club.ts` · plane: `lib/plane.ts` ·
  pose/scan: `lib/pose.ts` · library: `lib/library.ts` · trends: `lib/trends.ts` ·
  drawing: `lib/draw.ts`
- Tests: Vitest (`test/` and `lib/*.test.ts`)

## Dev
```bash
npm install
npm run dev        # http://localhost:3000  (#demo for a synthetic preview)
npm test           # vitest
npm run typecheck
npm run lint
```
AI coaching needs `ANTHROPIC_API_KEY` in the environment; without it the route
answers 503 and the rest of the app is unaffected.

## Deploy
```bash
vercel deploy --prod --scope <team>
```

## Limits (stated in-product too)
2D single camera: reliable for tempo / head / key positions / your own
repeatability; rotation & speed numbers are honest estimates. It **cannot see the
club face**, and the clubhead path is a 2D trace from motion, so it can't tell a
slice from a pull on its own — only your report of the ball flight (or a launch
monitor) separates the two.
