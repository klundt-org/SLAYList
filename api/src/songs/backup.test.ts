// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import type { Song } from '@slaylist/shared';
import { backupBlobName, jsonlToSongs, songsToJsonl } from './backup.js';

const song = (over: Partial<Song> = {}): Song => ({
  id: 'song_1',
  libraryId: 'slaylist-home',
  title: 'T',
  ownerOid: 'oid-1',
  ownerDisplayName: 'd@example.com',
  state: 'ready',
  createdAt: '2026-11-15T00:00:00.000Z',
  ...over,
});

describe('song backup serialization (D33)', () => {
  it('round-trips songs through JSONL without loss (incl. deactivated + optionals)', () => {
    const songs = [
      song({ id: 'song_1', genre: 'pop' }),
      song({ id: 'song_2', state: 'deactivated', deactivatedAt: '2026-11-16T00:00:00.000Z' }),
      song({ id: 'song_3', sizeBytes: 123, durationSec: 7 }),
    ];
    expect(jsonlToSongs(songsToJsonl(songs))).toEqual(songs);
  });

  it('emits one line per record with a trailing newline', () => {
    const jsonl = songsToJsonl([song({ id: 'song_1' }), song({ id: 'song_2' })]);
    expect(jsonl.endsWith('\n')).toBe(true);
    expect(jsonl.trimEnd().split('\n')).toHaveLength(2);
  });

  it('an empty export is an empty string (no stray newline)', () => {
    expect(songsToJsonl([])).toBe('');
    expect(jsonlToSongs('')).toEqual([]);
  });

  it('skips blank lines on parse', () => {
    const jsonl = `${JSON.stringify(song())}\n\n`;
    expect(jsonlToSongs(jsonl)).toHaveLength(1);
  });

  it('rejects a line that is not a Song', () => {
    expect(() => jsonlToSongs('{"foo":1}')).toThrow(/not a valid Song/);
  });

  it('names the backup file by UTC date', () => {
    expect(backupBlobName(new Date('2026-11-15T23:59:00Z'))).toBe('songs-2026-11-15.jsonl');
  });
});
