// 3冊選書のサーバーAPI。grill-me会話履歴を文脈として「世界最高の専門司書」プロンプト
// (原文無変更)でGeminiに問い合わせる。プロンプト原文がWeb検索を前提とするため、
// Google公式の検索グラウンディング(googleSearchツール)を有効にして呼び出す。
// APIキーは利用者ごと(Standalone v1 BYOK・リクエストヘッダX-Gemini-Api-Key)で受け取り、
// lib/llm.tsへその都度渡す。サーバー側では保存しない。

import { NextResponse } from "next/server";
import { lookupBook } from "@/lib/books";
import { generateText, generateTextWithSearch } from "@/lib/llm";
import {
  DialogueTurn,
  TwoSentenceInput,
  buildRecommendPrompt,
  buildTwoSentencePrompt,
} from "@/lib/prompts";
import { readApiKey } from "@/lib/apiKeyHeader";

const MAX_TURNS = 200;
const MAX_MESSAGE_LENGTH = 4000;
const VALID_SPEAKERS = new Set(["user", "orange", "gelb"]);

function parseHistory(body: unknown): DialogueTurn[] | null {
  if (typeof body !== "object" || body === null) return null;
  const history = (body as { history?: unknown }).history;
  if (!Array.isArray(history) || history.length === 0 || history.length > MAX_TURNS) return null;
  const turns: DialogueTurn[] = [];
  for (const item of history) {
    if (typeof item !== "object" || item === null) return null;
    const { speaker, message } = item as { speaker?: unknown; message?: unknown };
    if (typeof speaker !== "string" || !VALID_SPEAKERS.has(speaker)) return null;
    if (typeof message !== "string" || message.length === 0 || message.length > MAX_MESSAGE_LENGTH) return null;
    turns.push({ speaker: speaker as DialogueTurn["speaker"], message });
  }
  return turns;
}

export interface RecommendedBook {
  title: string;
  author: string;
  summary: string;
  reason: string;
}

/** モデル出力(JSON想定)を検証つきで解析する。
    ちょうど3冊・各項目が非空文字列でない場合は正常結果として扱わずnullを返す
    (=クライアント側では失敗状態として処理する) */
function parseModelReply(raw: string): { needs: string; books: RecommendedBook[] } | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { needs, books } = parsed as { needs?: unknown; books?: unknown };
  if (!Array.isArray(books) || books.length !== 3) return null;
  const result: RecommendedBook[] = [];
  for (const item of books) {
    if (typeof item !== "object" || item === null) return null;
    const { title, author, summary, reason } = item as Record<string, unknown>;
    if (typeof title !== "string" || title.trim() === "") return null;
    if (typeof author !== "string" || author.trim() === "") return null;
    if (typeof summary !== "string" || summary.trim() === "") return null;
    if (typeof reason !== "string" || reason.trim() === "") return null;
    result.push({
      title: title.trim(),
      author: author.trim(),
      summary: summary.trim(),
      reason: reason.trim(),
    });
  }
  return { needs: typeof needs === "string" ? needs.trim() : "", books: result };
}

/** ちょうど1つの文か (2文推薦の検証用)。日本語の句点だけに依存せず、
    かぎ括弧内の記号を除外したうえで文末記号の個数・位置で判定する */
function isSingleSentence(s: string): boolean {
  const t = s.trim();
  if (t === "") return false;
  const stripped = t.replace(/「[^」]*」|『[^』]*』/g, "");
  const enders = stripped.match(/[。！？!?]/g) ?? [];
  if (enders.length > 1) return false;
  const idx = stripped.search(/[。！？!?]/);
  // 文末記号が途中にある(=複数文の連結)場合は不採用
  if (idx !== -1 && idx < stripped.length - 1) return false;
  return true;
}

/** 2文推薦の生成 (書籍ごとに1セット)。
    exactly 2文・空文なしをサーバー側で検証し、満たさない場合はnull
    (=正常結果として扱わない。UI側はダミーで埋めず推薦文を非表示にする) */
async function generateTwoSentence(input: TwoSentenceInput, apiKey: string): Promise<string | null> {
  try {
    const raw = await generateText(buildTwoSentencePrompt(input), apiKey);
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      sentence1?: unknown;
      sentence2?: unknown;
    };
    const s1 = typeof parsed.sentence1 === "string" ? parsed.sentence1.trim() : "";
    const s2 = typeof parsed.sentence2 === "string" ? parsed.sentence2.trim() : "";
    if (!isSingleSentence(s1) || !isSingleSentence(s2)) return null;
    // 表示用に2文を連結 (1文目に文末記号が無い場合のみ句点を補う)
    const joint = /[。！？!?」』]$/.test(s1) ? "" : "。";
    return `${s1}${joint}${s2}`;
  } catch (error) {
    console.error("recommend: two-sentence generation failed", error);
    return null;
  }
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  }
  const history = parseHistory(body);
  if (history === null) {
    return NextResponse.json({ ok: false, error: "invalid history" }, { status: 400 });
  }
  const apiKey = readApiKey(req);
  if (apiKey === null) {
    return NextResponse.json({ ok: false, error: "api key missing" }, { status: 401 });
  }
  try {
    const { text, searchQueries } = await generateTextWithSearch(buildRecommendPrompt(history), apiKey);
    const reply = parseModelReply(text);
    if (reply === null) {
      console.error("recommend: unparsable model reply", text.slice(0, 300));
      return NextResponse.json({ ok: false, error: "unparsable reply" }, { status: 502 });
    }
    // 書誌照合 (Ver.1: Google Booksのみ)。Geminiの選んだ3冊をタイトル+著者で照合し、
    // 確認できた書誌だけをmetaとして返す。照合失敗・取得失敗は選書自体の失敗にはせず
    // meta=null(未照合)として選書結果を維持する
    const metas = await Promise.all(
      reply.books.map((b) => lookupBook(b.title, b.author)),
    );
    // 2文推薦 (書籍ごとに1セット・並列生成)。入力は
    // grill-me由来のユーザー文脈(選書時の悩みまとめ。空なら会話中のユーザー発言) /
    // 選書時のreason / 書誌APIで確認できた情報のみ(未確認の概要は渡さず推測もさせない)。
    // 生成・検証失敗はnull=そのカードの推薦文を非表示(選書3冊自体は消さない)
    const userContext =
      reply.needs !== ""
        ? reply.needs
        : history
            .filter((t) => t.speaker === "user")
            .map((t) => t.message)
            .join(" / ");
    const twoSentences = await Promise.all(
      reply.books.map((b, i) =>
        generateTwoSentence(
          {
            userContext,
            title: metas[i]?.title ?? b.title,
            author: metas[i]?.author ?? b.author,
            description: metas[i]?.description ?? null,
            selectionReason: b.reason,
          },
          apiKey,
        ),
      ),
    );
    // 検索グラウンディング・書誌照合・2文推薦の状況を確認できるようログに出す(観測用)
    console.log(
      `recommend: 3 books ok, grounding queries=${searchQueries.length}, matched=${metas.filter((m) => m !== null).length}/3, twoSentence=${twoSentences.filter((t) => t !== null).length}/3`,
      searchQueries.slice(0, 5),
    );
    return NextResponse.json({
      ok: true,
      books: reply.books.map((b, i) => ({ ...b, meta: metas[i], twoSentence: twoSentences[i] })),
      needs: reply.needs,
      grounding: { used: searchQueries.length > 0, queries: searchQueries },
    });
  } catch (error) {
    console.error("recommend: generation failed", error);
    return NextResponse.json({ ok: false, error: "generation failed" }, { status: 502 });
  }
}
