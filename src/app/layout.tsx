import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Library Helper",
  description:
    "読書の挫折を防ぐ対話型読書伴走アプリ「Library Helper」(動作確認用モック)",
};

// iPhone対応: viewportFit=coverでノッチ・ホームバー領域まで描画し、
// アプリ側のsafe-area padding(env(safe-area-inset-*))で重なりを避ける
// (ホーム画面追加(スタンドアロン)時にステータスバーへ上部が食い込むのを防ぐ)
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className={`${geistSans.variable} h-full antialiased`}>
      {/* overflow-x-hidden: モバイルでの横スクロール・見切れ防止(全ページ共通) */}
      <body className="min-h-full flex flex-col overflow-x-hidden bg-slate-100 text-slate-900">
        {children}
      </body>
    </html>
  );
}
