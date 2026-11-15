// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Restore the Songs table from a JSON Lines backup (Sprint 4.4, D33). The companion to
 * `backup-songs-table.mjs`. Reads a backup — either a local file or a blob name in the
 * `table-backups` container — and UPSERTs every record back into the table (idempotent: safe to
 * re-run, works whether the row is missing or still present).
 *
 * Usage (from repo root):
 *   # from a local file:
 *   AZURE_STORAGE_CONNECTION_STRING="<conn>" pnpm --filter @slaylist/api run restore -- ./songs-2026-11-15.jsonl
 *   # from a backup blob by name:
 *   AZURE_STORAGE_CONNECTION_STRING="<conn>" pnpm --filter @slaylist/api run restore -- --blob songs-2026-11-15.jsonl
 *
 * This WRITES to the table it points at — double-check the connection string targets the right
 * environment. Logs counts only, never a title/owner (D32).
 */

import { readFile } from 'node:fs/promises';
import { BlobServiceClient } from '@azure/storage-blob';
import { getSongsRepository } from '../dist/src/songs/repo.js';
import { jsonlToSongs } from '../dist/src/songs/backup.js';

const CONTAINER = 'table-backups';
const conn =
  process.env.AZURE_STORAGE_CONNECTION_STRING ?? process.env.AzureWebJobsStorage ?? 'UseDevelopmentStorage=true';

async function readSource() {
  const args = process.argv.slice(2);
  const blobFlag = args.indexOf('--blob');
  if (blobFlag !== -1) {
    const blobName = args[blobFlag + 1];
    if (!blobName) throw new Error('--blob requires a blob name, e.g. --blob songs-2026-11-15.jsonl');
    const container = BlobServiceClient.fromConnectionString(conn).getContainerClient(CONTAINER);
    const buf = await container.getBlockBlobClient(blobName).downloadToBuffer();
    return buf.toString('utf8');
  }
  const path = args.find((a) => !a.startsWith('--'));
  if (!path) throw new Error('give a backup file path, or --blob <name>. See the header for usage.');
  return readFile(path, 'utf8');
}

async function main() {
  const text = await readSource();
  const songs = jsonlToSongs(text);
  const repo = await getSongsRepository();
  let restored = 0;
  for (const song of songs) {
    await repo.upsert(song);
    restored += 1;
  }
  console.log(`Restored ${restored} record(s) into the Songs table.`);
}

main().catch((err) => {
  console.error('restore failed:', err);
  process.exitCode = 1;
});
