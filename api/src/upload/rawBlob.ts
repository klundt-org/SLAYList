// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Raw-upload blob naming (Sprint 5.2, D8). The blob filename is plumbing — human-readable for
 * restore, but uniqueness is guaranteed by the short id, NEVER the timestamp. The song title lives
 * in the record's metadata, not the filename.
 *
 *   {title-slug}_{yyyyMMdd-HHmmss}_{shortid}.{ext}
 *
 * Pure functions — unit-testable, no I/O.
 */

/** A filesystem/URL-safe slug from a title: lowercase, alphanumerics + single dashes, capped. */
export function titleSlug(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'untitled';
}

/** The short, unique component of a song id (`song_<shortid>` -> `<shortid>`). */
export function shortIdOf(songId: string): string {
  return songId.replace(/^song_/, '');
}

/** UTC timestamp `yyyyMMdd-HHmmss`. */
export function timestampUtc(date: Date = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `-${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`
  );
}

/** Build the raw-upload blob name for a song (D8). `ext` has no leading dot. */
export function rawBlobName(title: string, ext: string, songId: string, date: Date = new Date()): string {
  return `${titleSlug(title)}_${timestampUtc(date)}_${shortIdOf(songId)}.${ext.toLowerCase()}`;
}
