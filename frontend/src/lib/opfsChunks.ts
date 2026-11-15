/**
 * Audio chunk storage backed by the Origin Private File System (OPFS).
 *
 * Files are written per meeting:
 *   /chunks/<meeting_id>/00000.webm
 * Only the audio bytes live here; sync metadata is kept in IndexedDB.
 */

const ROOT_DIR = "chunks";

export function isOpfsAvailable(): boolean {
  return typeof navigator !== "undefined" && !!navigator.storage?.getDirectory;
}

function extensionFor(mimeType: string): string {
  return mimeType.includes("ogg") ? "ogg" : "webm";
}

function chunkFileName(chunkId: number, mimeType: string): string {
  return `${String(chunkId).padStart(5, "0")}.${extensionFor(mimeType)}`;
}

async function chunksRoot(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(ROOT_DIR, { create: true });
}

async function meetingDir(meetingId: string, create: boolean): Promise<FileSystemDirectoryHandle> {
  const root = await chunksRoot();
  return root.getDirectoryHandle(meetingId, { create });
}

export async function writeChunkFile(
  meetingId: string,
  chunkId: number,
  blob: Blob,
  mimeType: string,
): Promise<void> {
  const dir = await meetingDir(meetingId, true);
  const handle = await dir.getFileHandle(chunkFileName(chunkId, mimeType), { create: true });
  const writable = await handle.createWritable();

  try {
    await writable.write(blob);
    await writable.close();
  } catch (err) {
    try { await writable.abort(); } catch {}
    throw err;
  }
}

export async function readChunkFile(
  meetingId: string,
  chunkId: number,
  mimeType: string,
): Promise<Blob> {
  const dir = await meetingDir(meetingId, false);
  const handle = await dir.getFileHandle(chunkFileName(chunkId, mimeType));
  const file = await handle.getFile();
  return new Blob([file], { type: mimeType || file.type || "audio/webm" });
}

export async function deleteChunkFile(
  meetingId: string,
  chunkId: number,
  mimeType: string,
): Promise<void> {
  try {
    const dir = await meetingDir(meetingId, false);
    await dir.removeEntry(chunkFileName(chunkId, mimeType));
  } catch {
    // The file is already gone — nothing to do.
  }
}

export async function deleteMeetingChunks(meetingId: string): Promise<void> {
  try {
    const root = await chunksRoot();
    await root.removeEntry(meetingId, { recursive: true });
  } catch {
    // The directory is already gone — nothing to do.
  }
}
