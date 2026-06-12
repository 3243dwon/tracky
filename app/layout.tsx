import type { Metadata, Viewport } from "next";
import Smooth from "@/components/Smooth";
import Intro from "@/components/Intro";
import "./globals.css";

export const metadata: Metadata = {
  title: "Swing·CV — on-device golf swing lab",
  description:
    "Golf swing analysis in the browser: skeleton + hand-tracer slow-mo, tempo, hand speed, kinematic sequence and swing-to-swing consistency. Runs entirely on your device — your video never uploads.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#060a07",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Intro />
        <Smooth />
        {children}
      </body>
    </html>
  );
}
