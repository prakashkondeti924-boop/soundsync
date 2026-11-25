export const R2_AUDIO_FILE_NAME_DELIMITER = "___";

export const UPLOAD_CONSTANTS = {
  MAX_FILE_SIZE_BYTES: 100 * 1024 * 1024, // 100 MB
  LOCAL_UPLOADS_PATH_PREFIX: "/uploads",
  ALLOWED_AUDIO_EXTENSIONS: [
    ".mp3",
    ".wav",
    ".flac",
    ".m4a",
    ".aac",
    ".ogg",
    ".webm",
    ".opus",
  ] as const,
  ALLOWED_AUDIO_MIME_TYPES: [
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/x-wav",
    "audio/wave",
    "audio/flac",
    "audio/x-flac",
    "audio/mp4",
    "audio/x-m4a",
    "audio/m4a",
    "audio/aac",
    "audio/ogg",
    "audio/webm",
    "audio/opus",
    "video/webm",
  ] as const,
} as const;

const STEADY_STATE_INTERVAL_MS = 2500;

// NTP Heartbeat Constants
export const NTP_CONSTANTS = {
  // Initial interval for rapid measurement collection
  INITIAL_INTERVAL_MS: 50,
  // Steady state interval after initial measurements
  STEADY_STATE_INTERVAL_MS: STEADY_STATE_INTERVAL_MS,
  // Timeout before considering connection stale
  RESPONSE_TIMEOUT_MS: 1.5 * STEADY_STATE_INTERVAL_MS,
  // Maximum number of NTP measurements to collect initially
  MAX_MEASUREMENTS: 16,
  // Coded probes (Huygens) — inter-departure gap between probe pairs
  // Large enough gap to avoid TCP coalescing where browsers batch small writes into one segment
  PROBE_GAP_MS: 25,
  // Coded probes — client accepts server gap within ±this tolerance
  PROBE_GAP_TOLERANCE_MS: 5,
} as const;

export const LOW_PASS_CONSTANTS = {
  MIN_FREQ: 20,
  MAX_FREQ: 20000,
} as const;

export const CHAT_CONSTANTS = {
  MAX_MESSAGE_LENGTH: 20_000,
} as const;
