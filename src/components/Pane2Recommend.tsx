"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Book } from "@/lib/dummyData";

/** 熱血プレゼン(API選書本のオンデマンド生成)の書籍ごとの状態 */
export type PitchState =
  | { status: "loading" }
  | { status: "ready"; text: string }
  | { status: "error" };

// 熱血プレゼン生成中・失敗時の案内(暫定文言・確定文言ではない)。
// 失敗時にダミーのプレゼン文で代用しない(確認できないものは表示しない原則)
const pitchLoadingGuide = "オランジェとゲルプが、この本の魅力をまとめているよ…";
const pitchFailedGuide =
  "ごめんね、いまこの本の魅力をうまくまとめられなかったみたい。少し待ってから、もう一度開いてみてね。";

interface Props {
  /** 候補3冊。null=空状態 (appState.pane2Books) */
  books: Book[] | null;
  /** 検索演出中 (appState.searching) */
  searching: boolean;
  /** 読書中の書籍ID一覧 (appState.shelf.readingから。読書中の本は決定不可・読書中表示) */
  readingIds: string[];
  /** 上限3冊の注意表示対象 (appState.limitNoticeBookId) */
  limitNoticeBookId: string | null;
  /** 検索演出の画像境界(最低1周経過後・約2秒ごと)の通知。親が結果取得済みなら3冊表示へ切り替える */
  onSearchBoundary: () => void;
  onDecideBook: (book: Book) => void;
  /** 「別の3冊にお願い」(§6.4: 全経路共通・候補3冊のみ差替) */
  onRefresh: () => void;
  /** 差替候補が不足したときのオランジェの案内 (appState.pane2Notice。nullなら非表示) */
  refreshNotice: string | null;
  /** 熱血プレゼンの生成状態 (書籍IDキー。API選書本=reasonDetail未設定の本のみ対象) */
  pitches: Record<string, PitchState>;
  /** 熱血プレゼンの生成依頼 (展開時に呼ぶ。生成済み・生成中は親が無視し、失敗後は再試行) */
  onRequestPitch: (bookId: string) => void;
}

// ---- CSS製ダミー表紙 (v13 coverHTML/COVERS と同一。実装で書影URLに差し替え) ----
const COVERS: Record<string, { bg: string; fg: string; ac: string }> = {
  "エッセンシャル思考": { bg: "#F4F1E8", fg: "#22211E", ac: "#D9482B" },
  "THINK AGAIN": { bg: "#16395C", fg: "#FFFFFF", ac: "#F2A649" },
  "限りある時間の使い方": { bg: "#D9A441", fg: "#2B2118", ac: "#F6EFDD" },
  "成瀬は天下を取りにいく": { bg: "#7FB3D5", fg: "#14364F", ac: "#FFFFFF" },
  "アウトプット大全": { bg: "#2E7D5B", fg: "#FFFFFF", ac: "#EFC94C" },
  "イシューからはじめよ": { bg: "#EAE4D6", fg: "#1F2A44", ac: "#2C5F9E" },
  "影響力の武器": { bg: "#8E3B2F", fg: "#F6EBDD", ac: "#E0B44B" },
  "GIVE & TAKE": { bg: "#3F7CAC", fg: "#FFFFFF", ac: "#F0EAD8" },
  "SHOE DOG": { bg: "#232323", fg: "#FFFFFF", ac: "#D93A2B" },
  "汝、星のごとく": { bg: "#1C2B4A", fg: "#EAD9A0", ac: "#5D7BA8" },
  "同志少女よ、敵を撃て": { bg: "#6E1F1F", fg: "#F1E4D0", ac: "#C7A252" },
  "ペンギン・ハイウェイ": { bg: "#CFE8F5", fg: "#1B4965", ac: "#F2B33D" },
  "コンビニ人間": { bg: "#EDF4F8", fg: "#25455C", ac: "#5FA8CE" },
  "かがみの孤城": { bg: "#2E6E8E", fg: "#F3EFE4", ac: "#E8C25A" },
  "FACTFULNESS": { bg: "#F0EEE8", fg: "#232323", ac: "#E2762C" },
  "思考の整理学": { bg: "#F0E6D2", fg: "#3A3126", ac: "#B4432E" },
  "サピエンス全史": { bg: "#DCD3C3", fg: "#26221C", ac: "#7A5C3A" },
  "仕事は楽しいかね?": { bg: "#4E6E9E", fg: "#FFFFFF", ac: "#F0D06A" },
};
const GENERIC = [
  { bg: "#56617A", fg: "#F2F3F6", ac: "#C9CFDD" },
  { bg: "#6E5A4E", fg: "#F4EEE7", ac: "#D8C29A" },
  { bg: "#4E6E5A", fg: "#EFF4F0", ac: "#CFE0C9" },
];
function coverSpec(title: string) {
  if (COVERS[title]) return COVERS[title];
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0;
  return GENERIC[h % GENERIC.length];
}

// ダミー表紙 (§12: 表紙70px基準・縦横比維持。v13の.coverと同一スタイル)
export function Cover({ title, author, w, h }: { title: string; author: string; w: number; h: number }) {
  const c = coverSpec(title);
  const small = w < 44;
  return (
    <span
      aria-hidden="true"
      className="relative block flex-none overflow-hidden rounded-[3px] shadow-[0_1px_2px_rgba(17,17,17,0.2),inset_0_0_0_1px_rgba(17,17,17,0.06)]"
      style={{ width: w, height: h, background: c.bg, color: c.fg, padding: small ? "5px 3px 6px 8px" : "7px 5px 8px 10px" }}
    >
      {/* 背表紙の陰影 */}
      <span
        className="pointer-events-none absolute inset-y-0 left-0 w-[7px]"
        style={{ background: "linear-gradient(90deg, rgba(0,0,0,0.20), rgba(0,0,0,0.04) 55%, rgba(255,255,255,0.22) 80%, rgba(255,255,255,0))" }}
      />
      <span className="block font-bold leading-[1.3] tracking-[0.01em]" style={{ fontSize: small ? "6.5px" : "8.5px" }}>
        {title}
      </span>
      {!small && (
        <span className="absolute right-1 bottom-[9px] left-[10px] font-semibold opacity-75" style={{ fontSize: "6px" }}>
          {author}
        </span>
      )}
      <span className="absolute inset-x-0 bottom-0 opacity-90" style={{ height: small ? 4 : 6, background: c.ac }} />
    </span>
  );
}

// ---- 検索演出 (§6.4・2026-08-23微修正: 1枚約2秒×3枚=1周約6秒。grill-me由来のみ) ----
// 最低1周は必ず表示。1周終了以降は約2秒の画像境界ごとにonSearchBoundaryを呼び、
// 親が選書結果取得済みなら3冊表示へ・未取得なら同じ3枚の演出をそのまま継続する
// (結果取得後も固定で待たせない。3枚の順番・画像・文言はv13から変更しない)
const searchImages = [
  { src: "/images/searching-1.jpg", w: 665, h: 499 },
  { src: "/images/searching-2.jpg", w: 669, h: 502 },
  { src: "/images/searching-3.jpg", w: 711, h: 533 },
] as const;

function SearchingView({ onBoundary }: { onBoundary: () => void }) {
  const [index, setIndex] = useState(0);
  const boundaries = useRef(0); // 経過した2秒境界の数 (3で1周)

  useEffect(() => {
    const swap = setInterval(() => {
      boundaries.current += 1;
      setIndex((i) => (i + 1) % searchImages.length);
      // 最低1周(境界3回=約6秒)を終えたら、以降の各境界で親に切替可否を確認する
      if (boundaries.current >= searchImages.length) onBoundary();
    }, 2000);
    return () => clearInterval(swap);
  }, [onBoundary]);

  const img = searchImages[index];
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <Image
        src={img.src}
        alt="オランジェとゲルプが本を探しています"
        width={img.w}
        height={img.h}
        className="block w-full max-w-[250px] rounded-r2"
      />
      {/* whitespace-nowrapはスマホ幅でキャプションが右に見切れるため除去(自然折返し。
          PCは1行に収まるため従来表示のまま) */}
      <p className="text-t3 max-lg:text-[13px] leading-[1.8] text-charcoal">今、オランジェとゲルプで本を探しているよ</p>
    </div>
  );
}

// ---- 空状態の棚アイコン (v13 SHELF_SVG) ----
function ShelfIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="currentColor" className="h-[46px] w-[46px] text-ink-faint">
      <rect x="8" y="12" width="6" height="25" rx="1.2" opacity="0.55" />
      <rect x="16" y="9" width="6" height="28" rx="1.2" opacity="0.8" />
      <rect x="24" y="13" width="6" height="24" rx="1.2" opacity="0.4" />
      <rect x="33.5" y="8.5" width="6" height="28" rx="1.2" opacity="0.65" transform="rotate(9 36.5 22.5)" />
      <rect x="5" y="38.5" width="38" height="2.4" rx="1.2" opacity="0.85" />
    </svg>
  );
}

// Pane 2「選ぶ」(引継ぎ§6.4): 3冊完全同格・2文推薦・1冊のみ展開
export default function Pane2({ books, searching, readingIds, limitNoticeBookId, onSearchBoundary, onDecideBook, onRefresh, refreshNotice, pitches, onRequestPitch }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  // 「別の3冊」処理中の二重実行防止 (v13: 700ms無効化)
  const [refreshing, setRefreshing] = useState(false);

  // 候補が差し替わったら展開状態を閉じる (v13: expandedTitle=null)。
  // レンダー中の状態調整パターン(React推奨)でエフェクトを使わずに同期リセットする
  const [prevBooks, setPrevBooks] = useState(books);
  if (prevBooks !== books) {
    setPrevBooks(books);
    setOpenId(null);
  }

  const handleRefresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    setTimeout(() => {
      onRefresh();
      setRefreshing(false);
    }, 700);
  };

  return (
    <section className="flex h-full flex-col overflow-y-auto bg-white">
      <div className="flex flex-1 flex-col gap-2 p-3">
        {/* 初期は空 (§12: 棚アイコン+案内)。著者探訪の初回検索が失敗した場合も候補は
            架空の本で埋めず、既存のオランジェ吹き出しスタイル(下の別の3冊にお願い時と同じ)
            をこの空状態にも表示する(2026-09-06新設。新しいデザインは追加しない) */}
        {books === null && !searching && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3.5 px-4 py-6 text-center">
            <ShelfIcon />
            <p className="text-t3 max-lg:text-[13px] leading-[1.8] text-ink-soft">
              トレンド・grill-me・著者探訪から選ぶと、
              <br />
              ここに「あなたへの3冊」が並びます
            </p>
            {refreshNotice !== null && (
              <div className="max-w-full rounded-r3 bg-pane-bg px-3 py-2 text-left text-t3 max-lg:text-[13px] leading-[1.7] text-charcoal">
                <span className="mr-1.5 mb-[1px] inline-block h-[7px] w-[7px] rounded-full bg-orange-brand" />
                （オランジェ）{refreshNotice}
              </div>
            )}
          </div>
        )}

        {searching && <SearchingView onBoundary={onSearchBoundary} />}

        {books !== null && !searching && (
          <>
            {books.map((book) => {
              const isOpen = openId === book.id;
              const isReading = readingIds.includes(book.id);
              const pitch = pitches[book.id];
              return (
                <article
                  key={book.id}
                  className={`rounded-r3 border px-3 py-[11px] ${
                    isReading ? "border-[#D5E3ED] bg-[#EAF2F8]" : "border-hairline bg-ice"
                  }`}
                >
                  <div className="flex gap-3">
                    {/* 実表紙は書誌APIで確認できた場合のみ表示。無い場合は既存のCSS
                        プレースホルダー(別書籍の表紙は代用しない) */}
                    {book.coverUrl !== undefined ? (
                      <Image
                        src={book.coverUrl}
                        alt={`『${book.title}』の表紙`}
                        width={48}
                        height={70}
                        className="block h-[70px] w-12 flex-none rounded-[3px] object-cover shadow-[0_1px_2px_rgba(17,17,17,0.2),inset_0_0_0_1px_rgba(17,17,17,0.06)]"
                      />
                    ) : (
                      <Cover title={book.title} author={book.author} w={48} h={70} />
                    )}
                    <div className="min-w-0 flex-1">
                      <h3 className="m-0 text-t1 font-bold leading-[1.4] tracking-[-0.01em]">{book.title}</h3>
                      <p className="mt-[3px] text-t4 max-lg:text-[12.5px] text-ink-soft">{book.author}</p>
                      {isReading && (
                        <span className="mt-1.5 inline-block rounded-full border border-[#D5E3ED] bg-white px-[9px] py-[2px] text-[10px] max-lg:text-[11px] font-bold text-[#3F6F8F]">
                          読書中
                        </span>
                      )}
                    </div>
                  </div>
                  {/* 2文推薦 (生成できなかった場合は非表示。ダミー文で埋めない) */}
                  {book.reason !== undefined && (
                    <p className="mt-2 text-t3 max-lg:text-[13.5px] leading-[1.7]">{book.reason}</p>
                  )}

                  <button
                    onClick={() => {
                      setOpenId(isOpen ? null : book.id);
                      // API選書本(reasonDetail未設定)は展開時にオンデマンド生成を依頼する。
                      // 生成済み・生成中の重複依頼は親側で無視され、失敗後の再展開は再試行になる
                      if (!isOpen && book.reasonDetail === undefined) onRequestPitch(book.id);
                    }}
                    className="mt-[9px] flex w-full items-center justify-center gap-1 rounded-r2 border border-hairline bg-white py-[7px] text-t3 font-bold text-action"
                  >
                    {isOpen ? "閉じる" : "この本の魅力を見る"}
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={`h-3 w-3 transition-transform ${isOpen ? "rotate-90" : ""}`}
                    >
                      <path d="M9 5l7 7-7 7" />
                    </svg>
                  </button>

                  {/* 1冊のみ展開: 熱血プレゼン+二次情報+[この本に決めた]+Amazon補助リンク */}
                  {isOpen && (
                    <div className="mt-2.5 border-t border-hairline pt-2.5">
                      {/* 熱血プレゼン: ダミープール本は既存サンプル文(reasonDetail)、
                          API選書本は実Gemini生成をオンデマンド表示。生成失敗時は
                          ダミー文で代用せず暫定の再試行案内のみ(再展開で再試行) */}
                      {book.reasonDetail !== undefined ? (
                        <p className="mb-2.5 text-t3 max-lg:text-[13.5px] leading-[1.8]">{book.reasonDetail}</p>
                      ) : pitch?.status === "ready" ? (
                        <p className="mb-2.5 text-t3 max-lg:text-[13.5px] leading-[1.8] whitespace-pre-line">{pitch.text}</p>
                      ) : pitch?.status === "error" ? (
                        <p className="mb-2.5 text-t4 max-lg:text-[12px] leading-[1.7] text-ink-soft">{pitchFailedGuide}</p>
                      ) : (
                        <p className="mb-2.5 text-t4 max-lg:text-[12px] leading-[1.7] text-ink-soft">{pitchLoadingGuide}</p>
                      )}
                      {/* 二次情報 (Ver.1表示原則: 確認できた項目だけ表示・無い項目は行ごと非表示。
                          推測やダミー値では埋めない。ダミープールの架空本のみv13サンプル値を保持) */}
                      {(book.publisher !== undefined ||
                        book.publishedDate !== undefined ||
                        book.rating !== undefined ||
                        book.reviewCount !== undefined) && (
                        <div className="mb-3.5 text-t4 max-lg:text-[12px] leading-[1.8] text-ink-soft">
                          {(book.publisher !== undefined || book.publishedDate !== undefined) && (
                            <p className="m-0">
                              {[book.publisher, book.publishedDate].filter((v) => v !== undefined).join("・")}
                            </p>
                          )}
                          {(book.rating !== undefined || book.reviewCount !== undefined) && (
                            <p className="m-0">
                              {[
                                book.rating !== undefined ? `読者評価 ${book.rating}` : null,
                                book.reviewCount !== undefined ? `書評 ${book.reviewCount}件` : null,
                                book.reviewCount !== undefined ? "複数の書評を確認" : null,
                              ]
                                .filter((v) => v !== null)
                                .join("　·　")}
                            </p>
                          )}
                        </div>
                      )}
                      <button
                        onClick={() => onDecideBook(book)}
                        disabled={isReading}
                        className="w-full rounded-r2 bg-action py-2.5 text-t3 font-bold text-white hover:opacity-90 disabled:bg-hairline disabled:text-ink-soft disabled:hover:opacity-100"
                      >
                        {isReading ? "✓ 読書中の本です" : "この本に決めた"}
                      </button>
                      {limitNoticeBookId === book.id && (
                        <p className="mt-2 rounded-r1 border border-hairline bg-pane-bg px-2.5 py-2 text-[11px] max-lg:text-[12px] leading-[1.7] text-charcoal">
                          読書中は3冊までです。新しい本を追加するには、現在の読書中から1冊を『完読』または『中断』にしてください。
                        </p>
                      )}
                      {/* Amazonリンク (2026-08-28全カード有効化): 全推薦カードで動作する。
                          ISBN-13が確認できていればISBN・なければ書名+著者名で
                          Amazon.co.jpの「本」カテゴリ検索へ(URLエンコード済み・新規タブ) */}
                      <a
                        href={`https://www.amazon.co.jp/s?k=${encodeURIComponent(book.isbn13 ?? `${book.title} ${book.author}`)}&i=stripbooks`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2.5 flex items-center justify-center gap-[3px] text-t4 max-lg:text-[12px] text-action no-underline"
                      >
                        Amazonで見る
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-2.5 w-2.5">
                          <path d="M7 17L17 7M9 7h8v8" />
                        </svg>
                      </a>
                    </div>
                  )}
                </article>
              );
            })}

            {/* 差替候補が不足したときの案内 (通常の案内会話と同じ静かな吹き出し・左寄せ。警告表現にしない) */}
            {refreshNotice !== null && (
              <div className="flex justify-start">
                <div className="max-w-full rounded-r3 bg-pane-bg px-3 py-2 text-t3 max-lg:text-[13px] leading-[1.7] text-charcoal">
                  <span className="mr-1.5 mb-[1px] inline-block h-[7px] w-[7px] rounded-full bg-orange-brand" />
                  （オランジェ）{refreshNotice}
                </div>
              </div>
            )}

            {/* 別の3冊にお願い (§15: 全経路共通の単一ボタン。処理中は無効化) */}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="mt-0.5 flex items-center justify-center gap-1.5 rounded-r2 border border-hairline bg-ice py-[9px] text-t3 font-bold text-action disabled:opacity-50">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-[13px] w-[13px]">
                <path d="M4 4v5h5M20 20v-5h-5" />
                <path d="M5.5 15A8 8 0 0119 8.5M18.5 9A8 8 0 015 15.5" />
              </svg>
              別の3冊にお願い
            </button>
          </>
        )}
      </div>
    </section>
  );
}
