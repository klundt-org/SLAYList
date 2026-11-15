// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Upload form (Sprint 5.2): an uploader picks an audio file + title and POSTs it to /api/upload.
 * The server validates (allowlist + size + magic bytes), writes the raw original, and creates a
 * `processing` record; on success we bump the list so the new row appears.
 *
 * Only rendered for uploader/admin (the parent gates on role) — and the API enforces the role too,
 * so the UI gate is convenience, not the control (D22). Plain layout; real UI polish is Epic 8.
 */

import { useState, type FormEvent } from 'react';
import { useMsal } from '@azure/msal-react';
import { useApiFetch } from '../api/client.js';

// Client-side hint only; the server allowlist (configurable) is authoritative.
const ACCEPT = '.mp3,.wav,.m4a,.flac,.ogg,.opus,audio/*';

type Status = { kind: 'idle' } | { kind: 'uploading' } | { kind: 'done' } | { kind: 'error'; message: string };

export function UploadForm({ onUploaded }: { onUploaded: () => void }) {
  const apiFetch = useApiFetch();
  const { accounts } = useMsal();
  const ownerDisplayName = accounts[0]?.username ?? '';
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file || title.trim().length === 0) return;
    setStatus({ kind: 'uploading' });
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('title', title.trim());
      form.set('ownerDisplayName', ownerDisplayName);
      // No Content-Type header: the browser sets the multipart boundary. apiFetch adds the auth header.
      const res = await apiFetch('/api/upload', { method: 'POST', body: form });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Upload failed (HTTP ${res.status}).`);
      }
      setStatus({ kind: 'done' });
      setTitle('');
      setFile(null);
      onUploaded();
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Upload failed.' });
      // D32: nothing logged here carries a title/owner beyond what the user just typed on their own screen.
    }
  }

  return (
    <section className="upload">
      <h2>Upload a song</h2>
      <form onSubmit={onSubmit}>
        <label>
          Title
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Song title"
            required
          />
        </label>
        <label>
          File
          <input
            type="file"
            accept={ACCEPT}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            required
          />
        </label>
        <button type="submit" disabled={status.kind === 'uploading' || !file || title.trim().length === 0}>
          {status.kind === 'uploading' ? 'Uploading…' : 'Upload'}
        </button>
      </form>
      {status.kind === 'done' && <p className="upload-ok">Uploaded — your song is processing.</p>}
      {status.kind === 'error' && <p className="upload-error">{status.message}</p>}
    </section>
  );
}
