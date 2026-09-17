// APIキーのリクエストヘッダ受け渡し (Standalone v1 BYOK)。
// 6つのAI API route(grill/support/meaning/recommend/author-books/pitch)共通の
// 「クライアントが付与したヘッダからキーを取り出す」処理を1箇所にまとめる。
// キー自体はここでも保存しない(取り出して返すだけ)。

export const API_KEY_HEADER = "X-Gemini-Api-Key";

/** リクエストヘッダからAPIキーを取り出す。未設定・空文字はnull */
export function readApiKey(req: Request): string | null {
  const v = req.headers.get(API_KEY_HEADER);
  if (v === null) return null;
  const trimmed = v.trim();
  return trimmed !== "" ? trimmed : null;
}
