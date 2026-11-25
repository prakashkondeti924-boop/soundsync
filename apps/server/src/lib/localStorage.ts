import { mkdir, readdir, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { getFileExtension, isValidRoomIdParam, UPLOAD_CONSTANTS, type StorageModeType } from "@beatsync/shared";
import { validateR2Config } from "@/lib/r2";

const DEFAULT_UPLOADS_DIR =
  path.basename(import.meta.dir) === "dist"
    ? path.resolve(import.meta.dir, "../uploads")
    : path.resolve(import.meta.dir, "../../uploads");

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".webm": "audio/webm",
  ".opus": "audio/opus",
};

/**
 * Resolve the root directory for local audio uploads.
 */
export function getLocalUploadsRoot(): string {
  const configured = process.env.LOCAL_UPLOAD_DIR?.trim();
  return configured ? path.resolve(configured) : DEFAULT_UPLOADS_DIR;
}

/**
 * Determine active storage mode. Uses local disk automatically when R2 is not configured
 * or when STORAGE_MODE=local is explicitly set.
 */
export function getStorageMode(): StorageModeType {
  if (process.env.STORAGE_MODE === "local") {
    return "local";
  }
  return validateR2Config().isValid ? "r2" : "local";
}

function assertSafeSingleSegment(segment: string, label: string): void {
  if (
    !segment ||
    segment === "." ||
    segment === ".." ||
    segment.includes("/") ||
    segment.includes("\\") ||
    segment.includes("\0") ||
    segment.includes("..")
  ) {
    throw new Error(`Invalid ${label}: path traversal or illegal characters detected`);
  }
}

/**
 * Resolve and validate the local upload directory for a room.
 */
export function resolveSafeRoomDir(roomId: string): string {
  if (!isValidRoomIdParam(roomId)) {
    throw new Error(`Invalid room ID: ${roomId}`);
  }
  const root = getLocalUploadsRoot();
  const roomDir = path.resolve(root, `room-${roomId}`);
  if (!roomDir.startsWith(root + path.sep)) {
    throw new Error("Resolved room directory escapes upload root");
  }
  return roomDir;
}

/**
 * Resolve and validate a file path inside a room's local upload directory.
 */
export function resolveSafeAudioFilePath(roomId: string, fileName: string): string {
  assertSafeSingleSegment(fileName, "file name");
  const roomDir = resolveSafeRoomDir(roomId);
  const filePath = path.resolve(roomDir, fileName);
  if (!filePath.startsWith(roomDir + path.sep)) {
    throw new Error("Resolved file path escapes room directory");
  }
  return filePath;
}

export function getLocalPublicAudioUrl(roomId: string, fileName: string): string {
  return `${UPLOAD_CONSTANTS.LOCAL_UPLOADS_PATH_PREFIX}/room-${encodeURIComponent(roomId)}/${encodeURIComponent(fileName)}`;
}

/**
 * Parse a local upload URL (relative or absolute) into { roomId, fileName }.
 * Returns null if the URL is not a valid local upload path.
 */
export function parseLocalAudioUrl(url: string): { roomId: string; fileName: string } | null {
  try {
    const pathname = url.startsWith("/") ? url.split("?")[0] : new URL(url).pathname;
    const prefix = `${UPLOAD_CONSTANTS.LOCAL_UPLOADS_PATH_PREFIX}/`;
    if (!pathname.startsWith(prefix)) {
      return null;
    }

    const remainder = pathname.slice(prefix.length);
    const parts = remainder.split("/");
    if (parts.length !== 2) {
      return null;
    }

    const roomPart = decodeURIComponent(parts[0]);
    const fileName = decodeURIComponent(parts[1]);

    if (!roomPart.startsWith("room-")) {
      return null;
    }

    const roomId = roomPart.slice("room-".length);
    if (!isValidRoomIdParam(roomId)) {
      return null;
    }

    assertSafeSingleSegment(fileName, "file name");
    return { roomId, fileName };
  } catch {
    return null;
  }
}

export function getAudioContentType(fileName: string, fallbackType?: string): string {
  const ext = getFileExtension(fileName);
  const resolvedFallback = fallbackType && fallbackType.length > 0 ? fallbackType : "application/octet-stream";
  return EXTENSION_CONTENT_TYPES[ext] ?? resolvedFallback;
}

export async function saveLocalAudioFile(
  roomId: string,
  fileName: string,
  data: ArrayBuffer | Uint8Array
): Promise<{ filePath: string; url: string }> {
  const roomDir = resolveSafeRoomDir(roomId);
  const filePath = resolveSafeAudioFilePath(roomId, fileName);
  await mkdir(roomDir, { recursive: true });
  await Bun.write(filePath, data);
  return {
    filePath,
    url: getLocalPublicAudioUrl(roomId, fileName),
  };
}

export async function getLocalAudioFile(roomId: string, fileName: string) {
  try {
    const filePath = resolveSafeAudioFilePath(roomId, fileName);
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      return null;
    }
    return {
      file,
      filePath,
      size: file.size,
      contentType: getAudioContentType(fileName, file.type),
    };
  } catch {
    return null;
  }
}

export async function localAudioFileExists(url: string): Promise<boolean> {
  const parsed = parseLocalAudioUrl(url);
  if (!parsed) return false;
  const loaded = await getLocalAudioFile(parsed.roomId, parsed.fileName);
  return loaded !== null;
}

export async function deleteLocalAudioFile(roomId: string, fileName: string): Promise<boolean> {
  try {
    const filePath = resolveSafeAudioFilePath(roomId, fileName);
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      return false;
    }
    await unlink(filePath);

    // Clean up empty room folder if no files remain
    const roomDir = resolveSafeRoomDir(roomId);
    const remaining = await readdir(roomDir).catch(() => []);
    if (remaining.length === 0) {
      await rm(roomDir, { recursive: true, force: true });
    }
    return true;
  } catch (error) {
    console.error(`Failed to delete local audio file ${fileName} in room ${roomId}:`, error);
    return false;
  }
}

export async function deleteLocalRoomDirectory(roomId: string): Promise<number> {
  try {
    const roomDir = resolveSafeRoomDir(roomId);
    const entries = await readdir(roomDir).catch(() => null);
    if (!entries) return 0;

    await rm(roomDir, { recursive: true, force: true });
    return entries.length;
  } catch (error) {
    console.error(`Failed to delete local room directory for ${roomId}:`, error);
    return 0;
  }
}

/**
 * Clean up orphaned room directories on local disk that are not in activeRoomIds
 * and have been unmodified for at least `minAgeMs`.
 */
export async function cleanupOrphanedLocalRooms(
  activeRoomIds: Set<string>,
  minAgeMs = 10 * 60 * 1000
): Promise<number> {
  const root = getLocalUploadsRoot();
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  let deletedRooms = 0;
  const now = Date.now();

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("room-")) continue;
    const roomId = entry.name.slice("room-".length);
    if (!isValidRoomIdParam(roomId) || activeRoomIds.has(roomId)) continue;

    try {
      const roomDir = resolveSafeRoomDir(roomId);
      const dirStat = await stat(roomDir);
      const files = await readdir(roomDir).catch(() => []);
      let latestMtime = dirStat.mtimeMs;
      for (const f of files) {
        const fStat = await stat(path.join(roomDir, f)).catch(() => null);
        if (fStat && fStat.mtimeMs > latestMtime) {
          latestMtime = fStat.mtimeMs;
        }
      }

      if (now - latestMtime >= minAgeMs) {
        await rm(roomDir, { recursive: true, force: true });
        deletedRooms++;
      }
    } catch (error) {
      console.error(`Failed to inspect/cleanup orphaned local room ${roomId}:`, error);
    }
  }

  return deletedRooms;
}
