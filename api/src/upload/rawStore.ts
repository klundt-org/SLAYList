// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Writes uploaded originals to the `raw-uploads` blob container (Sprint 5.2).
 *
 * `raw-uploads` is the canonical archive of the kids' creations (D28) — this module only ever
 * WRITES; nothing here (or anywhere) deletes from it. The blob is tagged with `songid` metadata so
 * the Epic 6/7 transcoder can map the raw file back to its Song record. Connection-string auth
 * (D25, via the shared resolver). The container is provisioned by Bicep (Sprint 1.3).
 */

import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import { storageConnectionString } from '../storage.js';

const CONTAINER = 'raw-uploads';

let cached: ContainerClient | null = null;

/** The `raw-uploads` container client, built lazily from app settings and cached. */
export function getRawUploadsContainer(): ContainerClient {
  if (cached) return cached;
  cached = BlobServiceClient.fromConnectionString(storageConnectionString()).getContainerClient(CONTAINER);
  return cached;
}

/** Test-only: reset the cached container client. */
export function _resetRawUploadsCache(): void {
  cached = null;
}

/**
 * Upload a raw original. `blobName` follows the D8 convention; `songId` is stamped as blob metadata
 * so the transcoder can resolve the record later. Fails (via the SDK) if the blob already exists —
 * the D8 short id makes collisions effectively impossible.
 */
export async function putRawUpload(args: {
  blobName: string;
  data: Buffer;
  contentType: string;
  songId: string;
}): Promise<void> {
  const blob = getRawUploadsContainer().getBlockBlobClient(args.blobName);
  await blob.uploadData(args.data, {
    blobHTTPHeaders: { blobContentType: args.contentType },
    metadata: { songid: args.songId },
    conditions: { ifNoneMatch: '*' }, // never overwrite an existing original (D28 safety)
  });
}
