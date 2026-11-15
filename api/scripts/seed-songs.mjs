// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Dev seed script (Sprint 4.3): upserts a handful of FAKE song records into the `Songs` table so the
 * list screen has something to show. No audio, no real data.
 *
 * Usage:
 *   # local Azurite (default):
 *   pnpm --filter @slaylist/api run seed
 *   # a real environment: point at its storage first (never commit the value):
 *   AZURE_STORAGE_CONNECTION_STRING="<conn>" pnpm --filter @slaylist/api run seed
 *
 * Idempotent: fixed record ids + upsert, so re-running overwrites rather than duplicating.
 *
 * Public-repo hygiene: every value here is fake — generic titles, `example.com` display names,
 * placeholder oids, "Kid A/B" — never a real family name, email, or identifier.
 */

import { TableClient, RestError } from '@azure/data-tables';

const TABLE = 'Songs';
const LIBRARY_ID = 'slaylist-home'; // the single library today (D19)

const conn =
  process.env.AZURE_STORAGE_CONNECTION_STRING ?? process.env.AzureWebJobsStorage ?? 'UseDevelopmentStorage=true';

// Fake records. One of each meaningful state, including a `deactivated` one that the default list
// query must HIDE (proves the filter) and a `processing`/`failed` for visual variety.
const FAKES = [
  { id: 'song_seed_01', title: 'Rainbow Rocket', ownerDisplayName: 'uploader@example.com', createdByKid: 'Kid A', genre: 'pop', state: 'ready' },
  { id: 'song_seed_02', title: 'Dino Stomp', ownerDisplayName: 'uploader@example.com', createdByKid: 'Kid A', genre: 'rock', state: 'ready' },
  { id: 'song_seed_03', title: 'Sleepy Clouds', ownerDisplayName: 'uploader@example.com', createdByKid: 'Kid B', genre: 'lo-fi', state: 'processing' },
  { id: 'song_seed_04', title: 'Broken Robot Blues', ownerDisplayName: 'uploader@example.com', createdByKid: 'Kid B', genre: 'blues', state: 'failed' },
  { id: 'song_seed_05', title: 'Old Draft (hidden)', ownerDisplayName: 'uploader@example.com', createdByKid: 'Kid A', state: 'deactivated' },
];

const PLACEHOLDER_OID = '00000000-0000-0000-0000-000000000001';

async function main() {
  const client = TableClient.fromConnectionString(conn, TABLE, { allowInsecureConnection: true });
  try {
    await client.createTable();
  } catch (err) {
    if (!(err instanceof RestError && err.statusCode === 409)) throw err;
  }

  for (const f of FAKES) {
    const entity = {
      partitionKey: LIBRARY_ID,
      rowKey: f.id,
      title: f.title,
      ownerOid: PLACEHOLDER_OID,
      ownerDisplayName: f.ownerDisplayName,
      state: f.state,
      createdAt: new Date().toISOString(),
      ...(f.createdByKid ? { createdByKid: f.createdByKid } : {}),
      ...(f.genre ? { genre: f.genre } : {}),
      ...(f.state === 'deactivated' ? { deactivatedAt: new Date().toISOString() } : {}),
    };
    await client.upsertEntity(entity, 'Replace');
    console.log(`seeded ${f.id} (${f.state})`);
  }
  console.log(`\nDone: ${FAKES.length} records in '${TABLE}' partition '${LIBRARY_ID}' (1 deactivated — hidden by the default list).`);
}

main().catch((err) => {
  console.error('seed failed:', err);
  process.exitCode = 1;
});
