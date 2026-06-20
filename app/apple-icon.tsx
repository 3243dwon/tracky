import { ImageResponse } from "next/og";

// Apple touch / home-screen icon (PNG, generated at build). iOS masks corners, so the
// dark background is full-bleed; the mark is a golf flag-on-the-green with a ball.
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
            <linearGradient id="green" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#318042" />
              <stop offset="1" stopColor="#1a4826" />
            </linearGradient>
            <linearGradient id="flag" x1="27" y1="20" x2="47" y2="20" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#ff9a36" />
              <stop offset="1" stopColor="#ffbf63" />
            </linearGradient>
          </defs>
          <ellipse cx="33" cy="50" rx="21" ry="7" fill="url(#green)" />
          <line x1="27" y1="49" x2="27" y2="13" stroke="#e8eee1" strokeWidth="2.3" strokeLinecap="round" />
          <path d="M27 14 L47 19 L27 26 Z" fill="url(#flag)" />
          <circle cx="41" cy="48" r="5" fill="#f4f8f1" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
