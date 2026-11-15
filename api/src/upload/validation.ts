// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Upload input validation (Sprint 5.1). Enforced SERVER-SIDE — the client may hint, but this is the
 * authority (InfoSec). The actual upload endpoint (Sprint 5.2) calls `validateUpload` before writing
 * anything to storage, and does magic-byte sniffing of the real bytes on top (the content-type and
 * filename here are client-declared, so they're a first gate, not proof).
 *
 * CONFIGURABLE (owner decision, Sprint 5.1): the allowlist and the size cap are read from app
 * settings, with permissive defaults — so they can change WITHOUT a code change (set the env var /
 * SWA app setting). Defaults: mp3/wav/m4a/flac/ogg/opus, 50 MB.
 *   - UPLOAD_ALLOWED_EXTENSIONS — comma-separated extensions, no dots (e.g. "mp3,wav,m4a").
 *   - UPLOAD_MAX_BYTES          — integer byte cap (e.g. 15728640 for 15 MB).
 *
 * FUTURE (backlogged): per-account tiers (free/paid/…) set at account creation will override these
 * GLOBAL limits per-account — e.g. a free tier allowing only compressed formats with a ~5–15 MB cap.
 * The `validateUpload` seam stays the same; only where the limits come from changes.
 */

/** Permissive defaults (owner decision, Sprint 5.1). */
const DEFAULT_ALLOWED_EXTENSIONS = ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'opus'];
const DEFAULT_MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

/** The active max upload size in bytes (config override or default). */
export function maxUploadBytes(): number {
  const v = Number(process.env.UPLOAD_MAX_BYTES);
  return Number.isInteger(v) && v > 0 ? v : DEFAULT_MAX_UPLOAD_BYTES;
}

/** The active allowlist of lowercase extensions (config override or default). */
export function allowedExtensions(): string[] {
  const raw = process.env.UPLOAD_ALLOWED_EXTENSIONS;
  if (!raw) return DEFAULT_ALLOWED_EXTENSIONS;
  const list = raw
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/^\./, ''))
    .filter((s) => s.length > 0);
  return list.length > 0 ? list : DEFAULT_ALLOWED_EXTENSIONS;
}

/** The declared metadata of an upload, as the client presents it. */
export interface UploadMeta {
  filename: string;
  sizeBytes: number;
  /** Client-declared MIME type; optional and not trusted — a first gate only. */
  contentType?: string;
}

export type UploadValidation = { ok: true; ext: string } | { ok: false; reason: string };

/** Lowercase file extension (no dot), or null if the name has none. */
export function fileExtension(filename: string): string | null {
  const m = /\.([A-Za-z0-9]+)$/.exec(filename.trim());
  return m ? m[1]!.toLowerCase() : null;
}

/**
 * Validate an upload's declared metadata against the active allowlist + size cap. Returns the
 * matched extension on success, or a clear, user-facing rejection reason.
 */
export function validateUpload(meta: UploadMeta): UploadValidation {
  const name = meta.filename?.trim() ?? '';
  // Filename safety: no path separators or parent-dir hops. The stored blob name is generated from
  // the title slug + a short id (D8), never the raw filename, but reject traversal shapes anyway.
  if (name.length === 0 || /[/\\]/.test(name) || name.includes('..') || /[\u0000-\u001f]/.test(name)) {
    return { ok: false, reason: 'Invalid file name.' };
  }

  const ext = fileExtension(name);
  const allowed = allowedExtensions();
  if (!ext || !allowed.includes(ext)) {
    return { ok: false, reason: `Unsupported file type. Allowed: ${allowed.join(', ')}.` };
  }

  if (!Number.isFinite(meta.sizeBytes) || meta.sizeBytes <= 0) {
    return { ok: false, reason: 'The file appears to be empty.' };
  }
  const cap = maxUploadBytes();
  if (meta.sizeBytes > cap) {
    const mb = Math.floor(cap / (1024 * 1024));
    return { ok: false, reason: `File is too large. Maximum is ${mb} MB.` };
  }

  // Content-type is client-controlled and often generic (e.g. application/octet-stream), so it's a
  // lenient gate: reject only when it's clearly a non-audio type. Real verification is magic-byte
  // sniffing of the bytes at upload time (Sprint 5.2).
  const ct = meta.contentType?.trim().toLowerCase();
  if (ct && ct !== 'application/octet-stream' && !ct.startsWith('audio/')) {
    return { ok: false, reason: 'That does not look like an audio file.' };
  }

  return { ok: true, ext };
}
