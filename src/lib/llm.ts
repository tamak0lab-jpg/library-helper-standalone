import "server-only";
import { GoogleGenAI } from "@google/genai";

const MODEL = "gemini-3.7-flash";

// Standalone v1 BYOK: キーは環境変数ではなく、呼び出し元(各API route)が
// リクエストごとに受け取った利用者のAPIキーを引数で渡す。サーバー側では保存しない。
function getGeminiClient(apiKey: string) {
  if (!apiKey) {
    throw new Error("Gemini APIキーが指定されていません。");
  }

  return new GoogleGenAI({ apiKey });
}

export async function generateText(prompt: string, apiKey: string): Promise<string> {
  const ai = getGeminiClient(apiKey);

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
  });

  const text = response.text?.trim();

  if (!text) {
    throw new Error("Gemini から回答を取得できませんでした。");
  }

  return text;
}

export interface GroundedResult {
  text: string;
  /** Google検索グラウンディングが実際に使われた場合の検索クエリ一覧 (未使用なら空配列) */
  searchQueries: string[];
}

/** Google検索グラウンディングを有効にした生成 (選書などWeb検索前提のプロンプト用)。
    検索の実行判断はGemini側(公式のgoogleSearchツール)に委ね、独自の検索ロジックは持たない */
export async function generateTextWithSearch(prompt: string, apiKey: string): Promise<GroundedResult> {
  const ai = getGeminiClient(apiKey);

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: { tools: [{ googleSearch: {} }] },
  });

  const text = response.text?.trim();

  if (!text) {
    throw new Error("Gemini から回答を取得できませんでした。");
  }

  const grounding = response.candidates?.[0]?.groundingMetadata;
  return { text, searchQueries: grounding?.webSearchQueries ?? [] };
}