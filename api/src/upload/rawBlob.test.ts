// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { rawBlobName, shortIdOf, timestampUtc, titleSlug } from './rawBlob.js';

describe('raw blob naming (D8)', () => {
  it('slugifies titles safely', () => {
    expect(titleSlug('Rainbow Rocket!')).toBe('rainbow-rocket');
    expect(titleSlug('  Hello   World  ')).toBe('hello-world');
    expect(titleSlug('***')).toBe('untitled');
    expect(titleSlug('Café Déjà')).toBe('cafe-deja');
  });

  it('caps slug length and trims trailing dashes', () => {
    const slug = titleSlug('a'.repeat(100));
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('extracts the short id from a song id', () => {
    expect(shortIdOf('song_8Kw3nQ1xZ4rT')).toBe('8Kw3nQ1xZ4rT');
  });

  it('formats a UTC timestamp yyyyMMdd-HHmmss', () => {
    expect(timestampUtc(new Date('2026-11-15T09:08:07Z'))).toBe('20261115-090807');
  });

  it('builds the full raw blob name (D8: slug_ts_shortid.ext)', () => {
    const name = rawBlobName('Dino Stomp', 'mp3', 'song_abc123', new Date('2026-11-15T09:08:07Z'));
    expect(name).toBe('dino-stomp_20261115-090807_abc123.mp3');
  });

  it('uniqueness rides the short id, not the timestamp (D8)', () => {
    const d = new Date('2026-11-15T09:08:07Z');
    const a = rawBlobName('Same Title', 'mp3', 'song_aaa', d);
    const b = rawBlobName('Same Title', 'mp3', 'song_bbb', d);
    expect(a).not.toBe(b); // same title + same second, different short id
  });
});
