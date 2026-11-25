"use client";

import { cn, trimFileName } from "@/lib/utils";
import { useCanMutate } from "@/store/global";
import { useLocalLibraryStore } from "@/store/localLibrary";
import { useRoomStore } from "@/store/room";
import { UPLOAD_CONSTANTS } from "@beatsync/shared";
import { CloudUpload, Plus } from "lucide-react";
import { useState } from "react";

const FILE_ACCEPT = UPLOAD_CONSTANTS.ALLOWED_AUDIO_EXTENSIONS.join(",") + ",audio/*";

export const AudioUploaderMinimal = () => {
  const [isDragging, setIsDragging] = useState(false);
  const canMutate = useCanMutate();
  const roomId = useRoomStore((state) => state.roomId);
  const uploads = useLocalLibraryStore((state) => state.uploads);
  const uploadFilesToRoom = useLocalLibraryStore((state) => state.uploadFilesToRoom);

  const isDisabled = !canMutate;
  const activeUploads = uploads.filter((u) => u.status === "uploading");
  const isUploading = activeUploads.length > 0;
  const latestUpload = activeUploads[0] ?? uploads[0];

  const handleFiles = (fileList: FileList | null) => {
    if (isDisabled || !fileList || fileList.length === 0) return;
    void uploadFilesToRoom(Array.from(fileList), roomId);
  };

  const onInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(event.target.files);
    event.target.value = "";
  };

  const onDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (isDisabled) return;
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  };

  const onDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (isDisabled) return;
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  };

  const onDropEvent = (event: React.DragEvent<HTMLDivElement>) => {
    if (isDisabled) return;
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    handleFiles(event.dataTransfer?.files ?? null);
  };

  return (
    <div
      className={cn(
        "border border-neutral-700/50 rounded-md mx-2 transition-all overflow-hidden",
        isDisabled ? "bg-neutral-800/20 opacity-50" : "bg-neutral-800/30 hover:bg-neutral-800/50",
        isDragging && !isDisabled ? "outline outline-primary-400 outline-dashed" : "outline-none"
      )}
      id="drop_zone"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDragEnd={onDragLeave}
      onDrop={onDropEvent}
      title={isDisabled ? "Admin-only mode - only admins can upload" : undefined}
    >
      <label htmlFor="audio-upload" className={cn("block w-full", isDisabled ? "" : "cursor-pointer")}>
        <div className="p-3 flex items-center gap-3">
          <div
            className={cn(
              "p-1.5 rounded-md flex-shrink-0",
              isDisabled ? "bg-neutral-600 text-neutral-400" : "bg-primary-700 text-white"
            )}
          >
            {isUploading ? <CloudUpload className="h-4 w-4 animate-pulse" /> : <Plus className="h-4 w-4" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-white truncate">
              {isUploading
                ? `Uploading ${activeUploads.length > 1 ? `${activeUploads.length} songs` : trimFileName(latestUpload.fileName)} (${latestUpload.progress}%)`
                : "Upload local songs"}
            </div>
            {!isUploading && (
              <div className={cn("text-xs truncate", isDisabled ? "text-neutral-500" : "text-neutral-400")}>
                {isDisabled ? "Must be an admin to upload" : "Drop or pick MP3, WAV, FLAC, M4A"}
              </div>
            )}
          </div>
        </div>
      </label>

      <input
        id="audio-upload"
        type="file"
        multiple
        accept={FILE_ACCEPT}
        onChange={onInputChange}
        disabled={isDisabled}
        className="hidden"
      />
    </div>
  );
};
