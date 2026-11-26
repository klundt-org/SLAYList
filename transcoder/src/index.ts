// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Transcoder entry point (Sprint 6.1).
 *
 * Modes:
 *   - default: start, emit `TranscoderStarted`, then idle. Under scale-to-zero (minReplicas 0, D4)
 *     nothing starts a replica at rest; Epic 7 replaces the idle with the queue consumer, which
 *     calls the same `runTranscode`.
 *   - manual one-shot (Epic 6 "manual trigger"): when `TRANSCODE_ONESHOT_BLOB` is set, transcode
 *     that one `raw-uploads` blob at startup, then idle. Idempotent — a replica restart re-runs it
 *     and the job cleanly skips a record that is no longer `processing`.
 *
 * Env (all non-secret except the App Insights connection string, which arrives via a Container
 * App secretRef — never in the image or the repo):
 *   STORAGE_ACCOUNT_NAME                   storage account (MI auth, D25) — required for a job
 *   APPLICATIONINSIGHTS_CONNECTION_STRING  App Insights sink (D24) — optional (console-only without)
 *   TRANSCODE_ONESHOT_BLOB                 raw blob name to transcode once (manual trigger)
 *   TRANSCODE_ONESHOT_LIBRARY_ID           fallback library id for pre-6.1 blobs lacking metadata
 *   TRANSCODE_TIMEOUT_MS                   ffmpeg ceiling (default 10 min)
 *   CONTAINER_APP_REVISION                 Azure-injected; telemetry only
 */

import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEncoder } from './ffmpeg.js';
import { createStorage } from './storage.js';
import { createTelemetry } from './telemetry.js';
import { runTranscode, type WorkFs } from './transcode.js';

const env = process.env;
const revision = env.CONTAINER_APP_REVISION;
const telemetry = createTelemetry({
  connectionString: env.APPLICATIONINSIGHTS_CONNECTION_STRING,
  roleName: 'slaylist-transcoder',
  roleInstance: revision,
});
const encoder = createEncoder();

const workFs: WorkFs = {
  // Directory name carries only the songId (D32) — never the title-slug blob name.
  makeWorkDir: (songId) => mkdtemp(join(tmpdir(), `slay-${songId}-`)),
  removeWorkDir: (dir) => rm(dir, { recursive: true, force: true }),
  sizeOf: async (path) => (await stat(path)).size,
};

function idleForever(): void {
  // Keep the process (and so the replica) alive; exit cleanly when the platform stops it.
  const timer = setInterval(() => undefined, 1 << 30);
  const stop = () => {
    clearInterval(timer);
    process.exit(0);
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

async function main(): Promise<void> {
  const oneshot = env.TRANSCODE_ONESHOT_BLOB?.trim();
  await telemetry.event('TranscoderStarted', {
    revision,
    mode: oneshot ? 'oneshot' : 'idle',
    ffmpegVersion: await encoder.version(),
  });

  if (oneshot) {
    const accountName = env.STORAGE_ACCOUNT_NAME?.trim();
    if (!accountName) {
      await telemetry.event('TranscodeFailed', { reason: 'config:missing-storage-account', mode: 'oneshot' });
    } else {
      const timeoutMs = Number.parseInt(env.TRANSCODE_TIMEOUT_MS ?? '', 10) || 10 * 60_000;
      // runTranscode reports its own outcome via telemetry; nothing else to log here (and the
      // blob name must never be logged — it embeds the title slug, D32).
      await runTranscode(
        { rawBlobName: oneshot, libraryId: env.TRANSCODE_ONESHOT_LIBRARY_ID?.trim() || undefined, mode: 'oneshot' },
        { storage: createStorage({ accountName }), encoder, fs: workFs, telemetry, timeoutMs },
      );
    }
  }

  idleForever();
}

main().catch(async () => {
  // Last-resort guard: report a code only (an arbitrary error message could carry a URL / name).
  await telemetry.event('TranscodeFailed', { reason: 'unexpected:main' });
  idleForever();
});
