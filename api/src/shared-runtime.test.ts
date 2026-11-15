// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { DEFAULT_LIBRARY_ID as SHARED_LIBRARY_ID, SONG_STATES as SHARED_STATES } from '@slaylist/shared';
import { DEFAULT_LIBRARY_ID, SONG_STATES, isSongState } from './shared-runtime.js';

/**
 * Drift guard for the runtime mirror (D46). The API can't import @slaylist/shared's runtime values
 * in the deployed artifact, so it mirrors them in shared-runtime.ts. These tests fail CI the moment
 * the mirror diverges from the real shared values — keeping shared the single source of truth.
 */
describe('shared-runtime mirror stays identical to @slaylist/shared (D46)', () => {
  it('DEFAULT_LIBRARY_ID matches shared', () => {
    expect(DEFAULT_LIBRARY_ID).toBe(SHARED_LIBRARY_ID);
  });

  it('SONG_STATES matches shared exactly, in order', () => {
    expect(SONG_STATES).toEqual([...SHARED_STATES]);
  });

  it('isSongState accepts every shared state and rejects others', () => {
    for (const s of SHARED_STATES) expect(isSongState(s)).toBe(true);
    expect(isSongState('bogus')).toBe(false);
    expect(isSongState(undefined)).toBe(false);
    expect(isSongState(42)).toBe(false);
  });
});
