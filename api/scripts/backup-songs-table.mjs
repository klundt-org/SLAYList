// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Nightly Song-table backup (Sprint 4.4, D33). Exports the ENTIRE Songs table (including
 * `deactivated` records) to a dated JSON Lines blob in the `table-backups` container of the same
 * storage account.
 *
 * Table Storage has no soft-delete and no versioning, so this self-made export is the only recovery
 * path for a bad delete or metadata corruption. Restore with `restore-songs-table.mjs`.
 *
 * Run by `.github/workflows/backup-dev.yml` on a nightly cron. Auth is the storage connection string
 * (`AZURE_STORAGE_CONNECTION_STRING`, already a CI secret — D25 connection-string posture); locally
 * it falls back to Azurite. Logs counts + the blob name only — never a title/owner (D32).
 *
 * TO TURN IT OFF: disable the `backup-dev` workflow in the repo's GitHub Actions tab (one toggle),
 * or delete `.github/workflows/backup-dev.yml`, or delete the repo. Nothing in Azure keeps running
 * or billing — the backups are tiny blobs and the prune rule is free.
 */

import { BlobServiceClient } from '@azure/storage-blob';
import { getSongsRepository } from '../dist/src/songs/repo.js';
import { songsToJsonl, backupBlobName } from '../dist/src/songs/backup.js';

const LIBRARY_ID = 'slaylist-home';
const CONTAINER = 'table-backups';

const conn =
  process.env.AZURE_STORAGE_CONNECTION_STRING ?? process.env.AzureWebJobsStorage ?? 'UseDevelopmentStorage=true';

async function main() {
  // A backup is a FULL export — include deactivated rows (recovery must restore everything).
  const repo = await getSongsRepository();
  const songs = await repo.list(LIBRARY_ID, { includeDeactivated: true });
  const jsonl = songsToJsonl(songs);

  const blobService = BlobServiceClient.fromConnectionString(conn);
  const container = blobService.getContainerClient(CONTAINER);
  await container.createIfNotExists();

  const name = backupBlobName();
  const blob = container.getBlockBlobClient(name);
  const bytes = Buffer.byteLength(jsonl, 'utf8');
  await blob.upload(jsonl, bytes, {
    blobHTTPHeaders: { blobContentType: 'application/x-ndjson' },
  });

  console.log(`Backed up ${songs.length} record(s) -> ${CONTAINER}/${name} (${bytes} bytes).`);
}

main().catch((err) => {
  console.error('backup failed:', err);
  process.exitCode = 1;
});
