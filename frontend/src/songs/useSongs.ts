// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Loads the library's songs from `GET /api/songs` (Sprint 4.3).
 *
 * The API already scopes the list to the caller's library and hides `deactivated` records by
 * default (D20/D45), so the client just renders what it receives. Returns a small state machine:
 * loading -> ready(songs) | error. PII (D32): errors are logged without any song title/owner.
 */

import { useEffect, useState } from 'react';
import { InteractionRequiredAuthError } from '@azure/msal-browser';
import type { Song } from '@slaylist/shared';
import { useApiFetch } from '../api/client.js';

export type SongsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; songs: Song[] };

export function useSongs(reloadKey = 0): SongsState {
  const apiFetch = useApiFetch();
  const [state, setState] = useState<SongsState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/songs');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { songs: Song[] };
        if (!cancelled) setState({ status: 'ready', songs: body.songs });
      } catch (err) {
        if (err instanceof InteractionRequiredAuthError) return; // a redirect is in flight
        if (!cancelled) {
          setState({ status: 'error' });
          console.error('Song list fetch failed', err); // D32: no PII in the log
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // reloadKey bump re-runs the fetch (e.g. after an upload adds a record).
  }, [apiFetch, reloadKey]);

  return state;
}
