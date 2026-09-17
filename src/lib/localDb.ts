// Standalone版のブラウザ内永続化層 (段階2-1A: 読み取り / 2-1B: 「この本に決めた」の書き込み /
// 2-1C: 状態変更・削除 / 2-1D: 保存フレーズのDB保存)。
// Neon(lib/db.ts・/api/shelf・/api/entries)の置き換え先。
// openDb()・loadShelf()・addBook()・updateStatus()・deleteRecord()・saveEntry()を実装。
// saveEntry()はDB保存のみを担う。旧/api/entriesが持っていたAI生成(extractEntry・
// userReflection/contextBefore/contextAfter/aiComment/aiCharacterの抽出)は今回のスコープ外
// (将来のBYOK化で別途ブラウザ側に実装する)。AI項目は常にnull/undefinedのまま保存できる。
//
// IndexedDB v1スキーマ:
//   database: "library-helper"
//   store "books"          keyPath: id
//   store "readingRecords" keyPath: id, index: bookId, index: status
//   store "readingEntries" keyPath: id, index: bookId, index: recordId
//
// timestampは既存state(page.tsxのisoToDate変換)との互換性を優先し、ISO文字列のまま保持する。
// conversation excerpt相当のフィールドはJS配列/オブジェクトのままstructured cloneで保存できる
// (JSON.stringifyは不要)。

import { ReadingEntry, Shelf, ShelfBook, ShelfRecord } from "./appState";

const DB_NAME = "library-helper";
const DB_VERSION = 1;

const STORE_BOOKS = "books";
const STORE_READING_RECORDS = "readingRecords";
const STORE_READING_ENTRIES = "readingEntries";

/** books storeの1行 (Neon booksテーブルに対応。確認できなかった項目はundefined) */
interface BookRow {
  id: string;
  googleVolumeId?: string;
  title: string;
  author: string;
  isbn13?: string;
  publisher?: string;
  publishedDate?: string;
  coverUrl?: string;
  createdAt: string;
  updatedAt: string;
}

/** readingRecords storeの1行 (Neon reading_recordsテーブルに対応) */
interface ReadingRecordRow {
  id: string;
  bookId: string;
  status: "reading" | "completed" | "suspended";
  source: "grill" | "trend" | "author" | "manual";
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** readingEntries storeの1行 (Neon reading_entriesテーブルに対応) */
interface ReadingEntryRow {
  id: string;
  bookId: string;
  recordId: string;
  phrase: string;
  contextBefore: string | null;
  contextAfter: string | null;
  userReflection: string | null;
  aiComment: string | null;
  aiCharacter: "orange" | "gelb" | null;
  excerpt: { speaker: "user" | "orange" | "gelb"; message: string }[] | null;
  recordedAt: string;
  createdAt: string;
}

/** ISO日時→Pane4表示用のyyyy-mm-dd (appState.ts today()・page.tsx isoToDateと同じ変換) */
function isoToDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** DBを開く (初回はonupgradeneededで3ストアを作成する。既存ストアは再作成しない) */
export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_BOOKS)) {
        db.createObjectStore(STORE_BOOKS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_READING_RECORDS)) {
        const store = db.createObjectStore(STORE_READING_RECORDS, { keyPath: "id" });
        store.createIndex("bookId", "bookId", { unique: false });
        store.createIndex("status", "status", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_READING_ENTRIES)) {
        const store = db.createObjectStore(STORE_READING_ENTRIES, { keyPath: "id" });
        store.createIndex("bookId", "bookId", { unique: false });
        store.createIndex("recordId", "recordId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  const tx = db.transaction(storeName, "readonly");
  return requestToPromise<T[]>(tx.objectStore(storeName).getAll());
}

/** 現在時刻のISO文字列 (Neon側のnow()に相当) */
function nowIso(): string {
  return new Date().toISOString();
}

/** 起動時の水和 (旧GET /api/shelfの置き換え)。IndexedDBが空でもエラーにせず、
    空のShelfとして正常に返す(3ストアのgetAll()は未作成データなら[]を返すため自然に成立)。
    返却形はpage.tsxのHYDRATE_SHELFへそのまま渡せる形に統一する(page.tsx側の変換は不要) */
export async function loadShelf(): Promise<{
  shelf: Shelf;
  records: Record<string, ShelfRecord>;
  entries: Record<string, ReadingEntry[]>;
}> {
  const db = await openDb();
  const [bookRows, recordRows, entryRows] = await Promise.all([
    getAll<BookRow>(db, STORE_BOOKS),
    getAll<ReadingRecordRow>(db, STORE_READING_RECORDS),
    getAll<ReadingEntryRow>(db, STORE_READING_ENTRIES),
  ]);
  const booksById = new Map(bookRows.map((b) => [b.id, b]));

  const shelf: Shelf = { reading: [], done: [], suspended: [] };
  const records: Record<string, ShelfRecord> = {};
  for (const r of recordRows) {
    const book = booksById.get(r.bookId);
    // 対応するbooks行が無い記録は表示しない(旧SQLのINNER JOINと同じ挙動を踏襲)
    if (book === undefined) continue;
    const shelfBook: ShelfBook = {
      id: r.bookId,
      title: book.title,
      author: book.author,
      date: isoToDate(r.status === "completed" ? (r.completedAt ?? r.updatedAt) : r.updatedAt),
    };
    if (r.status === "completed") shelf.done.push(shelfBook);
    else if (r.status === "suspended") shelf.suspended.push(shelfBook);
    else shelf.reading.push(shelfBook);
    records[r.bookId] = { id: r.id, source: r.source };
  }

  // recorded_at昇順・created_at昇順(旧GET /api/shelfのORDER BYと同じ順序)
  const sortedEntries = [...entryRows].sort((a, b) => {
    const byRecordedAt = a.recordedAt.localeCompare(b.recordedAt);
    return byRecordedAt !== 0 ? byRecordedAt : a.createdAt.localeCompare(b.createdAt);
  });
  const entries: Record<string, ReadingEntry[]> = {};
  for (const e of sortedEntries) {
    const view: ReadingEntry = {
      id: e.id,
      bookId: e.bookId,
      recordId: e.recordId,
      phrase: e.phrase,
      contextBefore: e.contextBefore,
      contextAfter: e.contextAfter,
      userReflection: e.userReflection,
      aiComment: e.aiComment,
      aiCharacter: e.aiCharacter,
      excerpt: e.excerpt,
      recordedAt: isoToDate(e.recordedAt),
    };
    entries[e.bookId] = [...(entries[e.bookId] ?? []), view];
  }

  return { shelf, records, entries };
}

/** addBook()への書誌入力 (旧POST /api/shelf action:"add" の AddBook と同形。
    未確認の項目はnullのまま渡す=推測で埋めない) */
export interface AddBookInput {
  id: string;
  title: string;
  author: string;
  googleVolumeId: string | null;
  isbn13: string | null;
  publisher: string | null;
  publishedDate: string | null;
  coverUrl: string | null;
}

/** 「この本に決めた」(旧POST /api/shelf action:"add" の置き換え)。
    挙動は旧SQL(UPSERT+reading_records分岐)と同一にする:
    - books: 新しい値がnullでない項目だけ上書きし、nullの項目は既存値を保持する
      (SQLのCOALESCE(EXCLUDED.x, books.x)と同じ=新しい非null値が常に優先)。
      title/authorは常に新しい値で上書きする。新規行ならそのまま挿入
    - readingRecords: book_id一致の記録が既にあれば(状態を問わず・1冊につき1記録の前提)
      status="reading"・completedAtクリア・startedAtは既存があれば保持/無ければ今、を
      更新して既存idを返す(sourceは更新しない=既存値を維持)。無ければcrypto.randomUUID()で
      新規発行し、statusは常に"reading"・sourceは引数のsourceで新規作成する
    books/readingRecordsの読み取り→書き込みは1つのreadwriteトランザクションで行い、
    途中に他の非同期処理を挟まない(トランザクションの早期commitを防ぐ) */
export async function addBook(
  book: AddBookInput,
  source: "grill" | "trend" | "author" | "manual",
): Promise<{ recordId: string }> {
  const db = await openDb();
  const tx = db.transaction([STORE_BOOKS, STORE_READING_RECORDS], "readwrite");
  const booksStore = tx.objectStore(STORE_BOOKS);
  const recordsStore = tx.objectStore(STORE_READING_RECORDS);

  const now = nowIso();
  const existingBook = await requestToPromise<BookRow | undefined>(booksStore.get(book.id));
  const mergedBook: BookRow = {
    id: book.id,
    title: book.title,
    author: book.author,
    googleVolumeId: book.googleVolumeId ?? existingBook?.googleVolumeId,
    isbn13: book.isbn13 ?? existingBook?.isbn13,
    publisher: book.publisher ?? existingBook?.publisher,
    publishedDate: book.publishedDate ?? existingBook?.publishedDate,
    coverUrl: book.coverUrl ?? existingBook?.coverUrl,
    createdAt: existingBook?.createdAt ?? now,
    updatedAt: now,
  };
  await requestToPromise(booksStore.put(mergedBook));

  // book_id一致の記録を検索(1冊につき1記録の前提。状態は問わない=旧SQLと同じ)
  const existingRecords = await requestToPromise<ReadingRecordRow[]>(
    recordsStore.index("bookId").getAll(book.id),
  );
  const existingRecord = existingRecords[0];

  let recordId: string;
  if (existingRecord !== undefined) {
    recordId = existingRecord.id;
    const updatedRecord: ReadingRecordRow = {
      ...existingRecord,
      status: "reading",
      completedAt: undefined,
      startedAt: existingRecord.startedAt ?? now,
      updatedAt: now,
      // sourceは更新しない(既存値を維持)
    };
    await requestToPromise(recordsStore.put(updatedRecord));
  } else {
    recordId = crypto.randomUUID();
    const newRecord: ReadingRecordRow = {
      id: recordId,
      bookId: book.id,
      status: "reading",
      source,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await requestToPromise(recordsStore.put(newRecord));
  }

  return { recordId };
}

/** 「…」メニューの状態変更 (旧POST /api/shelf action:"move" の置き換え)。
    挙動は旧SQLと同一にする:
    - status更新
    - completedAt: statusが"completed"の場合のみ現在時刻を設定。それ以外(reading/suspended)は
      既存値の有無を問わず常にクリアする(旧SQLの`CASE WHEN status='completed' THEN now() ELSE NULL END`
      をそのまま再現。addBook()のstartedAtのような既存値保持ロジックはここには無い)
    - startedAtには触れない(既存値をそのまま保持)
    - updatedAt更新
    - 対象recordIdが存在しない場合は例外を投げる(旧APIの404 "record not found"相当) */
export async function updateStatus(
  recordId: string,
  status: "reading" | "completed" | "suspended",
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_READING_RECORDS, "readwrite");
  const store = tx.objectStore(STORE_READING_RECORDS);
  const existing = await requestToPromise<ReadingRecordRow | undefined>(store.get(recordId));
  if (existing === undefined) {
    throw new Error(`reading record not found: ${recordId}`);
  }
  const now = nowIso();
  const updated: ReadingRecordRow = {
    ...existing,
    status,
    completedAt: status === "completed" ? now : undefined,
    updatedAt: now,
  };
  await requestToPromise(store.put(updated));
}

/** 「…」メニューの削除 (旧POST /api/shelf action:"delete" の置き換え)。
    挙動は旧SQLと同一にする: 紐づくreadingEntriesを先に削除し、次にreadingRecordsを削除する。
    booksは削除しない(書誌は残す・旧SQLと同じ)。対象recordIdが存在しなくてもエラーにしない
    (旧SQLのDELETEはWHERE不一致でも成功する)。両ストアの削除は1つのreadwriteトランザクション
    内で行う */
export async function deleteRecord(recordId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([STORE_READING_RECORDS, STORE_READING_ENTRIES], "readwrite");
  const entriesStore = tx.objectStore(STORE_READING_ENTRIES);
  const recordsStore = tx.objectStore(STORE_READING_RECORDS);

  const entries = await requestToPromise<ReadingEntryRow[]>(
    entriesStore.index("recordId").getAll(recordId),
  );
  await Promise.all(entries.map((e) => requestToPromise(entriesStore.delete(e.id))));
  await requestToPromise(recordsStore.delete(recordId));
}

/** saveEntry()への入力 (旧POST /api/entries の EntryInput と同形+AI項目)。
    AI関連項目(contextBefore/contextAfter/userReflection/aiComment/aiCharacter)は
    今回のスコープ外(AI生成はまだ移行しない)のため、すべてoptional。
    未指定・undefinedはnullとして保存する(旧APIのextractEntry失敗時=全null保存と同じ状態) */
export interface SaveEntryInput {
  bookId: string;
  phrase: string;
  excerpt: { speaker: "user" | "orange" | "gelb"; message: string }[];
  contextBefore?: string | null;
  contextAfter?: string | null;
  userReflection?: string | null;
  aiComment?: string | null;
  aiCharacter?: "orange" | "gelb" | null;
}

/** 保存フレーズのDB保存 (旧POST /api/entries のDB保存部分の置き換え。AI生成部分は含まない)。
    挙動は旧SQLと同一にする:
    - record特定: bookId一致のreadingRecordを検索(status不問・1冊1記録の前提・addBook()と同じ
      考え方)。旧SQLの`WHERE r.book_id = bookId LIMIT 1`と同じで、呼び出し元から渡されたrecordIdを
      信用せず常にbookIdから再解決する(旧APIも元々recordIdをリクエストから受け取っていない)。
      対応するreadingRecordが無ければ例外を投げる(旧APIの404 "record not found"相当)
    - excerptが空配列ならnullとして保存(旧SQLの`excerpt.length > 0 ? JSON.stringify(excerpt) : null`
      と同じ判定。IndexedDBでは配列のままstructured cloneで保存できるためJSON化は不要)
    - AI項目(contextBefore等)は未指定ならnullで保存
    - id: crypto.randomUUID()、recordedAt/createdAtは現在時刻 */
export async function saveEntry(input: SaveEntryInput): Promise<ReadingEntry> {
  const db = await openDb();
  const tx = db.transaction([STORE_READING_RECORDS, STORE_READING_ENTRIES], "readwrite");
  const recordsStore = tx.objectStore(STORE_READING_RECORDS);
  const entriesStore = tx.objectStore(STORE_READING_ENTRIES);

  const records = await requestToPromise<ReadingRecordRow[]>(
    recordsStore.index("bookId").getAll(input.bookId),
  );
  const record = records[0];
  if (record === undefined) {
    throw new Error(`reading record not found for book: ${input.bookId}`);
  }

  const now = nowIso();
  const id = crypto.randomUUID();
  const excerpt = input.excerpt.length > 0 ? input.excerpt : null;
  const row: ReadingEntryRow = {
    id,
    bookId: input.bookId,
    recordId: record.id,
    phrase: input.phrase,
    contextBefore: input.contextBefore ?? null,
    contextAfter: input.contextAfter ?? null,
    userReflection: input.userReflection ?? null,
    aiComment: input.aiComment ?? null,
    aiCharacter: input.aiCharacter ?? null,
    excerpt,
    recordedAt: now,
    createdAt: now,
  };
  await requestToPromise(entriesStore.put(row));

  return {
    id,
    bookId: input.bookId,
    recordId: record.id,
    phrase: input.phrase,
    contextBefore: row.contextBefore,
    contextAfter: row.contextAfter,
    userReflection: row.userReflection,
    aiComment: row.aiComment,
    aiCharacter: row.aiCharacter,
    excerpt: row.excerpt,
    recordedAt: isoToDate(now),
  };
}
