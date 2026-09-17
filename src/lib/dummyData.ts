// 動作確認用モックのダミーデータ。本番ではAI・APIから取得する。

export type Speaker = "user" | "orange" | "gelb" | "system";

export interface ChatMessage {
  id: number;
  speaker: Speaker;
  message: string;
  /** 一時表示専用(受けとめメッセージ等)。§6.4: どのセッション履歴にも保存しない。
      段階3の履歴保存実装時、このフラグ付きメッセージは保存対象から除外する */
  transient?: boolean;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  /** 2文推薦 (§13: 1文目=薦める理由/2文目=読後に残るもの)。
      API選書本は実Gemini生成(2文推薦本番プロンプト)。生成できなかった場合は
      未設定=UIで非表示(ダミーで埋めない)。ダミープールはv13サンプル文を保持 */
  reason?: string;
  /** 展開時の熱血プレゼン。ダミープール(架空サンプル本)はv13サンプル文を保持。
      API選書本は未設定=展開時に実Gemini生成(/api/pitch)をオンデマンド表示する */
  reasonDetail?: string;
  /* ---- 二次情報・書誌 (Ver.1表示原則: 確認できた事実だけ表示。未設定の項目はUIで非表示) ----
     rating/reviewCountはダミープール(架空のサンプル本)のみv13サンプル値を保持。
     選書API経由の実在書は書誌API(Google Books)で確認できた場合のみ設定される */
  rating?: string;
  reviewCount?: number;
  coverUrl?: string; // 実表紙 (書誌APIで確認できた場合のみ。別書籍の表紙代用は禁止)
  googleVolumeId?: string; // Google Books volumeId (照合できた場合。書籍一意IDの最優先材料)
  isbn13?: string; // 参考書誌 (取得できた場合。主キー前提にしない)
  publisher?: string;
  publishedDate?: string;
  description?: string; // 書誌API由来の概要 (保持のみ。表示は既存どおりGemini生成を使用)
}

/* ================= 候補プール (v13と同一の文言・書籍は一意IDで識別) =================
   §13: 2文推薦=1文目理由+2文目読後の変化。AIが都度生成する想定のサンプル */

// grill-me由来の候補プール (v13 GRILL_POOL)
export const GRILL_POOL: Book[] = [
  {
    id: "bk-essential",
    title: "エッセンシャル思考",
    author: "グレッグ・マキューン",
    reason:
      "「選択する基準を作りたい」という今の課題に、考え方の土台から応えてくれる一冊です。読み終える頃には、「手放す」決断に自信が持てるようになります。",
    reasonDetail:
      "対話の中で見えてきたのは、やりたいことが無いのではなく「どれを選ぶかの基準が定まっていない」というモヤモヤでした。本書は「より少なく、しかしより良く」という考え方で、自分の判断軸を作る方法を具体的に教えてくれます。第3章の「選択」の話だけでも、今の霧が晴れるはずです。",
    rating: "4.4",
    reviewCount: 128,
  },
  {
    id: "bk-think-again",
    title: "THINK AGAIN",
    author: "アダム・グラント",
    reason:
      "積み上げてきた考え方を一度見直したい、というあなたの言葉に応える一冊です。前提を疑い直す習慣が、判断の質を一段引き上げてくれます。",
    reasonDetail:
      "自分の思い込みを手放し、考え直す力(再考力)を科学的な根拠とストーリーで学べます。判断軸を作る前に、いまの前提を疑う視点が手に入ります。意見を変えることは負けではなく強さだ、と心から思える一冊です。",
    rating: "4.3",
    reviewCount: 96,
  },
  {
    id: "bk-kagiri",
    title: "限りある時間の使い方",
    author: "オリバー・バークマン",
    reason:
      "「全部やる」を手放すための現実的な方法を探しているあなたに合っています。時間の使い方に、自分なりの優先順位が生まれます。",
    reasonDetail:
      "人生は約4000週間しかない、という事実から出発して「何を捨てるか」を実践レベルで考えさせてくれる本です。読み終わったあと、明日からの時間の使い方が具体的に変わります。",
    rating: "4.2",
    reviewCount: 214,
  },
  {
    id: "bk-issue",
    title: "イシューからはじめよ",
    author: "安宅和人",
    reason:
      "「何を解くべきか」を先に決める思考法が、今の停滞感の突破口になります。動き出す前に立ち止まる価値が分かるようになります。",
    reasonDetail:
      "生産性の高い仕事は「イシュー度」の高い課題選びから始まる、という視点を具体例とともに提示します。悩む前に「解くべき問い」を見極める癖がつく一冊です。",
    rating: "4.5",
    reviewCount: 410,
  },
  {
    id: "bk-sapiens",
    title: "サピエンス全史",
    author: "ユヴァル・ノア・ハラリ",
    reason:
      "目の前の悩みを大きな視点から眺め直したいときに効く一冊です。日々の選択を、歴史というスケールで相対化できるようになります。",
    reasonDetail:
      "人類の歴史を「虚構」という切り口から読み解く大作です。自分の悩みがどんな物語の上に乗っているのかに気づくと、選択はずっと軽くなります。",
    rating: "4.6",
    reviewCount: 1540,
  },
];

// トレンドのカテゴリ別プール (v13 TREND_POOLS)
export const TREND_POOLS: Record<string, Book[]> = {
  "ビジネス・実用": [
    { id: "bk-output", title: "アウトプット大全", author: "樺沢紫苑",
      reason: "学んだことを行動に変える具体的な型を求めている人に合う教科書です。読んだ内容が「使える知識」に変わっていく感覚が得られます。",
      reasonDetail: "読む・話す・書く、すべての行動をアウトプットとして捉え直し、圧倒的な実践量に落とし込む方法を解説します。", rating: "4.3", reviewCount: 301 },
    { id: "bk-issue", title: "イシューからはじめよ", author: "安宅和人",
      reason: "成果につながる課題選びから仕事を組み立て直したい人への定番です。着手前に「解くべき問い」を見極める癖がつきます。",
      reasonDetail: "生産性の高い仕事は「イシュー度」の高い課題選びから始まる、という視点を具体例とともに提示します。", rating: "4.5", reviewCount: 410 },
    { id: "bk-think-again", title: "THINK AGAIN", author: "アダム・グラント",
      reason: "思い込みを手放し、考え直す力を科学的に学べる一冊です。意見を変えることを強さとして捉えられるようになります。",
      reasonDetail: "再考する力を科学的に解き明かし、意見を変えることの強さを教えてくれます。", rating: "4.3", reviewCount: 96 },
    { id: "bk-influence", title: "影響力の武器", author: "ロバート・チャルディーニ",
      reason: "人が動く裏側にある6つの原理を、豊富な実例で学べる定番書です。日常の意思決定を一歩引いて眺められるようになります。",
      reasonDetail: "承諾の心理を解き明かした古典的名著。営業や交渉だけでなく、自分が「動かされる」場面にも気づけるようになります。", rating: "4.4", reviewCount: 520 },
    { id: "bk-give-take", title: "GIVE & TAKE", author: "アダム・グラント",
      reason: "「与える人」が長期的に成果を出す理由をデータで示す一冊です。周囲との関わり方に、新しい軸が一本通ります。",
      reasonDetail: "ギバー・テイカー・マッチャーという3類型から、長期的に成果を出す働き方を描きます。", rating: "4.2", reviewCount: 280 },
    { id: "bk-shoe-dog", title: "SHOE DOG", author: "フィル・ナイト",
      reason: "理屈より前に進む力が欲しいときに効く、ナイキ創業者の赤裸々な自伝です。泥臭く挑み続けることへの見方が変わります。",
      reasonDetail: "創業から上場までの綱渡りの日々を、驚くほど率直に綴った回顧録です。", rating: "4.7", reviewCount: 610 },
  ],
  "小説・エンタメ": [
    { id: "bk-naruse", title: "成瀬は天下を取りにいく", author: "宮島未奈",
      reason: "何にも染まらない主人公の熱量を浴びたい気分に応える本屋大賞受賞作です。読後は、自分の「好き」にもう少し正直になれます。",
      reasonDetail: "「島崎、わたしはこの夏を無駄にしない」。まっすぐすぎる成瀬の生き方が痛快な連作短編です。", rating: "4.6", reviewCount: 890 },
    { id: "bk-nanji", title: "汝、星のごとく", author: "凪良ゆう",
      reason: "不器用な人間関係の機微に、静かに寄り添ってほしいときの一冊です。ままならなさを抱えたまま進む強さを受け取れます。",
      reasonDetail: "瀬戸内の島で出会った二人の、15年にわたる愛の物語。本屋大賞受賞作です。", rating: "4.5", reviewCount: 720 },
    { id: "bk-doushi", title: "同志少女よ、敵を撃て", author: "逢坂冬馬",
      reason: "重い問いを物語として受け止めたい今に合う話題作です。戦争と尊厳について、自分の言葉で考えたくなります。",
      reasonDetail: "独ソ戦を舞台に、狙撃兵となった少女の目から戦争と人間の尊厳を描いた話題作です。", rating: "4.6", reviewCount: 640 },
    { id: "bk-penguin", title: "ペンギン・ハイウェイ", author: "森見登美彦",
      reason: "少し不思議な夏の世界に心を遊ばせたいときにどうぞ。子どもの頃の「知りたい」という気持ちがよみがえります。",
      reasonDetail: "知的好奇心旺盛な少年の夏を描く、みずみずしい青春SFです。", rating: "4.3", reviewCount: 410 },
    { id: "bk-conbini", title: "コンビニ人間", author: "村田沙耶香",
      reason: "「普通」への違和感を静かに見つめ直したい人に合う芥川賞受賞作です。当たり前を疑う視点が一つ増えます。",
      reasonDetail: "コンビニで18年働く古倉さんの目から「普通」を問い直す芥川賞受賞作です。", rating: "4.1", reviewCount: 530 },
    { id: "bk-kagami", title: "かがみの孤城", author: "辻村深月",
      reason: "傷ついた心にそっと寄り添う物語を求めている今に合う一冊です。居場所は一つではない、と思えるようになります。",
      reasonDetail: "居場所を失った7人の中学生が、鏡の中の城で出会う本屋大賞受賞作です。", rating: "4.6", reviewCount: 900 },
  ],
  総合: [
    { id: "bk-kagiri", title: "限りある時間の使い方", author: "オリバー・バークマン",
      reason: "「全部やる」を手放したい今の気分に合っています。時間の使い方に、自分なりの優先順位が生まれます。",
      reasonDetail: "人生は約4000週間。何を捨てるかを実践的に考えさせてくれるベストセラーです。", rating: "4.2", reviewCount: 214 },
    { id: "bk-essential", title: "エッセンシャル思考", author: "グレッグ・マキューン",
      reason: "判断の基準を作りたいという課題に、考え方の土台から応えてくれます。「手放す」決断に自信が持てるようになります。",
      reasonDetail: "より少なく、しかしより良く。選択の質を上げる考え方を学べる定番書です。", rating: "4.4", reviewCount: 128 },
    { id: "bk-naruse", title: "成瀬は天下を取りにいく", author: "宮島未奈",
      reason: "まっすぐな熱量を分けてもらいたい今に合う本屋大賞受賞作です。自分の「好き」に正直になれます。",
      reasonDetail: "まっすぐすぎる成瀬の生き方が痛快な連作短編です。", rating: "4.6", reviewCount: 890 },
    { id: "bk-factfulness", title: "FACTFULNESS", author: "ハンス・ロスリング",
      reason: "データで世界を正しく見る10の思考法を学べるベストセラーです。ニュースの受け止め方が落ち着いたものに変わります。",
      reasonDetail: "思い込みを乗り越え、データを基に世界を正しく見る習慣を解説します。", rating: "4.5", reviewCount: 1020 },
    { id: "bk-shikou", title: "思考の整理学", author: "外山滋比古",
      reason: "考えを寝かせて育てる、時代を超えた思考の作法を学べます。アイデアを急がず待つ余裕が生まれます。",
      reasonDetail: "「グライダー人間」ではなく自分で飛べる人になるための、長く読み継がれる一冊です。", rating: "4.2", reviewCount: 610 },
    { id: "bk-sapiens", title: "サピエンス全史", author: "ユヴァル・ノア・ハラリ",
      reason: "大きな視点で今の悩みを相対化したいときに効く一冊です。日々の選択を歴史のスケールで眺められるようになります。",
      reasonDetail: "人類の歴史を「虚構」という切り口から読み解く大作です。", rating: "4.6", reviewCount: 1540 },
  ],
};

// 著者探訪の候補著者 (v13 AUTHOR_POOL。部分一致2文字以上・候補最大5件)
export const AUTHOR_POOL = [
  "村上春樹", "村上龍", "村田沙耶香", "村山由佳", "西村京太郎",
  "森見登美彦", "辻村深月", "凪良ゆう", "宮島未奈", "逢坂冬馬",
] as const;

// 著者探訪の3冊は2026-09-06確定でGoogle Booksの実在書籍検索(/api/author-books・
// lib/books.tsのsearchAuthorBooks)に置き換え済み。旧v13ダミー生成buildAuthorBooksは
// 参照が無くなったため削除した(架空書名「○○『入門・代表作』」等は廃止)。

// grill-me台本: ユーザーが入力するたびに1問ずつ返す固定の質問
// 初回発言は確定文言 (引継ぎ§6.5)
export const grillOpening: Omit<ChatMessage, "id">[] = [
  {
    speaker: "orange",
    message:
      "最近、気になっていることはある？ うまく言葉にできなくても大丈夫。いっしょに整理しながら、ぴったりの本を探してみよう。",
  },
];

export const grillQuestions: Omit<ChatMessage, "id">[][] = [
  [
    {
      speaker: "gelb",
      message:
        "なるほど、ありがとうございます。では、なぜそれが気になっているのだと思いますか?言葉の裏にある気持ちを聞かせてください。",
    },
  ],
  [
    {
      speaker: "orange",
      message:
        "うんうん、すごく大事なところに近づいてる気がする。もしかすると「やり方が分からない」より「どれを選べばいいか決められない」という面もあるのかな?",
    },
  ],
];

// 3回目の入力後: 核心の提示 → 検索へ
export const grillCore: Omit<ChatMessage, "id">[] = [
  {
    speaker: "gelb",
    message:
      "ここまでの対話を整理しますね。\n\nあなたのモヤモヤの核心は、「選択肢がない」のではなく「選択する基準が定まっていない」ことのようです。",
  },
  {
    speaker: "gelb",
    message:
      "あなたが求めているもの:\n✓ 考え方を整理したい\n✓ 判断軸を作りたい\n✓ 実践できる方法が欲しい",
  },
  {
    speaker: "orange",
    message:
      "だいぶ見えてきたね。この核心をもとに、3冊選んでみるよ。ちょっとだけ待っててね。",
  },
];

// 検索完了後にPane3へ出すメッセージ
export const grillDone: Omit<ChatMessage, "id">[] = [
  {
    speaker: "orange",
    message:
      "お待たせ!あなたのための3冊を「選ぶ」に並べたよ。気になる一冊から開いてみてね。もちろん、この会話はこのまま続けられるよ。",
  },
];

// 「この本に決めた」直後の受けとめメッセージ (確定文言。一時表示化・状態遷移は段階2)
export const readingStart = (title: string): Omit<ChatMessage, "id">[] => [
  {
    speaker: "orange",
    message: `『${title}』を選んだんだね!ここからは一緒に伴走するよ。感想も疑問も、いつでも話しかけてね。`,
  },
];

// 案内文言 (引継ぎ§6.5の確定文言。表示時の「●（オランジェ）」プレフィックスは描画層が付与)
export const guideMessages = {
  /** ①通常初期: 何を入力しても案内のみ(会話・grill-me・選書・Pane2/4変更を開始しない) */
  initial:
    "本を探したいなら、「探す」のgrill-meから始めよう。いっしょに探していこうね。",
  /** 決めた直後(supportMode=false・justDecided=true): 読書支援会話として処理せず案内のみ
      (案内文はPane4読書中クリック時の案内と共通利用) */
  useSupport:
    "読書支援を使いたいときは、「会話」の右上にある「読書支援へ」を押してね。",
  /** 読書支援モードで本未選択のまま入力: セッションを開始せず案内のみ */
  selectBook:
    "どの読書中の本について話そうか？ 右の「読書中」から本を選んでね。",
} as const;

/** 読書中上限3冊の注意 (§6.4確定文言。Pane2の上限表示と同一。
    Pane4「読書中へ戻す」が上限で拒否されたときの案内にも再利用する) */
export const readingLimitNotice =
  "読書中は3冊までです。新しい本を追加するには、現在の読書中から1冊を『完読』または『中断』にしてください。";

// 「別の3冊にお願い」で新候補が不足したときの案内 (§6.4: 同一3冊の再表示禁止・確定文言。
// 表示時の「●（オランジェ）」プレフィックスは描画層が付与)
export const refreshNotices = {
  two: "新しく2冊見つけたよ。今の条件だと、これ以上別の1冊は出せないみたい。",
  one: "新しく1冊見つけたよ。今の条件だと、これ以上別の2冊は出せないみたい。",
  zero: "今の条件だと、これ以上別の3冊は出せないみたい。条件を少し変えて、もう一度探してみようか。",
} as const;

/* ---- フレーズ保存 (§6.5: 明示依頼のみ保存・自動保存禁止・専用ボタンなし。判定はv13と同一) ---- */

/** 明示的な保存依頼か (意図の推測による自動保存はしない) */
export function isSaveRequest(text: string): boolean {
  return /(保存して|保存したい|残しておきたい|残しておいて|メモして|印象に残った|フレーズがよかった)/.test(text);
}

function extractQuoted(text: string): string | null {
  const m = text.match(/「([^」]+)」|『([^』]+)』/);
  return m ? (m[1] ?? m[2] ?? null) : null;
}

/** 保存対象のフレーズ部分を抽出 (「」内を優先。なければ依頼語尾を除去) */
export function extractPhrase(text: string): string {
  const q = extractQuoted(text);
  if (q !== null) return q;
  const t = text
    .replace(/(という)?(言葉|フレーズ)?(を|が)?(保存して|保存したい|残しておきたい|残しておいて|メモして|印象に残った|よかった)(ほしい|ください)?[。！!]*$/, "")
    .trim();
  return t !== "" ? t : text;
}

/** 保存成功時の応答 (§6.5確定文言。通常の読書支援会話として扱う) */
export const phraseSavedReply = "このフレーズを保存しておくね。";

/* ---- 意味をたずねる (§6.5: ②grill-me中・③正式な読書支援中のみその場で説明。専用モードにしない) ----
   将来のClaude API接続時の回答優先順位(§6.5確定・崩さないこと):
     1. 現在の会話文脈 → 2. 取得済み書籍情報 → 3. 一般知識 → 4. 必要時のみ外部検索(毎回の検索は禁止) */

/** 意味質問か (v13と同一の判定) */
export function isMeaningQuestion(text: string): boolean {
  return /(どういう意味|どんな意味|意味が(よく)?わからない|意味を教えて|って何[?？]|もっと簡単に説明|この言葉がわからない)/.test(text);
}

/** 意味質問へのダミー説明応答 (v13と同一文言。実装ではClaude APIが上記優先順位で回答する) */
export function meaningReply(text: string): string {
  const m = text.match(/「([^」]+)」|『([^』]+)』/);
  const term = m ? (m[1] ?? m[2] ?? null) : null;
  return (
    (term !== null ? `「${term}」ですね。` : "その言葉ですね。") +
    "いまの会話の流れと、この本についてすでに分かっている情報の範囲でご説明しますね。(モックのため説明文はサンプルです。実装では、正確な確認が必要なときだけ外部検索で補います)"
  );
}

// 通常チャットの固定ダミー返答 (AI未接続)
export const dummyReplies: Omit<ChatMessage, "id">[] = [
  {
    speaker: "orange",
    message:
      "いいね、その視点!すごく大事なところに気づいてるよ。そこ、もう少し聞かせて?",
  },
  {
    speaker: "gelb",
    message:
      "なるほど。整理すると、いまの気づきは本書の核心につながるポイントですね。読書録に残しておくことをおすすめします。",
  },
];
