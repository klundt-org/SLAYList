// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { FfmpegError, type Encoder } from './ffmpeg.js';
import { createTelemetry } from './telemetry.js';
import {
  finishedBlobName,
  rawExtension,
  runTranscode,
  type RecordPatch,
  type TranscodeStorage,
  type WorkFs,
} from './transcode.js';

// A raw blob whose name embeds a kid's name in the title slug — the D32 canary. Nothing the
// transcoder logs or emits may ever contain "kidname".
const RAW = 'kidnames-rainbow-song_20261125-101500_abc123.mp3';
const SONG_ID = 'song_abc123';
const LIB = 'slaylist-home';

interface Harness {
  storage: TranscodeStorage & { updates: RecordPatch[] };
  encoder: Encoder;
  fs: WorkFs;
  lines: string[];
  posted: string[];
}

function harness(opts: {
  info?: { songId?: string; libraryId?: string } | null;
  state?: 'processing' | 'ready' | 'failed' | 'deactivated' | null;
  encodeError?: Error;
  downloadError?: Error;
  updateResults?: ('ok' | 'conflict' | Error)[];
} = {}): Harness {
  const updates: RecordPatch[] = [];
  const updateResults = [...(opts.updateResults ?? [])];
  const storage: Harness['storage'] = {
    updates,
    getRawInfo: vi.fn(async () => (opts.info === undefined ? { songId: SONG_ID, libraryId: LIB } : opts.info)),
    downloadRaw: vi.fn(async () => {
      if (opts.downloadError) throw opts.downloadError;
    }),
    uploadFinished: vi.fn(async () => undefined),
    getRecord: vi.fn(async () => {
      const state = opts.state === undefined ? 'processing' : opts.state;
      return state === null ? null : { state, etag: 'W/"etag-1"' };
    }),
    updateRecord: vi.fn(async (_l: string, _s: string, patch: RecordPatch) => {
      updates.push(patch);
      const next = updateResults.shift() ?? 'ok';
      if (next instanceof Error) throw next;
      return next;
    }),
  };
  const encoder: Encoder = {
    encode: vi.fn(async () => {
      if (opts.encodeError) throw opts.encodeError;
    }),
    probeDurationSec: vi.fn(async () => 183.42),
    version: vi.fn(async () => 'ffmpeg version test'),
  };
  const fs: WorkFs = {
    makeWorkDir: vi.fn(async (songId: string) => `/tmp/slay-${songId}-x1`),
    removeWorkDir: vi.fn(async () => undefined),
    sizeOf: vi.fn(async () => 3_670_016),
  };
  const lines: string[] = [];
  const posted: string[] = [];
  return { storage, encoder, fs, lines, posted };
}

function deps(h: Harness) {
  const telemetry = createTelemetry({
    connectionString: 'InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=https://example.invalid/',
    roleName: 'slaylist-transcoder',
    logLine: (l) => h.lines.push(l),
    fetchImpl: async (_url, init) => {
      h.posted.push(init.body);
      return { ok: true, status: 200 };
    },
  });
  return { storage: h.storage, encoder: h.encoder, fs: h.fs, telemetry, timeoutMs: 60_000 };
}

/** Every telemetry/console byte the job produced — the D32 audit surface. */
const emitted = (h: Harness) => [...h.lines, ...h.posted].join('\n');

describe('pure helpers', () => {
  it('rawExtension accepts allowlisted extensions and rejects unsafe names', () => {
    expect(rawExtension(RAW)).toBe('mp3');
    expect(rawExtension('x_20261125-101500_a.FLAC')).toBe('flac');
    expect(rawExtension('x_20261125-101500_a.exe')).toBeNull();
    expect(rawExtension('../etc/passwd.mp3')).toBeNull();
    expect(rawExtension('dir/song.mp3')).toBeNull();
    expect(rawExtension('noext')).toBeNull();
  });

  it('finishedBlobName keeps the D8 stem and swaps the extension (deterministic)', () => {
    expect(finishedBlobName(RAW)).toBe('kidnames-rainbow-song_20261125-101500_abc123.m4a');
    expect(finishedBlobName(RAW)).toBe(finishedBlobName(RAW));
  });
});

describe('runTranscode — happy path', () => {
  it('transcodes, uploads the finished copy, and flips the record to ready', async () => {
    const h = harness();
    const r = await runTranscode({ rawBlobName: RAW }, deps(h));

    expect(r).toMatchObject({ outcome: 'ready', songId: SONG_ID, libraryId: LIB, sizeBytes: 3_670_016, durationSec: 183.42 });
    // D32 (a): ffmpeg only sees songId-named local files.
    expect(h.storage.downloadRaw).toHaveBeenCalledWith(RAW, expect.stringMatching(/slay-song_abc123-x1[\\/]song_abc123\.mp3$/));
    expect(h.encoder.encode).toHaveBeenCalledWith(
      expect.stringMatching(/song_abc123\.mp3$/),
      expect.stringMatching(/song_abc123\.m4a$/),
      expect.objectContaining({ timeoutMs: 60_000 }),
    );
    expect(h.storage.uploadFinished).toHaveBeenCalledWith('kidnames-rainbow-song_20261125-101500_abc123.m4a', expect.any(String));
    expect(h.storage.updates).toEqual([
      {
        state: 'ready',
        blobPath: 'kidnames-rainbow-song_20261125-101500_abc123.m4a',
        format: 'm4a',
        sizeBytes: 3_670_016,
        durationSec: 183.42,
      },
    ]);
    // ETag-conditional on the state we read.
    expect(h.storage.updateRecord).toHaveBeenCalledWith(LIB, SONG_ID, expect.anything(), 'W/"etag-1"');
    expect(h.fs.removeWorkDir).toHaveBeenCalledTimes(1);
  });

  it('emits Started + Succeeded to App Insights with songId and measurements', async () => {
    const h = harness();
    await runTranscode({ rawBlobName: RAW }, deps(h));
    const names = h.posted.map((b) => JSON.parse(b)[0].data.baseData.name);
    expect(names).toEqual(['TranscodeStarted', 'TranscodeSucceeded']);
    const ok = JSON.parse(h.posted[1]!)[0].data.baseData;
    expect(ok.properties).toMatchObject({ songId: SONG_ID, libraryId: LIB });
    expect(ok.measurements).toMatchObject({ sizeBytes: 3_670_016, durationSec: 183.42 });
  });

  it('uses the job libraryId only as a fallback when blob metadata lacks it (pre-6.1 uploads)', async () => {
    const h = harness({ info: { songId: SONG_ID } });
    const r = await runTranscode({ rawBlobName: RAW, libraryId: 'other-lib' }, deps(h));
    expect(r).toMatchObject({ outcome: 'ready', libraryId: 'other-lib' });
    expect(h.storage.getRecord).toHaveBeenCalledWith('other-lib', SONG_ID);
  });
});

describe('runTranscode — failure paths set failed (no stuck processing)', () => {
  it('bad input: ffmpeg error flips the record to failed with a reason + sanitized detail', async () => {
    const h = harness({ encodeError: new FfmpegError('ffmpeg-exit-1', '<work>/song_abc123.mp3: Invalid data found') });
    const r = await runTranscode({ rawBlobName: RAW }, deps(h));
    expect(r).toMatchObject({ outcome: 'failed', reason: 'encode:ffmpeg-exit-1' });
    expect(h.storage.updates).toEqual([{ state: 'failed' }]);
    expect(h.storage.uploadFinished).not.toHaveBeenCalled();
    const failed = JSON.parse(h.posted.at(-1)!)[0].data.baseData;
    expect(failed.name).toBe('TranscodeFailed');
    expect(failed.properties).toMatchObject({ songId: SONG_ID, reason: 'encode:ffmpeg-exit-1' });
    expect(failed.properties.detail).toContain('Invalid data found');
    expect(h.fs.removeWorkDir).toHaveBeenCalledTimes(1);
  });

  it('storage 403 on download (the D25 MI/RBAC failure) is reported by status:code, never message', async () => {
    const e = Object.assign(new Error(`https://acct.blob.core.windows.net/raw-uploads/${RAW} denied`), {
      statusCode: 403,
      code: 'AuthorizationPermissionMismatch',
    });
    const h = harness({ downloadError: e });
    const r = await runTranscode({ rawBlobName: RAW }, deps(h));
    expect(r).toMatchObject({ outcome: 'failed', reason: 'download:403:AuthorizationPermissionMismatch' });
    expect(emitted(h)).not.toContain('raw-uploads/');
  });

  it('if the failed-flip itself errors, the reason records it (record left for retry)', async () => {
    const h = harness({
      encodeError: new FfmpegError('ffmpeg-timeout', ''),
      updateResults: [Object.assign(new Error('boom'), { statusCode: 503 })],
    });
    const r = await runTranscode({ rawBlobName: RAW }, deps(h));
    expect(r).toMatchObject({ outcome: 'failed', reason: 'encode:ffmpeg-timeout;failed-flip:503' });
  });
});

describe('runTranscode — idempotency (safe to run twice)', () => {
  it.each(['ready', 'failed', 'deactivated'] as const)('skips a record already %s — no download, no write', async (state) => {
    const h = harness({ state });
    const r = await runTranscode({ rawBlobName: RAW }, deps(h));
    expect(r).toMatchObject({ outcome: 'skipped', reason: `not-processing:${state}` });
    expect(h.storage.downloadRaw).not.toHaveBeenCalled();
    expect(h.storage.updateRecord).not.toHaveBeenCalled();
  });

  it('a second run after success is a clean skip', async () => {
    const h1 = harness();
    expect((await runTranscode({ rawBlobName: RAW }, deps(h1))).outcome).toBe('ready');
    const h2 = harness({ state: 'ready' });
    expect((await runTranscode({ rawBlobName: RAW }, deps(h2))).outcome).toBe('skipped');
  });

  it('an ETag conflict on the ready flip (concurrent change) is a skip, not a clobber', async () => {
    const h = harness({ updateResults: ['conflict'] });
    const r = await runTranscode({ rawBlobName: RAW }, deps(h));
    expect(r).toMatchObject({ outcome: 'skipped', reason: 'record-changed' });
    expect(h.storage.updates).toHaveLength(1); // no follow-up failed-flip
  });

  it('skips cleanly: missing blob, missing songid, missing library, missing record, unsafe ids', async () => {
    const skipReason = async (rawBlobName: string, h: Harness) => {
      const r = await runTranscode({ rawBlobName }, deps(h));
      expect(r.outcome).toBe('skipped');
      expect(h.storage.updateRecord).not.toHaveBeenCalled();
      return r.outcome === 'skipped' ? r.reason : undefined;
    };
    expect(await skipReason(RAW, harness({ info: null }))).toBe('raw-not-found');
    expect(await skipReason(RAW, harness({ info: { libraryId: LIB } }))).toBe('raw-missing-songid');
    expect(await skipReason(RAW, harness({ info: { songId: SONG_ID } }))).toBe('missing-library-id');
    expect(await skipReason(RAW, harness({ state: null }))).toBe('record-not-found');
    expect(await skipReason(RAW, harness({ info: { songId: '../x', libraryId: LIB } }))).toBe('raw-missing-songid');
    expect(await skipReason('evil.exe', harness())).toBe('invalid-blob-name');
  });
});

describe('D32 — no PII in anything emitted', () => {
  it('never emits the blob name / title slug on success or failure', async () => {
    const ok = harness();
    await runTranscode({ rawBlobName: RAW }, deps(ok));
    const bad = harness({ encodeError: new FfmpegError('ffmpeg-exit-1', 'x') });
    await runTranscode({ rawBlobName: RAW }, deps(bad));
    for (const h of [ok, bad]) {
      expect(emitted(h).toLowerCase()).not.toContain('kidname');
      expect(emitted(h)).not.toContain(RAW);
    }
  });
});
