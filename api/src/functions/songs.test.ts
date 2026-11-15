// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HttpRequest, InvocationContext } from '@azure/functions';
import type { Caller } from '../auth.js';
import type { Song } from '@slaylist/shared';

// Mock the auth seam (keep the real callerHasRole; stub getCaller) and the repo factory.
vi.mock('../auth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth.js')>();
  return { ...actual, getCaller: vi.fn() };
});
vi.mock('../songs/repo.js', () => ({ getSongsRepository: vi.fn() }));

const { getCaller } = await import('../auth.js');
const { getSongsRepository } = await import('../songs/repo.js');
const { createSong, listSongs, getSong, updateSong } = await import('./songs.js');

const mockGetCaller = vi.mocked(getCaller);
const mockGetRepo = vi.mocked(getSongsRepository);

type RepoMock = {
  create: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

let repo: RepoMock;

function useRepo(): RepoMock {
  const r: RepoMock = { create: vi.fn(), get: vi.fn(), list: vi.fn(), update: vi.fn() };
  // The handlers only call these four methods; cast through unknown for the test double.
  mockGetRepo.mockResolvedValue(r as unknown as Awaited<ReturnType<typeof getSongsRepository>>);
  return r;
}

function req(opts: { body?: unknown; bad?: boolean; query?: Record<string, string>; params?: Record<string, string> } = {}): HttpRequest {
  return {
    json: async () => {
      if (opts.bad) throw new Error('invalid json');
      return opts.body;
    },
    query: new URLSearchParams(opts.query ?? {}),
    params: opts.params ?? {},
    headers: new Map(),
  } as unknown as HttpRequest;
}

const ctx = { log: vi.fn() } as unknown as InvocationContext;

const uploader: Caller = { ownerOid: 'oid-up', role: 'uploader' };
const listener: Caller = { ownerOid: 'oid-ls', role: 'listener' };

beforeEach(() => {
  repo = useRepo();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/songs (create)', () => {
  it('401 when unauthenticated', async () => {
    mockGetCaller.mockResolvedValue(null);
    const res = await createSong(req({ body: { title: 'x', ownerDisplayName: 'd@example.com' } }), ctx);
    expect(res.status).toBe(401);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('403 when the role cannot write (listener)', async () => {
    mockGetCaller.mockResolvedValue(listener);
    const res = await createSong(req({ body: { title: 'x', ownerDisplayName: 'd@example.com' } }), ctx);
    expect(res.status).toBe(403);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('400 when title is missing', async () => {
    mockGetCaller.mockResolvedValue(uploader);
    const res = await createSong(req({ body: { ownerDisplayName: 'd@example.com' } }), ctx);
    expect(res.status).toBe(400);
  });

  it('201 sets server-owned fields (ownerOid from token, state, id, libraryId)', async () => {
    mockGetCaller.mockResolvedValue(uploader);
    repo.create.mockImplementation(async (s: Song) => s);
    const res = await createSong(
      req({ body: { title: 'My Song', ownerDisplayName: 'd@example.com', genre: 'pop', ownerOid: 'HACKER' } }),
      ctx,
    );
    expect(res.status).toBe(201);
    const saved = (res.jsonBody as Song);
    expect(saved.ownerOid).toBe('oid-up'); // from the token, NOT the client-supplied "HACKER"
    expect(saved.state).toBe('processing');
    expect(saved.libraryId).toBe('slaylist-home');
    expect(saved.id).toMatch(/^song_/);
    expect(saved.genre).toBe('pop');
    expect(repo.create).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/songs (list)', () => {
  it('401 when unauthenticated', async () => {
    mockGetCaller.mockResolvedValue(null);
    expect((await listSongs(req(), ctx)).status).toBe(401);
  });

  it('200 returns the library songs; excludes deactivated by default', async () => {
    mockGetCaller.mockResolvedValue(listener); // listeners may list
    repo.list.mockResolvedValue([{ id: 'song_a' }]);
    const res = await listSongs(req(), ctx);
    expect(res.status).toBe(200);
    expect((res.jsonBody as { songs: unknown[] }).songs).toHaveLength(1);
    expect(repo.list).toHaveBeenCalledWith('slaylist-home', { includeDeactivated: false });
  });

  it('passes includeDeactivated=true through from the query', async () => {
    mockGetCaller.mockResolvedValue(uploader);
    repo.list.mockResolvedValue([]);
    await listSongs(req({ query: { includeDeactivated: 'true' } }), ctx);
    expect(repo.list).toHaveBeenCalledWith('slaylist-home', { includeDeactivated: true });
  });
});

describe('GET /api/songs/{id} (read)', () => {
  it('404 when the record is absent', async () => {
    mockGetCaller.mockResolvedValue(listener);
    repo.get.mockResolvedValue(null);
    const res = await getSong(req({ params: { id: 'song_x' } }), ctx);
    expect(res.status).toBe(404);
  });

  it('200 returns the record, scoped to the caller library', async () => {
    mockGetCaller.mockResolvedValue(listener);
    repo.get.mockResolvedValue({ id: 'song_x', libraryId: 'slaylist-home' });
    const res = await getSong(req({ params: { id: 'song_x' } }), ctx);
    expect(res.status).toBe(200);
    expect(repo.get).toHaveBeenCalledWith('slaylist-home', 'song_x');
  });
});

describe('PATCH /api/songs/{id} (update)', () => {
  it('403 when the role cannot write', async () => {
    mockGetCaller.mockResolvedValue(listener);
    const res = await updateSong(req({ params: { id: 'song_x' }, body: { state: 'ready' } }), ctx);
    expect(res.status).toBe(403);
  });

  it('400 on an invalid state value', async () => {
    mockGetCaller.mockResolvedValue(uploader);
    const res = await updateSong(req({ params: { id: 'song_x' }, body: { state: 'bogus' } }), ctx);
    expect(res.status).toBe(400);
  });

  it('400 when no updatable fields are provided', async () => {
    mockGetCaller.mockResolvedValue(uploader);
    const res = await updateSong(req({ params: { id: 'song_x' }, body: { unknownField: 1 } }), ctx);
    expect(res.status).toBe(400);
  });

  it('404 when the record does not exist', async () => {
    mockGetCaller.mockResolvedValue(uploader);
    repo.update.mockResolvedValue(null);
    const res = await updateSong(req({ params: { id: 'missing' }, body: { state: 'ready' } }), ctx);
    expect(res.status).toBe(404);
  });

  it('200 applies the patch and is library-scoped', async () => {
    mockGetCaller.mockResolvedValue(uploader);
    repo.update.mockResolvedValue({ id: 'song_x', state: 'ready' });
    const res = await updateSong(req({ params: { id: 'song_x' }, body: { state: 'ready' } }), ctx);
    expect(res.status).toBe(200);
    expect(repo.update).toHaveBeenCalledWith('slaylist-home', 'song_x', { state: 'ready' });
  });
});
