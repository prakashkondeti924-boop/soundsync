"use client";

import { uploadAudioFile } from "@/lib/api";
import {
  deleteLocalSong,
  listLocalSongs,
  localSongToFile,
  saveLocalSong,
  type LocalSongRecord,
} from "@/lib/localSongsDb";
import { validateAudioUploadMetadata } from "@beatsync/shared";
import { toast } from "sonner";
import { create } from "zustand";

export type UploadTaskStatus = "uploading" | "success" | "error";

export interface UploadTaskItem {
  id: string;
  fileName: string;
  fileSize: number;
  progress: number;
  status: UploadTaskStatus;
  error?: string;
}

interface LocalLibraryState {
  songs: LocalSongRecord[];
  isLoadingLibrary: boolean;
  libraryLoaded: boolean;
  libraryError: string | null;
  saveOnUpload: boolean;
  uploads: UploadTaskItem[];
  uploadingSongIds: Record<string, boolean>;

  loadLibrary: () => Promise<void>;
  setSaveOnUpload: (enabled: boolean) => void;
  saveFilesToLibrary: (files: File[]) => Promise<void>;
  removeFromLibrary: (id: string) => Promise<void>;
  uploadFilesToRoom: (files: File[], roomId: string, options?: { saveToLibrary?: boolean }) => Promise<void>;
  addSavedSongToRoom: (song: LocalSongRecord, roomId: string) => Promise<void>;
  dismissUpload: (id: string) => void;
  clearCompletedUploads: () => void;
}

function createTaskId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const useLocalLibraryStore = create<LocalLibraryState>((set, get) => {
  const updateUploadTask = (id: string, patch: Partial<UploadTaskItem>) => {
    set((state) => ({
      uploads: state.uploads.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    }));
  };

  const runSingleFileUpload = async (
    file: File,
    roomId: string,
    shouldSaveToLibrary: boolean,
    linkedSongId?: string
  ) => {
    const taskId = createTaskId();
    const validation = validateAudioUploadMetadata({
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
    });

    if (!validation.valid) {
      const errorMessage = validation.error ?? "Invalid audio file";
      set((state) => ({
        uploads: [
          {
            id: taskId,
            fileName: file.name,
            fileSize: file.size,
            progress: 0,
            status: "error",
            error: errorMessage,
          },
          ...state.uploads,
        ],
      }));
      toast.error(`${file.name}: ${errorMessage}`);
      return;
    }

    set((state) => ({
      uploads: [
        {
          id: taskId,
          fileName: file.name,
          fileSize: file.size,
          progress: 0,
          status: "uploading",
        },
        ...state.uploads,
      ],
      ...(linkedSongId ? { uploadingSongIds: { ...state.uploadingSongIds, [linkedSongId]: true } } : {}),
    }));

    try {
      if (shouldSaveToLibrary) {
        try {
          await saveLocalSong(file);
          const refreshed = await listLocalSongs();
          set({ songs: refreshed, libraryLoaded: true, libraryError: null });
        } catch (dbErr) {
          console.warn("Could not persist song to IndexedDB library:", dbErr);
        }
      }

      await uploadAudioFile({
        file,
        roomId,
        onProgress: (percent) => {
          updateUploadTask(taskId, { progress: percent });
        },
      });

      updateUploadTask(taskId, { progress: 100, status: "success" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to upload audio file";
      updateUploadTask(taskId, { status: "error", error: message });
      toast.error(`Failed to upload ${file.name}: ${message}`);
    } finally {
      if (linkedSongId) {
        set((state) => {
          const next = { ...state.uploadingSongIds };
          delete next[linkedSongId];
          return { uploadingSongIds: next };
        });
      }
    }
  };

  return {
    songs: [],
    isLoadingLibrary: false,
    libraryLoaded: false,
    libraryError: null,
    saveOnUpload: true,
    uploads: [],
    uploadingSongIds: {},

    loadLibrary: async () => {
      if (get().isLoadingLibrary) return;
      set({ isLoadingLibrary: true, libraryError: null });
      try {
        const songs = await listLocalSongs();
        set({ songs, isLoadingLibrary: false, libraryLoaded: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to read Local Songs library";
        set({ isLoadingLibrary: false, libraryError: message });
      }
    },

    setSaveOnUpload: (enabled) => set({ saveOnUpload: enabled }),

    saveFilesToLibrary: async (files) => {
      let savedCount = 0;
      for (const file of files) {
        const validation = validateAudioUploadMetadata({
          fileName: file.name,
          mimeType: file.type,
          size: file.size,
        });
        if (!validation.valid) {
          toast.error(`${file.name}: ${validation.error}`);
          continue;
        }
        try {
          await saveLocalSong(file);
          savedCount++;
        } catch (err) {
          const message = err instanceof Error ? err.message : "Failed to save song";
          toast.error(`${file.name}: ${message}`);
        }
      }
      const songs = await listLocalSongs();
      set({ songs, libraryLoaded: true, libraryError: null });
      if (savedCount > 0) {
        toast.success(`Saved ${savedCount} ${savedCount === 1 ? "song" : "songs"} to Local Library`);
      }
    },

    removeFromLibrary: async (id) => {
      try {
        await deleteLocalSong(id);
        set((state) => ({
          songs: state.songs.filter((s) => s.id !== id),
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to remove song";
        toast.error(message);
      }
    },

    uploadFilesToRoom: async (files, roomId, options) => {
      if (files.length === 0) return;
      if (!roomId) {
        toast.error("Join a room before uploading songs");
        return;
      }

      const shouldSave = options?.saveToLibrary ?? get().saveOnUpload;

      // Upload concurrently in small batches of 2 to keep UI responsive and avoid saturating bandwidth
      const CONCURRENCY = 2;
      const queue = [...files];
      const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        while (queue.length > 0) {
          const nextFile = queue.shift();
          if (nextFile) {
            await runSingleFileUpload(nextFile, roomId, shouldSave);
          }
        }
      });

      await Promise.all(workers);
    },

    addSavedSongToRoom: async (song, roomId) => {
      if (!roomId) {
        toast.error("Join a room before adding songs");
        return;
      }
      if (get().uploadingSongIds[song.id]) return;
      const file = localSongToFile(song);
      await runSingleFileUpload(file, roomId, false, song.id);
    },

    dismissUpload: (id) =>
      set((state) => ({
        uploads: state.uploads.filter((item) => item.id !== id),
      })),

    clearCompletedUploads: () =>
      set((state) => ({
        uploads: state.uploads.filter((item) => item.status === "uploading"),
      })),
  };
});
