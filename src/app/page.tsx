import Image from "next/image";
import Link from "next/link";

// 入口画面 (引継ぎ§6.2): 確定入口画像をそのまま使用。
// 導線は画像内CTA「利用を開始する」のクリック領域1本のみ (ログイン導線・注記なし)
export default function EntryPage() {
  return (
    <main className="flex h-dvh items-center justify-center overflow-hidden bg-[linear-gradient(180deg,#f7efe2,#efe0c9)]">
      <div className="relative h-full">
        <Image
          src="/images/entrance.jpg"
          alt="AI時代の読書術 Library Helper ― あなたの学びを、やさしくサポート"
          width={681}
          height={1210}
          priority
          className="h-full w-auto"
        />
        {/* 実体のあるCTAリンクボタン (2026-08-27修正): 旧・透明クリック領域(bottom 3.2%)は
            現行entrance.jpgのボタン絵とずれておりクリックできなかったため、
            画像内オレンジピルの実測位置(下端10.66%・幅53.7%・高さ6.2%・色#F18F36)に
            それを覆う可視ボタンとして配置。画像・レイアウトは不変 */}
        <Link
          href="/app"
          aria-label="利用を開始する"
          className="absolute bottom-[10.4%] left-1/2 flex h-[6.8%] w-[55.5%] -translate-x-1/2 items-center justify-center gap-[0.45em] rounded-full bg-[#F18F36] font-bold tracking-[0.18em] whitespace-nowrap text-white shadow-[0_3px_12px_rgba(180,95,20,0.35)] hover:brightness-105 focus-visible:outline-3 focus-visible:outline-white focus-visible:outline-offset-2"
          style={{ fontSize: "clamp(14px, 2.9dvh, 28px)" }}
        >
          利用を開始する<span className="tracking-normal">›</span>
        </Link>
      </div>
    </main>
  );
}
