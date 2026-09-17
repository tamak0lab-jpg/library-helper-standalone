// 読書支援会話のサーバーAPI。APIキーは利用者ごと(Standalone v1 BYOK・リクエストヘッダ
// X-Gemini-Api-Key)で受け取り、lib/llm.tsへその都度渡す。サーバー側では保存しない。
// クライアントには対象書籍・会話履歴と応答(dialogue)だけをやり取りする。
// プロンプトはlib/prompts.tsの原文(§3.6・制約4項目込み)を無変更で使用し、
// キャラクター運用ルール・表現品質ルール(共通+読書支援固有)を併用する。

import { NextResponse } from "next/server";
import { generateText } from "@/lib/llm";
import { DialogueTurn, SupportBook, buildSupportPrompt } from "@/lib/prompts";
import { readApiKey } from "@/lib/apiKeyHeader";

const MAX_TURNS = 200;
const MAX_MESSAGE_LENGTH = 4000;
const VALID_SPEAKERS = new Set(["user", "orange", "gelb"]);

function parseBody(body: unknown): { book: SupportBook; history: DialogueTurn[] } | null {
  if (typeof body !== "object" || body === null) return null;
  const { bookTitle, bookAuthor, history } = body as {
    bookTitle?: unknown;
    bookAuthor?: unknown;
    history?: unknown;
  };
  if (typeof bookTitle !== "string" || bookTitle.trim() === "" || bookTitle.length > 500) return null;
  if (typeof bookAuthor !== "string" || bookAuthor.trim() === "" || bookAuthor.length > 500) return null;
  if (!Array.isArray(history) || history.length === 0 || history.length > MAX_TURNS) return null;
  const turns: DialogueTurn[] = [];
  for (const item of history) {
    if (typeof item !== "object" || item === null) return null;
    const { speaker, message } = item as { speaker?: unknown; message?: unknown };
    if (typeof speaker !== "string" || !VALID_SPEAKERS.has(speaker)) return null;
    if (typeof message !== "string" || message.length === 0 || message.length > MAX_MESSAGE_LENGTH) return null;
    turns.push({ speaker: speaker as DialogueTurn["speaker"], message });
  }
  return { book: { title: bookTitle.trim(), author: bookAuthor.trim() }, history: turns };
}

interface SupportReply {
  dialogue: { speaker: "orange" | "gelb"; message: string }[];
  /** 読書録への保存提案 (後から振り返る価値が高い場面に限る・承諾時のみ保存)。
      phraseは会話に実在する文字列であることをサーバー側でも検証する(創作フレーズは提案させない) */
  saveProposal: { phrase: string } | null;
}

/** モデル出力(JSON想定)を検証つきで解析する。
    解析できない場合はnull(=クライアント側で再試行案内) */
function parseModelReply(raw: string, history: DialogueTurn[]): SupportReply | null {
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
  const { dialogue, save_proposal } = parsed as { dialogue?: unknown; save_proposal?: unknown };
  if (!Array.isArray(dialogue) || dialogue.length === 0) return null;
  const items: SupportReply["dialogue"] = [];
  // 原則1ターン1キャラクター(両役割が必要な場合のみ2件) — 念のためサーバー側でも2件までに制限
  for (const item of dialogue.slice(0, 2)) {
    if (typeof item !== "object" || item === null) return null;
    const { speaker, message } = item as { speaker?: unknown; message?: unknown };
    if (speaker !== "orange" && speaker !== "gelb") return null;
    if (typeof message !== "string" || message.trim() === "") return null;
    items.push({ speaker, message: message.trim() });
  }
  // 保存提案: phraseが会話中に実在する場合のみ有効(会話に無い文の提案は破棄。応答自体は返す)
  let saveProposal: SupportReply["saveProposal"] = null;
  if (typeof save_proposal === "object" && save_proposal !== null) {
    const phrase = (save_proposal as { phrase?: unknown }).phrase;
    if (typeof phrase === "string") {
      const t = phrase.trim();
      if (t !== "" && t.length <= 500 && history.some((h) => h.message.includes(t))) {
        saveProposal = { phrase: t };
      }
    }
  }
  return { dialogue: items, saveProposal };
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
    const raw = await generateText(buildSupportPrompt(input.book, input.history), apiKey);
    const reply = parseModelReply(raw, input.history);
    if (reply === null) {
      console.error("support: unparsable model reply", raw.slice(0, 200));
      return NextResponse.json({ ok: false, error: "unparsable reply" }, { status: 502 });
    }
    return NextResponse.json({ ok: true, dialogue: reply.dialogue, saveProposal: reply.saveProposal });
  } catch (error) {
    console.error("support: generation failed", error);
    return NextResponse.json({ ok: false, error: "generation failed" }, { status: 502 });
  }
}
