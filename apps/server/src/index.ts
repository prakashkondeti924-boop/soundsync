import { ADMIN_SECRET, IS_DEMO_MODE } from "@/demo";
import { cleanupOrphanedLocalRooms, getStorageMode } from "@/lib/localStorage";
import { validateR2Config } from "@/lib/r2";
import { globalManager } from "@/managers";
import { BackupManager } from "@/managers/BackupManager";
import { getActiveRooms } from "@/routes/active";
import { handleGetDefaultAudio } from "@/routes/default";
import { handleServeAudio } from "@/routes/demoAudio";
import { handleDiscover } from "@/routes/discover";
import { handleHealth } from "@/routes/health";
import { handleServeLocalAudio } from "@/routes/localAudio";
import { handleRoot } from "@/routes/root";
import { handleStats } from "@/routes/stats";
import { handleGetPresignedURL, handleGetUploadConfig, handleLocalUpload, handleUploadComplete } from "@/routes/upload";
import { handleWebSocketUpgrade } from "@/routes/websocket";
import { handleClose, handleMessage, handleOpen } from "@/routes/websocketHandlers";
import { corsHeaders, errorResponse } from "@/utils/responses";
import type { WSData } from "@/utils/websocket";
import { UPLOAD_CONSTANTS } from "@beatsync/shared";

// Bun.serve with WebSocket support
const server = Bun.serve<WSData>({
  hostname: "0.0.0.0",
  port: Number(process.env.PORT) || 8080,
  async fetch(req, server) {
    const start = performance.now();
    const url = new URL(req.url);

    // Handle CORS preflight requests
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    let response: Response;

    try {
      // Demo mode: serve local audio files
      if (IS_DEMO_MODE && url.pathname.startsWith("/audio/")) {
        response = handleServeAudio(url.pathname);
      } else if (!IS_DEMO_MODE && url.pathname.startsWith(`${UPLOAD_CONSTANTS.LOCAL_UPLOADS_PATH_PREFIX}/`)) {
        response = await handleServeLocalAudio(req, url.pathname);
      } else {
        switch (url.pathname) {
          case "/":
            response = handleRoot(req);
            break;

          case "/ws":
            return handleWebSocketUpgrade(req, server);

          case "/upload/config":
            response = handleGetUploadConfig(req);
            break;

          case "/upload/local":
            if (IS_DEMO_MODE) {
              response = errorResponse("Uploads disabled in demo mode", 403);
            } else {
              response = await handleLocalUpload(req, server);
            }
            break;

          case "/upload/get-presigned-url":
            if (IS_DEMO_MODE) {
              response = errorResponse("Uploads disabled in demo mode", 403);
            } else {
              response = await handleGetPresignedURL(req);
            }
            break;

          case "/upload/complete":
            if (IS_DEMO_MODE) {
              response = errorResponse("Uploads disabled in demo mode", 403);
            } else {
              response = await handleUploadComplete(req, server);
            }
            break;

          case "/stats":
            response = await handleStats();
            break;

          case "/default":
            response = await handleGetDefaultAudio(req);
            break;

          case "/active-rooms":
            response = getActiveRooms(req);
            break;

          case "/discover":
            response = handleDiscover(req);
            break;

          case "/health":
            response = handleHealth();
            break;

          default:
            response = errorResponse("Not found", 404);
            break;
        }
      }
    } catch (error) {
      const durationMs = (performance.now() - start).toFixed(1);
      console.error(
        `[${new Date().toISOString()}] ${req.method} ${url.pathname} 500 ${durationMs}ms - Unhandled error:`,
        error
      );
      return errorResponse("Internal server error", 500);
    }

    const durationMs = (performance.now() - start).toFixed(1);
    console.log(`[${new Date().toISOString()}] ${req.method} ${url.pathname} ${response.status} ${durationMs}ms`);

    return response;
  },

  websocket: {
    open(ws) {
      handleOpen(ws, server);
    },

    message(ws, message) {
      void handleMessage(ws, message, server);
    },

    close(ws) {
      handleClose(ws, server);
    },
  },
});

console.log(`HTTP listening on http://${server.hostname}:${server.port} (storage mode: ${getStorageMode()})`);

if (IS_DEMO_MODE) {
  console.log(`🔑 Admin secret: ${ADMIN_SECRET}`);
}

const isR2Configured = validateR2Config().isValid;

if (!IS_DEMO_MODE) {
  if (isR2Configured) {
    // Restore state from backup on startup
    BackupManager.restoreState().catch((error) => {
      console.error("Failed to restore state on startup:", error);
    });

    // Set up periodic backups every minute (for Render persistence issues)
    const BACKUP_INTERVAL_MS = 60 * 1000; // 1 minute
    setInterval(() => {
      console.log("🔄 Performing periodic backup at", new Date().toISOString());
      BackupManager.backupState().catch((error) => {
        console.error("Failed to perform periodic backup:", error);
      });
    }, BACKUP_INTERVAL_MS);
  } else {
    console.log("📁 R2 not configured — running with local disk upload storage");
    cleanupOrphanedLocalRooms(new Set(globalManager.getRoomIds())).catch((error) => {
      console.error("Failed to clean up orphaned local rooms on startup:", error);
    });
  }
}

// Simple graceful shutdown
const shutdown = async () => {
  console.log("\n⚠️ Shutting down...");

  void server.stop(); // Stop accepting new connections
  if (!IS_DEMO_MODE && isR2Configured) {
    await BackupManager.backupState(); // Save state
  }

  process.exit(0);
};

// Handle shutdown signals
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

// Crash handlers — log the error before PM2 restarts the process
process.on("uncaughtException", (error) => {
  console.error(`[${new Date().toISOString()}] UNCAUGHT EXCEPTION — process will exit:`, error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error(`[${new Date().toISOString()}] UNHANDLED REJECTION:`, reason);
});
