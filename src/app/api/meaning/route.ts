// 意味質問のサーバーAPI。APIキーは利用者ごと(Standalone v1 BYOK・リクエストヘッダ
// X-Gemini-Api-Key)で受け取り、lib/llm.tsへその都度渡す。サーバー側では保存しない。
// プロンプトはlib/prompts.tsの原文(§3.7・2026-08-23確定)を無変更で使用し、
// キャラクター運用ルール・表現品質ルール(共通+意味質問固有)を併用する。
// grill-me中(書籍なし)・読書支援中(書籍あり)のどちらからも呼ばれる(専用モードなし)。
// 検索グラウンディングは使わない(原文の優先順位1〜3=会話文脈→書籍情報→一般知識で回答。
// Web検索結果を本文の代用にしない)。

import { NextResponse } from "next/server";
import { generateText } from "@/lib/llm";
import { DialogueTurn, SupportBook, buildMeaningPrompt } from "@/lib/prompts";
import { readApiKey } from "@/lib/apiKeyHeader";

const MAX_TURNS = 200;
const MAX_MESSAGE_LENGTH = 4000;
const VALID_SPEAKERS = new Set(["user", "orange", "gelb"]);

function parseBody(body: unknown): { book: SupportBook | null; history: DialogueTurn[] } | null {
  if (typeof body !== "object" || body === null) return null;
  const { bookTitle, bookAuthor, history } = body as {
    bookTitle?: unknown;
    bookAuthor?: unknown;
    history?: unknown;
  };
  // 書籍は任意(grill-me中はなし)。渡す場合は書名・著者の両方が必要
  let book: SupportBook | null = null;
  if (bookTitle !== undefined && bookTitle !== null) {
    if (typeof bookTitle !== "string" || bookTitle.trim() === "" || bookTitle.length > 500) return null;
    if (typeof bookAuthor !== "string" || bookAuthor.trim() === "" || bookAuthor.length > 500) return null;
    book = { title: bookTitle.trim(), author: bookAuthor.trim() };
  }
  if (!Array.isArray(history) || history.length === 0 || history.length > MAX_TURNS) return null;
  const turns: DialogueTurn[] = [];
  for (const item of history) {
    if (typeof item !== "object" || item === null) return null;
    const { speaker, message } = item as { speaker?: unknown; message?: unknown };
    if (typeof speaker !== "string" || !VALID_SPEAKERS.has(speaker)) return null;
    if (typeof message !== "string" || message.length === 0 || message.length > MAX_MESSAGE_LENGTH) return null;
    turns.push({ speaker: speaker as DialogueTurn["speaker"], message });
  }
  // 意味質問は末尾がユーザーの質問であることを前提とする
  if (turns[turns.length - 1].speaker !== "user") return null;
  return { book, history: turns };
}

/** モデル出力(JSON想定)を検証つきで解析する。
    解析できない場合はnull(=クライアント側で再試行案内) */
function parseModelReply(raw: string): { speaker: "orange" | "gelb"; message: string }[] | null {
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
  const { dialogue } = parsed as { dialogue?: unknown };
  if (!Array.isArray(dialogue) || dialogue.length === 0) return null;
  const items: { speaker: "orange" | "gelb"; message: string }[] = [];
  // 原則1ターン1キャラクター(両役割が必要な場合のみ2件) — 念のためサーバー側でも2件までに制限
  for (const item of dialogue.slice(0, 2)) {
    if (typeof item !== "object" || item === null) return null;
    const { speaker, message } = item as { speaker?: unknown; message?: unknown };
    if (speaker !== "orange" && speaker !== "gelb") return null;
    if (typeof message !== "string" || message.trim() === "") return null;
    items.push({ speaker, message: message.trim() });
  }
  return items;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  }
  const input = parseBody(body);
  if (input === null) {
    return NextResponse.json({ ok: false, error: "invalid input" }, { status: 400 });
  }
  const apiKey = readApiKey(req);
  if (apiKey === null) {
    return NextResponse.json({ ok: false, error: "api key missing" }, { status: 401 });
  }
  try {
    const raw = await generateText(buildMeaningPrompt(input.book, input.history), apiKey);
    const dialogue = parseModelReply(raw);
    if (dialogue === null) {
      console.error("meaning: unparsable model reply", raw.slice(0, 200));
      return NextResponse.json({ ok: false, error: "unparsable reply" }, { status: 502 });
    }
    return NextResponse.json({ ok: true, dialogue });
  } catch (error) {
    console.error("meaning: generation failed", error);
    return NextResponse.json({ ok: false, error: "generation failed" }, { status: 502 });
  }
}
