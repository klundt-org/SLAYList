// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { newSongId } from './ids.js';

describe('newSongId', () => {
  it('has the song_ prefix and a url-safe suffix (legal Table RowKey)', () => {
    const id = newSongId();
    expect(id).toMatch(/^song_[A-Za-z0-9_-]+$/);
    // No RowKey-illegal characters (/ \ # ?).
    expect(id).not.toMatch(/[/\\#?]/);
  });

  it('is practically unique across many generations', () => {
    const ids = new Set(Array.from({ length: 5000 }, () => newSongId()));
    expect(ids.size).toBe(5000);
  });
});
