// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AAC_BITRATE_KBPS, encodeArgs, sanitizeStderr } from './ffmpeg.js';

describe('encodeArgs', () => {
  const args = encodeArgs('/w/song_1.mp3', '/w/song_1.m4a');

  it('uses the built-in aac encoder — never libfdk_aac (D27)', () => {
    expect(args[args.indexOf('-c:a') + 1]).toBe('aac');
    expect(args.join(' ')).not.toContain('libfdk');
  });

  it('meets the D27 bitrate floor (>= 128 kbps)', () => {
    expect(AAC_BITRATE_KBPS).toBeGreaterThanOrEqual(128);
    expect(args[args.indexOf('-b:a') + 1]).toBe(`${AAC_BITRATE_KBPS}k`);
  });

  it('strips source metadata + keeps logs at error level (D32)', () => {
    expect(args[args.indexOf('-map_metadata') + 1]).toBe('-1');
    expect(args[args.indexOf('-loglevel') + 1]).toBe('error');
    expect(args).toContain('-hide_banner');
    expect(args).toContain('-nostdin');
  });

  it('writes a fast-start MP4 to the given output path', () => {
    expect(args[args.indexOf('-movflags') + 1]).toBe('+faststart');
    expect(args.at(-1)).toBe('/w/song_1.m4a');
  });
});

describe('sanitizeStderr', () => {
  it('replaces the work dir and keeps only the tail', () => {
    expect(sanitizeStderr('/tmp/slay-song_1-ab/song_1.mp3: Invalid data\n', '/tmp/slay-song_1-ab')).toBe(
      '<work>/song_1.mp3: Invalid data',
    );
    expect(sanitizeStderr('x'.repeat(5000)).length).toBe(2000);
  });
});

describe('D28 — the transcoder never deletes', () => {
  it('no source file under src/ calls a delete API', () => {
    for (const f of ['storage.ts', 'transcode.ts', 'index.ts']) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
      expect(src, f).not.toMatch(/\.(delete|deleteIfExists|deleteBlob|deleteEntity|deleteContainer)\s*\(/);
    }
  });
});
