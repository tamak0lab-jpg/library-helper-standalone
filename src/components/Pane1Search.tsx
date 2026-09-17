"use client";

import { useState } from "react";
import { AUTHOR_POOL } from "@/lib/dummyData";

interface Props {
  onStartGrill: () => void;
  /** トレンドのカテゴリ選択 → Pane2へ3冊 (結果はPane1に出さない・§6.3) */
  onTrendSelect: (category: string) => void;
  /** 著者候補の選択 → Pane2へ3冊 */
  onAuthorSelect: (name: string) => void;
}

// Pane 1「探す」(引継ぎ§6.3): トレンド / grill-me / 著者探訪 の3ブロック同形式
// ([白黒線画アイコン]+名称)。結果はPane1に出さず全てPane2へ (結果表示は段階1-5以降)
// アイコン・文言・寸法はv13モックと同一

const trendCategories = [
  {
    name: "ビジネス・実用",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="8" width="16" height="11" rx="1.5" />
        <path d="M9 8V6a2 2 0 012-2h2a2 2 0 012 2v2" />
      </svg>
    ),
  },
  {
    name: "小説・エンタメ",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 4h11a2 2 0 012 2v14l-7-3-6 3V4z" />
      </svg>
    ),
  },
  {
    name: "総合",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        <rect x="4" y="4" width="7" height="7" rx="1" />
        <rect x="13" y="4" width="7" height="7" rx="1" />
        <rect x="4" y="13" width="7" height="7" rx="1" />
        <rect x="13" y="13" width="7" height="7" rx="1" />
      </svg>
    ),
  },
] as const;

// ブロック見出し (v13 .sec-label: 13px/700・アイコン14px)
function SecLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <p className="mb-2 flex items-center gap-1.5 text-t2 font-bold [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:flex-none [&>svg]:text-ink-soft">
      {icon}
      {label}
    </p>
  );
}

export default function Pane1({ onStartGrill, onTrendSelect, onAuthorSelect }: Props) {
  const [category, setCategory] = useState<string | null>(null);
  const [author, setAuthor] = useState("");

  // 著者候補 (§6.3: 部分一致・2文字以上・候補最大5件)
  const candidates =
    author.trim().length >= 2
      ? AUTHOR_POOL.filter((n) => n.includes(author.trim())).slice(0, 5)
      : [];

  return (
    <section className="flex h-full flex-col gap-3.5 overflow-y-auto bg-white p-3">
      {/* トレンド */}
      <div>
        <SecLabel
          label="トレンド"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 17l6-6 4 4 7-8" />
              <path d="M15 7h5v5" />
            </svg>
          }
        />
        <div className="grid grid-cols-3 gap-1.5">
          {trendCategories.map(({ name, icon }) => (
            <button
              key={name}
              onClick={() => {
                setCategory(name);
                onTrendSelect(name);
              }}
              className={`flex flex-col items-center gap-[5px] rounded-r2 border px-1 pt-[9px] pb-2 text-t4 max-lg:text-[12.5px] font-semibold text-charcoal transition-colors [&>svg]:h-4 [&>svg]:w-4 ${
                category === name
                  ? "border-action/45 bg-ice [&>svg]:text-charcoal"
                  : "border-hairline bg-white hover:bg-pane-bg [&>svg]:text-ink-soft"
              }`}
            >
              {icon}
              {name}
            </button>
          ))}
        </div>
      </div>

      {/* grill-me (主役・淡#EEF4FFカード) */}
      <div>
        <SecLabel
          label="grill-me"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 5h16v10H8l-4 4V5z" />
              <circle cx="9" cy="10" r="0.8" fill="currentColor" />
              <circle cx="12" cy="10" r="0.8" fill="currentColor" />
              <circle cx="15" cy="10" r="0.8" fill="currentColor" />
            </svg>
          }
        />
        <div className="rounded-r3 border border-hairline bg-ice px-3.5 py-3">
          <p className="mb-2.5 text-t3 max-lg:text-[13px] leading-[1.75] text-charcoal">
            検索では出会えない本棚へ
            {/* 本が数冊重なった白黒線画アイコン (§6.3・矢印は不採用) */}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="ml-1.5 inline-block h-[13px] w-[13px] align-[-2.5px] text-ink-soft"
            >
              <rect x="5" y="15" width="14" height="4" rx="1" />
              <rect x="6.5" y="10.5" width="13" height="4" rx="1" />
              <rect x="4.5" y="6" width="13" height="4" rx="1" />
            </svg>
          </p>
          <button
            onClick={onStartGrill}
            className="flex w-full items-center justify-center gap-[5px] rounded-r2 border border-hairline bg-white py-2 text-[12.5px] font-bold text-action transition-colors hover:border-action/45"
          >
            grill-meを始める
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-[13px] w-[13px]">
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* 著者探訪 */}
      <div>
        <SecLabel
          label="著者探訪"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="3.4" />
              <path d="M5 20c0-3.6 3.1-6.5 7-6.5s7 2.9 7 6.5" />
            </svg>
          }
        />
        <div className="flex gap-2">
          <input
            type="text"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="著者名を入力(例:村上春樹)"
            autoComplete="off"
            className="min-w-0 flex-1 rounded-r2 border border-hairline bg-white px-3 py-[7px] text-t3 text-charcoal placeholder:text-ink-faint max-lg:text-[16px] max-lg:leading-[1.3] max-lg:py-[6px] max-lg:focus:outline-1 focus:outline-2 focus:outline-action focus:-outline-offset-1"
          />
          {/* 候補は入力に応じて下に表示される (v13と同じ挙動。ボタンは表示のトリガと同等) */}
          <button className="rounded-r2 border border-hairline bg-ice px-3.5 text-t3 font-bold text-action">
            検索
          </button>
        </div>
        <p className="mt-1.5 text-t4 max-lg:text-[11px] text-ink-soft">名字だけでも検索できます(2文字以上)</p>
        {/* 候補 (最大5件)。選択でPane2に3冊 */}
        <div className="mt-2 flex flex-col gap-1">
          {candidates.map((name) => (
            <button
              key={name}
              onClick={() => onAuthorSelect(name)}
              className="rounded-r2 border border-transparent bg-pane-bg px-3 py-2 text-left text-t3 text-charcoal hover:border-hairline hover:bg-ice"
            >
              {name}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
