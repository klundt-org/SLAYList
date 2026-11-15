// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import { allowedExtensions, fileExtension, maxUploadBytes, validateUpload } from './validation.js';

const MB = 1024 * 1024;

afterEach(() => {
  delete process.env.UPLOAD_ALLOWED_EXTENSIONS;
  delete process.env.UPLOAD_MAX_BYTES;
});

describe('upload validation (Sprint 5.1)', () => {
  it('accepts an allowed format within the size cap', () => {
    const r = validateUpload({ filename: 'my-song.mp3', sizeBytes: 4 * MB, contentType: 'audio/mpeg' });
    expect(r).toEqual({ ok: true, ext: 'mp3' });
  });

  it('accepts each default-allowed extension', () => {
    for (const ext of ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'opus']) {
      expect(validateUpload({ filename: `x.${ext}`, sizeBytes: 1 * MB })).toEqual({ ok: true, ext });
    }
  });

  it('rejects an unsupported extension with a clear message listing the allowed set', () => {
    const r = validateUpload({ filename: 'virus.exe', sizeBytes: 1 * MB });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/unsupported file type/i);
  });

  it('rejects a file over the cap', () => {
    const r = validateUpload({ filename: 'huge.wav', sizeBytes: 60 * MB });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/too large.*50 MB/i);
  });

  it('rejects an empty / zero-byte file', () => {
    const r = validateUpload({ filename: 'x.mp3', sizeBytes: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/empty/i);
  });

  it('rejects a non-audio content type', () => {
    const r = validateUpload({ filename: 'x.mp3', sizeBytes: 1 * MB, contentType: 'text/html' });
    expect(r.ok).toBe(false);
  });

  it('tolerates a generic octet-stream content type', () => {
    expect(validateUpload({ filename: 'x.mp3', sizeBytes: 1 * MB, contentType: 'application/octet-stream' }).ok).toBe(true);
  });

  it('rejects path-traversal / separator filenames', () => {
    for (const filename of ['../etc/passwd.mp3', 'a/b.mp3', 'a\\b.mp3', '..mp3evil']) {
      expect(validateUpload({ filename, sizeBytes: 1 * MB }).ok).toBe(false);
    }
  });

  it('is CONFIGURABLE: a tighter allowlist + cap via env (future per-account tiers)', () => {
    process.env.UPLOAD_ALLOWED_EXTENSIONS = 'mp3, m4a'; // compressed-only, e.g. a free tier
    process.env.UPLOAD_MAX_BYTES = String(10 * MB);
    expect(allowedExtensions()).toEqual(['mp3', 'm4a']);
    expect(maxUploadBytes()).toBe(10 * MB);
    expect(validateUpload({ filename: 'x.wav', sizeBytes: 1 * MB }).ok).toBe(false); // wav now disallowed
    expect(validateUpload({ filename: 'x.mp3', sizeBytes: 12 * MB }).ok).toBe(false); // over the 10 MB cap
    expect(validateUpload({ filename: 'x.mp3', sizeBytes: 5 * MB }).ok).toBe(true);
  });

  it('falls back to defaults when env config is blank/invalid', () => {
    process.env.UPLOAD_ALLOWED_EXTENSIONS = '   ';
    process.env.UPLOAD_MAX_BYTES = 'not-a-number';
    expect(allowedExtensions()).toContain('flac');
    expect(maxUploadBytes()).toBe(50 * MB);
  });

  it('fileExtension lowercases and handles no-extension', () => {
    expect(fileExtension('Song.MP3')).toBe('mp3');
    expect(fileExtension('noext')).toBeNull();
  });
});
