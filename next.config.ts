import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // 書誌API(Ver.1: Google Books)の表紙画像ホスト (引継ぎ§7: Next16はremotePatterns必須)
    remotePatterns: [
      { protocol: "https", hostname: "books.google.com" },
      { protocol: "https", hostname: "books.googleusercontent.com" },
    ],
  },
};

export default nextConfig;
