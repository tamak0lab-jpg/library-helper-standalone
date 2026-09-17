// grill-me会話のサーバーAPI。APIキーは利用者ごと(Standalone v1 BYOK・リクエストヘッダ
// X-Gemini-Api-Key)で受け取り、lib/llm.tsへその都度渡す。サーバー側では保存しない。
// クライアントには会話履歴と応答(dialogue/done)だけをやり取りする。
// プロンプトはlib/prompts.tsの原文を無変更で使用する。

import { NextResponse } from "next/server";
import { generateText } from "@/lib/llm";
import { DialogueTurn, buildGrillPrompt } from "@/lib/prompts";
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

interface GrillReply {
  dialogue: { speaker: "orange" | "gelb"; message: string }[];
  done: boolean;
}

/** モデル出力(JSON想定)を検証つきで解析する。コードブロック記号等は除去して救済する。
    解析できない場合はnull(=クライアント側で再試行案内) */
function parseModelReply(raw: string): GrillReply | null {
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
  const { dialogue, ready_for_selection } = parsed as {
    dialogue?: unknown;
    ready_for_selection?: unknown;
  };
  if (!Array.isArray(dialogue) || dialogue.length === 0) return null;
  const items: GrillReply["dialogue"] = [];
  // 原則1ターン1キャラクター(両役割が必要な場合のみ2件) — 念のためサーバー側でも2件までに制限
  for (const item of dialogue.slice(0, 2)) {
    if (typeof item !== "object" || item === null) return null;
    const { speaker, message } = item as { speaker?: unknown; message?: unknown };
    if (speaker !== "orange" && speaker !== "gelb") return null;
    if (typeof message !== "string" || message.trim() === "") return null;
    items.push({ speaker, message: message.trim() });
  }
  return { dialogue: items, done: ready_for_selection === true };
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
    const raw = await generateText(buildGrillPrompt(history), apiKey);
    const reply = parseModelReply(raw);
    if (reply === null) {
      console.error("grill: unparsable model reply", raw.slice(0, 200));
      return NextResponse.json({ ok: false, error: "unparsable reply" }, { status: 502 });
    }
    return NextResponse.json({ ok: true, ...reply });
  } catch (error) {
    console.error("grill: generation failed", error);
    return NextResponse.json({ ok: false, error: "generation failed" }, { status: 502 });
  }
}
