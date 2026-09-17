// 著者探訪のサーバーAPI(2026-09-06新設)。入力された著者名から実在書籍をGoogle Booksで
// 検索し(選書エンジンとしてGeminiは使わない)、確認済みの候補だけを返す。
// excludeには読書中・完読の本(トレンド/grillと同じ既読除外の考え方)と、
// 「別の3冊にお願い」時の直前候補をクライアント側でまとめて渡す(searchAuthorBooks参照)。
// 2文推薦(§3.4原文・無変更)は、確認済み書誌のみを根拠に3冊分まとめて1回のGemini呼び出しで
// 生成する(トークン消費抑制)。生成・検証に失敗した本は2文推薦なし(reason非表示)のまま返し、
// ダミー文で埋めない。候補自体が3冊に満たない場合は422(架空の本で埋めない)。
// APIキーは利用者ごと(Standalone v1 BYOK・リクエストヘッダX-Gemini-Api-Key)で受け取り、
// lib/llm.tsへその都度渡す。サーバー側では保存しない。

import { NextResponse } from "next/server";
import { AuthorExcludeBook, BookMeta, searchAuthorBooks } from "@/lib/books";
import { generateText } from "@/lib/llm";
import { TwoSentenceInput, buildTwoSentenceBatchPrompt } from "@/lib/prompts";
import { isSingleSentence, joinTwoSentences } from "@/lib/twoSentence";
import { readApiKey } from "@/lib/apiKeyHeader";

const CANDIDATE_COUNT = 3;
const MAX_NAME_LENGTH = 100;
const MAX_EXCLUDE = 60;

function isNonEmptyText(v: unknown, max: number): v is string {
  return typeof v === "string" && v.trim() !== "" && v.length <= max;
}

/** リクエスト本文を検証つきで解析する。形式不正はnull(=400)。
    excludeは「読書中・完読の除外」(appState.tsのShelf由来)と「別の3冊にお願いの
    重複回避」の両方をクライアント側でまとめて渡す共通の除外リスト。
    googleVolumeIdはクライアントが把握している場合のみ含む(gb-{id}形式の書籍ID由来) */
function parseInput(
  body: unknown,
): { authorName: string; exclude: AuthorExcludeBook[] } | null {
  if (typeof body !== "object" || body === null) return null;
  const { authorName, exclude } = body as Record<string, unknown>;
  if (!isNonEmptyText(authorName, MAX_NAME_LENGTH)) return null;
  if (exclude === undefined || exclude === null) {
    return { authorName: authorName.trim(), exclude: [] };
  }
  if (!Array.isArray(exclude) || exclude.length > MAX_EXCLUDE) return null;
  const parsed: AuthorExcludeBook[] = [];
  for (const item of exclude) {
    if (typeof item !== "object" || item === null) return null;
    const { title, author, googleVolumeId } = item as Record<string, unknown>;
    if (!isNonEmptyText(title, 300) || !isNonEmptyText(author, 200)) return null;
    if (googleVolumeId !== undefined && !isNonEmptyText(googleVolumeId, 100)) return null;
    parsed.push({
      title: title.trim(),
      author: author.trim(),
      googleVolumeId: typeof googleVolumeId === "string" ? googleVolumeId.trim() : undefined,
    });
  }
  return { authorName: authorName.trim(), exclude: parsed };
}

/** モデル応答(JSON配列想定)から2文推薦をcount件分取り出す。
    全体が解析不能なら全件null。各要素は個別に検証し、満たさないものだけnullにする
    (1冊分の失敗で他の2冊まで巻き込まない) */
function parseTwoSentenceBatch(raw: string, count: number): (string | null)[] {
  const fallback = (): (string | null)[] => Array.from({ length: count }, () => null);
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return fallback();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return fallback();
  }
  const items = (parsed as { items?: unknown }).items;
  if (!Array.isArray(items)) return fallback();
  return Array.from({ length: count }, (_, i) => {
    const item = items[i];
    if (typeof item !== "object" || item === null) return null;
    const { sentence1, sentence2 } = item as Record<string, unknown>;
    const s1 = typeof sentence1 === "string" ? sentence1.trim() : "";
    const s2 = typeof sentence2 === "string" ? sentence2.trim() : "";
    if (!isSingleSentence(s1) || !isSingleSentence(s2)) return null;
    return joinTwoSentences(s1, s2);
  });
}

/** レスポンスの1冊分(page.tsxのtoBook()にそのまま渡せる形。summary/reasonは
    確認済みの選書理由が無いため省略する) */
interface AuthorBookReply {
  title: string;
  author: string;
  twoSentence: string | null;
  meta: BookMeta;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  }
  const input = parseInput(body);
  if (input === null) {
    return NextResponse.json({ ok: false, error: "invalid input" }, { status: 400 });
  }
  const apiKey = readApiKey(req);
  if (apiKey === null) {
    return NextResponse.json({ ok: false, error: "api key missing" }, { status: 401 });
  }
  try {
    let candidates: BookMeta[];
    try {
      candidates = await searchAuthorBooks(input.authorName, input.exclude, CANDIDATE_COUNT);
    } catch (error) {
      // Google Books の取得自体が失敗(429・5xx・タイムアウト等)。
      // 「実在確認できた候補が3冊に満たない」(422)とは別物として 5xx を返す。
      console.error("author-books: google books fetch failed", error);
      return NextResponse.json({ ok: false, error: "google books unavailable" }, { status: 502 });
    }
    if (candidates.length < CANDIDATE_COUNT) {
      // 取得は成功したが、実在確認・概要確認・日本語判定が取れた候補が3冊に満たない
      // →架空の本で埋めずエラー扱い
      console.log(
        `author-books: insufficient candidates for "${input.authorName}" (${candidates.length}/${CANDIDATE_COUNT})`,
      );
      return NextResponse.json({ ok: false, error: "insufficient candidates" }, { status: 422 });
    }

    // 2文推薦(§3.4原文・無変更)を3冊分まとめて1回のGemini呼び出しで生成する。
    // 悩みまとめの代わりに、選書経緯の事実(著者名)だけを渡す(悩みの捏造をしない)
    const twoSentenceInputs: TwoSentenceInput[] = candidates.map((m) => ({
      userContext: `「${input.authorName}」の作品から選んだ本です。`,
      title: m.title,
      author: m.author ?? input.authorName,
      description: m.description,
      selectionReason: `${input.authorName}の著書としてGoogle Booksで確認できた一冊`,
    }));
    let twoSentences: (string | null)[] = candidates.map(() => null);
    try {
      const raw = await generateText(buildTwoSentenceBatchPrompt(twoSentenceInputs), apiKey);
      twoSentences = parseTwoSentenceBatch(raw, candidates.length);
    } catch (error) {
      // 2文推薦の生成に失敗しても書籍自体は返す(reason非表示。ダミー文で埋めない)
      console.error("author-books: two-sentence batch failed", error);
    }

    const books: AuthorBookReply[] = candidates.map((m, i) => ({
      title: m.title,
      author: m.author ?? input.authorName,
      twoSentence: twoSentences[i],
      meta: m,
    }));
    console.log(
      `author-books: ok, author="${input.authorName}", books=${books.length}, twoSentence=${twoSentences.filter((t) => t !== null).length}/${books.length}`,
    );
    return NextResponse.json({ ok: true, books });
  } catch (error) {
    console.error("author-books: search failed", error);
    return NextResponse.json({ ok: false, error: "search failed" }, { status: 502 });
  }
}
