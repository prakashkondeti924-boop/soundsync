import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { LocalSongRecord } from "@/lib/localSongsDb";

let storedSongs: LocalSongRecord[] = [];
const uploadedCalls: { name: string; roomId: string }[] = [];

void mock.module("@/lib/api", () => ({
  uploadAudioFile: mock(
    async ({ file, roomId, onProgress }: { file: File; roomId: string; onProgress?: (percent: number) => void }) => {
      onProgress?.(40);
      await Promise.resolve();
      onProgress?.(100);
      uploadedCalls.push({ name: file.name, roomId });
      return { success: true, publicUrl: `/uploads/room-${roomId}/${encodeURIComponent(file.name)}` };
    }
  ),
}));

void mock.module("@/lib/localSongsDb", () => ({
  isIndexedDBAvailable: () => true,
  listLocalSongs: mock(async () => [...storedSongs]),
  saveLocalSong: mock(async (file: File) => {
    const existing = storedSongs.find((s) => s.name === file.name && s.size === file.size);
    const record: LocalSongRecord = {
      id: existing?.id ?? `id-${storedSongs.length + 1}`,
      name: file.name,
      size: file.size,
      type: file.type || "audio/mpeg",
      blob: file,
      addedAt: Date.now(),
    };
    storedSongs = [record, ...storedSongs.filter((s) => s.id !== record.id)];
    return record;
  }),
  deleteLocalSong: mock(async (id: string) => {
    storedSongs = storedSongs.filter((s) => s.id !== id);
  }),
  localSongToFile: (song: LocalSongRecord) =>
    new File([song.blob], song.name, { type: song.type || "audio/mpeg", lastModified: song.addedAt }),
  formatFileSize: (bytes: number) => `${bytes} B`,
}));

import { useLocalLibraryStore } from "@/store/localLibrary";

describe("useLocalLibraryStore", () => {
  beforeEach(() => {
    storedSongs = [];
    uploadedCalls.length = 0;
    useLocalLibraryStore.setState({
      songs: [],
      isLoadingLibrary: false,
      libraryLoaded: false,
      libraryError: null,
      saveOnUpload: true,
      uploads: [],
      uploadingSongIds: {},
    });
  });

  it("uploads multiple valid files, saves them to library, and records validation errors for invalid files", async () => {
    const mp3 = new File([new Uint8Array([1, 2, 3])], "track1.mp3", { type: "audio/mpeg" });
    const flac = new File([new Uint8Array([4, 5, 6, 7])], "track2.flac", { type: "" });
    const bad = new File([new Uint8Array([1, 2])], "malware.exe", { type: "application/octet-stream" });

    await useLocalLibraryStore.getState().uploadFilesToRoom([mp3, flac, bad], "123456");

    const state = useLocalLibraryStore.getState();
    expect(uploadedCalls).toHaveLength(2);
    expect(state.songs).toHaveLength(2);

    const successUploads = state.uploads.filter((u) => u.status === "success");
    const errorUploads = state.uploads.filter((u) => u.status === "error");
    expect(successUploads).toHaveLength(2);
    expect(successUploads.every((u) => u.progress === 100)).toBe(true);
    expect(errorUploads).toHaveLength(1);
    expect(errorUploads[0].fileName).toBe("malware.exe");
    expect(errorUploads[0].error).toContain("Unsupported audio format");
  });

  it("adds a saved song from IndexedDB library to an active room and removes songs from library", async () => {
    const wav = new File([new Uint8Array([10, 20, 30])], "saved.wav", { type: "audio/wav" });
    await useLocalLibraryStore.getState().saveFilesToLibrary([wav]);

    let state = useLocalLibraryStore.getState();
    expect(state.songs).toHaveLength(1);

    const saved = state.songs[0];
    await state.addSavedSongToRoom(saved, "654321");

    expect(uploadedCalls).toEqual([{ name: "saved.wav", roomId: "654321" }]);

    await state.removeFromLibrary(saved.id);
    state = useLocalLibraryStore.getState();
    expect(state.songs).toHaveLength(0);
  });
});
