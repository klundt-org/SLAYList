// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The single authenticated API client for the SPA (Sprint 4.3).
 *
 * `useApiFetch` returns a `fetch`-shaped function that (1) acquires an access token for our API
 * scope via MSAL and (2) sends it in the custom `X-SLAYLIST-Authorization` header — NOT
 * `Authorization`, which Azure Static Web Apps overwrites with its own platform token before the
 * request reaches the managed Functions API (D44). Every call to `/api/*` goes through here, so the
 * header rule and the silent-token-refresh-or-redirect behaviour live in exactly one place.
 *
 * On a silent-token failure that needs interaction it kicks off a redirect and rethrows, so callers
 * simply bail (a full-page redirect is in flight). PII (D32): nothing here logs a name/email.
 */

import { useCallback } from 'react';
import { useMsal } from '@azure/msal-react';
import { InteractionRequiredAuthError } from '@azure/msal-browser';
import { apiScopes } from '../auth/msalConfig.js';

/** The SWA-safe bearer header (D44). */
export const BEARER_HEADER = 'X-SLAYLIST-Authorization';

export type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

export function useApiFetch(): ApiFetch {
  const { instance, accounts } = useMsal();
  const account = accounts[0];
  const accountId = account?.homeAccountId;

  return useCallback(
    async (path: string, init?: RequestInit): Promise<Response> => {
      if (!account) throw new Error('not signed in');
      let accessToken: string;
      try {
        const result = await instance.acquireTokenSilent({ scopes: apiScopes, account });
        accessToken = result.accessToken;
      } catch (err) {
        // Silent acquisition needs interaction -> start a redirect and rethrow so the caller bails.
        if (err instanceof InteractionRequiredAuthError) {
          void instance.acquireTokenRedirect({ scopes: apiScopes });
        }
        throw err;
      }
      return fetch(path, {
        ...init,
        headers: { ...(init?.headers ?? {}), [BEARER_HEADER]: `Bearer ${accessToken}` },
      });
    },
    // Key on the stable account id, not the `accounts` array identity (MSAL hands back new array
    // refs each render). instance is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [instance, accountId],
  );
}
