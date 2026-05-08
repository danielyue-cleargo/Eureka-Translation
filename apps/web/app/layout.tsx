import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EU Figma Translation",
  description: "Translate US Figma layouts into approved EU language variants."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
