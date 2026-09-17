// 20往復超の長期会話の「古い部分の要約」を生成する境界 (引継ぎ§6.7の実装仕様)。
//
// ここが将来の外部AI(要約生成)との唯一の差し替え点。状態管理(appState)は
// この関数のシグネチャだけに依存し、要約の生成方法には依存しない。
// 採用するAIプロバイダーは未決定 — このファイル以外でAPI選定を前提にしないこと。
//
// 要約に将来残す内容(実装仕様): セッションの目的 / ユーザーの考え・希望 /
// 重要発言 / 決定事項 / 選書・読書支援を続けるために必要な情報。
// 外部AI接続時は、この関数を「prevSummary+olderMessagesから上記を含む要約文を
// 生成する」実装に差し替える。

import { ChatMessage } from "./dummyData";

/**
 * 直近10往復から押し出された古いメッセージを、保存済み要約へ統合する。
 *
 * 暫定実装(外部依存なしフェーズ): 決定論的な転記ダイジェスト。
 * 保持構造とロールアップ挙動の検証が目的で、文章品質は本番確定ではない。
 * UIには一切表示しない内部コンテキスト用データ(新しいプロダクト文言ではない)。
 * transientメッセージは呼び出し側で除外済みであることを前提とする。
 */
export function summarizeSession(
  prevSummary: string | null,
  olderMessages: ChatMessage[],
): string {
  const lines = olderMessages.map((m) => `${m.speaker}: ${m.message}`);
  return [...(prevSummary !== null ? [prevSummary] : []), ...lines].join("\n");
}
