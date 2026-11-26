// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The transcoder's storage access — Managed Identity + RBAC ONLY (D25). There is deliberately no
 * connection-string code path here: the Container App's system-assigned identity holds Storage
 * Blob Data Contributor + Storage Table Data Contributor on the account (containerapp.bicep), and
 * `DefaultAzureCredential` picks that identity up inside Azure with no extra configuration.
 *
 * D28: this module only READS `raw-uploads`. The `TranscodeStorage` interface has no delete
 * operation at all — raw originals are the canonical archive and are never removed (a test pins
 * that no delete call exists in this file).
 *
 * D32: errors from here are reported by status/code only (see `errors.ts`) — never by message,
 * because SDK error messages can embed the request URL, and blob URLs embed the title slug.
 */

import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import { TableClient } from '@azure/data-tables';
import { DefaultAzureCredential, type TokenCredential } from '@azure/identity';
import type { SongState } from '@slaylist/shared';
import { statusOf } from './errors.js';
import type { RawBlobInfo, RecordPatch, RecordView, TranscodeStorage } from './transcode.js';

export const RAW_CONTAINER = 'raw-uploads';
export const FINISHED_CONTAINER = 'finished';
export const SONGS_TABLE = 'Songs';
/** Content type of the finished AAC-in-MP4 audio. */
export const FINISHED_CONTENT_TYPE = 'audio/mp4';

export function createStorage(args: { accountName: string; credential?: TokenCredential }): TranscodeStorage {
  const credential = args.credential ?? new DefaultAzureCredential();
  const blobService = new BlobServiceClient(`https://${args.accountName}.blob.core.windows.net`, credential);
  const raw: ContainerClient = blobService.getContainerClient(RAW_CONTAINER);
  const finished: ContainerClient = blobService.getContainerClient(FINISHED_CONTAINER);
  const table = new TableClient(`https://${args.accountName}.table.core.windows.net`, SONGS_TABLE, credential);

  return {
    async getRawInfo(rawBlobName): Promise<RawBlobInfo | null> {
      try {
        const props = await raw.getBlobClient(rawBlobName).getProperties();
        const md = props.metadata ?? {};
        return { songId: md['songid'], libraryId: md['libraryid'] };
      } catch (err) {
        if (statusOf(err) === 404) return null;
        throw err;
      }
    },

    async downloadRaw(rawBlobName, localPath) {
      // Streams to disk — a 50 MB WAV/FLAC never sits in the 0.5 GiB container's memory.
      await raw.getBlobClient(rawBlobName).downloadToFile(localPath);
    },

    async uploadFinished(finishedName, localPath) {
      // Overwrite is intentional: the finished name is deterministic per raw upload, so a re-run
      // (e.g. a crash after upload but before the record flip) replaces the same derivative copy.
      // Cache-Control is deliberately NOT set yet — the cache/invalidation strategy is decided with
      // playback in Sprint 8.2 (BACKLOG: key on blobPath + etag).
      await finished.getBlockBlobClient(finishedName).uploadFile(localPath, {
        blobHTTPHeaders: { blobContentType: FINISHED_CONTENT_TYPE },
      });
    },

    async getRecord(libraryId, songId): Promise<RecordView | null> {
      try {
        const e = await table.getEntity<{ state: SongState }>(libraryId, songId, {
          queryOptions: { select: ['state'] },
        });
        return { state: e.state, etag: e.etag };
      } catch (err) {
        if (statusOf(err) === 404) return null;
        throw err;
      }
    },

    async updateRecord(libraryId, songId, patch: RecordPatch, etag) {
      try {
        // ETag-conditional Merge: only applies if nobody changed the record since we read it
        // (e.g. an admin deactivated it mid-transcode, or a duplicate job already finished it).
        await table.updateEntity({ partitionKey: libraryId, rowKey: songId, ...patch }, 'Merge', { etag });
        return 'ok';
      } catch (err) {
        if (statusOf(err) === 412) return 'conflict';
        throw err;
      }
    },
  };
}
