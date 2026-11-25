export interface LocalSongRecord {
  id: string;
  name: string;
  size: number;
  type: string;
  blob: Blob;
  addedAt: number;
}

const DB_NAME = "beatsync-local-library";
const DB_VERSION = 1;
const STORE_NAME = "songs";

export function isIndexedDBAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDBAvailable()) {
      reject(new Error("IndexedDB is not available in this browser"));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("addedAt", "addedAt", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
  });
}

function createSongId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `song-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * List all saved songs from IndexedDB ordered newest first.
 */
export async function listLocalSongs(): Promise<LocalSongRecord[]> {
  if (!isIndexedDBAvailable()) return [];

  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const records = (request.result as LocalSongRecord[]) ?? [];
      records.sort((a, b) => b.addedAt - a.addedAt);
      resolve(records);
    };
    request.onerror = () => reject(request.error ?? new Error("Failed to load local songs"));
    tx.oncomplete = () => db.close();
  });
}

/**
 * Save a File into IndexedDB. Deduplicates by matching filename and byte size.
 */
export async function saveLocalSong(file: File): Promise<LocalSongRecord> {
  const existingSongs = await listLocalSongs();
  const duplicate = existingSongs.find((song) => song.name === file.name && song.size === file.size);

  const record: LocalSongRecord = {
    id: duplicate ? duplicate.id : createSongId(),
    name: file.name,
    size: file.size,
    type: file.type || "audio/mpeg",
    blob: file,
    addedAt: Date.now(),
  };

  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(record);

    request.onsuccess = () => resolve(record);
    request.onerror = () => reject(request.error ?? new Error("Failed to save local song"));
    tx.oncomplete = () => db.close();
  });
}

/**
 * Delete a saved song from IndexedDB by ID.
 */
export async function deleteLocalSong(id: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Failed to delete local song"));
    tx.oncomplete = () => db.close();
  });
}

/**
 * Convert a stored LocalSongRecord back into a standard File for uploading.
 */
export function localSongToFile(song: LocalSongRecord): File {
  return new File([song.blob], song.name, {
    type: song.type || "audio/mpeg",
    lastModified: song.addedAt,
  });
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
