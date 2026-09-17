"use client";

// Gemini APIキー設定モーダル (Standalone v1 BYOK・最小構成)。
// 保存先はブラウザのlocalStorageのみ(src/lib/apiKeyStorage.ts)。サーバー・DB・ログ・Gitには
// 一切送らない・保存しない。入力→保存の1ステップのみで完結させ、再デプロイ・env設定は不要にする。

import { useState } from "react";
import { clearApiKey, getApiKey, setApiKey } from "@/lib/apiKeyStorage";

interface ApiKeySettingsModalProps {
  open: boolean;
  onClose: () => void;
}

// 開くたびに呼び出し元がkeyを変えて再マウントする(page.tsx参照)。
// これによりuseEffectでのsetState同期呼び出しを使わずに、開くたび入力欄・保存状態を最新化する
export default function ApiKeySettingsModal({ open, onClose }: ApiKeySettingsModalProps) {
  const [input, setInput] = useState("");
  const [hasSavedKey, setHasSavedKey] = useState(() => getApiKey() !== null);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (!open) return null;

  const handleSave = () => {
    if (setApiKey(input)) {
      setHasSavedKey(true);
      setInput("");
      setFeedback("保存したよ。");
    } else {
      setFeedback("キーを入力してね。");
    }
  };

  const handleClear = () => {
    clearApiKey();
    setHasSavedKey(false);
    setInput("");
    setFeedback("削除したよ。");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Gemini APIキー設定"
        className="w-full max-w-sm rounded-r3 bg-white p-5 text-charcoal shadow-[0_4px_16px_rgba(17,17,17,0.15)]"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">Gemini APIキー設定</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="text-ink-soft"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-4 w-4">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <p className="mb-3 text-t4 leading-[1.7] text-ink-soft">
          自分のGemini APIキーをこのブラウザに保存すると、AI機能(会話・選書など)が使えるようになるよ。
          キーはこの端末のブラウザにだけ保存され、Gemini以外へは送られない。
        </p>

        <p className="mb-3 text-t4 leading-[1.7] text-ink-soft">
          キーをお持ちでない場合は、
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="text-action no-underline"
          >
            Google AI Studio
          </a>
          で取得できるよ。
        </p>

        <p className="mb-3 text-t4 text-ink-soft">
          現在の状態: <span className="font-semibold text-charcoal">{hasSavedKey ? "設定済み" : "未設定"}</span>
        </p>

        <input
          type="password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Gemini APIキーを貼り付け"
          autoComplete="off"
          className="mb-3 w-full rounded-r2 border border-hairline px-3 py-2 text-[13.5px] text-charcoal outline-none focus:border-[var(--color-action)]"
        />

        {feedback !== null && <p className="mb-3 text-t4 text-ink-soft">{feedback}</p>}

        <div className="mb-4 flex gap-2">
          <button
            type="button"
            onClick={handleSave}
            className="flex-1 rounded-r2 bg-[var(--color-action)] px-3 py-2 text-[13.5px] font-semibold text-white"
          >
            保存
          </button>
          <button
            type="button"
            onClick={handleClear}
            disabled={!hasSavedKey}
            className="rounded-r2 border border-hairline px-3 py-2 text-[13.5px] text-charcoal disabled:opacity-40"
          >
            削除
          </button>
        </div>

        <p className="text-[11.5px] leading-[1.6] text-ink-soft">
          共有端末では保存しないでください。使用後は「削除」から消してください。
        </p>
      </div>
    </div>
  );
}
