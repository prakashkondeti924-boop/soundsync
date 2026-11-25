import { getLocalAudioFile, parseLocalAudioUrl } from "@/lib/localStorage";
import { corsHeaders, errorResponse } from "@/utils/responses";

interface ByteRange {
  start: number;
  end: number;
}

function parseRangeHeader(rangeHeader: string, fileSize: number): ByteRange | "invalid" {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match || fileSize <= 0) {
    return "invalid";
  }

  const [, startStr, endStr] = match;
  if (!startStr && !endStr) {
    return "invalid";
  }

  let start: number;
  let end: number;

  if (!startStr) {
    // Suffix byte range: bytes=-500 (last 500 bytes)
    const suffixLength = Number.parseInt(endStr, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return "invalid";
    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  } else {
    start = Number.parseInt(startStr, 10);
    end = endStr ? Number.parseInt(endStr, 10) : fileSize - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= fileSize || end < start) {
    return "invalid";
  }

  return {
    start,
    end: Math.min(end, fileSize - 1),
  };
}

/**
 * Stream locally stored audio files with CORS and HTTP Range support.
 */
export async function handleServeLocalAudio(req: Request, pathname: string): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return errorResponse("Method not allowed", 405);
  }

  const parsed = parseLocalAudioUrl(pathname);
  if (!parsed) {
    return errorResponse("Invalid audio file path", 400);
  }

  const loaded = await getLocalAudioFile(parsed.roomId, parsed.fileName);
  if (!loaded) {
    return errorResponse("Audio file not found", 404);
  }

  const { file, size, contentType } = loaded;
  const baseHeaders: Record<string, string> = {
    ...corsHeaders,
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=3600",
  };

  const rangeHeader = req.headers.get("range");
  if (rangeHeader) {
    const range = parseRangeHeader(rangeHeader, size);
    if (range === "invalid") {
      return new Response(null, {
        status: 416,
        headers: {
          ...corsHeaders,
          "Content-Range": `bytes */${size}`,
        },
      });
    }

    const chunkSize = range.end - range.start + 1;
    const headers = {
      ...baseHeaders,
      "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
      "Content-Length": chunkSize.toString(),
    };

    if (req.method === "HEAD") {
      return new Response(null, { status: 206, headers });
    }

    return new Response(file.slice(range.start, range.end + 1), {
      status: 206,
      headers,
    });
  }

  const headers = {
    ...baseHeaders,
    "Content-Length": size.toString(),
  };

  if (req.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }

  return new Response(file, { status: 200, headers });
}
