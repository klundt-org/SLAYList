// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * POST /api/upload (Sprint 5.2) — an uploader submits an audio file; it lands in `raw-uploads` and a
 * `processing` Song record is created. No transcoding here (D5 — that's the Container App, Epic 6/7);
 * the record stays `processing` until the pipeline exists.
 *
 * Authorized SERVER-SIDE: `getCaller` (401 if unauthenticated) + role gate uploader|admin (403) —
 * the role check ships WITH the endpoint, not deferred (CLAUDE.md: never expose a feature without
 * the role check in front of it). Library-scoped via `callerLibraryId` (D20); `ownerOid` from the
 * token, never the client (D21).
 *
 * Validation is layered: `validateUpload` (declared filename/size/content-type, Sprint 5.1) THEN
 * magic-byte sniffing of the real bytes (`sniffAudio`) — a non-audio file renamed `.mp3` is rejected.
 *
 * Order of effects: write the raw blob FIRST, then create the record. A failure after the blob write
 * leaves an orphaned raw original — acceptable: `raw-uploads` is the never-deleted archive (D28), so
 * an orphan is harmless, whereas a record-first failure would strand a record in `processing` with no
 * file. (Upload idempotency decision — see BACKLOG: no idempotency key at family scale; rare orphans
 * are tolerated. Client-generated-id-as-upsert is the documented upgrade.)
 *
 * Logging (D32): `ownerOid` + `songId` + `ext` + size — NEVER the title or the blob name (the blob
 * name embeds the title slug, a D32/D40 surface).
 */

import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import type { Role, Song } from '@slaylist/shared';
import { callerHasRole, getCaller } from '../auth.js';
import { callerLibraryId } from '../songs/library.js';
import { getSongsRepository } from '../songs/repo.js';
import { newSongId } from '../songs/ids.js';
import { validateUpload } from '../upload/validation.js';
import { sniffAudio, familyMatchesExtension } from '../upload/magic.js';
import { rawBlobName } from '../upload/rawBlob.js';
import { putRawUpload } from '../upload/rawStore.js';

const UPLOAD_ROLES: readonly Role[] = ['uploader', 'admin'];

function err(status: number, message: string): HttpResponseInit {
  return { status, jsonBody: { error: message } };
}

export async function upload(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const caller = await getCaller(request);
  if (!caller) return err(401, 'not authenticated');
  if (!callerHasRole(caller, UPLOAD_ROLES)) return err(403, 'forbidden');

  // Parse multipart form: the file plus title (+ optional createdByKid, genre, ownerDisplayName).
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return err(400, 'Expected a multipart/form-data upload.');
  }

  const file = form.get('file');
  if (!file || typeof file === 'string') return err(400, 'No file provided.');
  const title = (form.get('title') as string | null)?.trim() ?? '';
  if (title.length === 0) return err(400, 'A title is required.');
  const ownerDisplayName = (form.get('ownerDisplayName') as string | null)?.trim() ?? '';
  if (ownerDisplayName.length === 0) return err(400, 'ownerDisplayName is required.');
  const createdByKid = (form.get('createdByKid') as string | null)?.trim() || undefined;
  const genre = (form.get('genre') as string | null)?.trim() || undefined;

  const data = Buffer.from(await file.arrayBuffer());

  // 1) Declared-metadata validation (allowlist + size cap, Sprint 5.1).
  const declared = validateUpload({ filename: file.name, sizeBytes: data.length, contentType: file.type });
  if (!declared.ok) return err(400, declared.reason);

  // 2) Real-bytes magic sniff — reject a non-audio file (or one whose bytes don't match its extension).
  const family = sniffAudio(data);
  if (!family) return err(400, 'That does not look like an audio file.');
  if (!familyMatchesExtension(family, declared.ext)) {
    return err(400, 'The file content does not match its extension.');
  }

  const songId = newSongId();
  const libraryId = callerLibraryId(caller);
  const blobName = rawBlobName(title, declared.ext, songId);

  // 3) Write the raw original FIRST (D28 archive; orphan-on-failure is harmless), then the record.
  const contentType = file.type && file.type.startsWith('audio/') ? file.type : 'application/octet-stream';
  await putRawUpload({ blobName, data, contentType, songId, libraryId });

  const song: Song = {
    id: songId,
    libraryId,
    title,
    ownerOid: caller.ownerOid, // from the validated token, never the client (D21)
    ownerDisplayName,
    state: 'processing',
    createdAt: new Date().toISOString(),
  };
  if (createdByKid) song.createdByKid = createdByKid;
  if (genre) song.genre = genre;

  const repo = await getSongsRepository();
  await repo.create(song);

  // D32-safe: no title, no blob name (it embeds the title slug).
  context.log(
    `POST /api/upload ownerOid=${caller.ownerOid} songId=${songId} libraryId=${libraryId} ext=${declared.ext} bytes=${data.length} -> processing`,
  );
  return { status: 201, jsonBody: song };
}

app.http('upload', { methods: ['POST'], authLevel: 'anonymous', route: 'upload', handler: upload });
