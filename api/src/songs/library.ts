// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The library-scoping seam (D19/D20).
 *
 * Every song operation acts WITHIN a single `libraryId` — authorization always asks "can this
 * caller act within THIS library", never "can this caller act globally" (D20). This module is the
 * ONE place that decides which library a given caller operates in. Today there is exactly one
 * library (`DEFAULT_LIBRARY_ID`), so every caller resolves to it — but the single-library
 * assumption lives here and nowhere else. When multi-library arrives (deferred, not designed-out,
 * D19), only this function changes: it will map the caller (e.g. an Entra group / app-role
 * assignment) to their library id. No handler or repository code assumes one library.
 *
 * `libraryId` becomes the Table Storage `PartitionKey` (D45), so a caller scoped to one library can
 * only ever touch that library's partition — cross-library reach is structurally impossible, not
 * merely checked.
 */

// DEFAULT_LIBRARY_ID comes from the runtime mirror (D46), not directly from @slaylist/shared — the
// deployed artifact can't import shared's runtime values; a drift test keeps the mirror honest.
import { DEFAULT_LIBRARY_ID } from '../shared-runtime.js';
import type { Caller } from '../auth.js';

/**
 * Resolve the library a caller operates within. Single-library today: everyone maps to
 * `DEFAULT_LIBRARY_ID`. Takes the `Caller` (not nothing) so the multi-library future is a
 * body change here, not a signature change at every call site.
 */
export function callerLibraryId(_caller: Caller): string {
  return DEFAULT_LIBRARY_ID;
}
