import { ImageResponse } from "next/og";

// Apple touch / home-screen icon (PNG, generated at build). iOS masks corners, so the
// dark background is full-bleed; the mark is the brand's orange→green swing arc.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0e0a",
        }}
      >
        <svg width="150" height="150" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="arc" x1="12" y1="38" x2="52" y2="38" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#ff9a36" />
              <stop offset="0.55" stopColor="#ffb056" />
              <stop offset="1" stopColor="#4ce17e" />
            </linearGradient>
          </defs>
          <path d="M12 38 Q 32 12 52 38" stroke="url(#arc)" strokeWidth="6.5" strokeLinecap="round" />
          <circle cx="52" cy="38" r="4.6" fill="#62e58c" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
