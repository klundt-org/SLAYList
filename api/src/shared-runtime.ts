// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Runtime mirror of the small CONSTANT values the API needs from `@slaylist/shared` (D46).
 *
 * WHY a mirror and not a direct import: the deployed SWA managed-functions artifact cannot import
 * `@slaylist/shared` at runtime. It's a `workspace:*` package that the isolated, lockfile-bypassing
 * prod install in the deploy step strips out (see `.github/workflows/deploy-dev.yml` assemble step),
 * so API *runtime* code imports only TYPES from shared (which the compiler erases). Runtime values
 * live here instead.
 *
 * SINGLE SOURCE OF TRUTH is preserved by `shared-runtime.test.ts`: it imports the real values from
 * `@slaylist/shared` (available in-workspace at test time) and asserts these mirrors are identical,
 * so any drift fails the hard CI gate (D23). The TYPES below still come from shared, so a change to
 * the shape there is a compile error here too.
 *
 * FUTURE: when the API gains a bundling/own-functions build (BACKLOG) that inlines workspace deps,
 * this mirror collapses back into a direct `import { ... } from '@slaylist/shared'`.
 */

import type { SongState } from '@slaylist/shared';

/** Mirror of `DEFAULT_LIBRARY_ID` (D19). The single library today. */
export const DEFAULT_LIBRARY_ID = 'slaylist-home';

/** Mirror of `SONG_STATES` (the four lifecycle states), for runtime validation of client input. */
export const SONG_STATES: readonly SongState[] = ['processing', 'ready', 'failed', 'deactivated'];

/** True when `value` is one of the four valid song states. */
export function isSongState(value: unknown): value is SongState {
  return typeof value === 'string' && (SONG_STATES as readonly string[]).includes(value);
}
