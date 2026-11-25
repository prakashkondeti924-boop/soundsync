import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { validateAudioUploadMetadata } from "@beatsync/shared";
import { createMockServer, createMockWs } from "@/__tests__/mocks/websocket";
import {
  cleanupOrphanedLocalRooms,
  getLocalAudioFile,
  parseLocalAudioUrl,
  resolveSafeAudioFilePath,
  saveLocalAudioFile,
} from "@/lib/localStorage";
import { globalManager } from "@/managers";
import { handleServeLocalAudio } from "@/routes/localAudio";
import { handleGetUploadConfig, handleLocalUpload } from "@/routes/upload";
import { handleDeleteAudioSources } from "@/websocket/handlers/handleDeleteAudioSources";

const tempUploadsDir = mkdtempSync(path.join(os.tmpdir(), "beatsync-local-uploads-"));
const originalLocalUploadDir = process.env.LOCAL_UPLOAD_DIR;
const originalStorageMode = process.env.STORAGE_MODE;

describe("Local Audio Upload & Storage", () => {
  beforeEach(() => {
    process.env.LOCAL_UPLOAD_DIR = tempUploadsDir;
    process.env.STORAGE_MODE = "local";
    for (const entry of readdirSync(tempUploadsDir)) {
      rmSync(path.join(tempUploadsDir, entry), { recursive: true, force: true });
    }
    for (const roomId of globalManager.getRoomIds()) {
      globalManager.deleteRoom(roomId);
    }
  });

  afterEach(() => {
    for (const roomId of globalManager.getRoomIds()) {
      globalManager.deleteRoom(roomId);
    }
  });

  afterAll(() => {
    process.env.LOCAL_UPLOAD_DIR = originalLocalUploadDir;
    process.env.STORAGE_MODE = originalStorageMode;
    rmSync(tempUploadsDir, { recursive: true, force: true });
  });

  describe("Validation & Path Traversal Protection", () => {
    it("accepts supported audio formats including empty MIME with valid extension", () => {
      expect(validateAudioUploadMetadata({ fileName: "track.mp3", mimeType: "audio/mpeg", size: 1024 }).valid).toBe(
        true
      );
      expect(validateAudioUploadMetadata({ fileName: "lossless.flac", mimeType: "", size: 2048 }).valid).toBe(true);
      expect(validateAudioUploadMetadata({ fileName: "voice.m4a", mimeType: "audio/mp4", size: 512 }).valid).toBe(true);
      expect(validateAudioUploadMetadata({ fileName: "beat.wav", mimeType: "audio/wav", size: 4096 }).valid).toBe(true);
    });

    it("rejects unsupported extensions, empty files, and oversized files", () => {
      expect(validateAudioUploadMetadata({ fileName: "payload.exe", mimeType: "audio/mpeg", size: 100 }).valid).toBe(
        false
      );
      expect(validateAudioUploadMetadata({ fileName: "empty.mp3", mimeType: "audio/mpeg", size: 0 }).valid).toBe(false);
      expect(
        validateAudioUploadMetadata({ fileName: "huge.mp3", mimeType: "audio/mpeg", size: 200 * 1024 * 1024 }).valid
      ).toBe(false);
    });

    it("rejects path traversal in parseLocalAudioUrl and resolveSafeAudioFilePath", () => {
      expect(parseLocalAudioUrl("/uploads/room-123456/../../etc/passwd")).toBeNull();
      expect(parseLocalAudioUrl("/uploads/room-123456/%2e%2e/secret.mp3")).toBeNull();
      expect(parseLocalAudioUrl("/uploads/room-../song.mp3")).toBeNull();
      expect(() => resolveSafeAudioFilePath("123456", "../escape.mp3")).toThrow();
      expect(() => resolveSafeAudioFilePath("../other", "song.mp3")).toThrow();
    });
  });

  describe("Upload Config, Local Upload & Range Streaming", () => {
    it("reports local storage mode when R2 is not configured", async () => {
      const res = handleGetUploadConfig(new Request("http://localhost:8080/upload/config"));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { mode: string; allowedExtensions: string[] };
      expect(body.mode).toBe("local");
      expect(body.allowedExtensions).toContain(".mp3");
      expect(body.allowedExtensions).toContain(".flac");
    });

    it("uploads audio via POST /upload/local, adds to room, broadcasts, and streams with Range support", async () => {
      const roomId = "123456";
      const room = globalManager.getOrCreateRoom(roomId);
      const ws = createMockWs({ clientId: "client-1", roomId });
      room.addClient(ws);

      const published: unknown[][] = [];
      const baseServer = createMockServer();
      const server = {
        ...baseServer,
        publish: (...args: unknown[]) => {
          published.push(args);
          return 0;
        },
      } as unknown as ReturnType<typeof createMockServer>;

      const audioBytes = new Uint8Array(Array.from({ length: 64 }, (_, i) => i));
      const file = new File([audioBytes], "My Test Song.mp3", { type: "audio/mpeg" });
      const formData = new FormData();
      formData.append("roomId", roomId);
      formData.append("file", file);

      const uploadReq = new Request("http://localhost:8080/upload/local", {
        method: "POST",
        body: formData,
      });

      const uploadRes = await handleLocalUpload(uploadReq, server);
      expect(uploadRes.status).toBe(200);

      const uploadBody = (await uploadRes.json()) as { success: boolean; url: string; fileName: string };
      expect(uploadBody.success).toBe(true);
      expect(uploadBody.url).toStartWith(`/uploads/room-${roomId}/`);
      expect(room.getAudioSources().some((s) => s.url === uploadBody.url)).toBe(true);
      expect(published.length).toBeGreaterThan(0);

      // Verify full GET
      const fullRes = await handleServeLocalAudio(
        new Request(`http://localhost:8080${uploadBody.url}`),
        uploadBody.url
      );
      expect(fullRes.status).toBe(200);
      expect(fullRes.headers.get("Accept-Ranges")).toBe("bytes");
      expect(fullRes.headers.get("Access-Control-Allow-Origin")).toBe("*");
      const downloaded = new Uint8Array(await fullRes.arrayBuffer());
      expect(downloaded).toEqual(audioBytes);

      // Verify partial Range 206
      const rangeRes = await handleServeLocalAudio(
        new Request(`http://localhost:8080${uploadBody.url}`, {
          headers: { Range: "bytes=10-19" },
        }),
        uploadBody.url
      );
      expect(rangeRes.status).toBe(206);
      expect(rangeRes.headers.get("Content-Range")).toBe("bytes 10-19/64");
      expect(rangeRes.headers.get("Content-Length")).toBe("10");
      const slice = new Uint8Array(await rangeRes.arrayBuffer());
      expect(Array.from(slice)).toEqual(Array.from(audioBytes.slice(10, 20)));

      // Verify invalid Range 416
      const invalidRangeRes = await handleServeLocalAudio(
        new Request(`http://localhost:8080${uploadBody.url}`, {
          headers: { Range: "bytes=100-200" },
        }),
        uploadBody.url
      );
      expect(invalidRangeRes.status).toBe(416);
      expect(invalidRangeRes.headers.get("Content-Range")).toBe("bytes */64");
    });

    it("rejects uploads for non-existent rooms", async () => {
      const formData = new FormData();
      formData.append("roomId", "999999");
      formData.append("file", new File([new Uint8Array([1, 2, 3])], "song.mp3", { type: "audio/mpeg" }));

      const res = await handleLocalUpload(
        new Request("http://localhost:8080/upload/local", { method: "POST", body: formData }),
        createMockServer()
      );
      expect(res.status).toBe(404);
    });
  });

  describe("Safe Cleanup", () => {
    it("deletes local file when deleted from room, unless still referenced by another room", async () => {
      const room1 = globalManager.getOrCreateRoom("111111");
      const room2 = globalManager.getOrCreateRoom("222222");
      const ws1 = createMockWs({ clientId: "admin-1", roomId: "111111" });
      room1.addClient(ws1);

      const { url } = await saveLocalAudioFile("111111", "shared___test.mp3", new Uint8Array([1, 2, 3, 4]));
      room1.addAudioSource({ url });
      room2.addAudioSource({ url });

      // Deleting from room1 while room2 still references it must keep file on disk
      await handleDeleteAudioSources({
        ws: ws1,
        message: { type: "DELETE_AUDIO_SOURCES", urls: [url] },
        server: createMockServer(),
      });
      expect(room1.getAudioSources()).toHaveLength(0);
      expect(await getLocalAudioFile("111111", "shared___test.mp3")).not.toBeNull();

      // Remove reference from room2, re-add to room1, then delete — file should now be removed
      room2.removeAudioSources([url]);
      room1.addAudioSource({ url });
      await handleDeleteAudioSources({
        ws: ws1,
        message: { type: "DELETE_AUDIO_SOURCES", urls: [url] },
        server: createMockServer(),
      });
      expect(await getLocalAudioFile("111111", "shared___test.mp3")).toBeNull();
    });

    it("cleans up room local files on RoomManager.cleanup only when no active connections exist", async () => {
      const roomId = "333333";
      const room = globalManager.getOrCreateRoom(roomId);
      const ws = createMockWs({ clientId: "client-a", roomId });
      room.addClient(ws);

      await saveLocalAudioFile(roomId, "active___song.mp3", new Uint8Array([9, 8, 7]));

      // While connected, cleanup must not delete files
      await room.cleanup();
      expect(await getLocalAudioFile(roomId, "active___song.mp3")).not.toBeNull();

      // After disconnecting, cleanup deletes room directory
      room.removeClient("client-a");
      await room.cleanup();
      expect(await getLocalAudioFile(roomId, "active___song.mp3")).toBeNull();
    });

    it("cleans up expired orphaned local room folders without touching active rooms", async () => {
      globalManager.getOrCreateRoom("444444");
      await saveLocalAudioFile("444444", "keep___song.mp3", new Uint8Array([1, 2]));
      await saveLocalAudioFile("555555", "orphan___song.mp3", new Uint8Array([3, 4]));

      const deletedCount = await cleanupOrphanedLocalRooms(new Set(["444444"]), 0);
      expect(deletedCount).toBe(1);
      expect(await getLocalAudioFile("444444", "keep___song.mp3")).not.toBeNull();
      expect(await getLocalAudioFile("555555", "orphan___song.mp3")).toBeNull();
    });
  });
});
