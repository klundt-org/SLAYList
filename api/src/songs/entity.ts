// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Mapping between the shared `Song` record and its Azure Table Storage entity (D45).
 *
 *   PartitionKey = libraryId   (the library is the partition — library-scoping is structural, D20)
 *   RowKey       = id          (unique within the partition; drives the blob short-id, D8)
 *
 * Both directions are pure functions so they're trivially unit-testable with no storage.
 * Optional `Song` fields are OMITTED from the entity when unset (never written as explicit null),
 * and absent entity properties map back to `undefined`. Timestamps are ISO-8601 strings (stored as
 * plain strings, not Edm.DateTime, so they round-trip without timezone reinterpretation) — distinct
 * from the service's own system `Timestamp`, which we ignore.
 */

import type { Song, SongState } from '@slaylist/shared';
import type { TableEntity } from '@azure/data-tables';

/** The Table Storage shape of a song: the non-key `Song` fields plus the partition/row keys. */
export type SongEntity = TableEntity<{
  title: string;
  ownerOid: string;
  ownerDisplayName: string;
  state: SongState;
  createdAt: string;
  createdByKid?: string;
  genre?: string;
  deactivatedAt?: string;
  blobPath?: string;
  format?: string;
  sizeBytes?: number;
  durationSec?: number;
}>;

/** Build the Table entity for a full `Song` record (keys from libraryId/id, optionals omitted). */
export function songToEntity(song: Song): SongEntity {
  const e: SongEntity = {
    partitionKey: song.libraryId,
    rowKey: song.id,
    title: song.title,
    ownerOid: song.ownerOid,
    ownerDisplayName: song.ownerDisplayName,
    state: song.state,
    createdAt: song.createdAt,
  };
  if (song.createdByKid !== undefined) e.createdByKid = song.createdByKid;
  if (song.genre !== undefined) e.genre = song.genre;
  if (song.deactivatedAt !== undefined) e.deactivatedAt = song.deactivatedAt;
  if (song.blobPath !== undefined) e.blobPath = song.blobPath;
  if (song.format !== undefined) e.format = song.format;
  if (song.sizeBytes !== undefined) e.sizeBytes = song.sizeBytes;
  if (song.durationSec !== undefined) e.durationSec = song.durationSec;
  return e;
}

/** Reconstruct a `Song` from a Table entity (id/libraryId from the keys, absent props -> undefined). */
export function entityToSong(e: SongEntity): Song {
  const song: Song = {
    id: e.rowKey,
    libraryId: e.partitionKey,
    title: e.title,
    ownerOid: e.ownerOid,
    ownerDisplayName: e.ownerDisplayName,
    state: e.state,
    createdAt: e.createdAt,
  };
  if (e.createdByKid !== undefined) song.createdByKid = e.createdByKid;
  if (e.genre !== undefined) song.genre = e.genre;
  if (e.deactivatedAt !== undefined) song.deactivatedAt = e.deactivatedAt;
  if (e.blobPath !== undefined) song.blobPath = e.blobPath;
  if (e.format !== undefined) song.format = e.format;
  if (e.sizeBytes !== undefined) song.sizeBytes = e.sizeBytes;
  if (e.durationSec !== undefined) song.durationSec = e.durationSec;
  return song;
}
