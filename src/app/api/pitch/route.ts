// 熱血プレゼンのサーバーAPI。「この本の魅力を見る」の展開時にオンデマンドで
// 1冊分を生成する(選書時に3冊まとめて先行生成しない=選書レイテンシを増やさない)。
// プロンプトは比較資料§3.5原文(制約6項目込み・無変更)+表現品質ルール(共通+熱血固有)+
// 統合層の出力形式。書誌は確認済みの事実のみ入力に渡す(未確認情報の捏造をさせない)。
// 原文の「十分な分量」を担保するため、最低分量をサーバー側で検証し、不足時は再試行する。
// APIキーは利用者ごと(Standalone v1 BYOK・リクエストヘッダX-Gemini-Api-Key)で受け取り、
// lib/llm.tsへその都度渡す。サーバー側では保存しない。

import { NextResponse } from "next/server";
import { generateText } from "@/lib/llm";
import { PitchInput, buildPitchPrompt } from "@/lib/prompts";
import { readApiKey } from "@/lib/apiKeyHeader";

const MAX_TEXT_LENGTH = 8000;

// 「十分な分量」(§3.5原文)の最低ライン。統合層の目安は600〜900字だが、検証は
// 熱量ある予告編として成立しうる下限に留める(2〜3文の短い要約はここで弾く)
const MIN_PITCH_LENGTH = 300;
// 分量不足・解析不能時の再試行を含めた最大生成回数
const MAX_ATTEMPTS = 3;

function isNonEmptyText(v: unknown, max = MAX_TEXT_LENGTH): v is string {
  return typeof v === "string" && v.trim() !== "" && v.length <= max;
}

/** リクエスト本文を検証つきで解析する。形式不正はnull(=400) */
function parseInput(body: unknown): PitchInput | null {
  if (typeof body !== "object" || body === null) return null;
  const { needs, books, index, confirmed, twoSentence } = body as Record<string, unknown>;
  if (!isNonEmptyText(needs)) return null;
  if (!Array.isArray(books) || books.length !== 3) return null;
  const parsedBooks: PitchInput["books"] = [];
  for (const item of books) {
    if (typeof item !== "object" || item === null) return null;
    const { title, author, summary, reason } = item as Record<string, unknown>;
    if (!isNonEmptyText(title) || !isNonEmptyText(author)) return null;
    // summary/reasonは任意(著者探訪は確認済み書誌を送るため省略される)。
    // 送られた場合のみ非空文字列を要求し、空文字・不正型はinvalid input扱い
    if (summary !== undefined && summary !== null && !isNonEmptyText(summary)) return null;
    if (reason !== undefined && reason !== null && !isNonEmptyText(reason)) return null;
    parsedBooks.push({
      title: title.trim(),
      author: author.trim(),
      summary: isNonEmptyText(summary) ? summary.trim() : undefined,
      reason: isNonEmptyText(reason) ? reason.trim() : undefined,
    });
  }
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index > 2) return null;
  let parsedConfirmed: PitchInput["confirmed"] = null;
  if (confirmed !== null && confirmed !== undefined) {
    if (typeof confirmed !== "object") return null;
    const c = confirmed as Record<string, unknown>;
    parsedConfirmed = {};
    for (const key of ["title", "author", "publisher", "publishedDate", "description"] as const) {
      const v = c[key];
      if (v === undefined || v === null) continue;
      if (!isNonEmptyText(v)) return null;
      parsedConfirmed[key] = v.trim();
    }
  }
  if (twoSentence !== null && twoSentence !== undefined && !isNonEmptyText(twoSentence)) return null;
  return {
    needs: needs.trim(),
    books: parsedBooks,
    index,
    confirmed: parsedConfirmed,
    twoSentence: isNonEmptyText(twoSentence) ? twoSentence.trim() : null,
  };
}

/** モデル応答からpitch本文を取り出す。解析不能・空はnull */
function parsePitch(raw: string): string | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const pitch = (JSON.parse(raw.slice(start, end + 1)) as { pitch?: unknown }).pitch;
    if (typeof pitch !== "string" || pitch.trim() === "") return null;
    return pitch.trim();
  } catch {
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
  const input = parseInput(body);
  if (input === null) {
    return NextResponse.json({ ok: false, error: "invalid input" }, { status: 400 });
  }
  const apiKey = readApiKey(req);
  if (apiKey === null) {
    return NextResponse.json({ ok: false, error: "api key missing" }, { status: 401 });
  }
  try {
    // 生成+検証(最低分量)。不足・解析不能はMAX_ATTEMPTSまで再試行し、
    // 最後まで満たさなければ失敗扱い(短い生成結果をそのまま表示しない)
    const prompt = buildPitchPrompt(input);
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const raw = await generateText(prompt, apiKey);
      const pitch = parsePitch(raw);
      if (pitch === null) {
        console.error(`pitch: unparsable model reply (attempt ${attempt})`, raw.slice(0, 300));
        continue;
      }
      if (pitch.length < MIN_PITCH_LENGTH) {
        console.warn(
          `pitch: too short (attempt ${attempt}), book=${input.index + 1}, length=${pitch.length}`,
        );
        continue;
      }
      // 生成状況を確認できるようログに出す(観測用。本文は出さない)
      console.log(
        `pitch: ok, book=${input.index + 1}, length=${pitch.length}, attempts=${attempt}`,
      );
      return NextResponse.json({ ok: true, pitch });
    }
    return NextResponse.json({ ok: false, error: "generation failed" }, { status: 502 });
  } catch (error) {
    console.error("pitch: generation failed", error);
    return NextResponse.json({ ok: false, error: "generation failed" }, { status: 502 });
  }
}
