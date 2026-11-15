// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HttpRequest, InvocationContext } from '@azure/functions';
import type { Caller } from '../auth.js';
import type { Song } from '@slaylist/shared';

vi.mock('../auth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth.js')>();
  return { ...actual, getCaller: vi.fn() };
});
vi.mock('../songs/repo.js', () => ({ getSongsRepository: vi.fn() }));
vi.mock('../upload/rawStore.js', () => ({ putRawUpload: vi.fn() }));

const { getCaller } = await import('../auth.js');
const { getSongsRepository } = await import('../songs/repo.js');
const { putRawUpload } = await import('../upload/rawStore.js');
const { upload } = await import('./upload.js');

const mockGetCaller = vi.mocked(getCaller);
const mockGetRepo = vi.mocked(getSongsRepository);
const mockPutRaw = vi.mocked(putRawUpload);

const uploader: Caller = { ownerOid: 'oid-up', role: 'uploader' };
const listener: Caller = { ownerOid: 'oid-ls', role: 'listener' };

// 'ID3' + padding -> sniffs as mp3.
const MP3_BYTES = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const NON_AUDIO = new Uint8Array([0x4d, 0x5a, 0x90, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]); // "MZ" exe

function req(fields: { file?: File; title?: string; ownerDisplayName?: string; badBody?: boolean }): HttpRequest {
  return {
    formData: async () => {
      if (fields.badBody) throw new Error('not multipart');
      const fd = new FormData();
      if (fields.file) fd.set('file', fields.file);
      if (fields.title !== undefined) fd.set('title', fields.title);
      if (fields.ownerDisplayName !== undefined) fd.set('ownerDisplayName', fields.ownerDisplayName);
      return fd;
    },
  } as unknown as HttpRequest;
}

const ctx = { log: vi.fn() } as unknown as InvocationContext;
const mp3File = () => new File([MP3_BYTES], 'My Song.mp3', { type: 'audio/mpeg' });

let createMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  createMock = vi.fn().mockImplementation(async (s: Song) => s);
  mockGetRepo.mockResolvedValue({ create: createMock } as unknown as Awaited<ReturnType<typeof getSongsRepository>>);
  mockPutRaw.mockResolvedValue(undefined);
});
afterEach(() => vi.clearAllMocks());

describe('POST /api/upload (Sprint 5.2)', () => {
  it('401 when unauthenticated', async () => {
    mockGetCaller.mockResolvedValue(null);
    expect((await upload(req({ file: mp3File(), title: 'x', ownerDisplayName: 'd@example.com' }), ctx)).status).toBe(401);
    expect(mockPutRaw).not.toHaveBeenCalled();
  });

  it('403 for a listener (role gate ships with the endpoint)', async () => {
    mockGetCaller.mockResolvedValue(listener);
    expect((await upload(req({ file: mp3File(), title: 'x', ownerDisplayName: 'd@example.com' }), ctx)).status).toBe(403);
    expect(mockPutRaw).not.toHaveBeenCalled();
  });

  it('400 when no file is provided', async () => {
    mockGetCaller.mockResolvedValue(uploader);
    expect((await upload(req({ title: 'x', ownerDisplayName: 'd@example.com' }), ctx)).status).toBe(400);
  });

  it('400 when title is missing', async () => {
    mockGetCaller.mockResolvedValue(uploader);
    expect((await upload(req({ file: mp3File(), ownerDisplayName: 'd@example.com' }), ctx)).status).toBe(400);
  });

  it('400 on a disallowed extension', async () => {
    mockGetCaller.mockResolvedValue(uploader);
    const bad = new File([MP3_BYTES], 'x.exe', { type: 'application/octet-stream' });
    expect((await upload(req({ file: bad, title: 'x', ownerDisplayName: 'd@example.com' }), ctx)).status).toBe(400);
    expect(mockPutRaw).not.toHaveBeenCalled();
  });

  it('400 when the bytes are not audio (renamed non-audio file)', async () => {
    mockGetCaller.mockResolvedValue(uploader);
    const fake = new File([NON_AUDIO], 'notreally.mp3', { type: 'audio/mpeg' });
    const res = await upload(req({ file: fake, title: 'x', ownerDisplayName: 'd@example.com' }), ctx);
    expect(res.status).toBe(400);
    expect(mockPutRaw).not.toHaveBeenCalled(); // nothing written
  });

  it('201 writes the raw blob (with songid metadata) and a processing record', async () => {
    mockGetCaller.mockResolvedValue(uploader);
    const res = await upload(req({ file: mp3File(), title: 'My Song', ownerDisplayName: 'd@example.com' }), ctx);
    expect(res.status).toBe(201);
    const song = res.jsonBody as Song;
    expect(song.state).toBe('processing');
    expect(song.ownerOid).toBe('oid-up'); // from token
    expect(song.libraryId).toBe('slaylist-home');
    expect(song.title).toBe('My Song');

    expect(mockPutRaw).toHaveBeenCalledTimes(1);
    const putArg = mockPutRaw.mock.calls[0]![0];
    expect(putArg.songId).toBe(song.id);
    expect(putArg.blobName).toMatch(/^my-song_\d{8}-\d{6}_.+\.mp3$/);

    expect(createMock).toHaveBeenCalledTimes(1);
    expect((createMock.mock.calls[0]![0] as Song).state).toBe('processing');
  });

  it('400 on a non-multipart body', async () => {
    mockGetCaller.mockResolvedValue(uploader);
    expect((await upload(req({ badBody: true }), ctx)).status).toBe(400);
  });

  // Sprint 5.3 — role-enforcement matrix: admin can upload too; listener/anon cannot (above).
  it('201 for an admin (role matrix, Sprint 5.3)', async () => {
    mockGetCaller.mockResolvedValue({ ownerOid: 'oid-ad', role: 'admin' });
    const res = await upload(req({ file: mp3File(), title: 'Admin Song', ownerDisplayName: 'a@example.com' }), ctx);
    expect(res.status).toBe(201);
    expect(mockPutRaw).toHaveBeenCalledTimes(1);
  });
});
