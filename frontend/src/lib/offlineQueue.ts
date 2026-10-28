/**
 * Offline recording queue.
 *
 * Audio chunks and meeting details are kept in IndexedDB so a recording can
 * start (and survive a page reload) without a network connection. Once the
 * browser is online again the queued meeting is created on the backend, its
 * chunks are uploaded in order, and the usual merge flow runs.
 */

export interface CachedChunk {
  meeting_id: string;
  chunk_id: number;
  timestamp: string;
  blob: Blob;
  size_bytes: number;
  mime_type?: string;
}

export interface PendingMeeting {
  meeting_id: string;
  context: string;
  attendees: string[];
  no_of_persons: number;
  meet_url?: string;
  date_time: string;
  /** Whether the backend meeting record has been created. */
  created: boolean;
  created_at: string;
}

const DB_NAME = "meetmind_chunks";
const DB_VERSION = 2;
const CHUNK_STORE = "pending_chunks";
const MEETING_STORE = "pending_meetings";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(CHUNK_STORE)) {
        const store = db.createObjectStore(CHUNK_STORE, {
          keyPath: ["meeting_id", "chunk_id"],
        });
        store.createIndex("meeting_id", "meeting_id", { unique: false });
      }
      if (!db.objectStoreNames.contains(MEETING_STORE)) {
        db.createObjectStore(MEETING_STORE, { keyPath: "meeting_id" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDB();

  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = run(tx.objectStore(storeName));

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

// ── Audio chunks ──────────────────────────────────────────────────────────────

export function cacheChunk(chunk: CachedChunk): Promise<IDBValidKey> {
  return withStore(CHUNK_STORE, "readwrite", (store) => store.put(chunk));
}

export function removeCachedChunk(meetingId: string, chunkId: number): Promise<undefined> {
  return withStore(CHUNK_STORE, "readwrite", (store) => store.delete([meetingId, chunkId]));
}

export function getPendingChunksForMeeting(meetingId: string): Promise<CachedChunk[]> {
  return withStore(CHUNK_STORE, "readonly", (store) =>
    store.index("meeting_id").getAll(IDBKeyRange.only(meetingId)) as IDBRequest<CachedChunk[]>,
  );
}

export function getAllPendingChunks(): Promise<CachedChunk[]> {
  return withStore(CHUNK_STORE, "readonly", (store) =>
    store.getAll() as IDBRequest<CachedChunk[]>,
  );
}

// ── Meeting details ───────────────────────────────────────────────────────────

export function savePendingMeeting(meeting: PendingMeeting): Promise<IDBValidKey> {
  return withStore(MEETING_STORE, "readwrite", (store) => store.put(meeting));
}

export function getPendingMeeting(meetingId: string): Promise<PendingMeeting | undefined> {
  return withStore(MEETING_STORE, "readonly", (store) => store.get(meetingId));
}

export function getAllPendingMeetings(): Promise<PendingMeeting[]> {
  return withStore(MEETING_STORE, "readonly", (store) =>
    store.getAll() as IDBRequest<PendingMeeting[]>,
  );
}

export function deletePendingMeeting(meetingId: string): Promise<undefined> {
  return withStore(MEETING_STORE, "readwrite", (store) => store.delete(meetingId));
}

export async function markPendingMeetingCreated(meetingId: string): Promise<void> {
  const meeting = await getPendingMeeting(meetingId);
  if (!meeting) return;
  await savePendingMeeting({ ...meeting, created: true });
}
