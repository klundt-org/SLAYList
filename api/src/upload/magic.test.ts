// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { familyMatchesExtension, sniffAudio } from './magic.js';

/** Build a 16-byte buffer starting with `head` (ascii or bytes), zero-padded. */
function buf(head: Array<number | string>): Uint8Array {
  const bytes: number[] = [];
  for (const h of head) {
    if (typeof h === 'string') for (const c of h) bytes.push(c.charCodeAt(0));
    else bytes.push(h);
  }
  while (bytes.length < 16) bytes.push(0);
  return new Uint8Array(bytes);
}

describe('sniffAudio (Sprint 5.2 magic bytes)', () => {
  it('detects FLAC (fLaC)', () => expect(sniffAudio(buf(['fLaC']))).toBe('flac'));
  it('detects OGG (OggS)', () => expect(sniffAudio(buf(['OggS']))).toBe('ogg'));
  it('detects WAV (RIFF....WAVE)', () => expect(sniffAudio(buf(['RIFF', 0, 0, 0, 0, 'WAVE']))).toBe('wav'));
  it('detects M4A (ftyp at offset 4)', () => expect(sniffAudio(buf([0, 0, 0, 0x18, 'ftyp', 'M4A ']))).toBe('m4a'));
  it('detects MP3 via ID3 tag', () => expect(sniffAudio(buf(['ID3', 0x03, 0x00]))).toBe('mp3'));
  it('detects MP3 via frame sync (0xFF 0xFB)', () => expect(sniffAudio(buf([0xff, 0xfb, 0x90, 0x00]))).toBe('mp3'));

  it('returns null for non-audio bytes', () => {
    expect(sniffAudio(buf(['<', '!', 'D', 'O', 'C', 'T', 'Y', 'P', 'E']))).toBeNull(); // HTML
    expect(sniffAudio(buf([0x4d, 0x5a]))).toBeNull(); // MZ (exe)
  });

  it('returns null for too-short input', () => {
    expect(sniffAudio(new Uint8Array([0x49, 0x44]))).toBeNull();
  });
});

describe('familyMatchesExtension', () => {
  it('ogg family matches ogg and opus', () => {
    expect(familyMatchesExtension('ogg', 'ogg')).toBe(true);
    expect(familyMatchesExtension('ogg', 'opus')).toBe(true);
  });
  it('m4a family matches m4a/aac/mp4', () => {
    expect(familyMatchesExtension('m4a', 'm4a')).toBe(true);
    expect(familyMatchesExtension('m4a', 'aac')).toBe(true);
  });
  it('mismatched family/extension is rejected (wav bytes, mp3 name)', () => {
    expect(familyMatchesExtension('wav', 'mp3')).toBe(false);
  });
});
