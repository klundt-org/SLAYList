// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Song-record CRUD over Table Storage (Sprint 4.2) — no audio yet, just the metadata spine.
 *
 *   POST   /api/songs       create a record            (uploader | admin)
 *   GET    /api/songs       list a library's records   (any signed-in role; hides `deactivated`)
 *   GET    /api/songs/{id}  read one record            (any signed-in role)
 *   PATCH  /api/songs/{id}  update a record            (uploader | admin)
 *
 * Every handler authorizes SERVER-SIDE (getCaller validates the bearer token, 401 if absent/invalid;
 * callerHasRole gates writes, 403 otherwise) — never trusting the UI (InfoSec). Every handler is
 * LIBRARY-SCOPED (D20): the `libraryId` comes from `callerLibraryId(caller)`, never from client
 * input, so a caller can only ever touch their own library's partition (D45). `ownerOid` on a new
 * record is taken from the validated token, never the client (it's the authz key, D21).
 *
 * Logging (D32): `ownerOid` + `songId` only — NEVER `title` or `ownerDisplayName` (kids' names).
 * Response bodies DO carry title/ownerDisplayName — that's display data for the authenticated
 * caller over TLS, which D32 (a logging rule) does not touch.
 */

import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import type { Role, Song, SongCreateInput, SongUpdateInput } from '@slaylist/shared';
import { callerHasRole, getCaller } from '../auth.js';
import { callerLibraryId } from '../songs/library.js';
import { getSongsRepository } from '../songs/repo.js';
import { newSongId } from '../songs/ids.js';
import { isAudioFormat, isSongState } from '../shared-runtime.js';

const WRITE_ROLES: readonly Role[] = ['uploader', 'admin'];
const READ_ROLES: readonly Role[] = ['listener', 'uploader', 'admin'];

function err(status: number, message: string): HttpResponseInit {
  return { status, jsonBody: { error: message } };
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Parse a JSON request body into a plain object, or null if it's absent / not a JSON object. */
async function parseJsonObject(request: HttpRequest): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown;
    return body !== null && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// --- POST /api/songs ---------------------------------------------------------------------------
export async function createSong(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const caller = await getCaller(request);
  if (!caller) return err(401, 'not authenticated');
  if (!callerHasRole(caller, WRITE_ROLES)) return err(403, 'forbidden');

  const body = await parseJsonObject(request);
  if (!body) return err(400, 'invalid JSON body');
  if (!isNonEmptyString(body.title)) return err(400, 'title is required');
  if (!isNonEmptyString(body.ownerDisplayName)) return err(400, 'ownerDisplayName is required');
  if (body.createdByKid !== undefined && typeof body.createdByKid !== 'string') return err(400, 'createdByKid must be a string');
  if (body.genre !== undefined && typeof body.genre !== 'string') return err(400, 'genre must be a string');

  const input = body as unknown as SongCreateInput;
  const libraryId = callerLibraryId(caller);
  const song: Song = {
    id: newSongId(),
    libraryId,
    title: input.title,
    ownerOid: caller.ownerOid, // from the validated token, never the client (D21)
    ownerDisplayName: input.ownerDisplayName,
    state: 'processing',
    createdAt: new Date().toISOString(),
  };
  if (input.createdByKid !== undefined) song.createdByKid = input.createdByKid;
  if (input.genre !== undefined) song.genre = input.genre;

  const repo = await getSongsRepository();
  await repo.create(song);
  context.log(`POST /api/songs ownerOid=${caller.ownerOid} songId=${song.id} libraryId=${libraryId} -> created`);
  return { status: 201, jsonBody: song };
}

// --- GET /api/songs ----------------------------------------------------------------------------
export async function listSongs(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const caller = await getCaller(request);
  if (!caller) return err(401, 'not authenticated');
  if (!callerHasRole(caller, READ_ROLES)) return err(403, 'forbidden');

  const libraryId = callerLibraryId(caller);
  const includeDeactivated = request.query.get('includeDeactivated') === 'true';
  const repo = await getSongsRepository();
  const songs = await repo.list(libraryId, { includeDeactivated });
  context.log(
    `GET /api/songs ownerOid=${caller.ownerOid} libraryId=${libraryId} count=${songs.length} includeDeactivated=${includeDeactivated}`,
  );
  return { status: 200, jsonBody: { songs } };
}

// --- GET /api/songs/{id} -----------------------------------------------------------------------
export async function getSong(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const caller = await getCaller(request);
  if (!caller) return err(401, 'not authenticated');
  if (!callerHasRole(caller, READ_ROLES)) return err(403, 'forbidden');

  const id = request.params.id;
  if (!id) return err(400, 'id is required');
  const libraryId = callerLibraryId(caller);
  const repo = await getSongsRepository();
  const song = await repo.get(libraryId, id);
  context.log(`GET /api/songs/${id} ownerOid=${caller.ownerOid} libraryId=${libraryId} -> ${song ? 'found' : 'not found'}`);
  if (!song) return err(404, 'not found');
  return { status: 200, jsonBody: song };
}

/** Pull the allowed, well-typed update fields out of a request body. */
function buildUpdatePatch(body: Record<string, unknown>): { patch: SongUpdateInput } | { error: string } {
  const patch: SongUpdateInput = {};
  if (body.title !== undefined) {
    if (!isNonEmptyString(body.title)) return { error: 'title must be a non-empty string' };
    patch.title = body.title;
  }
  if (body.genre !== undefined) {
    if (typeof body.genre !== 'string') return { error: 'genre must be a string' };
    patch.genre = body.genre;
  }
  if (body.createdByKid !== undefined) {
    if (typeof body.createdByKid !== 'string') return { error: 'createdByKid must be a string' };
    patch.createdByKid = body.createdByKid;
  }
  if (body.state !== undefined) {
    if (!isSongState(body.state)) return { error: 'state must be one of processing|ready|failed|deactivated' };
    patch.state = body.state;
  }
  if (body.blobPath !== undefined) {
    if (typeof body.blobPath !== 'string') return { error: 'blobPath must be a string' };
    patch.blobPath = body.blobPath;
  }
  if (body.format !== undefined) {
    if (!isAudioFormat(body.format)) return { error: 'format must be one of m4a|opus' };
    patch.format = body.format;
  }
  if (body.sizeBytes !== undefined) {
    if (typeof body.sizeBytes !== 'number' || !Number.isFinite(body.sizeBytes)) return { error: 'sizeBytes must be a number' };
    patch.sizeBytes = body.sizeBytes;
  }
  if (body.durationSec !== undefined) {
    if (typeof body.durationSec !== 'number' || !Number.isFinite(body.durationSec)) return { error: 'durationSec must be a number' };
    patch.durationSec = body.durationSec;
  }
  if (body.deactivatedAt !== undefined) {
    if (typeof body.deactivatedAt !== 'string') return { error: 'deactivatedAt must be a string' };
    patch.deactivatedAt = body.deactivatedAt;
  }
  return { patch };
}

// --- PATCH /api/songs/{id} ---------------------------------------------------------------------
export async function updateSong(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const caller = await getCaller(request);
  if (!caller) return err(401, 'not authenticated');
  if (!callerHasRole(caller, WRITE_ROLES)) return err(403, 'forbidden');

  const id = request.params.id;
  if (!id) return err(400, 'id is required');
  const body = await parseJsonObject(request);
  if (!body) return err(400, 'invalid JSON body');

  const result = buildUpdatePatch(body);
  if ('error' in result) return err(400, result.error);
  if (Object.keys(result.patch).length === 0) return err(400, 'no updatable fields provided');

  const libraryId = callerLibraryId(caller);
  const repo = await getSongsRepository();
  const updated = await repo.update(libraryId, id, result.patch);
  context.log(
    `PATCH /api/songs/${id} ownerOid=${caller.ownerOid} libraryId=${libraryId} fields=[${Object.keys(result.patch).join(',')}] -> ${updated ? 'updated' : 'not found'}`,
  );
  if (!updated) return err(404, 'not found');
  return { status: 200, jsonBody: updated };
}

app.http('songs-create', { methods: ['POST'], authLevel: 'anonymous', route: 'songs', handler: createSong });
app.http('songs-list', { methods: ['GET'], authLevel: 'anonymous', route: 'songs', handler: listSongs });
app.http('songs-get', { methods: ['GET'], authLevel: 'anonymous', route: 'songs/{id}', handler: getSong });
app.http('songs-update', { methods: ['PATCH'], authLevel: 'anonymous', route: 'songs/{id}', handler: updateSong });
