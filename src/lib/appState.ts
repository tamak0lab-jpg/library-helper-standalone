// 状態モデル (段階2-1): v13モックのstateオブジェクトと1対1対応する形で定義する。
// 旧Phase型("idle"|"grill"|"searching"|"ready"|"reading")は廃止。
// 特に「reading」フェーズ(=決めた直後に伴走モード化する旧仕様)はv12で不採用のため存在しない。

import { Book, ChatMessage, GRILL_POOL, TREND_POOLS, refreshNotices } from "./dummyData";
import { summarizeSession } from "./sessionSummary";

/** 長期セッションの保持単位 (§6.7の実装仕様: 20往復まで全文保持、
    超過時は「古い部分の要約+直近10往復の全文」)。
    - summary: 古い部分の要約 (null=未圧縮=全文保持)。UIには表示しない内部コンテキスト用
    - recentMessages: 原文のまま保持しているメッセージ (未圧縮なら全文、圧縮後は直近10往復) */
export interface SessionMemory {
  summary: string | null;
  recentMessages: ChatMessage[];
}

/** 現在開いている会話の種別 (v13: sessionType)。grill=選書1回ごと / support=本ごと */
export type SessionType = "grill" | "support" | null;

/** 読書録の1冊 (書籍は一意IDで識別する=凍結時確定方針。タイトル文字列をキーにしない) */
export interface ShelfBook {
  id: string;
  title: string;
  author: string;
  date: string;
}

/** DB(reading_records)上の記録の対応情報 (書籍IDキー)。
    状態変更・削除・読書記録(entries)の保存でDB側の行を特定するために保持する */
export interface ShelfRecord {
  /** reading_records.id (サーバー発行のUUID) */
  id: string;
  /** 何から選んだ本か (grill/trend/author/manual) */
  source: "grill" | "trend" | "author" | "manual";
}

/** 読書体験の記録1件 (DB reading_entriesの表示用ミラー)。
    取得・保存されていない項目はnull=UIで項目ごと非表示。
    前後文脈・気づきはユーザーが実際に入力した本文のみ(AIが作った文脈は保存されない) */
export interface ReadingEntry {
  id: string;
  bookId: string;
  recordId: string;
  phrase: string;
  contextBefore: string | null;
  contextAfter: string | null;
  userReflection: string | null;
  aiComment: string | null;
  aiCharacter: "orange" | "gelb" | null;
  /** 保存時点の最小限の前後会話 (会話全文ではない) */
  excerpt: { speaker: "user" | "orange" | "gelb"; message: string }[] | null;
  /** Pane4の日付表示基準 (yyyy-mm-dd) */
  recordedAt: string;
}

/** 読書録 (§6.6: 読書中/完読/中断の3状態) */
export interface Shelf {
  reading: ShelfBook[];
  done: ShelfBook[];
  suspended: ShelfBook[];
}

export interface AppState {
  /* ---- Pane3 状態判定の核心 (§6.5: 3状態+明示フラグ) ---- */
  /** 会話種別。②grill-me開始済み=Pane1の「grill-meを始める」からの正式開始のみ "grill" */
  sessionType: SessionType;
  /** 正式な読書支援モード。「読書支援へ」押下でのみtrue。grill-me開始・リセット・「この本に決めた」(追加成功時)でfalse */
  supportMode: boolean;
  /** 「この本に決めた」直後(まだ正式な読書支援モードに入っていない)の判定専用。
      「読書支援へ」押下・新しいgrill-me開始・リセットで解除 */
  justDecided: boolean;

  /* ---- Pane2 選書 ---- */
  /** 検索演出中 (§6.4: grill-me由来のみ) */
  searching: boolean;
  /** 候補3冊。null=空状態(棚アイコン表示) */
  pane2Books: Book[] | null;
  /** 現在の選書経路 (§6.4: 「別の3冊」は経路の条件・文脈を保ったまま差替) */
  origin: "grill" | "trend" | "author" | null;
  /** トレンドの選択カテゴリ */
  trendCategory: string | null;
  /** 著者探訪の選択著者 */
  authorName: string | null;
  /** 候補ローテーション位置 (v13 grillCursor/trendCursors) */
  cursors: { grill: number; trend: Record<string, number> };
  /** 「別の3冊」で新候補が不足したときの案内文 (Pane2内のオランジェ吹き出し。nullなら非表示) */
  pane2Notice: string | null;

  /* ---- Pane4 ---- */
  shelf: Shelf;
  /** DB記録(reading_records)の対応 (書籍IDキー。DB保存済みの本のみ) */
  records: Record<string, ShelfRecord>;
  /** 読書体験の記録 (書籍IDキー・recorded_at昇順。DBから水和+保存時に追加) */
  entries: Record<string, ReadingEntry[]>;

  /** 読書支援セッションの対象書籍ID (最小限。セッション開始/再開は段階2-4以降で実装) */
  sessionBookId: string | null;

  /** 読書中上限3冊の注意表示対象の書籍ID (§6.4。nullなら非表示) */
  limitNoticeBookId: string | null;

  /** 現在表示中の会話ログ */
  messages: ChatMessage[];

  /* ---- セッションストア (§6.7: grill-me=選書1回ごと/読書支援=本ごと。両者の履歴は混在させない) ---- */
  /** grill-me履歴の保管庫 (選書1回ごとに1セッション=SessionMemory 1件)。
      Ver.1では内部保持のみ — 履歴一覧・再開ボタン等のUIは追加しない */
  grillArchive: SessionMemory[];
  /** 読書支援履歴の保管庫。キーは書籍ID(タイトル文字列は使わない)。
      supportLogs[bookId] の形で、構造上ほかの本・grill-meの履歴と混ざらない
      (20往復超の要約もSessionMemory単位で本ごとに分離され、要約レベルでも混在しない) */
  supportLogs: Record<string, SessionMemory>;
  /** 現在アクティブなセッションの「古い部分の要約」(null=未圧縮)。
      直近の原文はmessagesが保持する。セッション退避時にSessionMemoryとして
      grillArchive/supportLogsへ保存し、再開時に復元する。
      再開だけでは再生成しない — 更新トリガーは新しい会話追加のみ */
  sessionSummary: string | null;
  /** 保存したフレーズ (§6.5/§6.6)。キーは書籍ID — 本ごとに完全分離し、他の本と混ざらない */
  phrases: Record<string, string[]>;

  /** ユーザーが読書録から削除した本の一意ID集合。
      削除済みの本は通常の推薦候補(grill/トレンド/著者/別の3冊)から除外する。
      将来「明示的な再希望」での再包含を許容する方針だが、その判定・UIは未実装。
      再登録時も旧supportLogs/phrasesは復活させない(新しい読書録として開始する方針)。
      現時点ではインメモリのみ(DB・localStorage永続化なし) */
  deletedBookIds: string[];
}

/** 初期の読書録: 空 (Ver.1永続保存後は起動時にDB=事実の正本から水和する。
    v13の架空サンプル5冊はDBへ混入させないため廃止。DB未接続・水和失敗時は空のまま) */
export const initialShelf: Shelf = {
  reading: [],
  done: [],
  suspended: [],
};

export const initialAppState: AppState = {
  sessionType: null,
  supportMode: false,
  justDecided: false,
  searching: false,
  pane2Books: null,
  origin: null,
  trendCategory: null,
  authorName: null,
  cursors: { grill: 0, trend: {} },
  pane2Notice: null,
  shelf: initialShelf,
  records: {},
  entries: {},
  sessionBookId: null,
  limitNoticeBookId: null,
  messages: [],
  grillArchive: [],
  supportLogs: {},
  sessionSummary: null,
  phrases: {},
  deletedBookIds: [],
};

/** 今日の日付 (yyyy-mm-dd) */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 現在の正式セッションの履歴を正しい保存先へ退避する (§6.7)。
    - grill(sessionType==="grill") → grillArchiveへ1セッション(SessionMemory)として追加
    - 読書支援(sessionType==="support"・対象bookIdあり) → supportLogs[bookId]へ
    - 正式セッション外(sessionType===null: 通常初期の案内表示・決めた直後の受けとめ等)は保存しない
    - transient=true のメッセージ(受けとめ・案内等の一時表示)は保存対象から除外する
    - 現在の要約(sessionSummary)もSessionMemoryとして一緒に退避し、戻り値で必ずリセットする */
function leaveSession(state: AppState): {
  grillArchive: SessionMemory[];
  supportLogs: Record<string, SessionMemory>;
  sessionSummary: null;
} {
  const persistable = state.messages.filter((m) => !m.transient);
  const memory: SessionMemory = { summary: state.sessionSummary, recentMessages: persistable };
  if (state.sessionType === "grill" && (persistable.length > 0 || state.sessionSummary !== null)) {
    return {
      grillArchive: [...state.grillArchive, memory],
      supportLogs: state.supportLogs,
      sessionSummary: null,
    };
  }
  if (state.sessionType === "support" && state.sessionBookId !== null) {
    return {
      grillArchive: state.grillArchive,
      supportLogs: { ...state.supportLogs, [state.sessionBookId]: memory },
      sessionSummary: null,
    };
  }
  return { grillArchive: state.grillArchive, supportLogs: state.supportLogs, sessionSummary: null };
}

/* ---- 20往復超の要約保持 (§6.7の実装仕様) ----
   「1往復」= ユーザー発言1回+それに対するAI応答群(オランジェ/ゲルプが連続応答しても同じ1往復)。
   ChatMessage件数を2で割る数え方はしない。transient=trueは往復数にも要約対象にも含めない。
   20往復までは全文保持。21往復目が完成した時点で「古い部分の要約+直近10往復の全文」へ移行し、
   以後は直近10往復から押し出された往復をsummarizeSession(交換可能境界)で要約側へ統合する */

/** 保持する直近往復数 (圧縮後) */
const RECENT_EXCHANGES = 10;
/** 全文保持の上限往復数 (これを超えたら初めて圧縮) */
const MAX_FULL_EXCHANGES = 20;

/** transient除外でのユーザー発言(=往復の起点)のインデックス一覧 */
function exchangeStarts(messages: ChatMessage[]): number[] {
  const starts: number[] = [];
  messages.forEach((m, i) => {
    if (!m.transient && m.speaker === "user") starts.push(i);
  });
  return starts;
}

/** 会話追加後の長期セッション圧縮。閾値内ならそのまま返す(参照も変えない)。
    超過時は直近RECENT_EXCHANGES往復より前(セッション冒頭のAI発言含む)を要約へ統合する */
function rollupLongSession(
  messages: ChatMessage[],
  summary: string | null,
): { messages: ChatMessage[]; summary: string | null } {
  const starts = exchangeStarts(messages);
  // 未圧縮なら20往復まで全文保持(20往復ちょうどは圧縮しない)。
  // 圧縮済みなら直近10往復を超えた分を都度押し出す
  const threshold = summary === null ? MAX_FULL_EXCHANGES : RECENT_EXCHANGES;
  if (starts.length <= threshold) return { messages, summary };
  const cut = starts[starts.length - RECENT_EXCHANGES]; // 残す直近10往復の先頭位置
  const older = messages.slice(0, cut).filter((m) => !m.transient);
  return {
    messages: messages.slice(cut),
    summary: summarizeSession(summary, older),
  };
}

/** 既読除外の対象ID (§6.4: 読書中・完読は常に除外、中断は原則除外。書籍IDで判定)。
    削除済みの本(deletedBookIds)も通常推薦から除外する(明示的な再希望での再包含は未実装) */
function excludedIds(shelf: Shelf, deletedBookIds: string[]): Set<string> {
  return new Set([
    ...[...shelf.reading, ...shelf.done, ...shelf.suspended].map((b) => b.id),
    ...deletedBookIds,
  ]);
}

/** 候補プールから3冊選ぶ (v13 pickThree)。
    既読除外後の残りからカーソル位置で3冊ローテーション(=「別の3冊」で直前3冊との重複を回避)。
    残りが3冊未満のときのみ既読(書架)の再表示を許可(候補不足時)。
    削除済みの本はこの候補不足時の再表示にも含めない */
function pickThree(
  pool: Book[],
  cursor: number,
  shelf: Shelf,
  deletedBookIds: string[],
): { books: Book[]; nextCursor: number } {
  const ex = excludedIds(shelf, deletedBookIds);
  const deleted = new Set(deletedBookIds);
  let avail = pool.filter((b) => !ex.has(b.id));
  if (avail.length < 3) avail = pool.filter((b) => !deleted.has(b.id));
  if (avail.length === 0) avail = pool.slice(); // プール全冊削除の理論上ケースの防御(通常到達しない)
  const books = [0, 1, 2].map((k) => avail[(cursor + k) % avail.length]);
  return { books, nextCursor: cursor + 3 };
}

/** トレンドの本をPane2へ渡す際、reasonDetail(静的な短い熱血プレゼン文)を落とす。
    TREND_POOLSの元オブジェクトは書き換えない(新しいオブジェクトを返すだけ)。
    Pane2Recommend.tsxのreasonDetail===undefined分岐を通し、/api/pitchの
    オンデマンド長文生成(600〜900字目標)へ進ませるための最小対応(2026-09-15) */
function withoutReasonDetail(books: Book[]): Book[] {
  return books.map((b) => {
    const copy = { ...b };
    delete copy.reasonDetail;
    return copy;
  });
}

/* 遷移アクション (段階2-1では土台のみ)。
   TODO(2-2): 入力ガード分岐 / TODO(2-3): DECIDE_BOOK(v12状態遷移・上限判定) /
   TODO(2-4): GO_SUPPORT・OPEN_SUPPORT_SESSION / TODO(2-5): トレンド・著者・別の3冊・リセット */
export type AppAction =
  | { type: "APPEND_MESSAGES"; items: ChatMessage[] }
  /** Pane1「grill-meを始める」(新規grill-meの開始入口はここだけ) */
  | { type: "START_GRILL" }
  /** grill: 選書条件が揃った→検索演出へ (§6.4: 元はgrill-me由来のみだったが、
      2026-09-06確定で著者探訪の実書籍検索(AUTHOR_SELECT)もこの検索演出を再利用する) */
  | { type: "START_SEARCHING" }
  /** grill: 選書完了→3冊表示。booksあり=選書API(Gemini)の結果を表示 /
      books省略=従来のダミープール選定(GRILL_POOLから既読除外のうえ3冊) */
  | { type: "GRILL_BOOKS_READY"; books?: Book[] }
  /** grill: 選書API失敗。検索演出を終了する(候補は変更しない。初回なら空状態のまま・
      以前の3冊があればそのまま)。再試行はgrill会話の継続→再度の選書条件成立で行う */
  | { type: "SEARCH_FAILED" }
  /** トレンド: カテゴリ選択→Pane2へ3冊 (grill-meセッションは開始しない・Pane3不変) */
  | { type: "TREND_SELECT"; category: string }
  /** 著者探訪: 候補著者の選択→検索演出を開始する(2026-09-06確定: 実書籍検索は
      /api/author-booksへの非同期問い合わせのため、grillと同様に検索演出を挟む。
      pane2Booksはここでは変更しない=完了まで旧候補を隠したまま待つ) */
  | { type: "AUTHOR_SELECT"; name: string }
  /** 著者探訪: 実書籍検索完了→3冊表示(2026-09-06新設)。/api/author-booksが返した
      確認済み書誌+2文推薦済みの3冊をそのまま表示する */
  | { type: "AUTHOR_BOOKS_READY"; books: Book[] }
  /** 著者探訪: 実書籍検索が失敗/候補不足(2026-09-06新設)。検索演出を終了し、
      候補は変更しない(初回なら空状態のまま・以前の3冊があればそのまま)。
      noticeはPane2内のオランジェ吹き出しに表示する案内文(架空の本で埋めない) */
  | { type: "AUTHOR_SEARCH_FAILED"; notice: string }
  /** 「別の3冊にお願い」(§6.4: 全経路共通・条件と文脈を保ち候補3冊のみ差替。
      新セッションなし・Pane3履歴/Pane4不変・直前3冊との重複回避) */
  | { type: "REFRESH_BOOKS" }
  /** 初期状態へ戻す (v13の「⟲入口から見直す」相当。現状のUI導線は入口経由の再マウント) */
  | { type: "RESET" }
  /** 「この本に決めた」= どの状態から押しても「読書中への登録」(§6.4・v12確定仕様)。
      noticeは追加成功時にのみ表示する受けとめメッセージ(transient=履歴保存対象外) */
  | { type: "DECIDE_BOOK"; book: Book; notice: ChatMessage }
  /** Pane3右上「読書支援へ」押下 = 正式な読書支援モードへ入る唯一の入口 (§6.5)。
      現在の会話を閉じて読書支援初期画面へ。本の自動選択・セッション自動開始はしない。
      「モードに入る」ことと「本ごとのセッションを開始する」ことは分離し、
      sessionType="support"の確定はPane4で本を選択した時に行う */
  | { type: "GO_SUPPORT" }
  /** Pane4「読書中」の本を選択 (supportMode=trueのときのみ)。
      §6.5: 過去セッション(supportLogs[bookId])があれば続きから再開/なければ新規開始。
      openingは新規開始時のみ表示する初回メッセージ(セッションの一部として保存対象) */
  | { type: "OPEN_SUPPORT_SESSION"; bookId: string; opening: ChatMessage }
  /** フレーズ保存 (§6.5: 読書支援中の明示依頼のみ。正式セッション対象の本に紐づけて保存) */
  | { type: "SAVE_PHRASE"; phrase: string }
  /** Pane4「…」メニューの状態変更 (§6.6: 読書中/完読/中断の移動)。
      状態変更ではsupportLogs・phrases・セッション状態には触れない(§8未確定のため既存データ保持) */
  | { type: "MOVE_BOOK"; bookId: string; from: keyof Shelf; to: keyof Shelf }
  /** 起動時のDB水和: 読書録・DB記録対応・読書体験の記録をDBの内容で置き換える。
      会話・セッション・Pane2等には触れない */
  | { type: "HYDRATE_SHELF"; shelf: Shelf; records: Record<string, ShelfRecord>; entries: Record<string, ReadingEntry[]> }
  /** DB保存成功後にreading_recordsの対応を保持する (「この本に決めた」の非同期完了) */
  | { type: "SET_RECORD"; bookId: string; record: ShelfRecord }
  /** 読書体験の記録1件の追加 (DB保存成功後。recorded_at昇順の末尾へ) */
  | { type: "ADD_ENTRY"; entry: ReadingEntry }
  /** Pane4「…」メニューの削除 (オランジェの確認吹き出しで確定後のみ)。
      読書録・supportLogs[bookId]・phrases[bookId]を削除し、bookIdをdeletedBookIdsへ保持。
      削除対象が現在の読書支援対象なら、そのセッションを終了して本未選択状態へ戻す
      (supportModeは維持=読書支援初期画面を再利用) */
  | { type: "DELETE_BOOK"; bookId: string };

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "APPEND_MESSAGES": {
      const appended = [...state.messages, ...action.items];
      // 正式セッション(grill/支援・本選択済み)のみ20往復超の圧縮対象。
      // 要約更新のトリガーは「新しい会話追加」のこの1箇所だけ(再開では更新しない)
      const inSession =
        state.sessionType === "grill" ||
        (state.sessionType === "support" && state.sessionBookId !== null);
      if (!inSession) return { ...state, messages: appended };
      const rolled = rollupLongSession(appended, state.sessionSummary);
      return { ...state, messages: rolled.messages, sessionSummary: rolled.summary };
    }
    case "START_GRILL":
      // v13 startGrillDialogue準拠: 現セッションを退避してから新しいgrill-meを開始。
      // supportMode/justDecidedを解除
      return {
        ...state,
        ...leaveSession(state),
        sessionType: "grill",
        supportMode: false,
        justDecided: false,
        searching: false,
        origin: "grill",
        pane2Books: null,
        limitNoticeBookId: null,
        pane2Notice: null,
        messages: [],
      };
    case "START_SEARCHING":
      return { ...state, searching: true, origin: "grill", limitNoticeBookId: null };
    case "GRILL_BOOKS_READY": {
      // 選書API(Gemini)の結果を表示する場合。カーソルはダミープール専用のため進めない
      if (action.books !== undefined) {
        return {
          ...state,
          searching: false,
          pane2Books: action.books,
          origin: "grill",
          limitNoticeBookId: null,
          pane2Notice: null,
        };
      }
      const { books, nextCursor } = pickThree(GRILL_POOL, state.cursors.grill, state.shelf, state.deletedBookIds);
      return {
        ...state,
        searching: false,
        pane2Books: books,
        origin: "grill",
        limitNoticeBookId: null,
        pane2Notice: null,
        cursors: { ...state.cursors, grill: nextCursor },
      };
    }
    case "SEARCH_FAILED":
      return { ...state, searching: false };
    case "TREND_SELECT": {
      // v13準拠: カテゴリ選択のたびにカーソルを先頭へ戻して3冊。
      // grill-meセッションは開始しない(sessionType/supportMode/messagesに触れない)
      const { books, nextCursor } = pickThree(TREND_POOLS[action.category] ?? [], 0, state.shelf, state.deletedBookIds);
      return {
        ...state,
        searching: false,
        // Pane2へ渡す時点でreasonDetailを落とす(TREND_POOLS自体は変更しない)。
        // 目的はPane2Recommend.tsxの既存分岐(reasonDetail===undefined)をそのまま
        // 通し、trendも/api/pitchのオンデマンド長文生成へ進ませること(2026-09-15)
        pane2Books: withoutReasonDetail(books),
        origin: "trend",
        trendCategory: action.category,
        limitNoticeBookId: null,
        pane2Notice: null,
        cursors: { ...state.cursors, trend: { ...state.cursors.trend, [action.category]: nextCursor } },
      };
    }
    case "AUTHOR_SELECT":
      // Pane3の会話状態には触れない。実書籍検索(/api/author-books)はpage側の非同期処理に
      // 委ね、ここでは検索演出を開始するだけ(2026-09-06確定)。pane2Booksは変更せず、
      // 完了まで検索演出の裏に隠したままにする(以前の3冊があればそのまま残る)
      return {
        ...state,
        searching: true,
        origin: "author",
        authorName: action.name,
        limitNoticeBookId: null,
        pane2Notice: null,
      };
    case "AUTHOR_BOOKS_READY":
      return {
        ...state,
        searching: false,
        pane2Books: action.books,
        limitNoticeBookId: null,
        pane2Notice: null,
      };
    case "AUTHOR_SEARCH_FAILED":
      return { ...state, searching: false, pane2Notice: action.notice };
    case "REFRESH_BOOKS": {
      // §6.4: 全経路共通で条件・文脈を保ったまま候補のみ差替。同一3冊の再表示は禁止。
      // 差し替え可能な「新しい候補」(既読除外+現在の3冊を除く)の数nに応じて:
      //   n>=3: 3冊すべて差替 / n=2: 2冊差替+1冊維持 / n=1: 1冊差替+2冊維持 / n=0: 現状維持。
      // n<3のときはPane2内にオランジェの案内吹き出しを表示する(エラー表現にしない)
      if (state.pane2Books === null) return state;
      let pool: Book[] | null = null;
      if (state.origin === "grill") pool = GRILL_POOL;
      else if (state.origin === "trend" && state.trendCategory !== null) pool = TREND_POOLS[state.trendCategory] ?? [];
      // 著者探訪(author)はここでダミープールを組まない(2026-09-06: 実在書籍化)。
      // 「別の3冊」はpage側で/api/author-booksを直前3冊の除外指定つきに再実行して取得する
      if (pool === null) return state;
      const ex = excludedIds(state.shelf, state.deletedBookIds);
      const currentIds = new Set(state.pane2Books.map((b) => b.id));
      const fresh = pool.filter((b) => !ex.has(b.id) && !currentIds.has(b.id));
      const n = Math.min(3, fresh.length);
      // trendの新規差替分のみreasonDetailを落とす(grillはこの経路を変更しない=
      // GRILL_POOLはそのまま。維持される側のstate.pane2Books.slice(n)は既に
      // TREND_SELECT/前回のREFRESH_BOOKSでreasonDetail除去済みのため再処理不要)
      const freshForPane2 = state.origin === "trend" ? withoutReasonDetail(fresh.slice(0, n)) : fresh.slice(0, n);
      const books = n === 0 ? state.pane2Books : [...freshForPane2, ...state.pane2Books.slice(n)];
      const notice =
        n >= 3 ? null : n === 2 ? refreshNotices.two : n === 1 ? refreshNotices.one : refreshNotices.zero;
      return { ...state, pane2Books: books, pane2Notice: notice, limitNoticeBookId: null };
    }
    case "OPEN_SUPPORT_SESSION": {
      // supportMode=false中は案内のみ(UI側)でここには来ない(防御的ガード)
      if (!state.supportMode) return state;
      // 同一本の再クリック: セッションを作り直さない(重複作成の禁止)
      if (state.sessionType === "support" && state.sessionBookId === action.bookId) return state;
      // 現在のセッション(別の本A等)を正しい保存先へ退避してから切替 (§6.7: A→B→A)
      const stores = leaveSession(state);
      const saved = stores.supportLogs[action.bookId];
      const resuming =
        saved !== undefined && (saved.recentMessages.length > 0 || saved.summary !== null);
      return {
        ...state,
        ...stores,
        sessionType: "support",
        sessionBookId: action.bookId,
        // 既存履歴があれば続きから再開(挨拶の追加なし)/なければ初回メッセージで新規開始。
        // 圧縮済みセッションは「保存済みの要約+直近10往復の原文」をそのまま復元する。
        // 再開だけでは要約を作り直さない(更新はAPPEND_MESSAGES時のみ)
        messages: resuming ? saved.recentMessages : [action.opening],
        sessionSummary: resuming ? saved.summary : null,
      };
    }
    case "SAVE_PHRASE": {
      // 保存条件: 正式な読書支援セッション中のみ (supportMode/sessionType/sessionBookIdの三重ガード)。
      // それ以外(通常初期/grill/決めた直後/本未選択)は各入力ガードが先に案内を返すため到達しないが、
      // 構造上もここで遮断する
      if (!state.supportMode || state.sessionType !== "support" || state.sessionBookId === null) {
        return state;
      }
      const bookId = state.sessionBookId;
      return {
        ...state,
        phrases: { ...state.phrases, [bookId]: [...(state.phrases[bookId] ?? []), action.phrase] },
      };
    }
    case "MOVE_BOOK": {
      const { bookId, from, to } = action;
      if (from === to) return state;
      const book = state.shelf[from].find((b) => b.id === bookId);
      if (!book) return state;
      // 読書中上限3冊(§6.4)は「読書中へ戻す」にも適用する。
      // 自動で別の本を移動・入替せず、状態を一切変更しない
      if (to === "reading" && state.shelf.reading.length >= 3) return state;
      // v13準拠: 移動元から取り除き、日付を当日へ更新して移動先の先頭へ。
      // supportLogs・phrases・sessionBookId等のセッション状態は変更しない
      // (状態変更時のセッション・保存フレーズの扱いは§8未確定のため既存データを保持)
      const shelf: Shelf = { ...state.shelf };
      shelf[from] = shelf[from].filter((b) => b.id !== bookId);
      shelf[to] = [{ ...book, date: today() }, ...shelf[to]];
      return {
        ...state,
        shelf,
        // v13準拠: 読書中が3冊未満になったらPane2の上限注意をクリア
        limitNoticeBookId: shelf.reading.length < 3 ? null : state.limitNoticeBookId,
      };
    }
    case "HYDRATE_SHELF":
      // DB=読書録の正本。会話・セッション状態には触れない
      return { ...state, shelf: action.shelf, records: action.records, entries: action.entries };
    case "SET_RECORD":
      return { ...state, records: { ...state.records, [action.bookId]: action.record } };
    case "ADD_ENTRY": {
      const list = state.entries[action.entry.bookId] ?? [];
      return {
        ...state,
        entries: { ...state.entries, [action.entry.bookId]: [...list, action.entry] },
      };
    }
    case "DELETE_BOOK": {
      const { bookId } = action;
      const inShelf =
        state.shelf.reading.some((b) => b.id === bookId) ||
        state.shelf.done.some((b) => b.id === bookId) ||
        state.shelf.suspended.some((b) => b.id === bookId);
      if (!inShelf) return state;
      // 読書録・読書支援履歴・保存フレーズをまとめて削除する(元に戻せない)。
      // bookIdだけは「削除済み本」として保持し、通常推薦からの除外に使う。
      // 将来の再登録時も旧supportLogs/phrasesは復活させない(新しい読書録として開始)
      const shelf: Shelf = {
        reading: state.shelf.reading.filter((b) => b.id !== bookId),
        done: state.shelf.done.filter((b) => b.id !== bookId),
        suspended: state.shelf.suspended.filter((b) => b.id !== bookId),
      };
      const supportLogs = { ...state.supportLogs };
      delete supportLogs[bookId];
      const phrases = { ...state.phrases };
      delete phrases[bookId];
      // DB記録対応・読書体験の記録も一緒に削除する(DB側の削除は呼び出し元がAPIで行う)
      const records = { ...state.records };
      delete records[bookId];
      const entries = { ...state.entries };
      delete entries[bookId];
      // 現在の読書支援対象を削除した場合はセッションを終了し本未選択状態へ。
      // supportModeは維持し、messagesを空にすることで既存の読書支援初期画面
      // (supportMode && sessionBookId===null && messages空)が再利用される。
      // 別の本のセッション中なら会話・sessionBookIdには一切触れない
      const isCurrent = state.sessionBookId === bookId;
      return {
        ...state,
        shelf,
        supportLogs,
        phrases,
        records,
        entries,
        // 二重追加の禁止(重複登録なし)
        deletedBookIds: state.deletedBookIds.includes(bookId)
          ? state.deletedBookIds
          : [...state.deletedBookIds, bookId],
        sessionType: isCurrent ? null : state.sessionType,
        sessionBookId: isCurrent ? null : state.sessionBookId,
        messages: isCurrent ? [] : state.messages,
        // 削除した本の会話要約を孤立させない(supportLogs[bookId]ごと削除済み。
        // 現在の支援対象ならアクティブな要約も破棄する)
        sessionSummary: isCurrent ? null : state.sessionSummary,
        // 削除後に「決めた直後」の一時状態だけが残る不整合を防ぐ
        justDecided: false,
        // 読書中が3冊未満になったら上限注意をクリア(MOVE_BOOKと同じ整合)
        limitNoticeBookId: shelf.reading.length < 3 ? null : state.limitNoticeBookId,
      };
    }
    case "RESET":
      return initialAppState;
    case "DECIDE_BOOK": {
      const { book, notice } = action;
      // C. 重複登録防止: すでに読書中にある同一書籍IDは再追加しない(タイトル文字列では判定しない)
      if (state.shelf.reading.some((b) => b.id === book.id)) return state;
      // B. 読書中上限3冊: 追加せず注意表示のみ。supportMode/sessionType/sessionBookId/
      //    justDecided/会話状態は一切変更しない(§6.4: 状態遷移を行わない)
      if (state.shelf.reading.length >= 3) {
        return { ...state, limitNoticeBookId: book.id };
      }
      // A. 追加成功時のみ状態遷移(v12確定仕様):
      //    読書中へ追加/現セッションを保存して閉じる(leaveSession)/supportMode=false/
      //    justDecided=true/受けとめメッセージの一時表示(transient。履歴には保存しない)
      return {
        ...state,
        ...leaveSession(state),
        shelf: {
          ...state.shelf,
          reading: [
            { id: book.id, title: book.title, author: book.author, date: today() },
            ...state.shelf.reading,
          ],
        },
        sessionType: null,
        supportMode: false,
        justDecided: true,
        sessionBookId: null,
        limitNoticeBookId: null,
        pane2Notice: null,
        messages: [notice],
      };
    }
    case "GO_SUPPORT": {
      // supportMode=true中は右上が非操作ラベル「読書支援中」のため到達しない(防御的ガード)
      if (state.supportMode) return state;
      // 現在の会話(grill会話・決めた直後の受けとめ等)を保存して閉じ、読書支援初期画面へ。
      // grill-me履歴は内部保持のみ(Ver.1では再開導線を追加しない)。
      // Pane2・Pane4の内容は変更しない
      return {
        ...state,
        ...leaveSession(state),
        supportMode: true,
        justDecided: false, // 正式な読書支援モードに入ったので「決めた直後」判定を解除
        sessionType: null, // 本ごとのセッションはまだ開始しない(Pane4で本選択時に"support"へ)
        sessionBookId: null, // 本の自動選択はしない
        messages: [],
      };
    }
    default:
      return state;
  }
}
