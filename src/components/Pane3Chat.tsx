"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ChatMessage } from "@/lib/dummyData";

// Web Speech API (SpeechRecognition) の最小型定義。標準DOM型(lib.dom.d.ts)には
// 含まれないため、今回使用する範囲だけをこのファイル内でローカルに定義する
// (グローバル型を汚染しないよう、SpeechRecognitionという名前は使わずVoice接頭辞にする)。
interface VoiceRecognitionEvent {
  results: { [index: number]: { [index: number]: { transcript: string } } };
}
interface VoiceRecognitionErrorEvent {
  error: string;
}
interface VoiceRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  abort: () => void;
  onresult: ((event: VoiceRecognitionEvent) => void) | null;
  onerror: ((event: VoiceRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type VoiceRecognitionConstructor = new () => VoiceRecognition;

/** window.SpeechRecognition / window.webkitSpeechRecognition をfeature detectionする。
    非対応ブラウザ・SSR時(windowなし)はnull */
function getVoiceRecognitionConstructor(): VoiceRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: VoiceRecognitionConstructor;
    webkitSpeechRecognition?: VoiceRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** SpeechRecognitionのerrorコードを、ユーザー向けの3種の案内文へ振り分ける */
function voiceErrorMessage(code: string): string {
  if (code === "not-allowed" || code === "service-not-allowed" || code === "audio-capture") {
    return "音声入力を利用できません。マイクの許可と音声入力の設定を確認してください。";
  }
  return "音声を認識できませんでした。もう一度お試しください。";
}

interface Props {
  messages: ChatMessage[];
  /** 検索演出中は送信をガード (appState.searching) */
  searching: boolean;
  onSend: (text: string) => void;
  /** 正式な読書支援モード (appState.supportMode)。右上=「読書支援中」の非操作ラベル */
  supportMode?: boolean;
  /** 読書支援初期画面 (supportMode=true・本未選択・会話なし)。右上非表示 */
  supportInitial?: boolean;
  /** 右上「読書支援へ」押下 (supportMode=falseのときのみ表示・唯一の正式モード入口) */
  onGoSupport: () => void;
}

// 発言表示 (§6.5): 名前と本文を同一行。セッション内初回のみ「●（名前）本文」、以降「● 本文」。
// ユーザーは右寄せ・アイコンなし
function Message({ msg, showName }: { msg: ChatMessage; showName: boolean }) {
  if (msg.speaker === "user") {
    return (
      <div className="flex max-w-[84%] flex-col items-end self-end">
        <div className="rounded-r3 bg-[#EAF2FF] px-3 py-2 text-t3 max-lg:text-[13px] leading-[1.7] whitespace-pre-wrap text-charcoal">
          {msg.message}
        </div>
      </div>
    );
  }
  const name = msg.speaker === "orange" ? "オランジェ" : "ゲルプ";
  const dotColor = msg.speaker === "orange" ? "bg-orange-brand" : "bg-gelb-brand";
  return (
    <div className="flex max-w-[84%] flex-col self-start">
      {/* AI回答本文はモバイルのみ14px・weight500 — 12px・400だとiPhone実機で小さく
          線が細く淡く見えるため(色は確定チャコール#111のまま・背景/余白は不変。PCは12px・400) */}
      <div className="rounded-r3 bg-pane-bg px-3 py-2 text-t3 leading-[1.7] whitespace-pre-wrap text-charcoal max-lg:text-[14px] max-lg:font-medium">
        <span className={`mr-1.5 mb-[1px] inline-block h-[7px] w-[7px] flex-none rounded-full ${dotColor}`} />
        {showName ? `（${name}）` : ""}
        {msg.message}
      </div>
    </div>
  );
}

// Pane 3「会話」(引継ぎ§6.5): 初期=机画像+1行のみ。会話開始で机が消え会話最大化
export default function Pane3({ messages, searching, onSend, supportMode = false, supportInitial = false, onGoSupport }: Props) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  // 音声入力(Ver.1確定仕様: マイク→認識→テキスト化→入力欄反映→ユーザー確認→手動送信。
  // 自動送信はしない=onresult/onerror/onendのどこからもonSend/handleSendを呼ばない)
  const [isRecording, setIsRecording] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recognitionRef = useRef<VoiceRecognition | null>(null);

  const convo = messages.length > 0 && !supportInitial;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages]);

  // unmount時、動作中のrecognitionが残らないよう安全に終了する。
  // ハンドラを先にnullへ外してからabortすることで、unmount後にonerror/onendが
  // 発火してsetState(isRecording等)を呼んでしまうのを防ぐ
  useEffect(() => {
    return () => {
      const recognition = recognitionRef.current;
      if (recognition !== null) {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        try {
          recognition.abort();
        } catch {
          // 既に終了している場合などは無視
        }
        recognitionRef.current = null;
      }
    };
  }, []);

  const handleSend = () => {
    const text = input.trim();
    if (text === "" || searching) return;
    onSend(text);
    setInput("");
  };

  // マイク押下: ここでfeature detectionし、非対応なら案内のみ表示して終了(押しても
  // 何も起きない状態にしない)。二重起動防止のためisRecording中は何もしない
  const handleMicClick = () => {
    if (isRecording) return;
    setVoiceError(null);
    const VoiceRecognitionCtor = getVoiceRecognitionConstructor();
    if (VoiceRecognitionCtor === null) {
      setVoiceError("このブラウザでは音声入力を利用できません。");
      return;
    }
    const recognition = new VoiceRecognitionCtor();
    recognition.lang = "ja-JP";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      if (transcript === "") return;
      // 既存文字は消さず末尾に追加する(単語が連結しないよう必要なら空白を挟む)
      setInput((prev) => {
        if (prev.trim() === "") return transcript;
        return /\s$/.test(prev) ? `${prev}${transcript}` : `${prev} ${transcript}`;
      });
    };
    recognition.onerror = (event) => {
      setVoiceError(voiceErrorMessage(event.error));
    };
    recognition.onend = () => {
      setIsRecording(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setIsRecording(true);
    } catch {
      setVoiceError("音声を認識できませんでした。もう一度お試しください。");
      recognitionRef.current = null;
    }
  };

  // セッション内初回のみ名前表示: 各話者の最初の発言indexを求める
  const firstIndexOf: Record<string, number> = {};
  messages.forEach((m, i) => {
    if (m.speaker !== "user" && !(m.speaker in firstIndexOf)) firstIndexOf[m.speaker] = i;
  });

  return (
    <section className="flex h-full flex-col bg-white">
      {/* 右上表示 (§6.5): supportMode=false=「読書支援へ」/ true=「読書支援中」(非操作ラベル)。
          読書支援初期画面では非表示 */}
      {!supportInitial && (
        <div className="flex justify-end px-3 pt-2">
          {supportMode ? (
            <span className="cursor-default rounded-r1 px-1.5 py-0.5 text-[11px] max-lg:text-[13px] font-semibold text-ink-soft">
              読書支援中
            </span>
          ) : (
            <button
              onClick={onGoSupport}
              className="rounded-r1 px-1.5 py-0.5 text-[11px] max-lg:text-[13px] font-semibold text-ink-soft hover:bg-pane-bg hover:text-charcoal"
            >
              読書支援へ
            </button>
          )}
        </div>
      )}

      {/* 初期表示: 机画像+キャプション (会話開始後は非表示) */}
      {!convo && (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-3">
          {/* 初期画像は画面用途で切替: grill-me用と読書支援用で別画像(2026-08-27確定版へ差替) */}
          {supportInitial ? (
            <Image
              src="/images/ban07cb7e81-e74a-4b54-a4d4-61dddb28eda3.png"
              alt="オランジェとゲルプの机"
              width={1448}
              height={1086}
              className="block max-h-[58%] w-auto max-w-[78%] rounded-xl"
            />
          ) : (
            <Image
              src="/images/grill5036307-3c8d-40a3-b8d8-5922739a9de5.png"
              alt="オランジェとゲルプの机"
              width={1449}
              height={1086}
              className="block max-h-[58%] w-auto max-w-[78%] rounded-xl"
            />
          )}
          {supportInitial ? (
            <div className="flex flex-col items-center gap-2.5 self-stretch px-0.5">
              <p className="m-0 text-t3 max-lg:text-[13px] font-semibold text-charcoal">読書支援 / 読みながら考えを整理しよう</p>
              {/* 案内は通常の会話と同じ吹き出し・左寄せ (PC2行基本・狭幅は自然折返し) */}
              <div className="flex justify-start self-stretch px-2">
                <div className="max-w-full rounded-r3 bg-pane-bg px-3 py-2 text-left text-t3 max-lg:text-[14px] leading-[1.7] text-charcoal">
                  <span className="mr-1.5 mb-[1px] inline-block h-[7px] w-[7px] rounded-full bg-orange-brand" />
                  （オランジェ）どの本について話そうか？
                  <br />
                  気になった言葉や残しておきたいフレーズがあったら、いつでも言ってね。
                </div>
              </div>
            </div>
          ) : (
            <p className="m-0 text-t3 max-lg:text-[13px] font-semibold text-charcoal">grill-me / あなたが求める本を一緒に探そう！</p>
          )}
        </div>
      )}

      {/* 会話領域 */}
      {convo && (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2.5">
          {messages.map((msg, i) => (
            <Message key={msg.id} msg={msg} showName={firstIndexOf[msg.speaker] === i} />
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      {/* 入力バー: マイク|テキスト|送信 を下部固定 (§31)。マイクはWeb Speech API
          (window.SpeechRecognition/webkitSpeechRecognition)による日本語音声入力
          (lang=ja-JP・continuous=false・interimResults=false・maxAlternatives=1)。
          認識結果は入力欄へ反映するのみで送信はしない(自動送信禁止)。
          入力欄はモバイル(lg未満)で16px — iOS Safariは16px未満の入力欄フォーカスで
          自動ズームしレイアウトが画面外へはみ出すため */}
      <div className="relative border-t border-hairline">
        <div className="flex items-center gap-2 px-3 py-[9px]">
          <div className="relative flex-none">
            <button
              type="button"
              onClick={handleMicClick}
              disabled={isRecording}
              title="音声で話す"
              aria-label="音声で話す"
              className={`flex h-[34px] w-[34px] items-center justify-center rounded-full border text-ink-soft ${
                isRecording ? "border-action bg-[#EAF2FF] text-action" : "border-hairline bg-white"
              }`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0014 0" />
                <path d="M12 18v3" />
              </svg>
            </button>
            {/* 録音中の小さな表示 (§UI仕様: 波形・モーダル・大きな録音画面・アニメーションなし) */}
            {isRecording && (
              <span className="absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-r1 bg-pane-bg px-1.5 py-0.5 text-[10px] font-semibold text-action">
                録音中
              </span>
            )}
          </div>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="気になったこと、回答を入力"
            className="min-w-0 flex-1 rounded-full border border-hairline bg-white px-4 py-[9px] text-t3 text-charcoal placeholder:text-ink-faint max-lg:text-[16px] max-lg:leading-[1.3] max-lg:py-[6px] max-lg:px-3.5 max-lg:focus:outline-1 focus:outline-2 focus:outline-action focus:-outline-offset-1"
          />
          <button
            onClick={handleSend}
            aria-label="送信"
            className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full bg-action text-white"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
              <path d="M4 12l16-7-6 16-3-6-7-3z" />
            </svg>
          </button>
        </div>
        {/* 音声入力エラー案内 (§エラー処理: 押しても何も起きない状態にしない。
            通常時は非表示、エラー時のみ最小限の文言を表示) */}
        {voiceError !== null && (
          <p className="px-3 pb-1.5 text-[11px] leading-[1.4] text-ink-soft">{voiceError}</p>
        )}
      </div>
    </section>
  );
}
