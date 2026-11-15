// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Song-id generation.
 *
 * The id is the record's unique key (Table Storage `RowKey`, D45) and also drives the blob
 * short-id (D8) — uniqueness is guaranteed by the random component, never a timestamp. The
 * `song_` prefix keeps ids self-describing in logs (the id is safe to log; the title is not, D32).
 *
 * base64url alphabet (`A–Z a–z 0–9 - _`) is entirely legal in a Table Storage `RowKey`, which
 * forbids `/ \ # ?` and control characters — so the id needs no escaping as a key.
 */

import { randomBytes } from 'node:crypto';

/** A fresh, collision-resistant song id, e.g. `song_8Kw3nQ1xZ4rT`. */
export function newSongId(): string {
  // 9 random bytes -> 12 base64url chars (~72 bits); ample for family scale with no coordination.
  return `song_${randomBytes(9).toString('base64url')}`;
}
