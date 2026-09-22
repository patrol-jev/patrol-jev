import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "순찰일지",
  description: "사진을 올리면 순찰일지 글이 나옵니다.",
  // 홈 화면에 얹는 값은 app/manifest.ts, 아이콘은 app/icon.svg·app/apple-icon.png 가 준다.
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "순찰일지", statusBarStyle: "default" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
