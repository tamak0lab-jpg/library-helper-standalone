"use client";

import { useState } from "react";
import { Cover } from "./Pane2Recommend";
import { ReadingEntry, Shelf } from "@/lib/appState";

// Pane 4「読書録」(引継ぎ§6.6): 書架リスト形式
// 表紙34x48+タイトル+著者+状態バッジ+日付+「…」メニュー。状態は読書中/完読/中断の3種
// 1冊以上ある状態のみセクション表示(0冊は見出しごと非表示)
// 「…」メニューの状態変更(読書中/完読/中断)はMOVE_BOOK、削除はDELETE_BOOKで実装済み。
// 削除の確認はオランジェの案内吹き出し(確定文言)+［キャンセル］［削除する］で行う

type Kind = keyof Shelf;

const SECTION_DEF: Record<
  Kind,
  { label: string; dateLabel: string; badge: string; menu: { label: string; to: Kind }[] }
> = {
  reading: {
    label: "読書中",
    dateLabel: "選んだ日",
    badge: "border-[#D5E3ED] bg-[#EAF2F8] text-[#3F6F8F]",
    menu: [
      { label: "完読にする", to: "done" },
      { label: "中断する", to: "suspended" },
    ],
  },
  done: {
    label: "完読",
    dateLabel: "完読日",
    badge: "border-[#E0E0E3] bg-[#F0F0F2] text-[#66666B]",
    menu: [
      { label: "読書中へ戻す", to: "reading" },
      { label: "中断へ変更", to: "suspended" },
    ],
  },
  suspended: {
    label: "中断",
    dateLabel: "中断日",
    badge: "border-hairline bg-pane-bg text-[#8E8E93]", // 中断色は仮の低彩度グレー(§8保留)
    menu: [
      { label: "読書中へ戻す", to: "reading" },
      { label: "完読へ変更", to: "done" },
    ],
  },
};

const fmt = (d: string) => d.replace(/-/g, "/");

// 削除確認の確定文言 (表示時の「●（オランジェ）」プレフィックスは描画側が付与)
const deleteConfirmMessage =
  "この読書録を削除する？\nこの本の読書支援履歴と保存したフレーズも一緒に削除されて、元には戻せないよ。";

interface Props {
  shelf: Shelf;
  /** 読書体験の記録 (appState.entries・書籍IDキー・時系列)。0件の本には項目自体を表示しない */
  entries: Record<string, ReadingEntry[]>;
  /** Pane4上部の案内吹き出し (supportMode=falseで読書中クリック時・約5秒の一時表示) */
  notice: string | null;
  /** 現在の読書支援セッション対象の書籍ID (行ハイライト用) */
  activeBookId: string | null;
  /** 「読書中」の本のクリック (完読/中断は対象外・§6.5) */
  onReadingClick: (bookId: string) => void;
  /** 「…」メニューの状態変更 (読書中/完読/中断の移動・§6.6) */
  onMoveBook: (bookId: string, from: Kind, to: Kind) => void;
  /** 削除の確定 (確認吹き出しで［削除する］を押した場合のみ呼ぶ) */
  onDeleteBook: (bookId: string) => void;
}

// 記録展開時の話者表示
const SPEAKER_LABEL: Record<string, string> = { user: "あなた", orange: "オランジェ", gelb: "ゲルプ" };

export default function Pane4({ shelf, entries, notice, activeBookId, onReadingClick, onMoveBook, onDeleteBook }: Props) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  // 削除確認吹き出しの対象書籍ID (キャンセルで閉じるだけ・アプリ状態には一切触れない)
  const [confirmBookId, setConfirmBookId] = useState<string | null>(null);
  // 展開中の読書記録ID (1件のみ展開・再タップで折りたたみ)
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);

  const closeMenus = () => setOpenMenu(null);

  const kinds: Kind[] = ["reading", "done", "suspended"];
  let firstShown = true;

  return (
    <section className="flex h-full flex-col gap-0.5 overflow-y-auto bg-white p-3">
      {/* 案内吹き出し (v13 .p4-notice-msg: 通常の会話と同じ吹き出し・左寄せ・狭幅は自然折返し) */}
      {notice !== null && (
        <div className="mb-2 flex justify-start">
          <div className="max-w-full rounded-r3 bg-pane-bg px-2.5 py-2 text-[11px] max-lg:text-[12px] leading-[1.7] whitespace-pre-line text-charcoal">
            <span className="mr-1.5 mb-[1px] inline-block h-[7px] w-[7px] rounded-full bg-orange-brand" />
            （オランジェ）{notice}
          </div>
        </div>
      )}

      {/* 削除確認 (確定仕様): オランジェの案内吹き出し+［キャンセル］［削除する］。
          静かな会話吹き出し表現のまま(大型モーダル・警告色・アニメーションは追加しない)。
          キャンセルは吹き出しを閉じるだけで状態を一切変更しない */}
      {confirmBookId !== null && (
        <div className="mb-2 flex justify-start">
          <div className="max-w-full rounded-r3 bg-pane-bg px-2.5 py-2 text-[11px] max-lg:text-[12px] leading-[1.7] whitespace-pre-line text-charcoal">
            <span className="mr-1.5 mb-[1px] inline-block h-[7px] w-[7px] rounded-full bg-orange-brand" />
            （オランジェ）{deleteConfirmMessage}
            <span className="mt-1.5 flex justify-end gap-1.5">
              <button
                onClick={() => setConfirmBookId(null)}
                className="rounded-r2 border border-hairline bg-white px-3 py-1 text-[11px] max-lg:text-[12px] font-semibold text-charcoal hover:bg-pane-bg"
              >
                キャンセル
              </button>
              <button
                onClick={() => {
                  onDeleteBook(confirmBookId);
                  setConfirmBookId(null);
                }}
                className="rounded-r2 border border-hairline bg-white px-3 py-1 text-[11px] max-lg:text-[12px] font-semibold text-charcoal hover:bg-pane-bg"
              >
                削除する
              </button>
            </span>
          </div>
        </div>
      )}
      {kinds.map((kind) => {
        const books = shelf[kind];
        if (books.length === 0) return null; // 0冊は見出しごと非表示
        const def = SECTION_DEF[kind];
        const withSeparator = !firstShown;
        firstShown = false;
        return (
          <div key={kind} className={withSeparator ? "mt-2.5 border-t border-hairline pt-3" : ""}>
            <div className="flex items-baseline justify-between px-0.5 pt-[3px] pb-1.5 text-t2 font-bold">
              {def.label}
              <span className="text-t4 max-lg:text-[12px] font-semibold text-ink-soft tabular-nums">{books.length}冊</span>
            </div>
            <div className="flex flex-col gap-0.5">
              {books.map((book) => {
                const key = book.id;
                const menuOpen = openMenu === key;
                const list = entries[book.id];
                return (
                  <div key={book.id}>
                    <div
                      onClick={kind === "reading" ? () => onReadingClick(book.id) : undefined}
                      className={`relative flex items-center gap-2.5 rounded-r2 px-2 py-1.5 ${
                        kind === "reading" ? "cursor-pointer hover:bg-pane-bg" : ""
                      } ${kind === "reading" && activeBookId === book.id ? "bg-ice hover:bg-ice" : ""}`}
                    >
                      <Cover title={book.title} author={book.author} w={34} h={48} />
                      <span className="min-w-0 flex-1">
                        <p className="m-0 overflow-hidden text-t3 max-lg:text-[13px] font-bold leading-[1.4] text-ellipsis whitespace-nowrap text-charcoal">
                          {book.title}
                        </p>
                        <p className="mt-[1px] mb-[2px] text-t4 max-lg:text-[12px] text-ink-soft">{book.author}</p>
                        <span className="text-t4 max-lg:text-[12px] text-ink-soft tabular-nums">
                          {def.dateLabel} {fmt(book.date)}
                        </span>
                      </span>
                      <span className="flex flex-none flex-col items-end gap-1.5">
                        <span className={`rounded-full border px-[9px] py-[2px] text-[10px] max-lg:text-[11px] font-bold whitespace-nowrap ${def.badge}`}>
                          {def.label}
                        </span>
                        <button
                          aria-label="メニュー"
                          onClick={(e) => {
                            e.stopPropagation(); // 行クリック(セッション開始)に伝播させない
                            setOpenMenu(menuOpen ? null : key);
                          }}
                          className="flex h-5 w-6 items-center justify-center rounded-r1 text-ink-faint hover:bg-hairline hover:text-charcoal"
                        >
                          <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
                            <circle cx="5" cy="12" r="1.7" />
                            <circle cx="12" cy="12" r="1.7" />
                            <circle cx="19" cy="12" r="1.7" />
                          </svg>
                        </button>
                      </span>

                      {/* 「…」メニュー (状態変更・削除とも実処理。§43: 削除は即時実行せず
                          Pane4上部のオランジェ確認吹き出しで確定してから実行する) */}
                      {menuOpen && (
                        <span
                          onClick={(e) => e.stopPropagation()} // メニュー内操作を行クリックに伝播させない
                          className="absolute top-10 right-2 z-[6] block min-w-[158px] rounded-r2 border border-hairline bg-white p-1 shadow-[0_8px_20px_rgba(17,17,17,0.14)]"
                        >
                          {def.menu.map((item) => (
                            <button
                              key={item.label}
                              onClick={() => {
                                onMoveBook(book.id, kind, item.to);
                                closeMenus();
                              }}
                              className="block w-full rounded-r1 px-2.5 py-2 text-left text-t3 text-charcoal hover:bg-pane-bg"
                            >
                              {item.label}
                            </button>
                          ))}
                          <button
                            onClick={() => {
                              setConfirmBookId(book.id);
                              closeMenus();
                            }}
                            className="block w-full rounded-r1 px-2.5 py-2 text-left text-t3 text-[#C0392B] hover:bg-pane-bg"
                          >
                            読書録を削除
                          </button>
                        </span>
                      )}
                    </div>

                    {/* 読書体験の記録一覧 (§9: 日付+フレーズ+気づきの短い表示を時系列で。
                        0件なら項目自体非表示。タップした記録だけ展開し、
                        取得・保存されていない項目は項目自体を非表示にする) */}
                    {list && list.length > 0 && (
                      <div className="mb-1.5 ml-[52px] mt-0.5 flex flex-col gap-1">
                        {list.map((e) => {
                          const open = openEntryId === e.id;
                          return (
                            <div key={e.id} className="rounded-r1 bg-pane-bg px-2 py-1.5">
                              <button
                                onClick={() => setOpenEntryId(open ? null : e.id)}
                                className="block w-full text-left"
                              >
                                <span className="text-[10px] max-lg:text-[11px] text-ink-soft tabular-nums">{fmt(e.recordedAt)}</span>
                                <p className="m-0 text-[11px] max-lg:text-[12.5px] font-semibold leading-[1.6] text-charcoal">「{e.phrase}」</p>
                                {!open && e.userReflection !== null && (
                                  <p className="m-0 overflow-hidden text-[11px] max-lg:text-[13px] leading-[1.6] text-ink-soft text-ellipsis whitespace-nowrap">
                                    {e.userReflection}
                                  </p>
                                )}
                              </button>
                              {open && (
                                <div className="mt-1 flex flex-col gap-1 text-[11px] max-lg:text-[13px] leading-[1.7] text-charcoal">
                                  {e.contextBefore !== null && (
                                    <p className="m-0 text-ink-soft">前の文脈: {e.contextBefore}</p>
                                  )}
                                  {e.contextAfter !== null && (
                                    <p className="m-0 text-ink-soft">後の文脈: {e.contextAfter}</p>
                                  )}
                                  {e.userReflection !== null && <p className="m-0">{e.userReflection}</p>}
                                  {e.aiComment !== null && e.aiCharacter !== null && (
                                    <p className="m-0">
                                      <span
                                        className={`mr-1 mb-[1px] inline-block h-[7px] w-[7px] rounded-full ${
                                          e.aiCharacter === "orange" ? "bg-orange-brand" : "bg-[#E8C25A]"
                                        }`}
                                      />
                                      （{e.aiCharacter === "orange" ? "オランジェ" : "ゲルプ"}）{e.aiComment}
                                    </p>
                                  )}
                                  {e.excerpt !== null && e.excerpt.length > 0 && (
                                    <div className="border-t border-hairline pt-1 text-ink-soft">
                                      {e.excerpt.map((m, i) => (
                                        <p key={i} className="m-0">
                                          {SPEAKER_LABEL[m.speaker] ?? m.speaker}: {m.message}
                                        </p>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}
