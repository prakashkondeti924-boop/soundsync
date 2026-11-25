"use client";

import { formatFileSize, type LocalSongRecord } from "@/lib/localSongsDb";
import { cn, extractFileNameFromUrl, trimFileName } from "@/lib/utils";
import { useCanMutate, useGlobalStore } from "@/store/global";
import { useLocalLibraryStore } from "@/store/localLibrary";
import { useRoomStore } from "@/store/room";
import { UPLOAD_CONSTANTS } from "@beatsync/shared";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FolderHeart,
  HardDriveUpload,
  Loader2,
  Music2,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

const FILE_ACCEPT = UPLOAD_CONSTANTS.ALLOWED_AUDIO_EXTENSIONS.join(",") + ",audio/*";

function getExtensionBadge(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot === -1 || dot === fileName.length - 1) return "AUDIO";
  return fileName.slice(dot + 1).toUpperCase();
}

export const LocalSongsPanel = () => {
  const canMutate = useCanMutate();
  const roomId = useRoomStore((state) => state.roomId);
  const audioSources = useGlobalStore((state) => state.audioSources);

  const songs = useLocalLibraryStore((state) => state.songs);
  const isLoadingLibrary = useLocalLibraryStore((state) => state.isLoadingLibrary);
  const libraryLoaded = useLocalLibraryStore((state) => state.libraryLoaded);
  const libraryError = useLocalLibraryStore((state) => state.libraryError);
  const saveOnUpload = useLocalLibraryStore((state) => state.saveOnUpload);
  const uploads = useLocalLibraryStore((state) => state.uploads);
  const uploadingSongIds = useLocalLibraryStore((state) => state.uploadingSongIds);

  const loadLibrary = useLocalLibraryStore((state) => state.loadLibrary);
  const setSaveOnUpload = useLocalLibraryStore((state) => state.setSaveOnUpload);
  const saveFilesToLibrary = useLocalLibraryStore((state) => state.saveFilesToLibrary);
  const removeFromLibrary = useLocalLibraryStore((state) => state.removeFromLibrary);
  const uploadFilesToRoom = useLocalLibraryStore((state) => state.uploadFilesToRoom);
  const addSavedSongToRoom = useLocalLibraryStore((state) => state.addSavedSongToRoom);
  const dismissUpload = useLocalLibraryStore((state) => state.dismissUpload);
  const clearCompletedUploads = useLocalLibraryStore((state) => state.clearCompletedUploads);

  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const roomUploadInputRef = useRef<HTMLInputElement>(null);
  const libraryOnlyInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!libraryLoaded) {
      void loadLibrary();
    }
  }, [libraryLoaded, loadLibrary]);

  const queueSongTitles = useMemo(() => {
    const names = new Set<string>();
    for (const src of audioSources) {
      try {
        names.add(extractFileNameFromUrl(src.source.url).toLowerCase());
      } catch {
        // Ignore non-standard URLs
      }
    }
    return names;
  }, [audioSources]);

  const activeUploadCount = uploads.filter((u) => u.status === "uploading").length;
  const hasCompletedOrErrored = uploads.some((u) => u.status !== "uploading");

  const handleRoomFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0 || !canMutate) return;
    void uploadFilesToRoom(files, roomId);
  };

  const handleLibraryFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    void saveFilesToLibrary(files);
    setIsLibraryOpen(true);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);

    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0) return;

    if (canMutate) {
      void uploadFilesToRoom(files, roomId);
    } else {
      void saveFilesToLibrary(files);
      setIsLibraryOpen(true);
    }
  };

  const isSongInQueue = (song: LocalSongRecord) => queueSongTitles.has(trimFileName(song.name).toLowerCase());

  return (
    <div
      className={cn(
        "rounded-xl border transition-colors bg-neutral-900/60",
        isDragging ? "border-primary-400 bg-primary-950/20" : "border-neutral-800/80"
      )}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
      }}
      onDrop={handleDrop}
    >
      {/* Primary Action Bar */}
      <div className="p-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => roomUploadInputRef.current?.click()}
            disabled={!canMutate}
            title={!canMutate ? "Only admins can add songs in admin-only mode" : "Upload audio files from your device"}
            className={cn(
              "inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all",
              canMutate
                ? "bg-white text-black hover:bg-neutral-200 cursor-pointer shadow-sm"
                : "bg-neutral-800 text-neutral-500 cursor-not-allowed"
            )}
          >
            {activeUploadCount > 0 ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            <span>{activeUploadCount > 0 ? `Uploading (${activeUploadCount})...` : "Upload Local Songs"}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsLibraryOpen((prev) => !prev)}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer",
              isLibraryOpen
                ? "bg-neutral-800 border-neutral-600 text-white"
                : "bg-neutral-900/80 border-neutral-700/70 text-neutral-300 hover:bg-neutral-800 hover:text-white"
            )}
          >
            <FolderHeart className="size-3.5 text-primary-400" />
            <span>My Local Songs</span>
            <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] bg-neutral-700/70 text-neutral-200 font-mono">
              {songs.length}
            </span>
            {isLibraryOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
        </div>

        <label className="flex items-center gap-1.5 text-[11px] text-neutral-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={saveOnUpload}
            onChange={(e) => setSaveOnUpload(e.target.checked)}
            className="rounded border-neutral-600 bg-neutral-800 accent-white cursor-pointer"
          />
          <span>Save uploads to browser</span>
        </label>

        <input
          ref={roomUploadInputRef}
          type="file"
          multiple
          accept={FILE_ACCEPT}
          onChange={handleRoomFileSelect}
          className="hidden"
          data-testid="local-upload-input"
        />
        <input
          ref={libraryOnlyInputRef}
          type="file"
          multiple
          accept={FILE_ACCEPT}
          onChange={handleLibraryFileSelect}
          className="hidden"
          data-testid="local-library-input"
        />
      </div>

      {/* Drag hint on hover/drag */}
      {isDragging && (
        <div className="px-3 pb-3 text-xs text-primary-300 flex items-center gap-2">
          <HardDriveUpload className="size-4" />
          <span>
            {canMutate
              ? "Drop audio files to upload to this room"
              : "Drop audio files to save to your Local Songs library"}
          </span>
        </div>
      )}

      {/* Per-file Upload Progress & Status List */}
      {uploads.length > 0 && (
        <div className="border-t border-neutral-800/80 px-3 py-2.5 space-y-2 bg-neutral-950/40">
          <div className="flex items-center justify-between text-[11px] text-neutral-400">
            <span>Uploads ({uploads.length})</span>
            {hasCompletedOrErrored && (
              <button
                type="button"
                onClick={clearCompletedUploads}
                className="text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                Clear finished
              </button>
            )}
          </div>

          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
            {uploads.map((item) => (
              <div
                key={item.id}
                className="rounded-lg bg-neutral-900/90 border border-neutral-800/80 px-2.5 py-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {item.status === "uploading" && (
                      <Loader2 className="size-3.5 animate-spin text-primary-400 flex-shrink-0" />
                    )}
                    {item.status === "success" && <CheckCircle2 className="size-3.5 text-green-400 flex-shrink-0" />}
                    {item.status === "error" && <AlertCircle className="size-3.5 text-red-400 flex-shrink-0" />}
                    <span className="truncate text-neutral-200 font-medium">{item.fileName}</span>
                    <span className="text-[10px] text-neutral-500 flex-shrink-0">{formatFileSize(item.fileSize)}</span>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {item.status === "uploading" && (
                      <span className="text-[11px] font-mono text-neutral-300">{item.progress}%</span>
                    )}
                    {item.status === "success" && <span className="text-[11px] text-green-400">Added</span>}
                    {item.status !== "uploading" && (
                      <button
                        type="button"
                        onClick={() => dismissUpload(item.id)}
                        className="text-neutral-500 hover:text-neutral-200 transition-colors cursor-pointer"
                        aria-label={`Dismiss ${item.fileName}`}
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {item.status === "uploading" && (
                  <div className="mt-1.5 h-1.5 w-full rounded-full bg-neutral-800 overflow-hidden">
                    <div
                      className="h-full bg-white transition-all duration-150"
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                )}

                {item.status === "error" && item.error && <p className="mt-1 text-[11px] text-red-400">{item.error}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Personal Browser Local Songs Library (IndexedDB) */}
      {isLibraryOpen && (
        <div className="border-t border-neutral-800/80 p-3 space-y-2.5 bg-neutral-950/30">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-medium text-neutral-200">Saved in Browser (IndexedDB)</h3>
              <p className="text-[11px] text-neutral-500">
                Available across refreshes. Add any song to sync with this room.
              </p>
            </div>
            <button
              type="button"
              onClick={() => libraryOnlyInputRef.current?.click()}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition-colors cursor-pointer flex-shrink-0"
            >
              <Plus className="size-3" />
              <span>Save Files</span>
            </button>
          </div>

          {libraryError && (
            <div className="text-xs text-red-400 bg-red-950/30 border border-red-900/40 rounded-md p-2">
              {libraryError}
            </div>
          )}

          {isLoadingLibrary ? (
            <div className="py-4 flex items-center justify-center gap-2 text-xs text-neutral-400">
              <Loader2 className="size-3.5 animate-spin" />
              <span>Loading saved songs...</span>
            </div>
          ) : songs.length === 0 ? (
            <div className="py-4 text-center text-xs text-neutral-500 border border-dashed border-neutral-800 rounded-lg">
              No songs saved yet. Upload tracks or click &ldquo;Save Files&rdquo; to keep songs in your browser.
            </div>
          ) : (
            <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
              {songs.map((song) => {
                const isUploadingThis = Boolean(uploadingSongIds[song.id]);
                const alreadyInQueue = isSongInQueue(song);

                return (
                  <div
                    key={song.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-neutral-800/70 bg-neutral-900/70 px-2.5 py-2"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Music2 className="size-4 text-neutral-400 flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-neutral-200 truncate">{trimFileName(song.name)}</div>
                        <div className="flex items-center gap-2 text-[10px] text-neutral-500">
                          <span className="font-mono">{getExtensionBadge(song.name)}</span>
                          <span>{formatFileSize(song.size)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        type="button"
                        disabled={!canMutate || isUploadingThis}
                        onClick={() => void addSavedSongToRoom(song, roomId)}
                        title={
                          !canMutate
                            ? "Admin-only mode: only admins can add to queue"
                            : alreadyInQueue
                              ? "Add another copy to room queue"
                              : "Upload and add to room queue"
                        }
                        className={cn(
                          "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors",
                          !canMutate
                            ? "bg-neutral-800 text-neutral-500 cursor-not-allowed"
                            : isUploadingThis
                              ? "bg-neutral-700 text-neutral-300 cursor-wait"
                              : alreadyInQueue
                                ? "bg-emerald-950/60 border border-emerald-800/60 text-emerald-300 hover:bg-emerald-900/60 cursor-pointer"
                                : "bg-neutral-800 hover:bg-white hover:text-black text-white cursor-pointer"
                        )}
                      >
                        {isUploadingThis ? (
                          <>
                            <Loader2 className="size-3 animate-spin" />
                            <span>Adding...</span>
                          </>
                        ) : alreadyInQueue ? (
                          <>
                            <Check className="size-3" />
                            <span>In Queue</span>
                          </>
                        ) : (
                          <>
                            <Plus className="size-3" />
                            <span>Add to Queue</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => void removeFromLibrary(song.id)}
                        className="p-1.5 rounded-md text-neutral-500 hover:text-red-400 hover:bg-neutral-800 transition-colors cursor-pointer"
                        aria-label={`Remove ${song.name} from Local Songs`}
                        title="Remove from Local Songs"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
