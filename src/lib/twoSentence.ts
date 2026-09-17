// 2文推薦の検証・結合ロジック(2026-09-06新設・著者探訪のバッチ生成用)。
//
// api/recommend/route.tsに同趣旨のロジックが既に存在するが、他の3経路(grill/トレンド/
// 別の3冊)は今回変更しないため、そのファイルには手を入れずここに同一ロジックを用意する。

import "server-only";

/** ちょうど1つの文か。日本語の句点だけに依存せず、かぎ括弧内の記号を除外したうえで
    文末記号の個数・位置で判定する(api/recommend/route.tsの同名ロジックと同一趣旨) */
export function isSingleSentence(s: string): boolean {
  const t = s.trim();
  if (t === "") return false;
  const stripped = t.replace(/「[^」]*」|『[^』]*』/g, "");
  const enders = stripped.match(/[。！？!?]/g) ?? [];
  if (enders.length > 1) return false;
  const idx = stripped.search(/[。！？!?]/);
  // 文末記号が途中にある(=複数文の連結)場合は不採用
  if (idx !== -1 && idx < stripped.length - 1) return false;
  return true;
}

/** 検証済みの1文目・2文目を表示用に連結する(1文目に文末記号が無い場合のみ句点を補う) */
export function joinTwoSentences(s1: string, s2: string): string {
  const joint = /[。！？!?」』]$/.test(s1) ? "" : "。";
  return `${s1}${joint}${s2}`;
}
