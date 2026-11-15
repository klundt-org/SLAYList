// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import type { Song } from '@slaylist/shared';
import { entityToSong, songToEntity, type SongEntity } from './entity.js';

/** Minimal valid Song (required fields only) — fake PII per hygiene rules. */
const base: Song = {
  id: 'song_abc123',
  libraryId: 'slaylist-home',
  title: 'Test Song',
  ownerOid: '00000000-0000-0000-0000-000000000001',
  ownerDisplayName: 'test-uploader@example.com',
  state: 'processing',
  createdAt: '2026-11-15T00:00:00.000Z',
};

describe('song <-> table entity mapping (D45)', () => {
  it('maps libraryId -> PartitionKey and id -> RowKey', () => {
    const e = songToEntity(base);
    expect(e.partitionKey).toBe('slaylist-home');
    expect(e.rowKey).toBe('song_abc123');
  });

  it('omits unset optional fields from the entity (no explicit nulls)', () => {
    const e = songToEntity(base);
    expect('genre' in e).toBe(false);
    expect('blobPath' in e).toBe(false);
    expect('sizeBytes' in e).toBe(false);
    expect('deactivatedAt' in e).toBe(false);
  });

  it('carries all set optional fields through', () => {
    const full: Song = {
      ...base,
      createdByKid: 'kid-one',
      genre: 'pop',
      state: 'ready',
      deactivatedAt: '2026-11-16T00:00:00.000Z',
      blobPath: 'finished/test.opus',
      format: 'opus',
      sizeBytes: 123456,
      durationSec: 87,
    };
    const e = songToEntity(full);
    expect(e.genre).toBe('pop');
    expect(e.sizeBytes).toBe(123456);
    expect(e.blobPath).toBe('finished/test.opus');
  });

  it('round-trips entity -> song -> entity without loss', () => {
    const full: Song = { ...base, genre: 'rock', sizeBytes: 999, durationSec: 12 };
    const roundTripped = entityToSong(songToEntity(full));
    expect(roundTripped).toEqual(full);
  });

  it('reconstructs id/libraryId from the entity keys and ignores system props', () => {
    const entity = {
      partitionKey: 'slaylist-home',
      rowKey: 'song_xyz',
      title: 'X',
      ownerOid: 'oid-1',
      ownerDisplayName: 'd@example.com',
      state: 'ready',
      createdAt: '2026-11-15T00:00:00.000Z',
      // SDK system props that must be ignored:
      etag: 'W/"abc"',
      timestamp: '2026-11-15T00:00:01.000Z',
    } as unknown as SongEntity;
    const song = entityToSong(entity);
    expect(song.id).toBe('song_xyz');
    expect(song.libraryId).toBe('slaylist-home');
    expect(song.state).toBe('ready');
    expect('etag' in song).toBe(false);
  });
});
