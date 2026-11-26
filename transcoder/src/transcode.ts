// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The transcode job — pure orchestration over injected storage / encoder / filesystem / telemetry,
 * so every path (happy, failure, skip, conflict) is unit-tested without Azure or ffmpeg.
 *
 * JOB CONTRACT: `{ rawBlobName }` — the name of the original in `raw-uploads`. That is exactly what
 * Epic 7's Event Grid BlobCreated event will deliver, so the queue consumer is a thin adapter over
 * this function. The song id and library id come from the blob's metadata (`songid` / `libraryid`,
 * stamped by the API at upload); `job.libraryId` is an operator-supplied fallback ONLY for originals
 * uploaded before Sprint 6.1 started stamping `libraryid`. There is no hardcoded library (D19).
 *
 * STATE MACHINE (idempotent — safe if the same job runs twice / is delivered twice):
 *   - acts ONLY on a record in `processing`; any other state is a clean skip (already `ready`,
 *     `failed`, or `deactivated` → nothing to do);
 *   - the record flip is ETag-conditional on the state we read, so a concurrent change (duplicate
 *     job finished first, admin deactivated mid-transcode) is a skip, never a clobber;
 *   - the finished blob name is deterministic per raw upload, so a re-run overwrites its own
 *     derivative copy rather than orphaning a second one.
 *   - any error after the record was read flips it to `failed` (no stuck `processing`). If even
 *     that flip fails, the reason says so and the record stays `processing` for a retry (Epic 7's
 *     queue retry/dead-letter is the backstop).
 *
 * D28: originals are never deleted — `TranscodeStorage` has no delete operation.
 * D32 mitigation (a): ffmpeg only ever sees `<songId>.<ext>` → `<songId>.m4a` in a songId-named
 * work dir, so its stderr can't contain the title slug; the blob name is never logged.
 */

import { join } from 'node:path';
import type { AudioFormat, SongState, SongUpdateInput } from '@slaylist/shared';
import { OUTPUT_FORMAT } from '@slaylist/shared';
import { FfmpegError, type Encoder } from './ffmpeg.js';
import { errorCode } from './errors.js';
import type { Telemetry } from './telemetry.js';

// ---- Contracts --------------------------------------------------------------------------------

export interface TranscodeJob {
  /** Blob name within `raw-uploads` (D8: `{title-slug}_{yyyyMMdd-HHmmss}_{shortid}.{ext}`). */
  rawBlobName: string;
  /** Fallback library id for pre-6.1 originals lacking `libraryid` metadata. */
  libraryId?: string;
  /** How the job was started — telemetry only. */
  mode?: string;
}

export interface RawBlobInfo {
  songId?: string;
  libraryId?: string;
}

export interface RecordView {
  state: SongState;
  etag: string;
}

/** The record fields the transcoder writes — field names come from the shared `Song` type. */
export type RecordPatch = Pick<SongUpdateInput, 'state' | 'blobPath' | 'format' | 'sizeBytes' | 'durationSec'>;

/** Storage operations the transcoder needs. Note: NO delete — D28. */
export interface TranscodeStorage {
  getRawInfo(rawBlobName: string): Promise<RawBlobInfo | null>;
  downloadRaw(rawBlobName: string, localPath: string): Promise<void>;
  uploadFinished(finishedName: string, localPath: string): Promise<void>;
  getRecord(libraryId: string, songId: string): Promise<RecordView | null>;
  updateRecord(libraryId: string, songId: string, patch: RecordPatch, etag: string): Promise<'ok' | 'conflict'>;
}

/** Local scratch-space operations (injected so tests need no real filesystem). */
export interface WorkFs {
  makeWorkDir(songId: string): Promise<string>;
  removeWorkDir(dir: string): Promise<void>;
  sizeOf(path: string): Promise<number>;
}

export interface TranscodeDeps {
  storage: TranscodeStorage;
  encoder: Encoder;
  fs: WorkFs;
  telemetry: Telemetry;
  /** Hard ceiling on one ffmpeg run. */
  timeoutMs: number;
  now?: () => number;
}

export type TranscodeResult =
  | { outcome: 'ready'; songId: string; libraryId: string; blobPath: string; sizeBytes: number; durationSec: number }
  | { outcome: 'failed'; songId: string; libraryId: string; reason: string }
  | { outcome: 'skipped'; reason: string; songId?: string; libraryId?: string }
  | { outcome: 'error'; reason: string; songId?: string; libraryId?: string };

// ---- Pure helpers -----------------------------------------------------------------------------

/** Input extensions the transcoder accepts — mirrors the upload allowlist (Sprint 5.1). */
export const INPUT_EXTENSIONS = ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'opus'] as const;

/** Ids used in local paths / keys: opaque, no separators — guards against path traversal. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** D8 blob names are flat (no `/`), slug/timestamp/shortid chars only. */
const SAFE_BLOB_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

/** Validate a raw blob name and return its lowercase extension, or null if unusable. */
export function rawExtension(rawBlobName: string): string | null {
  if (!SAFE_BLOB_NAME.test(rawBlobName) || rawBlobName.includes('..')) return null;
  const dot = rawBlobName.lastIndexOf('.');
  if (dot <= 0) return null;
  const ext = rawBlobName.slice(dot + 1).toLowerCase();
  return (INPUT_EXTENSIONS as readonly string[]).includes(ext) ? ext : null;
}

/**
 * The finished blob name: the raw name with its extension swapped for the output format's. Keeps
 * D8's human-readable `{title-slug}_{timestamp}_{shortid}` stem (handy at restore time) and is
 * deterministic per upload (idempotent re-runs). This is plumbing — never logged (title slug).
 */
export function finishedBlobName(rawBlobName: string, format: AudioFormat = OUTPUT_FORMAT): string {
  const dot = rawBlobName.lastIndexOf('.');
  return `${dot > 0 ? rawBlobName.slice(0, dot) : rawBlobName}.${format}`;
}

class StageError extends Error {
  constructor(
    readonly reason: string,
    readonly detail?: string,
  ) {
    super(reason);
  }
}

/** Run one stage; convert any failure into a PII-safe `<stage>:<code>` reason. */
async function stage<T>(name: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof StageError) throw err;
    if (err instanceof FfmpegError) throw new StageError(`${name}:${err.code}`, err.detail);
    throw new StageError(`${name}:${errorCode(err)}`);
  }
}

// ---- The job ----------------------------------------------------------------------------------

export async function runTranscode(job: TranscodeJob, deps: TranscodeDeps): Promise<TranscodeResult> {
  const { storage, encoder, fs, telemetry } = deps;
  const now = deps.now ?? Date.now;
  const mode = job.mode;

  const skip = async (reason: string, songId?: string, libraryId?: string): Promise<TranscodeResult> => {
    await telemetry.event('TranscodeSkipped', { songId, libraryId, reason, mode });
    return { outcome: 'skipped', reason, songId, libraryId };
  };
  const error = async (reason: string, songId?: string, libraryId?: string): Promise<TranscodeResult> => {
    await telemetry.event('TranscodeFailed', { songId, libraryId, reason, mode });
    return { outcome: 'error', reason, songId, libraryId };
  };

  // 1) Validate the job and resolve the record's keys from the raw blob's metadata.
  const ext = rawExtension(job.rawBlobName);
  if (!ext) return skip('invalid-blob-name');

  let info: RawBlobInfo | null;
  try {
    info = await stage('raw-read', () => storage.getRawInfo(job.rawBlobName));
  } catch (err) {
    return error((err as StageError).reason);
  }
  if (!info) return skip('raw-not-found');

  const songId = info.songId;
  if (!songId || !SAFE_ID.test(songId)) return skip('raw-missing-songid');
  const libraryId = info.libraryId ?? job.libraryId;
  if (!libraryId || !SAFE_ID.test(libraryId)) return skip('missing-library-id', songId);

  // 2) Only a `processing` record is work to do (idempotency).
  let record: RecordView | null;
  try {
    record = await stage('record-read', () => storage.getRecord(libraryId, songId));
  } catch (err) {
    return error((err as StageError).reason, songId, libraryId);
  }
  if (!record) return skip('record-not-found', songId, libraryId);
  if (record.state !== 'processing') return skip(`not-processing:${record.state}`, songId, libraryId);

  await telemetry.event('TranscodeStarted', { songId, libraryId, mode });
  const started = now();
  let workDir: string | undefined;

  try {
    workDir = await stage('workdir', () => fs.makeWorkDir(songId));
    const dir = workDir;
    const input = join(dir, `${songId}.${ext}`);
    const output = join(dir, `${songId}.${OUTPUT_FORMAT}`);
    const blobPath = finishedBlobName(job.rawBlobName);

    await stage('download', () => storage.downloadRaw(job.rawBlobName, input));
    await stage('encode', () => encoder.encode(input, output, { timeoutMs: deps.timeoutMs, workDir: dir }));
    const durationSec = await stage('probe', () => encoder.probeDurationSec(output, { workDir: dir }));
    const sizeBytes = await stage('stat', () => fs.sizeOf(output));
    await stage('upload', () => storage.uploadFinished(blobPath, output));

    const flip = await stage('record-write', () =>
      storage.updateRecord(
        libraryId,
        songId,
        { state: 'ready', blobPath, format: OUTPUT_FORMAT, sizeBytes, durationSec },
        record.etag,
      ),
    );
    if (flip === 'conflict') return skip('record-changed', songId, libraryId);

    await telemetry.event(
      'TranscodeSucceeded',
      { songId, libraryId, mode },
      { sizeBytes, durationSec, elapsedMs: now() - started },
    );
    return { outcome: 'ready', songId, libraryId, blobPath, sizeBytes, durationSec };
  } catch (err) {
    const se = err instanceof StageError ? err : new StageError(`unexpected:${errorCode(err)}`);
    let reason = se.reason;
    // Flip to `failed` so nothing is stranded in `processing` — conditional on the state we read.
    try {
      const r = await storage.updateRecord(libraryId, songId, { state: 'failed' }, record.etag);
      if (r === 'conflict') reason += ';failed-flip:conflict';
    } catch (flipErr) {
      reason += `;failed-flip:${errorCode(flipErr)}`;
    }
    await telemetry.event(
      'TranscodeFailed',
      { songId, libraryId, reason, detail: se.detail, mode },
      { elapsedMs: now() - started },
    );
    return { outcome: 'failed', songId, libraryId, reason };
  } finally {
    if (workDir) {
      try {
        await fs.removeWorkDir(workDir);
      } catch {
        // Scratch space is ephemeral (container-local); a failed cleanup is not a job failure.
      }
    }
  }
}
