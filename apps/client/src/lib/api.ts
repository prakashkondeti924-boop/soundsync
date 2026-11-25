import {
  DiscoverRoomsType,
  GetActiveRoomsType,
  GetDefaultAudioType,
  GetUploadUrlType,
  LocalUploadResponseType,
  UploadCompleteResponseType,
  UploadCompleteType,
  UploadConfigResponseType,
  UploadUrlResponseType,
  validateAudioUploadMetadata,
} from "@beatsync/shared";
import axios from "axios";
import { getApiUrl } from "./urls";

const baseAxios = axios.create({
  get baseURL() {
    return getApiUrl();
  },
});

let cachedUploadConfig: UploadConfigResponseType | null = null;

export const fetchUploadConfig = async (forceRefresh = false): Promise<UploadConfigResponseType> => {
  if (cachedUploadConfig && !forceRefresh) {
    return cachedUploadConfig;
  }

  const response = await baseAxios.get<UploadConfigResponseType>("/upload/config");
  cachedUploadConfig = response.data;
  return response.data;
};

export const uploadAudioFile = async (data: { file: File; roomId: string; onProgress?: (percent: number) => void }) => {
  const validation = validateAudioUploadMetadata({
    fileName: data.file.name,
    mimeType: data.file.type,
    size: data.file.size,
  });
  if (!validation.valid) {
    throw new Error(validation.error ?? "Invalid audio file");
  }

  try {
    const config = await fetchUploadConfig();

    if (config.mode === "local") {
      const formData = new FormData();
      formData.append("roomId", data.roomId);
      formData.append("file", data.file);

      const response = await baseAxios.post<LocalUploadResponseType>("/upload/local", formData, {
        onUploadProgress: (event) => {
          if (event.total && data.onProgress) {
            const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
            data.onProgress(percent);
          }
        },
      });

      data.onProgress?.(100);
      return {
        success: response.data.success,
        publicUrl: response.data.url,
      };
    }

    const contentType = data.file.type || "audio/mpeg";

    // Step 1: Get presigned upload URL from server
    const uploadUrlRequest: GetUploadUrlType = {
      roomId: data.roomId,
      fileName: data.file.name,
      contentType,
    };

    const presignedURLResponse = await baseAxios.post<UploadUrlResponseType>(
      "/upload/get-presigned-url",
      uploadUrlRequest
    );

    const { uploadUrl, publicUrl } = presignedURLResponse.data;

    // Step 2: Upload directly to R2 using presigned URL
    await axios.put(uploadUrl, data.file, {
      headers: {
        "Content-Type": contentType,
      },
      onUploadProgress: (event) => {
        if (event.total && data.onProgress) {
          const percent = Math.min(99, Math.round((event.loaded / event.total) * 100));
          data.onProgress(percent);
        }
      },
    });

    // Step 3: Notify server that upload completed successfully
    const uploadCompleteRequest: UploadCompleteType = {
      roomId: data.roomId,
      originalName: data.file.name,
      publicUrl,
    };

    await baseAxios.post<UploadCompleteResponseType>("/upload/complete", uploadCompleteRequest);
    data.onProgress?.(100);

    return {
      success: true,
      publicUrl,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const serverMsg = typeof error.response?.data === "string" ? error.response.data : error.response?.data?.message;
      throw new Error(serverMsg || "Failed to upload audio file");
    }
    throw error;
  }
};

export const fetchAudio = async (url: string) => {
  try {
    // Direct fetch from R2 public URL - zero server bandwidth
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch audio: ${response.statusText}`);
    }

    return await response.blob();
  } catch (error) {
    throw new Error(`Failed to fetch audio: ${error}`);
  }
};

export async function fetchDefaultAudioSources() {
  try {
    const response = await fetch(`${getApiUrl()}/default`);

    if (!response.ok) {
      console.error("Failed to fetch default audio sources:", response.status);
      return [];
    }

    const files: GetDefaultAudioType = await response.json();
    return files;
  } catch (error) {
    console.error("Error fetching default audio sources:", error);
    return [];
  }
}

export async function fetchActiveRooms() {
  const response = await fetch(`${getApiUrl()}/active-rooms`);
  const data: GetActiveRoomsType = await response.json();
  return data;
}

export async function fetchDiscoverRooms() {
  const response = await fetch(`${getApiUrl()}/discover`);
  const data: DiscoverRoomsType = await response.json();
  return data;
}
