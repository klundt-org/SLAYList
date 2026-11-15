// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Serialization for the nightly Song-table backup (Sprint 4.4, D33).
 *
 * Format is JSON Lines (one record per line): append-friendly, easy to diff between days, and
 * trivial to re-import line by line. These are pure functions — no storage — so they unit-test
 * without Azure. The backup/restore scripts (`api/scripts/{backup,restore}-songs-table.mjs`) do the
 * storage I/O around them, and the scheduled runner (`.github/workflows/backup-dev.yml`) invokes
 * the backup script nightly.
 *
 * A backup is a FULL export — it includes `deactivated` records too (the point of a backup is to
 * recover everything, including soft-deleted rows the UI hides).
 */

import type { Song } from '@slaylist/shared';

/** Serialize songs to JSON Lines (one compact JSON object per line, trailing newline). */
export function songsToJsonl(songs: Song[]): string {
  return songs.map((s) => JSON.stringify(s)).join('\n') + (songs.length > 0 ? '\n' : '');
}

/** Parse JSON Lines back into songs. Blank lines are skipped; each non-blank line must be a Song. */
export function jsonlToSongs(text: string): Song[] {
  const songs: Song[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const parsed = JSON.parse(trimmed) as Song;
    if (typeof parsed.id !== 'string' || typeof parsed.libraryId !== 'string') {
      throw new Error('backup line is not a valid Song (missing id/libraryId)');
    }
    songs.push(parsed);
  }
  return songs;
}

/** The dated backup file name for a given day (UTC), e.g. `songs-2026-11-15.jsonl`. */
export function backupBlobName(date: Date = new Date()): string {
  return `songs-${date.toISOString().slice(0, 10)}.jsonl`;
}
