"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import Pane1 from "@/components/Pane1Search";
import Pane2, { PitchState } from "@/components/Pane2Recommend";
import Pane3 from "@/components/Pane3Chat";
import Pane4 from "@/components/Pane4Notes";
import ApiKeySettingsModal from "@/components/ApiKeySettingsModal";
import { AppState, Shelf, appReducer, initialAppState } from "@/lib/appState";
import { getApiKey } from "@/lib/apiKeyStorage";
import { API_KEY_HEADER } from "@/lib/apiKeyHeader";
import { addBook, deleteRecord, loadShelf, saveEntry as saveEntryToDb, updateStatus } from "@/lib/localDb";
import {
  Book,
  ChatMessage,
  Speaker,
  grillDone,
  grillOpening,
  extractPhrase,
  guideMessages,
  isMeaningQuestion,
  isSaveRequest,
  phraseSavedReply,
  readingLimitNotice,
  readingStart,
  refreshNotices,
} from "@/lib/dummyData";

// grill-me API(Gemini接続)のエラー時に表示する再試行案内。
// API接続タスクで必要になった暫定文言(確定文言ではない・transient表示で履歴には残さない)
const grillRetryGuide =
  "ごめんね、いまうまく応答できなかったみたい。少し待ってから、もう一度送ってね。";

// 選書API失敗時の案内(暫定文言・確定文言ではない・transient表示で履歴には残さない)。
// 再試行はgrill会話の継続→再度の選書条件成立で行う(ダミー3冊への自動フォールバックはしない)
const recommendRetryGuide =
  "ごめんね、うまく選書できなかったみたい。もう少し話してから、もう一度試してみてね。";

// 著者探訪API(初回検索)失敗時の案内(暫定文言・確定文言ではない)。Pane2内のオランジェ
// 吹き出し(pane2Notice)に表示する。架空の3冊で埋めない(2026-09-06新設)
const authorSearchFailedNotice =
  "その著者の実在する本をうまく見つけられなかったみたい。別の著者名で試してみてね。";

// 読書支援API失敗時の再試行案内(暫定文言・確定文言ではない・transient表示で履歴には残さない)。
// ダミーの読書支援回答への自動フォールバックはしない
const supportRetryGuide =
  "ごめんね、いまうまく応答できなかったみたい。少し待ってから、もう一度送ってね。";

// 永続保存(Neon)関連の暫定文言(確定文言ではない・transient/一時表示で履歴には残さない)
const shelfLoadFailedNotice =
  "読書録をうまく読み込めなかったみたい。ページを再読み込みして試してみてね。";
const shelfSaveFailedNotice = "読書録への保存がうまくいかなかったみたい。";
const entrySaveFailedGuide =
  "ごめんね、いま読書録にうまく保存できなかったみたい。少し待ってから、もう一度お願いしてみてね。";

// Standalone v1 BYOK: Gemini APIキー未設定時の案内(暫定文言・確定文言ではない)。
// 未設定時はGeminiへの通信(自サーバーへのfetchも含む)を行わず、この案内だけを表示する
const apiKeyMissingGuide = "Gemini APIキーが未設定みたい。右上の鍵アイコンから設定してね。";

/** APIキー未設定を表す専用エラー。fetchAi()はこれをthrowする際にfetch自体を実行しない */
class ApiKeyMissingError extends Error {}

/** AI系API route(grill/support/meaning/recommend/author-books/pitch)共通のfetchラッパー。
    Standalone v1 BYOK: localStorageのキーをヘッダに添付する。キー未設定ならfetch自体を
    実行せず ApiKeyMissingError を投げる(=Geminiにも自サーバーにも通信しない) */
async function fetchAi(path: string, body: unknown): Promise<Response> {
  const apiKey = getApiKey();
  if (apiKey === null) {
    throw new ApiKeyMissingError();
  }
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", [API_KEY_HEADER]: apiKey },
    body: JSON.stringify(body),
  });
}

// モバイル表示(lg未満)でのみ入力フォーカスを外し、iOSのソフトキーボードを確実に閉じる。
// タブ切替・自動Pane遷移・検索完了・余白タップ・モード遷移で呼ぶ(PCのタイピングは妨げない)
const blurOnMobile = () => {
  if (typeof window === "undefined") return;
  if (window.matchMedia("(min-width: 1024px)").matches) return;
  const el = document.activeElement;
  if (el instanceof HTMLElement) el.blur();
};

// AI司書の保存提案(§6B)への承諾判定(暫定パターン・確定仕様ではない)。
// 明確な承諾のみ保存する。それ以外の入力は提案を流して通常の会話として処理する(拒否=保存しない)
const isProposalAcceptance = (text: string): boolean =>
  /^(はい|うん|ええ|ぜひ|お願い|おねがい|いいよ)/.test(text.trim()) || /(保存|残)して/.test(text);

// 書籍一意ID (Ver.1永続保存で確定):
// Google Books volumeIdが取得できた場合は "gb-{volumeId}" を最優先で使用。
// 取れない場合は正規化した書名+著者からLibrary Helper内部ID "lh-{hash}" を生成する
// (内部IDは正式なISBN等としてユーザーに表示しない。ISBN-13は参考カラムで主キー前提にしない)
const bookIdFrom = (title: string, author: string): string => {
  const s = `${title}|${author}`
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　]/g, "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `lh-${Math.abs(h).toString(36)}`;
};

/** ISO日時→ローカルの yyyy-mm-dd (Pane4の日付表示基準) */
const isoToDate = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** 書誌照合結果 (サーバーの共通書誌層BookMetaと同形。未照合はnull) */
interface RecommendedBookMeta {
  googleVolumeId: string | null;
  title: string;
  author: string | null;
  isbn13: string | null;
  publisher: string | null;
  publishedDate: string | null;
  description: string | null;
  coverUrl: string | null;
  averageRating: number | null;
  ratingsCount: number | null;
}

/** 選書API(/api/recommend)・著者探訪API(/api/author-books)の共通の1冊分レスポンス形。
    summary/reasonはGemini選書自身の説明(grill経路のみ確認済み。著者探訪には無いため省略可能。
    toBook()はどちらも読まないため型だけ緩めてある) */
interface RecommendedBook {
  title: string;
  author: string;
  summary?: string;
  reason?: string;
  /** 2文推薦 (サーバー側で実Gemini生成・2文検証済み。null=生成失敗→UIで非表示) */
  twoSentence?: string | null;
  meta?: RecommendedBookMeta | null;
}

/** 熱血プレゼンAPI(/api/pitch)への入力 (サーバーのPitchInputと同形)。
    選書出力(悩みまとめ+3冊)+対象位置+確認済み書誌のみを渡す(未確認情報は含めない) */
interface PitchApiInput {
  needs: string;
  // summary/reasonは選書API自身の説明(grill経路のみ渡せる)。著者探訪は確認済み書誌を
  // 送るため省略する(サーバーの/api/pitchも任意扱い)
  books: { title: string; author: string; summary?: string; reason?: string }[];
  index: number;
  confirmed: {
    title?: string;
    author?: string;
    publisher?: string;
    publishedDate?: string;
    description?: string;
  } | null;
  twoSentence: string | null;
}

// Ver.1表示原則: 書誌APIで確認できた事実だけをBookへ設定する(未確認項目は未設定=UIで非表示。
// 推測・ダミー・AI補完で埋めない)。正式書名・著者は照合できた場合Google Booksを正とする
const toBook = (r: RecommendedBook): Book => {
  const m = r.meta ?? null;
  return {
    // Google Books volumeIdを一意識別の最優先に使う(未照合時は正規化タイトル+著者の内部ID)
    id: m?.googleVolumeId != null ? `gb-${m.googleVolumeId}` : bookIdFrom(r.title, r.author),
    title: m !== null ? m.title : r.title,
    author: m?.author ?? r.author,
    googleVolumeId: m?.googleVolumeId ?? undefined,
    // 2文推薦は実Gemini生成(本番プロンプト+表現品質ルール)。生成・検証に失敗した場合は
    // 未設定=非表示(選書理由やダミー文で代用しない)
    reason: r.twoSentence ?? undefined,
    // 熱血プレゼン(reasonDetail)は設定しない: 展開時に/api/pitchでオンデマンド生成する
    rating: m?.averageRating != null ? m.averageRating.toFixed(1) : undefined,
    reviewCount: m?.ratingsCount ?? undefined,
    coverUrl: m?.coverUrl ?? undefined,
    isbn13: m?.isbn13 ?? undefined,
    publisher: m?.publisher ?? undefined,
    publishedDate: m?.publishedDate ?? undefined,
    description: m?.description ?? undefined,
  };
};

// 列ヘッダー (引継ぎ§6.1: 高さ21px・文字12.5px・白黒線画アイコン12px・静的)
// アイコンはv13モックの線画SVGと同一
const colHeads = [
  {
    label: "探す",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="M20 20l-4.8-4.8" />
      </svg>
    ),
  },
  {
    label: "選ぶ",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="7" width="12" height="13" rx="2" />
        <path d="M8 7V5.5A1.5 1.5 0 019.5 4H18.5A1.5 1.5 0 0120 5.5v9A1.5 1.5 0 0118.5 16H17" />
        <path d="M7.5 13.5l2 2 3.5-4" />
      </svg>
    ),
  },
  {
    label: "会話",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 5h16v10H8l-4 4V5z" />
      </svg>
    ),
  },
  {
    label: "読書録",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 5.5C4 4.7 4.7 4 5.5 4H12v16H5.5A1.5 1.5 0 014 18.5v-13zM20 5.5c0-.8-.7-1.5-1.5-1.5H12v16h6.5c.8 0 1.5-.7 1.5-1.5v-13z" />
      </svg>
    ),
  },
] as const;

// Paneラッパー共通クラス。スマホでは現在タブのPaneのみ表示し、他はdisplay:noneで
// 隠すだけ(マウント維持=v13モックと同じ切替方式)。PCのグリッド配置は変更しない
const paneClass = (i: number, activePane: number) =>
  `min-h-0 min-w-0 overflow-hidden rounded-r3 bg-white shadow-[0_1px_2px_rgba(17,17,17,0.05)] ${
    i === activePane ? "max-lg:mx-2.5 max-lg:mb-2.5 max-lg:flex-1" : "max-lg:hidden"
  }`;

// メイン画面: 4Pane構造 (§6.1: 20:24:36:20 / ページ全体スクロールなし・各Pane内のみスクロール)
// 状態は appState (v13対応の状態モデル) で管理。旧Phase型は廃止済み
export default function MainAppPage() {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const nextId = useRef(1);
  // grill-me API用の会話履歴ミラー(表示用messagesは20往復超で圧縮されるため、
  // API送信用の文脈はここで保持する。transient・案内は含めない)
  const grillLog = useRef<{ speaker: Speaker; message: string }[]>([]);
  // 応答待ちの多重リクエスト防止(待機中の追加送信は履歴へ積み、完了後にまとめて1回で問い合わせる)
  const grillPending = useRef(false);
  const grillDirty = useRef(false);
  // 新しいgrill-me開始で古い応答を破棄するための世代トークン
  const grillRunId = useRef(0);
  // 選書API(/api/recommend)の結果置き場。検索演出の画像境界(最低1周後)で消費する。
  // reasonはAPIキー未設定時のみ付与し、消費時(handleSearchBoundary)で案内文を出し分ける
  const recommendResult = useRef<
    | { status: "idle" | "pending" }
    | { status: "error"; reason?: "api_key_missing" }
    | { status: "ready"; books: Book[] }
  >({ status: "idle" });
  // 古い選書リクエストの遅延応答を破棄するための世代トークン
  const recommendRunId = useRef(0);
  // 著者探訪API(/api/author-books)の結果置き場(2026-09-06新設)。recommendResultと同型で、
  // grillの検索演出と同じ画像境界消費の仕組みを流用する(reasonの用途もrecommendResultと同じ)
  const authorSearchResult = useRef<
    | { status: "idle" | "pending" }
    | { status: "error"; reason?: "api_key_missing" }
    | { status: "ready"; books: Book[] }
  >({ status: "idle" });
  // 古い著者検索リクエストの遅延応答を破棄するための世代トークン
  const authorSearchRunId = useRef(0);
  // 熱血プレゼンAPI(/api/pitch)の入力(選書1回分・書籍IDキー)。選書結果が届いた時点で構築し、
  // 次の選書で丸ごと差し替える(古い選書に対する遅延応答は同一性チェックで破棄)
  const pitchInputs = useRef(new Map<string, PitchApiInput>());
  // 熱血プレゼンの生成状態(書籍IDキー)。Pane2の展開表示が参照する
  const [pitches, setPitches] = useState<Record<string, PitchState>>({});
  // トレンド由来の熱血プレゼンAPI入力を構築する(2026-09-15新設: trendを/api/pitchに
  // 接続する最小対応)。grill/authorは選書結果到着時点(buildGrillSelection/
  // buildAuthorSelection)でpitchInputsを構築するが、trendはappState側の同期reducer
  // (TREND_SELECT/REFRESH_BOOKS)がpane2Booksを直接更新するため、結果を受けてここで
  // 登録する(選書ロジック自体はappState.ts側のまま重複させない)。書誌APIによる
  // 確認は行っていないため confirmed は常にnull、summaryも常にundefined(推測しない)。
  // reasonはTREND_POOLS由来のBook.reasonをそのまま渡す(summaryへコピーしない)
  useEffect(() => {
    if (state.origin !== "trend" || state.pane2Books === null || state.trendCategory === null) return;
    const category = state.trendCategory;
    const currentBooks = state.pane2Books;
    const needs = `「${category}」というジャンルから選んだ本です。`;
    const selection = currentBooks.map((b) => ({ title: b.title, author: b.author, reason: b.reason }));
    currentBooks.forEach((b, i) => {
      pitchInputs.current.set(b.id, {
        needs,
        books: selection,
        index: i,
        confirmed: null,
        twoSentence: b.reason ?? null,
      });
    });
  }, [state.origin, state.pane2Books, state.trendCategory]);
  // 非同期応答の受け入れ判定用に最新のsessionTypeを参照できるようにする
  const sessionTypeRef = useRef(state.sessionType);
  useEffect(() => {
    sessionTypeRef.current = state.sessionType;
  }, [state.sessionType]);
  // 読書支援API用: 非同期応答の受け入れ判定(本の切替検知)と、
  // 待機中に追加送信があった場合の最新履歴再問い合わせのための最新値ミラー
  const sessionBookIdRef = useRef(state.sessionBookId);
  useEffect(() => {
    sessionBookIdRef.current = state.sessionBookId;
  }, [state.sessionBookId]);
  const messagesRef = useRef(state.messages);
  useEffect(() => {
    messagesRef.current = state.messages;
  }, [state.messages]);
  // 読書支援の応答待ち多重リクエスト防止(grill-meと同じ方式)
  const supportPending = useRef(false);
  const supportDirty = useRef(false);
  // AI司書からの保存提案(§6B)。次のユーザー入力で消費する(承諾のみ保存・それ以外は流す)。
  // 自動保存は禁止 — 保存はユーザーの明確な承諾または明示依頼のみ
  const pendingProposal = useRef<{ bookId: string; phrase: string } | null>(null);
  // DB水和の一度きり実行ガード
  const hydrated = useRef(false);
  // 段階4-1 スマホ表示 (§6.1: 1画面1Pane・列ヘッダーがタブ化。境界幅はv13モックの
  // 640px判定だったが、iPhone横向き(〜932px)で4Paneが崩れるため2026-08-26に
  // 境界をTailwind標準lg(1024px)へ変更=スマホは縦横とも1Pane。表示切替のみの画面状態のため
  // appReducerには持たせない。非表示Paneもマウントは維持する(タブ切替で状態を失わない)
  const [activePane, setActivePane] = useState(0);
  // Standalone v1 BYOK: Gemini APIキー設定モーダルの開閉(キー本体はappStateに持たせない)。
  // apiKeySettingsKeyは開くたびに変えてモーダルを再マウントし、入力欄・保存状態を初期化する
  // (useEffect内でのsetState同期呼び出しを避けるため)
  const [apiKeySettingsOpen, setApiKeySettingsOpen] = useState(false);
  const [apiKeySettingsKey, setApiKeySettingsKey] = useState(0);

  // 段階4-2 操作に応じた自動Pane遷移。v13モックのswitchPane同様、スマホ表示時のみ
  // 動作する(PCではactivePaneを変更しない)。遷移はv13で実際に自動遷移している
  // 6操作のみ: grill-me開始→会話 / トレンド選択→選ぶ / 著者候補選択→選ぶ /
  // grill選書条件成立(検索演出開始)→選ぶ / この本に決めた(追加成功時のみ)→会話 /
  // Pane4読書中クリック(supportMode=true時のみ)→会話。
  // 既存のappReducer・セッション状態には触れず、表示上のactivePaneだけを切り替える
  const autoSwitchPane = (i: number) => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(min-width: 1024px)").matches) return; // PC表示では何もしない
    blurOnMobile(); // 遷移時にキーボードを閉じる(iOS)
    setActivePane(i);
  };

  // iOSキーボード対応: 表示領域(visualViewport)の高さをCSS変数--app-hへ反映し、
  // アプリ全体をキーボードを除いた高さに収める(下部入力バーがキーボードに隠れない)。
  // あわせて、iOSが入力フォーカス時にページごとスクロールして上部が切れるのを常に戻す
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => {
      document.documentElement.style.setProperty("--app-h", `${Math.round(vv.height)}px`);
      if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    window.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      window.removeEventListener("scroll", apply);
      document.documentElement.style.removeProperty("--app-h");
    };
  }, []);
  // Pane4上部の案内吹き出し (約5秒の一時表示・履歴には保存しない)
  const [p4Notice, setP4Notice] = useState<string | null>(null);
  const p4NoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 開発時の検証用に状態(読み取り専用)とdispatchを公開する (本番ビルドでは無効。UIには影響しない)
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      (window as unknown as { __appState?: AppState }).__appState = state;
      (window as unknown as { __appDispatch?: typeof dispatch }).__appDispatch = dispatch;
    }
  }, [state, dispatch]);

  const append = (items: Omit<ChatMessage, "id">[]) => {
    dispatch({
      type: "APPEND_MESSAGES",
      items: items.map((m) => ({ ...m, id: nextId.current++ })),
    });
  };

  // Pane1: grill-me開始 (新規grill-meの開始入口はここだけ)
  const handleStartGrill = () => {
    if (state.sessionType === "grill" || state.searching) return;
    dispatch({ type: "START_GRILL" });
    grillRunId.current++;
    grillLog.current = grillOpening.map((m) => ({ speaker: m.speaker, message: m.message }));
    append(grillOpening);
    autoSwitchPane(2); // v13: grill-me開始→会話Paneへ
  };

  // grill-me会話のAPI問い合わせ (サーバー経由でGeminiを呼ぶ。キーはサーバー側のみ)。
  // 応答待ち中に追加送信があった場合は、現在の応答後に最新履歴でまとめて1回だけ再問い合わせる
  const runGrillReply = async () => {
    if (grillPending.current) {
      grillDirty.current = true;
      return;
    }
    grillPending.current = true;
    const runId = grillRunId.current;
    try {
      do {
        grillDirty.current = false;
        try {
          const res = await fetchAi("/api/grill", { history: grillLog.current });
          if (!res.ok) throw new Error(`grill api ${res.status}`);
          const data: {
            dialogue: { speaker: "orange" | "gelb"; message: string }[];
            done: boolean;
          } = await res.json();
          // 応答が返る前にセッションを離れた/新しいgrill-meを開始した場合は破棄
          if (runId !== grillRunId.current || sessionTypeRef.current !== "grill") return;
          grillLog.current.push(...data.dialogue);
          append(data.dialogue);
          lastAI.current = data.dialogue[data.dialogue.length - 1].speaker;
          if (data.done) {
            // §18: 条件が揃ったとAIが判断した時点で選書へ(検索演出はv13同様1.5秒後に開始)。
            // 選書API(実Gemini)は演出と並行して即時に問い合わせ、結果は演出の
            // 最低1周(約6秒)経過後の画像境界で受け取る(§6.4・2026-08-23微修正仕様)
            requestRecommend();
            setTimeout(() => {
              dispatch({ type: "START_SEARCHING" });
              autoSwitchPane(1);
            }, 1500);
          }
        } catch (error) {
          if (runId !== grillRunId.current || sessionTypeRef.current !== "grill") return;
          // transient=履歴に残さない簡潔な再試行案内(APIキー未設定時は専用の案内に差し替え)
          appendGuide(error instanceof ApiKeyMissingError ? apiKeyMissingGuide : grillRetryGuide);
        }
      } while (grillDirty.current);
    } finally {
      grillPending.current = false;
    }
  };

  // 原則1ターン1キャラクター(§25: 交互に返答)のための直前AI話者
  const lastAI = useRef<"orange" | "gelb">("gelb");

  // 表示中メッセージをAPI送信用の会話履歴へ変換する(transientの案内・受けとめは含めない)。
  // 20往復超で圧縮済みの場合は保持中の直近原文のみ送る(要約のAPI文脈利用はVer.1では未実装)
  const toApiHistory = (msgs: ChatMessage[]) =>
    msgs
      .filter(
        (m): m is ChatMessage & { speaker: "user" | "orange" | "gelb" } =>
          !m.transient && (m.speaker === "user" || m.speaker === "orange" || m.speaker === "gelb"),
      )
      .map((m) => ({ speaker: m.speaker, message: m.message }));

  // 読書支援会話のAPI問い合わせ (サーバー経由でGeminiを呼ぶ。キーはサーバー側のみ)。
  // 応答待ち中に追加送信があった場合は、現在の応答後に最新履歴でまとめて1回だけ再問い合わせる。
  // 応答が返る前に別の本へ切替/セッションを離れた場合は破棄する(誤った本の会話に混ぜない)
  const runSupportReply = async (
    bookId: string,
    book: { title: string; author: string },
    firstHistory: { speaker: Speaker; message: string }[],
  ) => {
    if (supportPending.current) {
      supportDirty.current = true;
      return;
    }
    supportPending.current = true;
    let history = firstHistory;
    try {
      do {
        supportDirty.current = false;
        try {
          const res = await fetchAi("/api/support", {
            bookTitle: book.title,
            bookAuthor: book.author,
            history,
          });
          if (!res.ok) throw new Error(`support api ${res.status}`);
          const data: {
            dialogue: { speaker: "orange" | "gelb"; message: string }[];
            saveProposal?: { phrase: string } | null;
          } = await res.json();
          if (sessionTypeRef.current !== "support" || sessionBookIdRef.current !== bookId) return;
          append(data.dialogue);
          lastAI.current = data.dialogue[data.dialogue.length - 1].speaker;
          // AI司書からの保存提案(§6B)。次のユーザー入力で承諾された場合のみ保存する。
          // 提案が無い応答では以前の提案を持ち越さない(古い提案への誤承諾を防ぐ)
          pendingProposal.current =
            data.saveProposal != null ? { bookId, phrase: data.saveProposal.phrase } : null;
        } catch (error) {
          if (sessionTypeRef.current !== "support" || sessionBookIdRef.current !== bookId) return;
          // transient=履歴に残さない暫定の再試行案内(APIキー未設定時は専用の案内に差し替え)
          appendGuide(error instanceof ApiKeyMissingError ? apiKeyMissingGuide : supportRetryGuide);
        }
        // 再問い合わせ時は最新の表示履歴から組み立て直す(待機中の追加送信を含む)
        history = toApiHistory(messagesRef.current);
      } while (supportDirty.current);
    } finally {
      supportPending.current = false;
    }
  };

  // 案内は一時表示専用(transient) — 正式なセッション履歴には保存しない(§6.7)
  const appendGuide = (message: string) => {
    append([{ speaker: "orange", message, transient: true }]);
    lastAI.current = "orange";
  };

  // Pane3: 送信 — 入力ガード5分岐 (段階2-2)。判定は明示状態(sessionType/supportMode/
  // justDecided/sessionBookId)のみを使用する。CSSクラス等の表示状態では判定しない。
  // 「読書支援モードではない」≠「grill-me開始済み」(②はPane1からの正式開始のみ)
  const handleSend = (text: string) => {
    append([{ speaker: "user", message: text }]);

    // 分岐3: 読書支援モード・本未選択 (§6.5) — セッションを開始せず案内のみ
    if (state.supportMode && state.sessionBookId === null) {
      appendGuide(guideMessages.selectBook);
      return;
    }

    // 分岐5: 決めた直後 (supportMode=false・justDecided=true) — 読書支援会話として
    // 処理せず「読書支援へ」の利用案内のみ。フレーズ保存・意味質問もここで遮断される
    if (!state.supportMode && state.justDecided) {
      appendGuide(guideMessages.useSupport);
      return;
    }

    // 分岐1: 通常初期 (sessionType===null・supportMode=false・justDecided=false) —
    // 何を入力しても案内のみ。grill-me開始・選書・Pane2/Pane4変更は行わない
    if (!state.supportMode && state.sessionType !== "grill") {
      appendGuide(guideMessages.initial);
      return;
    }

    // 分岐2: grill-me開始済み (sessionType==="grill") — Gemini API(サーバー経由)で会話
    if (state.sessionType === "grill" && !state.searching) {
      // 意味をたずねる (§6.5: ②grill-me中はその場で説明。会話の進行は消費しない)。
      // 実Gemini(意味質問API・書籍なし=会話文脈のみ)で回答し、文脈維持のためQ&Aを履歴に積む
      if (isMeaningQuestion(text)) {
        grillLog.current.push({ speaker: "user", message: text });
        const runId = grillRunId.current;
        runMeaningReply(
          null,
          [...grillLog.current],
          () => runId === grillRunId.current && sessionTypeRef.current === "grill",
          (dialogue) => grillLog.current.push(...dialogue),
        );
        return;
      }
      grillLog.current.push({ speaker: "user", message: text });
      void runGrillReply();
      return;
    }

    // 分岐4: 読書支援モード・本選択済み (supportMode=true・sessionBookId!==null)
    if (state.supportMode && state.sessionBookId !== null) {
      // 保存時の会話抜粋: 直近の最小限の前後会話+今回の入力(会話全文は保存しない)
      const excerptNow = () =>
        [...toApiHistory(state.messages), { speaker: "user" as const, message: text }].slice(-6);

      // AI司書の保存提案(§6B)は次の1入力で消費する。明確な承諾のみDBへ保存し、
      // それ以外(拒否・別の話)は何も保存せず通常の会話処理へ流す(自動保存禁止)
      const proposal = pendingProposal.current;
      pendingProposal.current = null;
      if (
        proposal !== null &&
        proposal.bookId === state.sessionBookId &&
        isProposalAcceptance(text)
      ) {
        append([{ speaker: "orange", message: phraseSavedReply }]);
        lastAI.current = "orange";
        saveEntry(proposal.bookId, proposal.phrase, excerptNow());
        return;
      }

      // 1入力につき主要処理は1つ (§: 保存意図が明確なら保存を優先し、意味質問と二重処理しない)
      // フレーズ保存 (§6.5=トリガーA): 明示依頼のみ、その本(書籍ID)に紐づけてDBへ保存し短く応答。
      // 保存依頼・応答とも通常の読書支援会話としてセッション履歴に残る
      if (isSaveRequest(text)) {
        append([{ speaker: "orange", message: phraseSavedReply }]);
        lastAI.current = "orange";
        saveEntry(state.sessionBookId, extractPhrase(text), excerptNow());
        return;
      }
      // 意味をたずねる (§6.5: ③正式な読書支援中はその場で説明。専用モードにしない)。
      // 実Gemini(意味質問API・対象書籍の書名/著者つき)で回答する
      if (isMeaningQuestion(text)) {
        const meaningBookId = state.sessionBookId;
        const meaningBook =
          [...state.shelf.reading, ...state.shelf.done, ...state.shelf.suspended].find(
            (b) => b.id === meaningBookId,
          ) ?? null;
        runMeaningReply(
          meaningBook !== null ? { title: meaningBook.title, author: meaningBook.author } : null,
          [...toApiHistory(state.messages), { speaker: "user", message: text }],
          () => sessionTypeRef.current === "support" && sessionBookIdRef.current === meaningBookId,
        );
        return;
      }
      // 通常の読書支援入力 — Gemini API(サーバー経由)で応答する。
      // 対象書籍は読書録から引く(読書中以外へ移動済みでもセッション継続中は対象のまま)。
      // 書誌はShelfBook保持の書名・著者のみ渡す(未確認情報は渡さない・推測もさせない)
      const bookId = state.sessionBookId;
      const book = [...state.shelf.reading, ...state.shelf.done, ...state.shelf.suspended].find(
        (b) => b.id === bookId,
      );
      if (!book) return; // 対象書籍が見つからない場合は何もしない(削除時はセッション終了済みのため通常到達しない)
      // 送信時点の表示履歴+今回のユーザー発言(stateへの反映は非同期のため明示的に連結)
      void runSupportReply(bookId, book, [
        ...toApiHistory(state.messages),
        { speaker: "user", message: text },
      ]);
      return;
    }
  };

  // 意味質問のAPI問い合わせ (§6.5: 専用モードなし・grill中/読書支援中の両方で動作)。
  // 検索グラウンディングなし(会話文脈→書籍情報→一般知識の優先順位で回答)。
  // accept=応答受け入れ判定(セッション離脱・本切替・新grill開始時は破棄)。
  // onDialogue=表示以外の後処理(grill中はAPI用履歴grillLogへの反映)。
  // 失敗時は既存の暫定再試行案内のみ(ダミーの意味説明へのフォールバックなし)
  const runMeaningReply = (
    book: { title: string; author: string } | null,
    history: { speaker: Speaker; message: string }[],
    accept: () => boolean,
    onDialogue?: (dialogue: { speaker: "orange" | "gelb"; message: string }[]) => void,
  ) => {
    void (async () => {
      try {
        const res = await fetchAi("/api/meaning", {
          bookTitle: book?.title ?? null,
          bookAuthor: book?.author ?? null,
          history,
        });
        if (!res.ok) throw new Error(`meaning api ${res.status}`);
        const data: { dialogue: { speaker: "orange" | "gelb"; message: string }[] } =
          await res.json();
        if (!accept()) return;
        append(data.dialogue);
        lastAI.current = data.dialogue[data.dialogue.length - 1].speaker;
        onDialogue?.(data.dialogue);
      } catch (error) {
        if (!accept()) return;
        // transient=履歴に残さない暫定の再試行案内(grillと同文言。APIキー未設定時は専用案内)
        appendGuide(error instanceof ApiKeyMissingError ? apiKeyMissingGuide : supportRetryGuide);
      }
    })();
  };

  // 選書API(実Gemini・検索グラウンディング有効)への問い合わせ。
  // 文脈として送るのはgrill-me会話履歴(grillLog: 確定初回発言+ユーザー/AIの全発言。
  // transientの案内は含まれない)。20往復超要約のAPI活用は未接続のため全文を送る
  const requestRecommend = () => {
    const runId = ++recommendRunId.current;
    recommendResult.current = { status: "pending" };
    void (async () => {
      try {
        const res = await fetchAi("/api/recommend", { history: grillLog.current });
        if (!res.ok) throw new Error(`recommend api ${res.status}`);
        const data: { books: RecommendedBook[]; needs?: string } = await res.json();
        if (runId !== recommendRunId.current) return; // 古いリクエストの応答は破棄
        const books = data.books.map(toBook);
        // 熱血プレゼン用の入力を選書1回分まとめて構築する(生成自体は展開時オンデマンド)。
        // 悩みまとめが空の場合はgrill会話のユーザー発言で代替(選書APIの2文推薦と同じ方針)
        const needs =
          typeof data.needs === "string" && data.needs.trim() !== ""
            ? data.needs.trim()
            : grillLog.current
                .filter((t) => t.speaker === "user")
                .map((t) => t.message)
                .join(" / ");
        const selection = data.books.map((b) => ({
          title: b.title,
          author: b.author,
          summary: b.summary,
          reason: b.reason,
        }));
        const inputs = new Map<string, PitchApiInput>();
        data.books.forEach((b, i) => {
          const m = b.meta ?? null;
          inputs.set(books[i].id, {
            needs,
            books: selection,
            index: i,
            // 書誌APIで確認できた事実のみ(未確認項目は渡さない=推測・捏造をさせない)
            confirmed:
              m === null
                ? null
                : {
                    title: m.title,
                    author: m.author ?? undefined,
                    publisher: m.publisher ?? undefined,
                    publishedDate: m.publishedDate ?? undefined,
                    description: m.description ?? undefined,
                  },
            twoSentence: b.twoSentence ?? null,
          });
        });
        pitchInputs.current = inputs;
        setPitches({}); // 前回選書分の生成結果・状態は破棄
        recommendResult.current = { status: "ready", books };
      } catch (error) {
        if (runId !== recommendRunId.current) return;
        recommendResult.current = {
          status: "error",
          reason: error instanceof ApiKeyMissingError ? "api_key_missing" : undefined,
        };
      }
    })();
  };

  // 著者探訪API(/api/author-books)の応答から、表示用Book[]と熱血プレゼンAPI用の入力を
  // 組み立てる(2026-09-06新設)。実在書籍のみが対象で書誌はサーバー側で確認済みのため、
  // grillと同様に事前構築できる(トレンドのようなフォールバック合成は不要)
  const buildAuthorSelection = (authorName: string, data: { books: RecommendedBook[] }) => {
    const books = data.books.map(toBook);
    const needs = `「${authorName}」の作品から選んだ本です。`;
    const selection = data.books.map((b) => ({ title: b.title, author: b.author }));
    const inputs = new Map<string, PitchApiInput>();
    data.books.forEach((b, i) => {
      const m = b.meta ?? null;
      inputs.set(books[i].id, {
        needs,
        books: selection,
        index: i,
        // 書誌APIで確認できた事実のみ(未確認項目は渡さない=推測・捏造をさせない)
        confirmed:
          m === null
            ? null
            : {
                title: m.title,
                author: m.author ?? undefined,
                publisher: m.publisher ?? undefined,
                publishedDate: m.publishedDate ?? undefined,
                description: m.description ?? undefined,
              },
        twoSentence: b.twoSentence ?? null,
      });
    });
    return { books, inputs };
  };

  // 著者探訪: 既読(読書中・完読・中断)の除外リストを組み立てる(2026-09-06確定)。
  // トレンド/grillの既読除外(appState.tsのexcludedIds)と同じ3状態を対象にする
  // (当初は読書中・完読のみに限定していたが、ユーザー指示によりexcludedIdsと同じ
  // 範囲へ統一・中断も対象に追加。deletedBookIdsは書名・著者を保持していないため
  // このリストの対象外=既存のexcludedIdsとの唯一の差分)。
  // idが"gb-"で始まる場合はGoogle Books volumeIdを優先情報として渡す(書名一致より確実に
  // 同一書籍を判定できる。/api/author-booksのmatchesExcludedがID優先で判定する)
  const authorShelfExclusions = (): { title: string; author: string; googleVolumeId?: string }[] =>
    [...state.shelf.reading, ...state.shelf.done, ...state.shelf.suspended].map((b) => ({
      title: b.title,
      author: b.author,
      googleVolumeId: b.id.startsWith("gb-") ? b.id.slice(3) : undefined,
    }));

  // 著者探訪: 実書籍検索(/api/author-books)への問い合わせ(2026-09-06新設)。
  // 候補著者の選択直後に呼び、結果はgrillと同じ検索演出の画像境界(最低1周後)で消費する
  // (handleSearchBoundary参照。§6.4: 検索演出を著者探訪にも再利用する確定方針)
  const requestAuthorSearch = (authorName: string) => {
    const runId = ++authorSearchRunId.current;
    authorSearchResult.current = { status: "pending" };
    void (async () => {
      try {
        const res = await fetchAi("/api/author-books", {
          authorName,
          exclude: authorShelfExclusions(),
        });
        if (!res.ok) throw new Error(`author-books api ${res.status}`);
        const data: { books: RecommendedBook[] } = await res.json();
        if (runId !== authorSearchRunId.current) return; // 古いリクエストの応答は破棄
        const { books, inputs } = buildAuthorSelection(authorName, data);
        pitchInputs.current = inputs;
        setPitches({}); // 前回検索分の生成結果・状態は破棄
        authorSearchResult.current = { status: "ready", books };
      } catch (error) {
        if (runId !== authorSearchRunId.current) return;
        authorSearchResult.current = {
          status: "error",
          reason: error instanceof ApiKeyMissingError ? "api_key_missing" : undefined,
        };
      }
    })();
  };

  // 著者探訪の「別の3冊にお願い」(2026-09-06新設): 直前3冊を除外して同じ著者を
  // 再検索する。grillの別の3冊と同様、検索演出(searching)は使わずPane2側の既存
  // ボタン無効化(700ms)のみで待機を表現する(既存UIは変更しない)
  const requestAuthorRefresh = () => {
    const currentBooks = state.pane2Books;
    const authorName = state.authorName;
    if (currentBooks === null || authorName === null) return;
    const runId = ++authorSearchRunId.current;
    void (async () => {
      try {
        const res = await fetchAi("/api/author-books", {
          authorName,
          // 既読(読書中・完読)に加え、直前3冊も重複回避のため除外する。
          // 直前3冊はgoogleVolumeIdが判明していれば併せて渡す(書名一致より確実)
          exclude: [
            ...authorShelfExclusions(),
            ...currentBooks.map((b) => ({
              title: b.title,
              author: b.author,
              googleVolumeId: b.googleVolumeId,
            })),
          ],
        });
        if (!res.ok) throw new Error(`author-books api ${res.status}`);
        const data: { books: RecommendedBook[] } = await res.json();
        if (runId !== authorSearchRunId.current) return; // 古いリクエストの応答は破棄
        const { books, inputs } = buildAuthorSelection(authorName, data);
        pitchInputs.current = inputs;
        setPitches({}); // 前回検索分の生成結果・状態は破棄
        dispatch({ type: "AUTHOR_BOOKS_READY", books });
      } catch (error) {
        if (runId !== authorSearchRunId.current) return;
        // 差し替え候補が見つからない場合も含め、既存のn=0案内(refreshNotices.zero)と
        // 同じ趣旨の文言をPane2内に表示する(架空の本で埋めない)。APIキー未設定時は専用の案内
        dispatch({
          type: "AUTHOR_SEARCH_FAILED",
          notice: error instanceof ApiKeyMissingError ? apiKeyMissingGuide : refreshNotices.zero,
        });
      }
    })();
  };

  // Pane2: 熱血プレゼンの生成依頼(「この本の魅力を見る」展開時)。API選書本のみ対象。
  // 生成済み・生成中は何もしない(失敗後の再展開は再試行)。応答はダミー文で代用せず、
  // 失敗時はPane2側の暫定案内表示のみ(§確認できないものは非表示の原則)
  const handleRequestPitch = (bookId: string) => {
    const current = pitches[bookId];
    if (current !== undefined && current.status !== "error") return;
    const payload = pitchInputs.current.get(bookId);
    if (payload === undefined) {
      // 入力が無い本(想定外)は失敗状態にする(生成中表示のまま止めない)
      setPitches((p) => ({ ...p, [bookId]: { status: "error" } }));
      return;
    }
    setPitches((p) => ({ ...p, [bookId]: { status: "loading" } }));
    void (async () => {
      try {
        const res = await fetchAi("/api/pitch", payload);
        if (!res.ok) throw new Error(`pitch api ${res.status}`);
        const data: { pitch: string } = await res.json();
        // 応答までに新しい選書で候補が差し替わっていた場合は破棄(同一性チェック)
        if (pitchInputs.current.get(bookId) !== payload) return;
        setPitches((p) => ({ ...p, [bookId]: { status: "ready", text: data.pitch } }));
      } catch (error) {
        if (pitchInputs.current.get(bookId) !== payload) return;
        // Pane2のプレゼン欄は既存の汎用失敗文言のまま(カード内テキストは変更しない)。
        // APIキー未設定はPane4の案内で個別に知らせる(showP4Notice=既存の一時案内の仕組みを流用)
        if (error instanceof ApiKeyMissingError) showP4Notice(apiKeyMissingGuide);
        setPitches((p) => ({ ...p, [bookId]: { status: "error" } }));
      }
    })();
  };

  // Pane2: 検索演出の画像境界(最低1周=約6秒経過後・約2秒ごと)での切替判定。
  // 結果取得済みなら3冊表示へ(=次の自然な切替タイミング)。未取得なら演出をそのまま継続。
  // 失敗確定なら演出を終了して案内のみ(ダミー3冊への自動フォールバックはしない)。
  // 2026-09-06確定: 著者探訪の実書籍検索も同じ検索演出を使うため、進行中の依頼が
  // grill/著者探訪のどちらかをstate.originで判定し、対応する結果置き場を消費する
  const handleSearchBoundary = () => {
    if (state.origin === "author") {
      const r = authorSearchResult.current;
      if (r.status === "ready") {
        authorSearchResult.current = { status: "idle" };
        blurOnMobile(); // 検索完了時にキーボードを閉じる(iOS)
        dispatch({ type: "AUTHOR_BOOKS_READY", books: r.books });
        return;
      }
      if (r.status === "error") {
        authorSearchResult.current = { status: "idle" };
        dispatch({
          type: "AUTHOR_SEARCH_FAILED",
          notice: r.reason === "api_key_missing" ? apiKeyMissingGuide : authorSearchFailedNotice,
        });
      }
      // pending中は何もしない(同じ3枚の演出が継続する)
      return;
    }
    const r = recommendResult.current;
    if (r.status === "ready") {
      recommendResult.current = { status: "idle" };
      blurOnMobile(); // 検索完了時にキーボードを閉じる(iOS)
      dispatch({ type: "GRILL_BOOKS_READY", books: r.books });
      append(grillDone);
      lastAI.current = "orange";
      // 3冊表示後もgrill会話は継続可能(§20)のため、完了メッセージもAPI用履歴に積む
      grillLog.current.push(...grillDone.map((m) => ({ speaker: m.speaker, message: m.message })));
      return;
    }
    if (r.status === "error") {
      recommendResult.current = { status: "idle" };
      dispatch({ type: "SEARCH_FAILED" });
      // transient=履歴に残さない暫定の再試行案内(APIキー未設定時は専用の案内に差し替え)
      appendGuide(r.reason === "api_key_missing" ? apiKeyMissingGuide : recommendRetryGuide);
    }
    // pending中は何もしない(同じ3枚の演出が継続する)
  };

  // Pane2: 「この本に決めた」= どの状態から押しても「読書中への登録」(§6.4・v12確定仕様)。
  // 上限3冊・重複ID・成功時の状態遷移はreducer(DECIDE_BOOK)が判定する。
  // 受けとめメッセージはtransient(一時表示専用)としてどのセッション履歴にも保存しない
  const handleDecideBook = (book: Book) => {
    // v13: 追加成功時のみ会話Paneへ自動遷移(上限3冊・重複IDで追加されない場合は遷移しない)。
    // 成否判定はreducer(DECIDE_BOOK)と同一条件を参照するのみで、状態遷移自体はreducerに任せる
    const willAdd =
      !state.shelf.reading.some((b) => b.id === book.id) && state.shelf.reading.length < 3;
    dispatch({
      type: "DECIDE_BOOK",
      book,
      notice: {
        id: nextId.current++,
        speaker: "orange",
        message: readingStart(book.title)[0].message,
        transient: true,
      },
    });
    lastAI.current = "orange";
    if (willAdd) {
      autoSwitchPane(2);
      // DBへ保存 (books upsert + reading_records)。書誌は確認できた項目のみ(null=未確認のまま)。
      // sourceは選書経路(grill/trend/author)。経路不明時のみmanual。
      // Standalone段階2-1B: IndexedDB(localDb.addBook)へ置き換え済み(/api/shelfは呼ばない)
      void (async () => {
        try {
          const { recordId } = await addBook(
            {
              id: book.id,
              title: book.title,
              author: book.author,
              googleVolumeId: book.googleVolumeId ?? null,
              isbn13: book.isbn13 ?? null,
              publisher: book.publisher ?? null,
              publishedDate: book.publishedDate ?? null,
              coverUrl: book.coverUrl ?? null,
            },
            state.origin ?? "manual",
          );
          dispatch({
            type: "SET_RECORD",
            bookId: book.id,
            record: { id: recordId, source: state.origin ?? "manual" },
          });
        } catch (error) {
          console.error("shelf write failed", error);
          showP4Notice(shelfSaveFailedNotice);
        }
      })();
    }
  };

  // Pane4「読書中」クリック (§6.5):
  // supportMode=false → 読書録上部にオランジェの案内吹き出しを約5秒表示するのみ
  //   (対象設定・履歴読込・セッション開始/再開・会話状態変更は一切しない)
  // supportMode=true → その本のセッションを開始/再開 (履歴があれば続きから)
  // Pane4上部の案内吹き出しを約5秒表示する (v13 showP4Notice相当・履歴には保存しない)
  const showP4Notice = (text: string) => {
    setP4Notice(text);
    if (p4NoticeTimer.current !== null) clearTimeout(p4NoticeTimer.current);
    p4NoticeTimer.current = setTimeout(() => setP4Notice(null), 5000);
  };

  // 起動時のDB水和 (Standalone段階2-1A: IndexedDB読み取りに置き換え済み)。
  // DB=読書録の正本(リロード後もここから復元される)。失敗時は空のまま+一時案内のみ。
  // loadShelf()はHYDRATE_SHELFへそのまま渡せる形({shelf, records, entries})を返す
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    void (async () => {
      try {
        const { shelf, records, entries } = await loadShelf();
        dispatch({ type: "HYDRATE_SHELF", shelf, records, entries });
      } catch (error) {
        console.error("shelf hydration failed", error);
        showP4Notice(shelfLoadFailedNotice); // 暫定文言・一時表示のみ(ダミーデータでは埋めない)
      }
    })();
  });

  // 読書体験の記録(reading_entries)の保存。保存トリガーはユーザーの明示依頼(A)または
  // AI司書の保存提案への承諾(B)のみ。会話全文は送らず、直近の最小限の抜粋だけを渡す。
  // Standalone段階2-1D: DB保存部分のみIndexedDB(localDb.saveEntry)へ移行済み(/api/entriesは
  // 呼ばない)。AI生成(userReflection/contextBefore/contextAfter/aiComment/aiCharacterの抽出)は
  // 今回のスコープ外のため、これらは常にnullのまま保存される(旧APIのAI抽出失敗時と同じ状態)。
  // excerptの要素speakerは実際には常に"user"|"orange"|"gelb"に絞られたものが渡される
  // (呼び出し元はtoApiHistory等で"system"を除外済み)。Speaker型は"system"を含む広い型のため
  // 値は変えずに型だけ narrow する
  const saveEntry = (bookId: string, phrase: string, excerpt: { speaker: Speaker; message: string }[]) => {
    void (async () => {
      try {
        const entry = await saveEntryToDb({
          bookId,
          phrase,
          excerpt: excerpt as { speaker: "user" | "orange" | "gelb"; message: string }[],
        });
        dispatch({ type: "ADD_ENTRY", entry });
      } catch (error) {
        console.error("entry save failed", error);
        // 保存失敗の暫定案内(履歴に残さない)。セッションを離れていたらPane4側に表示
        if (sessionTypeRef.current === "support" && sessionBookIdRef.current === bookId) {
          appendGuide(entrySaveFailedGuide);
        } else {
          showP4Notice(shelfSaveFailedNotice);
        }
      }
    })();
  };

  const handleReadingClick = (bookId: string) => {
    if (!state.supportMode) {
      // 文言はPane3の決めた直後案内と共通利用 (PC2行基本は表示側で改行)
      showP4Notice(guideMessages.useSupport.replace("は、「会話」", "は、\n「会話」"));
      return;
    }
    const book = state.shelf.reading.find((b) => b.id === bookId);
    if (!book) return;
    dispatch({
      type: "OPEN_SUPPORT_SESSION",
      bookId,
      opening: {
        id: nextId.current++,
        speaker: "orange",
        message: `『${book.title}』の続きを一緒に読もう!今日はどのあたりを読んでいるの?`,
      },
    });
    lastAI.current = "orange";
    // v13: supportMode=true時の読書中クリックは、同一本の再クリック(セッション維持)・
    // 新規開始・再開のいずれも会話Paneへ自動遷移する
    autoSwitchPane(2);
  };

  // Pane4「…」メニューの状態変更 (§6.6)。読書中上限3冊(§6.4)により「読書中へ戻す」が
  // 拒否される場合は状態を変更せず、既存の確定文言を既存のPane4案内吹き出しで表示する。
  // 自動遷移は追加しない(v13に存在しないため)。supportLogs・phrasesには触れない(§8未確定)
  const handleMoveBook = (bookId: string, from: keyof Shelf, to: keyof Shelf) => {
    if (to === "reading" && from !== "reading" && state.shelf.reading.length >= 3) {
      showP4Notice(readingLimitNotice);
      return;
    }
    dispatch({ type: "MOVE_BOOK", bookId, from, to });
    // DBの状態も更新 (アプリ内done=DB completed)。記録未保存の本(保存失敗直後等)は書き込みなし。
    // Standalone段階2-1C: IndexedDB(localDb.updateStatus)へ置き換え済み(/api/shelfは呼ばない)
    const record = state.records[bookId];
    if (record !== undefined && from !== to) {
      void (async () => {
        try {
          await updateStatus(record.id, to === "done" ? "completed" : to);
        } catch (error) {
          console.error("shelf write failed", error);
          showP4Notice(shelfSaveFailedNotice);
        }
      })();
    }
  };

  // Pane4「…」メニューの削除 (確認吹き出しで［削除する］確定後のみ呼ばれる)。
  // 削除の整合(shelf/supportLogs/phrases/deletedBookIds/セッション終了/justDecided/上限注意)は
  // reducer(DELETE_BOOK)が一貫して扱う。自動Pane遷移は行わない
  const handleDeleteBook = (bookId: string) => {
    // reducerがrecords[bookId]を消す前にDB記録IDを取得しておく
    const record = state.records[bookId];
    dispatch({ type: "DELETE_BOOK", bookId });
    // DB側も削除 (reading_entriesも一緒に削除・既存確定仕様どおり元に戻せない)。
    // Standalone段階2-1C: IndexedDB(localDb.deleteRecord)へ置き換え済み(/api/shelfは呼ばない)
    if (record !== undefined) {
      void (async () => {
        try {
          await deleteRecord(record.id);
        } catch (error) {
          console.error("shelf write failed", error);
          showP4Notice(shelfSaveFailedNotice);
        }
      })();
    }
  };

  return (
    // 高さ: visualViewport追従の--app-h(未設定時は100dvh)。iOSキーボード表示時も
    // 全UIが表示領域内に収まる。safe-area padding: ノッチ・ホームバー・横向きの
    // セーフエリアを避ける(viewportFit=cover環境。通常ブラウザでは0で無影響)。
    // onPointerDown: 入力欄以外(余白等)のタップでキーボードを閉じる(モバイルのみ)
    <div
      className="relative h-[var(--app-h,100dvh)] overflow-hidden bg-pane-bg text-charcoal pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
      onPointerDown={(e) => {
        const t = e.target as HTMLElement;
        if (!t.closest("input, textarea, button")) blurOnMobile();
      }}
    >
      {/* Standalone v1 BYOK: Gemini APIキー設定への入口。main(4Paneグリッド。ヘッダー行は
          lg:contentsで列数固定)には干渉させず、画面右上に独立配置する */}
      <button
        type="button"
        onClick={() => {
          setApiKeySettingsKey((k) => k + 1); // 開くたびに再マウントし、入力欄・保存状態を初期化
          setApiKeySettingsOpen(true);
        }}
        aria-label="Gemini APIキー設定"
        className="absolute top-2 right-2 z-40 flex h-7 w-7 items-center justify-center rounded-full bg-white text-ink-soft shadow-[0_1px_2px_rgba(17,17,17,0.15)]"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-3.5 w-3.5">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      <ApiKeySettingsModal
        key={apiKeySettingsKey}
        open={apiKeySettingsOpen}
        onClose={() => setApiKeySettingsOpen(false)}
      />

      {/* PC(sm以上) §6.1: 21px列ヘッダー行 + Pane行のグリッド (v13: gap 8/4px, padding 6px 8px 8px)
          スマホ(sm未満) §6.1: 1画面1Pane。列ヘッダーがタブ化 (v13: タブバー40px・白背景・
          下ヘアライン・現在地はチャコール太字+inset下線#007AFF・Pane余白10px) */}
      <main className="flex h-full flex-col lg:grid lg:grid-cols-[20fr_24fr_36fr_20fr] lg:grid-rows-[21px_minmax(0,1fr)] lg:gap-x-2 lg:gap-y-1 lg:px-2 lg:pt-1.5 lg:pb-2">
        <div className="flex h-10 flex-none border-b border-hairline bg-white max-lg:mb-2.5 lg:contents">
          {colHeads.map(({ label, icon }, i) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                blurOnMobile(); // タブ切替時にキーボードを閉じる(iOS)
                setActivePane(i);
              }}
              className={`flex items-center gap-[5px] text-[12.5px] font-semibold max-lg:h-full max-lg:flex-1 max-lg:cursor-pointer max-lg:justify-center max-lg:text-[13px] lg:pointer-events-none lg:h-[21px] lg:pr-1 lg:pl-3 lg:text-charcoal [&>svg]:h-3 [&>svg]:w-3 [&>svg]:flex-none [&>svg]:text-ink-soft ${
                i === activePane
                  ? "max-lg:font-bold max-lg:text-charcoal max-lg:shadow-[inset_0_-2px_0_var(--color-action)]"
                  : "max-lg:text-ink-soft"
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>

        <div className={paneClass(0, activePane)}>
          <Pane1
            onStartGrill={handleStartGrill}
            onTrendSelect={(category) => {
              dispatch({ type: "TREND_SELECT", category });
              autoSwitchPane(1); // v13: トレンド選択→選ぶPaneへ
            }}
            onAuthorSelect={(name) => {
              dispatch({ type: "AUTHOR_SELECT", name });
              requestAuthorSearch(name); // 2026-09-06確定: 実書籍検索(/api/author-books)
              autoSwitchPane(1); // v13: 著者候補の選択→選ぶPaneへ
            }}
          />
        </div>
        <div className={paneClass(1, activePane)}>
          <Pane2
            books={state.pane2Books}
            searching={state.searching}
            readingIds={state.shelf.reading.map((b) => b.id)}
            limitNoticeBookId={state.limitNoticeBookId}
            onSearchBoundary={handleSearchBoundary}
            onDecideBook={handleDecideBook}
            onRefresh={() => {
              // 著者探訪は実API(/api/author-books)を直前3冊の除外指定つきで再実行。
              // トレンド/grillは従来どおりreducerのREFRESH_BOOKSでダミープール内差替
              if (state.origin === "author") requestAuthorRefresh();
              else dispatch({ type: "REFRESH_BOOKS" });
            }}
            refreshNotice={state.pane2Notice}
            pitches={pitches}
            onRequestPitch={handleRequestPitch}
          />
        </div>
        <div className={paneClass(2, activePane)}>
          <Pane3
            messages={state.messages}
            searching={state.searching}
            supportMode={state.supportMode}
            supportInitial={state.supportMode && state.sessionBookId === null && state.messages.length === 0}
            onGoSupport={() => dispatch({ type: "GO_SUPPORT" })}
            onSend={handleSend}
          />
        </div>
        <div className={paneClass(3, activePane)}>
          <Pane4
            shelf={state.shelf}
            entries={state.entries}
            notice={p4Notice}
            activeBookId={state.sessionType === "support" ? state.sessionBookId : null}
            onReadingClick={handleReadingClick}
            onMoveBook={handleMoveBook}
            onDeleteBook={handleDeleteBook}
          />
        </div>
      </main>
    </div>
  );
}
