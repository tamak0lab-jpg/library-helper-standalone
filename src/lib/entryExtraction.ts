// 読書体験の記録(reading_entries)のAI抽出ロジック (旧 src/app/api/entries/route.ts より退避)。
// Standalone段階2-1E: Neon依存の除去に伴い、entries APIルート自体は削除するが、
// AI抽出仕様(extractEntry・verbatimOrNull・buildEntryPromptの利用)は将来のBYOK実装まで
// 実コードとして保持する。挙動は旧route.tsから一切変更していない。
//
// 絶対原則「文脈をAIが作らない」の実装:
// user_reflection / context_before / context_after は、Geminiに会話抜粋からの
// 「一字一句そのままの抜き出し」を指示したうえで、サーバー側でも
// 「ユーザー発言の部分文字列であること」を検証する。検証に通らない値はnullで保存する。
// AI司書の一言(comment)の生成に失敗しても保存自体は成功させる(記録を失わせない)。

import { generateText } from "@/lib/llm";
import { DialogueTurn, buildEntryPrompt } from "@/lib/prompts";

const MAX_MESSAGE_LENGTH = 2000;

export interface Extracted {
  userReflection: string | null;
  contextBefore: string | null;
  contextAfter: string | null;
  comment: string | null;
  character: "orange" | "gelb" | null;
}

/** ユーザー発言の一字一句そのままの部分文字列である場合のみ採用する(それ以外はnull=保存しない)。
    AIによる要約・言い換え・創作をDBに入れないための機械的な検証 */
export function verbatimOrNull(candidate: unknown, userMessages: string[]): string | null {
  if (typeof candidate !== "string") return null;
  const t = candidate.trim();
  if (t === "" || t.length > MAX_MESSAGE_LENGTH) return null;
  return userMessages.some((m) => m.includes(t)) ? t : null;
}

/** 記録の整理(抜き出し+司書の一言)を生成する。失敗時は全null(保存自体は続行)。
    apiKey: Standalone v1 BYOK(段階2-1E以降)。この関数自体は現在未使用(将来のBYOK実装で
    entries機能を復活させる際に呼び出し元からキーを渡す想定) */
export async function extractEntry(
  bookTitle: string,
  phrase: string,
  excerpt: DialogueTurn[],
  apiKey: string,
): Promise<Extracted> {
  const empty: Extracted = {
    userReflection: null,
    contextBefore: null,
    contextAfter: null,
    comment: null,
    character: null,
  };
  if (excerpt.length === 0) return empty;
  try {
    const raw = await generateText(buildEntryPrompt(bookTitle, phrase, excerpt), apiKey);
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end <= start) return empty;
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const userMessages = excerpt.filter((t) => t.speaker === "user").map((t) => t.message);
    const character =
      parsed.character === "orange" || parsed.character === "gelb" ? parsed.character : null;
    const comment =
      typeof parsed.comment === "string" &&
      parsed.comment.trim() !== "" &&
      parsed.comment.length <= 500 &&
      character !== null
        ? parsed.comment.trim()
        : null;
    return {
      userReflection: verbatimOrNull(parsed.user_reflection, userMessages),
      contextBefore: verbatimOrNull(parsed.context_before, userMessages),
      contextAfter: verbatimOrNull(parsed.context_after, userMessages),
      comment,
      character: comment !== null ? character : null,
    };
  } catch (error) {
    console.error("entries: extraction failed (saving without AI fields)", error);
    return empty;
  }
}
