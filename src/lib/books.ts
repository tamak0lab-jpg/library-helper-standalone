// 共通書誌取得層 (Ver.1はGoogle Books APIのみ)。
//
// 役割分担: Gemini=3冊を選ぶ / Google Books=選ばれた本の実在確認・書誌照合・表示用データ取得。
// Google Booksを選書エンジンとしては使わない。
//
// 表示原則(Ver.1確定): 確認できた事実だけ表示する。取得できない項目はnullで保持し、
// UI側でその項目自体を非表示にする。推測・ダミー・AI補完で埋めない。
//
// UIはこのファイルの共通Book型(BookMeta)だけに依存し、Google Books固有の
// フィールド名には依存させない(将来のプロバイダー追加はこの層の差し替えで行う。
// 複数プロバイダー切替・フォールバック等の先回り実装はしない)。

import "server-only";

/** Library Helper共通の書誌情報。取得(確認)できなかった項目はnull */
export interface BookMeta {
  /** Google Books volumeId (照合できた場合。書籍一意IDの最優先材料・§Ver.1永続保存) */
  googleVolumeId: string | null;
  /** 正式書名 (副題があれば連結) */
  title: string;
  author: string | null;
  /** ISBN-13 (取得できた場合は後続処理の一意識別に利用する) */
  isbn13: string | null;
  publisher: string | null;
  publishedDate: string | null;
  description: string | null;
  coverUrl: string | null;
  /** 評価 (存在する場合のみ)。片方しか無い場合も推測で補完しない */
  averageRating: number | null;
  ratingsCount: number | null;
}

export interface GoogleVolume {
  id?: string;
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    description?: string;
    /** BCP-47言語コード ("ja" 等)。著者探訪の日本語版限定判定に使う */
    language?: string;
    industryIdentifiers?: { type?: string; identifier?: string }[];
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
    averageRating?: number;
    ratingsCount?: number;
  };
}

/** 照合用の正規化: NFKC→小文字→空白・記号類を除去 (表記ゆれ吸収) */
function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　・･=・"'「」『』【】()（）\[\]:：;；,，.。、!！?？~〜ー―\-‐_/｜|]/g, "");
}

/** 双方向の包含で一致とみなす (副題の有無・表記ゆれを許容しつつ別書籍を避ける) */
function looseMatch(a: string, b: string): boolean {
  if (a.length < 2 || b.length < 2) return false;
  return a.includes(b) || b.includes(a);
}

/** Gemini選書結果(書名・著者)と候補ボリュームが同一書籍と判断できるか。
    書名・著者の両方の一致を必須とし、曖昧な場合は不採用(=未照合として扱う)。
    純関数(検証ハーネスからも利用) */
export function isSameBook(queryTitle: string, queryAuthor: string, v: GoogleVolume): boolean {
  const info = v.volumeInfo;
  if (!info?.title) return false;
  const qt = normalize(queryTitle);
  const gtMain = normalize(info.title);
  const gtFull = normalize(`${info.title}${info.subtitle ?? ""}`);
  const titleOk = looseMatch(qt, gtMain) || looseMatch(qt, gtFull);
  if (!titleOk) return false;
  const qa = normalize(queryAuthor);
  const authors = info.authors ?? [];
  const authorOk = authors.some((a) => looseMatch(qa, normalize(a)));
  return authorOk;
}

/** 検索書名に対する候補書名の一致の強さ (照合済み候補のランク付け専用)。
    2 = 完全一致: 書名(または書名+副題)の全体が正規化後に一致
    1 = 主書名一致: titleの空白区切り先頭部分が一致 — Google Booksが副題を
        titleに空白区切りで含めるケース(「エッセンシャル思考 最少の時間で…」)
    0 = 部分一致のみ(「〜ワークブック」等、検索書名に文字が付け足された派生版を含む) */
function exactRank(queryNorm: string, v: GoogleVolume): number {
  const info = v.volumeInfo;
  if (!info?.title) return 0;
  if (normalize(info.title) === queryNorm) return 2;
  if (normalize(`${info.title}${info.subtitle ?? ""}`) === queryNorm) return 2;
  const tokens = info.title.split(/[\s　]+/).filter((t) => t !== "");
  let prefix = "";
  // 全トークン連結はnormalize(title)===queryNormで判定済みのため末尾トークンは除く
  for (const t of tokens.slice(0, -1)) {
    prefix += t;
    if (normalize(prefix) === queryNorm) return 1;
  }
  return 0;
}

/** 照合候補から採用する1件を選ぶ (純関数・検証ハーネスからも利用)。
    書名・著者の両一致(isSameBook)を必須としたうえで、検索結果の並び順を鵜呑みにせず
    完全一致候補を部分一致候補(派生版等)より優先する。
    戻り値の3値:
    - GoogleVolume … 採用する1件
    - null … 一致候補はあるが同一書籍を特定できない(曖昧→未照合を確定。次の検索段も見ない)
    - undefined … 一致候補なし(次の検索段を試してよい)
    採用順位:
    1. 完全一致(書名または書名+副題の全体が正規化後に一致)の先頭
    2. 主書名一致(rank1)は、候補が1種類の書名に定まる場合のみ先頭を採用。
       「下」「上」「3」等の複数の派生が主書名一致で並ぶ場合は、どれが元の書籍か
       特定できないため曖昧=null(別書籍の書誌・表紙を表示しない。派生語のハードコードはしない)
    3. 部分一致のみ: 従来どおり先頭を採用(【電子限定特典付き】等の表記ゆれ版) */
export function pickBestMatch(
  queryTitle: string,
  queryAuthor: string,
  items: GoogleVolume[],
): GoogleVolume | null | undefined {
  const qt = normalize(queryTitle);
  const matches = items.filter((v) => isSameBook(queryTitle, queryAuthor, v));
  if (matches.length === 0) return undefined;
  const exact = matches.find((v) => exactRank(qt, v) === 2);
  if (exact !== undefined) return exact;
  const mains = matches.filter((v) => exactRank(qt, v) === 1);
  if (mains.length > 0) {
    const titles = new Set(mains.map((v) => normalize(v.volumeInfo?.title ?? "")));
    return titles.size === 1 ? mains[0] : null;
  }
  return matches[0];
}

function toBookMeta(v: GoogleVolume): BookMeta {
  const info = v.volumeInfo ?? {};
  const isbn13 =
    info.industryIdentifiers?.find((x) => x.type === "ISBN_13")?.identifier ?? null;
  const rawCover = info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail ?? null;
  return {
    googleVolumeId: typeof v.id === "string" && v.id !== "" ? v.id : null,
    title: info.subtitle ? `${info.title} ${info.subtitle}` : (info.title ?? ""),
    author: info.authors && info.authors.length > 0 ? info.authors.join("、") : null,
    isbn13,
    publisher: info.publisher ?? null,
    publishedDate: info.publishedDate ?? null,
    description: info.description ?? null,
    coverUrl: rawCover !== null ? rawCover.replace(/^http:\/\//, "https://") : null,
    averageRating: typeof info.averageRating === "number" ? info.averageRating : null,
    ratingsCount: typeof info.ratingsCount === "number" ? info.ratingsCount : null,
  };
}

async function searchVolumes(
  query: string,
  maxResults = 10,
  langRestrict?: string,
): Promise<GoogleVolume[]> {
  // APIキーは任意 (未設定なら匿名アクセス=IP共有の無償クォータ。
  // 匿名クォータ枯渇(429)を避けるにはBooks APIを有効化したGOOGLE_BOOKS_API_KEYを設定する)
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
  // langRestrictは著者探訪(searchAuthorBooks)のみが指定する。lookupBook経由の
  // トレンド/grill/通常選書は従来どおり未指定(挙動を変えない)
  const url =
    `https://www.googleapis.com/books/v1/volumes?maxResults=${maxResults}&printType=books&country=JP` +
    (langRestrict !== undefined && langRestrict !== ""
      ? `&langRestrict=${encodeURIComponent(langRestrict)}`
      : "") +
    `&q=` +
    encodeURIComponent(query) +
    (apiKey !== undefined && apiKey !== "" ? `&key=${encodeURIComponent(apiKey)}` : "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`google books ${res.status}`);
    const data = (await res.json()) as { items?: GoogleVolume[] };
    return data.items ?? [];
  } finally {
    clearTimeout(timer);
  }
}

/** 重複除去・除外指定用の見出し語(bracket除去込み)。lookupBookのnormalize()は
    括弧記号だけを除去し中身は残すため一致しない別版(「〜【電子限定特典付き】」等)が生じる。
    著者探訪の候補整理専用に、括弧で囲まれた区間ごと除去してから正規化する */
function dedupeKey(title: string): string {
  return normalize(title.replace(/[(（\[［【][^)）\]］】]*[)）\]］】]/g, ""));
}

/** 著者探訪の除外指定1件 (2026-09-06新設)。既読(読書中・完読)の除外・
    「別の3冊にお願い」の重複回避の両方をこの形で表す。
    googleVolumeIdが判明していればそれを優先して同一書籍を判定し(確実)、
    無ければ書名+著者の一致(isSameBookと同じ判定)にフォールバックする */
export interface AuthorExcludeBook {
  title: string;
  author: string;
  googleVolumeId?: string;
}

/** 候補が除外対象と同一書籍か。googleVolumeId優先・無ければ既存のisSameBook
    (書名+著者の一致判定)にフォールバックする。新しい独自の一致基準は作らない */
function matchesExcluded(v: GoogleVolume, excluded: AuthorExcludeBook): boolean {
  if (excluded.googleVolumeId !== undefined) return v.id === excluded.googleVolumeId;
  return isSameBook(excluded.title, excluded.author, v);
}

/** 著者名から実在書籍を検索する(著者探訪用・2026-09-06新設)。
    lookupBookが「Geminiが選んだ特定の1冊」を照合するのに対し、こちらは著者名だけを
    手がかりに実在書籍を発見する。選書エンジンとしてGeminiを使わず、Google Booksの
    検索結果のみから確認済みの候補を絞り込む(架空の書名・概要は生成しない)。
    - 著者名の一致は「著者リストの先頭」に限定する。共著・対談・インタビュー本(検索対象の
      著者が2番目以降に載っているもの)は、代表作としての関連性が低いため除外する
    - 概要(description)が確認できない候補は、2文推薦・熱血プレゼンのどちらも
      確認済み事実だけでは生成できないため除外する(表示自体をしない)
    - 括弧付き別版("【電子限定特典付き】"等)・同一書名の重版は正規化書名で重複除去する
    - excludeは「読書中・完読の除外」「別の3冊にお願いの重複回避」の両方に使う共通の
      除外リスト(matchesExcluded参照)。上下巻等の版違いは別書籍として通過しうる
      (トレンド/grillの既存経路と同じ扱い。追加の版判定ルールは設けない)
    - 日本語版限定(2026-09-06追加): 検索時に langRestrict=ja を付け、取得後も
      volumeInfo.language === "ja" と明示できる候補だけを採用する。languageが無い候補は
      今回は通さない(外国語版・言語未設定版を確実に混ぜないことを優先)。外国人著者の
      日本語翻訳版は language === "ja" なら通常どおり残る(「日本人著者限定」ではない)
    確認できなかった項目はnullのまま返す(推測・補完はしない)。
    Google Books の取得自体に失敗した場合(429・5xx・タイムアウト等)は、候補不足(空配列)
    と区別できるよう例外を再スローする(呼び出し元の /api/author-books が 5xx へ変換する) */
export async function searchAuthorBooks(
  authorName: string,
  exclude: AuthorExcludeBook[] = [],
  limit = 3,
): Promise<BookMeta[]> {
  let items: GoogleVolume[];
  try {
    items = await searchVolumes(`inauthor:${authorName}`, 20, "ja");
  } catch (error) {
    // 取得失敗は握りつぶさず再スローする。空配列で返すと「候補不足(422)」と
    // 区別できなくなるため(route側の外側catchが 5xx に変換する)
    console.error(`books: author search fetch failed for "${authorName}"`, error);
    throw error;
  }
  const an = normalize(authorName);
  const raw = items.length;

  // 1) 日本語版のみ: language === "ja" と明示できる候補だけ。未設定は通さない
  const langJa = items.filter((v) => v.volumeInfo?.language === "ja");

  // 2) 概要(description)確認済みのみ
  const withDesc = langJa.filter((v) => {
    const info = v.volumeInfo;
    return (
      info?.title !== undefined &&
      info.title !== "" &&
      info.description !== undefined &&
      info.description !== ""
    );
  });

  // 3) 先頭著者一致のみ(共著・対談・インタビュー本を除外)
  const authorMatched = withDesc.filter((v) => {
    const authors = v.volumeInfo?.authors ?? [];
    return authors.length > 0 && looseMatch(an, normalize(authors[0]));
  });

  // 4) 除外リスト(既読・「別の3冊にお願い」の直前候補)を dedup より前に適用する。
  //    dedup を先にすると、同一正規化書名の先頭候補が除外対象だった場合に後続の別版まで
  //    候補から失われ、不要な候補不足(422)を増やす。2cd5e7e と同じ「exclude → dedup」順を維持
  const afterExclude = authorMatched.filter((v) => !exclude.some((b) => matchesExcluded(v, b)));

  // 5) 正規化書名で重複除去(括弧付き別版・重版をまとめる。iteration順で先頭を残す)
  const seen = new Set<string>();
  const deduped: GoogleVolume[] = [];
  for (const v of afterExclude) {
    const key = dedupeKey(v.volumeInfo?.title ?? "");
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    deduped.push(v);
  }

  // 診断ログ: 著者探訪1回の各段階の残数(実際の処理順。APIキー・個人情報は出さない)
  console.log(
    `books: author-books filter for "${authorName}": ` +
      `raw=${raw} lang_ja=${langJa.length} with_desc=${withDesc.length} ` +
      `author_match=${authorMatched.length} after_exclude=${afterExclude.length} ` +
      `deduped=${deduped.length} final=${Math.min(deduped.length, limit)}`,
  );

  return deduped.slice(0, limit).map(toBookMeta);
}

/** 書名+著者でGoogle Booksを照合する。
    検索結果1件目をそのまま採用せず、書名・著者の一致を確認できた候補だけを採用。
    同一書籍と判断できない/取得に失敗した場合はnull(=未照合。選書自体は失敗にしない) */
export async function lookupBook(title: string, author: string): Promise<BookMeta | null> {
  const queries = [`intitle:${title} inauthor:${author}`, `${title} ${author}`];
  try {
    for (const q of queries) {
      const items = await searchVolumes(q);
      // 1件目採用ではなく、完全一致候補を部分一致候補(派生版等)より優先して選ぶ。
      // null=候補はあるが曖昧(派生版しか無い等)→未照合を確定し、次の検索段では上書きしない
      // (候補の少ない次の検索段で派生版が「唯一の候補」になって誤採用されるのを防ぐ)
      const hit = pickBestMatch(title, author, items);
      if (hit === null) return null;
      if (hit !== undefined) return toBookMeta(hit);
    }
    return null;
  } catch (error) {
    console.error(`books: lookup failed for "${title}"`, error);
    return null;
  }
}
