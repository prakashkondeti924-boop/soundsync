import { UPLOAD_CONSTANTS } from "./constants";

// Epoch now in milliseconds (high precision)
export const epochNow = () => performance.timeOrigin + performance.now();

export interface AudioUploadValidationResult {
  valid: boolean;
  error?: string;
}

const ALLOWED_EXTENSION_SET = new Set<string>(
  UPLOAD_CONSTANTS.ALLOWED_AUDIO_EXTENSIONS
);

export function getFileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === fileName.length - 1) return "";
  return fileName.slice(lastDot).toLowerCase();
}

export function normalizeMimeType(mimeType: string | undefined | null): string {
  if (!mimeType) return "";
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
}

/**
 * Validate audio upload metadata consistently across client and server.
 */
export function validateAudioUploadMetadata(input: {
  fileName: string;
  mimeType?: string;
  size?: number;
}): AudioUploadValidationResult {
  const fileName = input.fileName.trim();
  if (!fileName) {
    return { valid: false, error: "File name is required" };
  }

  if (typeof input.size === "number") {
    if (input.size <= 0) {
      return { valid: false, error: "File is empty" };
    }
    if (input.size > UPLOAD_CONSTANTS.MAX_FILE_SIZE_BYTES) {
      const maxMb = Math.round(
        UPLOAD_CONSTANTS.MAX_FILE_SIZE_BYTES / (1024 * 1024)
      );
      return { valid: false, error: `File exceeds maximum size of ${maxMb} MB` };
    }
  }

  const ext = getFileExtension(fileName);
  if (!ext || !ALLOWED_EXTENSION_SET.has(ext)) {
    return {
      valid: false,
      error: `Unsupported audio format (${ext || "no extension"}). Supported: ${UPLOAD_CONSTANTS.ALLOWED_AUDIO_EXTENSIONS.join(", ")}`,
    };
  }

  const normalizedMime = normalizeMimeType(input.mimeType);
  const isAllowedMime =
    normalizedMime === "" ||
    normalizedMime === "application/octet-stream" ||
    normalizedMime.startsWith("audio/") ||
    normalizedMime === "video/webm";

  if (!isAllowedMime) {
    return {
      valid: false,
      error: `Invalid file MIME type (${normalizedMime})`,
    };
  }

  return { valid: true };
}

export function isValidRoomIdParam(roomId: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(roomId);
}
