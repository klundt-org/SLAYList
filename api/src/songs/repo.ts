// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Data access for song records — the only module that talks to Azure Table Storage (D45).
 *
 * Every method is library-scoped: it takes a `libraryId` (the PartitionKey) and can only ever read
 * or write that partition, so one library's records are structurally unreachable from another
 * (D20). The HTTP handlers derive the `libraryId` from the caller via `callerLibraryId` and never
 * from client input, so a caller cannot ask for a different library's data.
 *
 * Auth posture (D25): the SWA managed-functions API reaches storage with a connection string (the
 * "shared-platform" half of the split auth model), read from app settings — NOT a storage key in
 * code, NOT Managed Identity (that's the Container App transcoder's half). Locally the same var
 * points at Azurite.
 *
 * Logging (D32): callers log `ownerOid` + `songId` only — never `title`/`ownerDisplayName`. This
 * module logs nothing itself.
 */

import { TableClient, RestError, odata } from '@azure/data-tables';
import type { Song, SongUpdateInput } from '@slaylist/shared';
import { entityToSong, songToEntity, type SongEntity } from './entity.js';

const TABLE_NAME = 'Songs';

/** Options for a list query. */
export interface ListSongsOptions {
  /** Include `deactivated` (soft-deleted) records. Default false — they're hidden. */
  includeDeactivated?: boolean;
}

/**
 * Library-scoped CRUD over the `Songs` table. Wraps a `TableClient` injected at construction, so
 * unit tests pass a mock and never touch the network.
 */
export class SongsRepository {
  constructor(private readonly client: TableClient) {}

  /** Insert a new record. Rejects (via the SDK) if an entity with the same id already exists. */
  async create(song: Song): Promise<Song> {
    await this.client.createEntity(songToEntity(song));
    return song;
  }

  /** Fetch one record by id within a library, or null if it doesn't exist. */
  async get(libraryId: string, id: string): Promise<Song | null> {
    try {
      const entity = await this.client.getEntity<SongEntity>(libraryId, id);
      return entityToSong(entity);
    } catch (err) {
      if (err instanceof RestError && err.statusCode === 404) return null;
      throw err;
    }
  }

  /** List a library's records. Excludes `deactivated` unless `includeDeactivated` is set. */
  async list(libraryId: string, options: ListSongsOptions = {}): Promise<Song[]> {
    // Filter server-side on the partition (+ state) so the scan never leaves the library's
    // partition. `odata` escapes the interpolated values.
    const filter = options.includeDeactivated
      ? odata`PartitionKey eq ${libraryId}`
      : odata`PartitionKey eq ${libraryId} and state ne ${'deactivated'}`;
    const songs: Song[] = [];
    for await (const entity of this.client.listEntities<SongEntity>({ queryOptions: { filter } })) {
      songs.push(entityToSong(entity));
    }
    return songs;
  }

  /**
   * Apply a partial update to an existing record and return the merged result, or null if the
   * record doesn't exist. Only fields present in `patch` are changed; id/libraryId/owner/createdAt
   * are never touched (they're not in `SongUpdateInput`). Uses Table "Merge" mode.
   */
  async update(libraryId: string, id: string, patch: SongUpdateInput): Promise<Song | null> {
    const existing = await this.get(libraryId, id);
    if (!existing) return null;
    const merged: Song = { ...existing };
    // Apply only defined patch fields onto the merged record + the entity to persist.
    const mergeEntity: Partial<SongEntity> & { partitionKey: string; rowKey: string } = {
      partitionKey: libraryId,
      rowKey: id,
    };
    for (const [key, value] of Object.entries(patch) as [keyof SongUpdateInput, unknown][]) {
      if (value === undefined) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (merged as any)[key] = value;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mergeEntity as any)[key] = value;
    }
    await this.client.updateEntity(mergeEntity as SongEntity, 'Merge');
    return merged;
  }
}

// --- Factory: build a repository from the environment's storage connection string. ---

let cached: SongsRepository | null = null;
let ensured = false;

/** Resolve the storage connection string (deployed app setting, or Azurite locally). */
function connectionString(): string {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING ?? process.env.AzureWebJobsStorage;
  if (!conn) {
    throw new Error('No storage connection string: set AZURE_STORAGE_CONNECTION_STRING (or AzureWebJobsStorage).');
  }
  return conn;
}

/**
 * The process-wide `SongsRepository`, built lazily from app settings and cached. On first build it
 * ensures the `Songs` table exists (idempotent — a no-op in dev/prod where Sprint 1.3 created it,
 * and the thing that creates it under local Azurite).
 */
export async function getSongsRepository(): Promise<SongsRepository> {
  if (cached) return cached;
  const client = TableClient.fromConnectionString(connectionString(), TABLE_NAME, {
    allowInsecureConnection: true, // permits Azurite's http endpoint locally; no effect on https (Azure)
  });
  if (!ensured) {
    try {
      await client.createTable();
    } catch (err) {
      // TableAlreadyExists (409) is the expected steady state — ignore it; rethrow anything else.
      if (!(err instanceof RestError && err.statusCode === 409)) throw err;
    }
    ensured = true;
  }
  cached = new SongsRepository(client);
  return cached;
}

/** Test-only: reset the cached singleton so a fresh connection string / mock is picked up. */
export function _resetSongsRepositoryCache(): void {
  cached = null;
  ensured = false;
}
