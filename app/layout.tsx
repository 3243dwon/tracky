import type { Metadata, Viewport } from "next";
import Smooth from "@/components/Smooth";
import Intro from "@/components/Intro";
import "./globals.css";

const TITLE = "Swing·CV — on-device golf swing lab";
const DESCRIPTION =
  "Golf swing analysis in the browser: skeleton + hand-tracer slow-mo, tempo, hand speed, kinematic sequence and swing-to-swing consistency. Runs entirely on your device — your video never uploads.";

export const metadata: Metadata = {
  metadataBase: new URL("https://swing-cv-web.vercel.app"),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "Swing·CV",
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
    siteName: "Swing·CV",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
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
