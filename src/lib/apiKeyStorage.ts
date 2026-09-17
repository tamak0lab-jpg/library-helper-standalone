// Gemini APIキーのブラウザ保存 (Standalone v1 BYOK・最小構成)。
// 保存先はこのオリジンのlocalStorageのみ。サーバー・DB・ファイル・ログ・Gitには一切保存しない。
// 保存したキーはこのアプリを含む同一オリジンのJavaScriptから読み取り可能(XSSで盗まれうる)。
// 「server-onlyでクライアントバンドルに含まれない」のはSDK呼び出しコード(lib/llm.ts)の話であり、
// ここで保存する利用者自身のキーには適用されない(server-only指定では守れない領域)。

const STORAGE_KEY = "lh_gemini_api_key";

/** 保存済みキーを取得する。未設定・空文字・localStorage利用不可(プライベートモード等)はnull */
export function getApiKey(): string | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v !== null && v.trim() !== "" ? v.trim() : null;
  } catch {
    return null;
  }
}

/** キーを保存する。空文字・空白のみは保存しない(既存値の誤クリアを防ぐ) */
export function setApiKey(key: string): boolean {
  const trimmed = key.trim();
  if (trimmed === "") return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, trimmed);
    return true;
  } catch {
    return false;
  }
}

/** キーを削除する(共有端末での利用後など) */
export function clearApiKey(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 削除失敗は「既にキーが無い」のと同じ状態として扱う(呼び出し元は気にしなくてよい)
  }
}
