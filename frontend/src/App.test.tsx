// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

/**
 * Component tests for the Sprint 3.4 login gate + role proof.
 *
 * Responsibilities proved here:
 *   1. Render the SLAYList heading + the AGPL §13 source-link footer (D15 — visible even on the gate).
 *   2. Signed out -> ONLY the sign-in gate; app content (role + health) is gated away.
 *   3. Signed in -> resolve the role via /api/me (the end-to-end proof) + show the health indicator.
 *   4. The /api/me call uses the SWA-safe custom header, not Authorization (D44).
 *
 * `@azure/msal-react` is mocked so we drive the auth state directly (no MsalProvider/network).
 * Real mobile-first layout is Epic 8.
 */

const h = vi.hoisted(() => ({
  state: { authed: false },
  instance: {
    loginRedirect: vi.fn(),
    logoutRedirect: vi.fn(),
    acquireTokenSilent: vi.fn().mockResolvedValue({ accessToken: 'test-token' }),
  },
}));

vi.mock('@azure/msal-react', () => ({
  useMsal: () => ({
    instance: h.instance,
    accounts: h.state.authed ? [{ homeAccountId: 'acct-1', username: 'x' }] : [],
  }),
  AuthenticatedTemplate: ({ children }: { children: React.ReactNode }) =>
    h.state.authed ? children : null,
  UnauthenticatedTemplate: ({ children }: { children: React.ReactNode }) =>
    h.state.authed ? null : children,
}));

// Imported AFTER the mock is declared.
const { App } = await import('./App.js');

/** Route fetch by URL so /api/health and /api/me can be stubbed together. Returns the mock. */
function stubFetch(routes: Record<string, { ok: boolean; status?: number; body: unknown }>) {
  const mock = vi.fn((input: string, _init?: RequestInit) => {
    const url = String(input);
    const key = Object.keys(routes).find((k) => url.includes(k));
    const r = key ? routes[key]! : { ok: false, status: 404, body: {} };
    return Promise.resolve({ ok: r.ok, status: r.status ?? (r.ok ? 200 : 500), json: async () => r.body });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

beforeEach(() => {
  h.state.authed = false;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('App — login gate + role proof (Sprint 3.4)', () => {
  it('renders the SLAYList heading', () => {
    stubFetch({});
    render(<App />);
    expect(screen.getByRole('heading', { name: /SLAYList/i })).toBeTruthy();
  });

  it('renders the AGPL §13 source-link footer on the gate (D15 — visible even when signed out)', () => {
    stubFetch({});
    render(<App />);
    const link = screen.getByRole('link', { name: /Source code \(AGPL-3\.0-or-later\)/i });
    expect(link.getAttribute('href')).toBe('https://github.com/rklundt/SLAYList');
  });

  it('signed out: shows ONLY the sign-in gate — no role, no health, no sign-out', () => {
    // Even with /api/* stubbed, the gate must not render app content.
    stubFetch({
      '/api/health': { ok: true, body: { status: 'ok' } },
      '/api/me': { ok: true, body: { role: 'uploader' } },
    });
    render(<App />);
    expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy();
    expect(screen.getByText(/please sign in/i)).toBeTruthy();
    // App content is gated away:
    expect(screen.queryByRole('button', { name: /sign out/i })).toBeNull();
    expect(screen.queryByText(/your role/i)).toBeNull();
  });

  it('signed in: shows the resolved role (the end-to-end proof)', async () => {
    h.state.authed = true;
    stubFetch({
      '/api/me': { ok: true, body: { role: 'uploader' } },
      '/api/songs': { ok: true, body: { songs: [] } },
    });
    render(<App />);
    await waitFor(() => expect(screen.getByText('uploader')).toBeTruthy());
    expect(h.instance.acquireTokenSilent).toHaveBeenCalled();
  });

  it('signed in: calls /api/me with the SWA-safe custom header, NOT Authorization (D44)', async () => {
    h.state.authed = true;
    const fetchMock = stubFetch({
      '/api/health': { ok: true, body: { status: 'ok' } },
      '/api/me': { ok: true, body: { role: 'admin' } },
      '/api/songs': { ok: true, body: { songs: [] } },
    });
    render(<App />);
    await waitFor(() => expect(screen.getByText('admin')).toBeTruthy());

    const meCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/me'));
    expect(meCall).toBeTruthy();
    const headers = (meCall![1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-SLAYLIST-Authorization']).toMatch(/^Bearer /);
    expect(headers['Authorization']).toBeUndefined();
  });
});

describe('App — song list (Sprint 4.3)', () => {
  const twoSongs = {
    songs: [
      { id: 'song_a', libraryId: 'slaylist-home', title: 'Rainbow Rocket', ownerOid: 'oid-1', ownerDisplayName: 'uploader@example.com', genre: 'pop', state: 'ready', createdAt: '2026-11-15T00:00:00Z' },
      { id: 'song_b', libraryId: 'slaylist-home', title: 'Dino Stomp', ownerOid: 'oid-1', ownerDisplayName: 'uploader@example.com', state: 'processing', createdAt: '2026-11-15T00:00:00Z' },
    ],
  };

  it('signed in with a role: lists songs with title / owner / genre / state', async () => {
    h.state.authed = true;
    stubFetch({
      '/api/me': { ok: true, body: { role: 'uploader' } },
      '/api/songs': { ok: true, body: twoSongs },
    });
    render(<App />);
    await waitFor(() => expect(screen.getByText('Rainbow Rocket')).toBeTruthy());
    expect(screen.getByText('Dino Stomp')).toBeTruthy();
    expect(screen.getAllByText('uploader@example.com').length).toBeGreaterThan(0); // owner column
    expect(screen.getByText('pop')).toBeTruthy(); // genre
    expect(screen.getByText('ready')).toBeTruthy(); // state
    expect(screen.getByText('processing')).toBeTruthy();
    // genre is optional — the second song has none; it renders an em-dash, not "undefined".
    expect(screen.queryByText(/undefined/)).toBeNull();
  });

  it('signed in: calls /api/songs with the SWA-safe custom header (D44)', async () => {
    h.state.authed = true;
    const fetchMock = stubFetch({
      '/api/me': { ok: true, body: { role: 'admin' } },
      '/api/songs': { ok: true, body: twoSongs },
    });
    render(<App />);
    await waitFor(() => expect(screen.getByText('Rainbow Rocket')).toBeTruthy());
    const songsCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/songs'));
    expect(songsCall).toBeTruthy();
    const headers = (songsCall![1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-SLAYLIST-Authorization']).toMatch(/^Bearer /);
    expect(headers['Authorization']).toBeUndefined();
  });

  it('signed in: an empty library shows "No songs yet"', async () => {
    h.state.authed = true;
    stubFetch({
      '/api/me': { ok: true, body: { role: 'listener' } },
      '/api/songs': { ok: true, body: { songs: [] } },
    });
    render(<App />);
    await waitFor(() => expect(screen.getByText(/no songs yet/i)).toBeTruthy());
  });

  // Sprint 5.3 — the upload UI is role-gated (uploader/admin only). The API enforces it too.
  it('signed in as a listener: can see the list but NOT the upload form', async () => {
    h.state.authed = true;
    stubFetch({
      '/api/me': { ok: true, body: { role: 'listener' } },
      '/api/songs': { ok: true, body: { songs: [] } },
    });
    render(<App />);
    await waitFor(() => expect(screen.getByText(/no songs yet/i)).toBeTruthy());
    expect(screen.queryByText(/upload a song/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /^upload$/i })).toBeNull();
  });

  it('signed in as an uploader: the upload form IS shown', async () => {
    h.state.authed = true;
    stubFetch({
      '/api/me': { ok: true, body: { role: 'uploader' } },
      '/api/songs': { ok: true, body: { songs: [] } },
    });
    render(<App />);
    await waitFor(() => expect(screen.getByText(/upload a song/i)).toBeTruthy());
  });
});
