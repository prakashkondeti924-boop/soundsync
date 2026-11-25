import type {
  LocalUploadResponseType,
  UploadCompleteResponseType,
  UploadConfigResponseType,
  UploadUrlResponseType,
} from "@beatsync/shared";
import {
  GetUploadUrlSchema,
  isValidRoomIdParam,
  UPLOAD_CONSTANTS,
  UploadCompleteSchema,
  validateAudioUploadMetadata,
} from "@beatsync/shared";
import { getStorageMode, saveLocalAudioFile } from "@/lib/localStorage";
import type { BunServer } from "@/utils/websocket";
import {
  createKey,
  generateAudioFileName,
  generatePresignedUploadUrl,
  getPublicAudioUrl,
  validateR2Config,
} from "@/lib/r2";
import { globalManager } from "@/managers";
import { errorResponse, jsonResponse, sendBroadcast } from "@/utils/responses";

export const handleGetUploadConfig = (req: Request) => {
  if (req.method !== "GET") {
    return errorResponse("Method not allowed", 405);
  }

  const response: UploadConfigResponseType = {
    mode: getStorageMode(),
    maxFileSizeBytes: UPLOAD_CONSTANTS.MAX_FILE_SIZE_BYTES,
    allowedExtensions: [...UPLOAD_CONSTANTS.ALLOWED_AUDIO_EXTENSIONS],
  };

  return jsonResponse(response);
};

export const handleLocalUpload = async (req: Request, server: BunServer) => {
  try {
    if (req.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return errorResponse("Content-Type must be multipart/form-data", 400);
    }

    const formData = await req.formData();
    const roomIdValue = formData.get("roomId");
    const fileValue = formData.get("file");

    if (typeof roomIdValue !== "string" || !isValidRoomIdParam(roomIdValue)) {
      return errorResponse("Invalid roomId", 400);
    }

    if (!(fileValue instanceof File)) {
      return errorResponse("Audio file is required", 400);
    }

    const room = globalManager.getRoom(roomIdValue);
    if (!room) {
      return errorResponse("Room not found. Please join the room before uploading files.", 404);
    }

    const validation = validateAudioUploadMetadata({
      fileName: fileValue.name,
      mimeType: fileValue.type,
      size: fileValue.size,
    });
    if (!validation.valid) {
      return errorResponse(validation.error ?? "Invalid audio file", 400);
    }

    const uniqueFileName = generateAudioFileName(fileValue.name);
    const bytes = await fileValue.arrayBuffer();
    const { url } = await saveLocalAudioFile(roomIdValue, uniqueFileName, bytes);

    const sources = room.addAudioSource({ url });

    console.log(`✅ Local audio upload completed - room ${roomIdValue}: ${url}`);

    sendBroadcast({
      server,
      roomId: roomIdValue,
      message: {
        type: "ROOM_EVENT",
        event: {
          type: "SET_AUDIO_SOURCES",
          sources,
        },
      },
    });

    const response: LocalUploadResponseType = {
      success: true,
      url,
      fileName: uniqueFileName,
    };
    return jsonResponse(response);
  } catch (error) {
    console.error("Error handling local upload:", error);
    return errorResponse("Failed to upload audio file", 500);
  }
};

// New endpoint to get presigned upload URL
export const handleGetPresignedURL = async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    // Validate R2 configuration first
    const r2Validation = validateR2Config();
    if (!r2Validation.isValid) {
      console.error("R2 configuration errors:", r2Validation.errors);
      return errorResponse("R2 configuration not complete", 500);
    }

    const body: unknown = await req.json();
    const parseResult = GetUploadUrlSchema.safeParse(body);

    if (!parseResult.success) {
      return errorResponse(`Invalid request data: ${parseResult.error.message}`, 400);
    }

    const { roomId, fileName, contentType } = parseResult.data;

    // Check if room exists
    const room = globalManager.getRoom(roomId);
    if (!room) {
      return errorResponse("Room not found. Please join the room before uploading files.", 404);
    }

    // Generate unique filename
    const uniqueFileName = generateAudioFileName(fileName);
    const r2Key = createKey(roomId, uniqueFileName);

    // Generate presigned URL for upload
    const uploadUrl = await generatePresignedUploadUrl(roomId, uniqueFileName, contentType);
    const publicUrl = getPublicAudioUrl(roomId, uniqueFileName);

    console.log(`Generated presigned URL for upload - R2 key: (${r2Key})`);

    const response: UploadUrlResponseType = {
      uploadUrl,
      publicUrl,
    };

    return jsonResponse(response);
  } catch (error) {
    console.error("Error generating upload URL:", error);
    return errorResponse("Failed to generate upload URL", 500);
  }
};

// Endpoint to confirm successful upload and broadcast to room
export const handleUploadComplete = async (req: Request, server: BunServer) => {
  try {
    if (req.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    const body: unknown = await req.json();
    const parseResult = UploadCompleteSchema.safeParse(body);

    if (!parseResult.success) {
      return errorResponse(`Invalid request data: ${parseResult.error.message}`, 400);
    }

    const { roomId, publicUrl } = parseResult.data;

    // Check if room exists
    const room = globalManager.getRoom(roomId);
    if (!room) {
      return errorResponse("Room not found. The room may have been closed during upload.", 404);
    }

    const sources = room.addAudioSource({ url: publicUrl });

    console.log(`✅ Audio upload completed - broadcasting to room ${roomId} new sources: ${JSON.stringify(sources)}`);

    // Broadcast to room that new audio is available
    sendBroadcast({
      server,
      roomId,
      message: {
        type: "ROOM_EVENT",
        event: {
          type: "SET_AUDIO_SOURCES",
          sources,
        },
      },
    });

    const response: UploadCompleteResponseType = { success: true };
    return jsonResponse(response);
  } catch (error) {
    console.error("Error confirming upload:", error);
    return errorResponse("Failed to confirm upload", 500);
  }
};
