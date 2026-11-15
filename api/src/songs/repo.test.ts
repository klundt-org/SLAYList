// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { RestError, type TableClient } from '@azure/data-tables';
import type { Song } from '@slaylist/shared';
import { SongsRepository, type ListSongsOptions } from './repo.js';
import { songToEntity, type SongEntity } from './entity.js';

const song = (over: Partial<Song> = {}): Song => ({
  id: 'song_1',
  libraryId: 'slaylist-home',
  title: 'T',
  ownerOid: 'oid-1',
  ownerDisplayName: 'd@example.com',
  state: 'processing',
  createdAt: '2026-11-15T00:00:00.000Z',
  ...over,
});

type ClientMock = {
  createEntity: ReturnType<typeof vi.fn>;
  getEntity: ReturnType<typeof vi.fn>;
  listEntities: ReturnType<typeof vi.fn>;
  updateEntity: ReturnType<typeof vi.fn>;
};

/** Build a mock TableClient with just the methods SongsRepository uses. */
function mockClient(over: Partial<ClientMock> = {}) {
  async function* empty(): AsyncGenerator<SongEntity> {
    /* nothing */
  }
  const client: ClientMock = {
    createEntity: vi.fn().mockResolvedValue({}),
    getEntity: vi.fn(),
    listEntities: vi.fn().mockReturnValue(empty()),
    updateEntity: vi.fn().mockResolvedValue({}),
    ...over,
  };
  return { client, repo: new SongsRepository(client as unknown as TableClient) };
}

describe('SongsRepository', () => {
  it('create() writes the entity with partition/row keys and returns the song', async () => {
    const { client, repo } = mockClient();
    const s = song({ genre: 'pop' });
    const result = await repo.create(s);
    expect(result).toEqual(s);
    expect(client.createEntity).toHaveBeenCalledTimes(1);
    const written = client.createEntity.mock.calls[0]![0] as SongEntity;
    expect(written.partitionKey).toBe('slaylist-home');
    expect(written.rowKey).toBe('song_1');
    expect(written.genre).toBe('pop');
  });

  it('get() returns the mapped song', async () => {
    const entity = songToEntity(song({ state: 'ready' }));
    const { repo } = mockClient({ getEntity: vi.fn().mockResolvedValue(entity) });
    const got = await repo.get('slaylist-home', 'song_1');
    expect(got?.id).toBe('song_1');
    expect(got?.state).toBe('ready');
  });

  it('get() returns null on a 404 (not found)', async () => {
    const notFound = new RestError('not found', { statusCode: 404 });
    const { repo } = mockClient({ getEntity: vi.fn().mockRejectedValue(notFound) });
    expect(await repo.get('slaylist-home', 'missing')).toBeNull();
  });

  it('get() rethrows non-404 errors', async () => {
    const boom = new RestError('server error', { statusCode: 500 });
    const { repo } = mockClient({ getEntity: vi.fn().mockRejectedValue(boom) });
    await expect(repo.get('slaylist-home', 'x')).rejects.toBe(boom);
  });

  it('list() excludes deactivated by default (filter + partition scope)', async () => {
    async function* gen(): AsyncGenerator<SongEntity> {
      yield songToEntity(song({ id: 'song_a', state: 'ready' }));
      yield songToEntity(song({ id: 'song_b', state: 'processing' }));
    }
    const listEntities = vi.fn().mockReturnValue(gen());
    const { repo } = mockClient({ listEntities });
    const songs = await repo.list('slaylist-home');
    expect(songs.map((s) => s.id)).toEqual(['song_a', 'song_b']);
    const filter = (listEntities.mock.calls[0]![0] as { queryOptions: { filter: string } }).queryOptions.filter;
    expect(filter).toContain("PartitionKey eq 'slaylist-home'");
    expect(filter).toContain("state ne 'deactivated'");
  });

  it('list() includes deactivated when asked (no state filter)', async () => {
    const listEntities = vi.fn().mockReturnValue((async function* () {
      /* empty */
    })());
    const { repo } = mockClient({ listEntities });
    const opts: ListSongsOptions = { includeDeactivated: true };
    await repo.list('slaylist-home', opts);
    const filter = (listEntities.mock.calls[0]![0] as { queryOptions: { filter: string } }).queryOptions.filter;
    expect(filter).toContain("PartitionKey eq 'slaylist-home'");
    expect(filter).not.toContain('state ne');
  });

  it('update() merges defined fields and returns the merged song', async () => {
    const existing = songToEntity(song({ title: 'Old', state: 'processing' }));
    const getEntity = vi.fn().mockResolvedValue(existing);
    const updateEntity = vi.fn().mockResolvedValue({});
    const { repo } = mockClient({ getEntity, updateEntity });
    const updated = await repo.update('slaylist-home', 'song_1', { state: 'ready', blobPath: 'finished/x.opus' });
    expect(updated?.state).toBe('ready');
    expect(updated?.blobPath).toBe('finished/x.opus');
    expect(updated?.title).toBe('Old'); // unchanged
    const [entityArg, mode] = updateEntity.mock.calls[0]!;
    expect(mode).toBe('Merge');
    expect((entityArg as SongEntity).partitionKey).toBe('slaylist-home');
    expect((entityArg as SongEntity).rowKey).toBe('song_1');
    expect((entityArg as SongEntity).state).toBe('ready');
  });

  it('update() returns null when the record does not exist', async () => {
    const notFound = new RestError('not found', { statusCode: 404 });
    const updateEntity = vi.fn();
    const { repo } = mockClient({ getEntity: vi.fn().mockRejectedValue(notFound), updateEntity });
    expect(await repo.update('slaylist-home', 'missing', { state: 'ready' })).toBeNull();
    expect(updateEntity).not.toHaveBeenCalled();
  });
});
