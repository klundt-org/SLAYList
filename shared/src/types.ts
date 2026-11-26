// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared types for SLAYList — the single source of truth for `Song`, roles,
 * and states across frontend, api, and transcoder.
 *
 * Anchored in:
 *   - D19: `libraryId` everywhere (renamed from `tenantId`).
 *   - D20: library-scoped authorization; the three roles are library-scoped.
 *   - D21: owner identity split — `ownerOid` is the authz key, `ownerDisplayName`
 *          is display-only PII, `createdByKid` is application metadata.
 *   - D29: this module is type-checked under `strict: true` +
 *          `noUncheckedIndexedAccess: true`.
 *   - D32: `ownerDisplayName` and `title` are PII / kid-name surfaces — never
 *          put them in logs; use `ownerOid` / `id` instead.
 */

/**
 * The four allowed lifecycle states a song record can be in.
 * `processing` — upload landed, transcode not yet complete.
 * `ready` — finished transcode written; playable.
 * `failed` — transcode failed after retries; surfaced for owner action.
 * `deactivated` — soft-deleted; hidden by default, recoverable until hard-delete.
 */
export const SONG_STATES = ['processing', 'ready', 'failed', 'deactivated'] as const;
export type SongState = (typeof SONG_STATES)[number];

/**
 * The three application roles (D20). Spelling/casing is locked — do not rename.
 * The two-tier admin model (library admin vs. platform admin) is a deferred
 * future addition; the current `admin` is implicitly admin of the sole library.
 */
export const ROLES = ['listener', 'uploader', 'admin'] as const;
export type Role = (typeof ROLES)[number];

/**
 * The default `libraryId` value for the single-family case (D19).
 * Not PII; safe to commit. If a multi-library future ever introduces real
 * per-family identifiers, those go in config — not in this constant.
 */
export const DEFAULT_LIBRARY_ID = 'slaylist-home';

/**
 * The finished-audio formats a song record may carry (D9 / D27). The union keeps both documented
 * formats so a future format switch is an additive change, not a breaking one (D45 additive-only).
 */
export const AUDIO_FORMATS = ['m4a', 'opus'] as const;
export type AudioFormat = (typeof AUDIO_FORMATS)[number];

/**
 * The single output format the transcoder produces today — AAC in an MP4 (.m4a) container, via
 * ffmpeg's built-in `aac` encoder (D27; libfdk_aac forbidden). Decided in Sprint 6.1 (D9): AAC
 * plays natively on every target device incl. iOS Safari; Opus was the rejected alternative.
 */
export const OUTPUT_FORMAT: AudioFormat = 'm4a';

/**
 * The canonical song record. Lives in Table Storage (D3); never in a JSON file.
 *
 * Field discipline:
 *   - `libraryId` is required on every record. Never assume one library (D19).
 *   - `ownerOid` is the ONLY field used for authz checks (D21). The Entra `oid`
 *     claim — stable, opaque.
 *   - `ownerDisplayName` is PII; for display only. Never log it (D32).
 *   - `createdByKid` is application metadata, distinct from `ownerDisplayName`
 *     (a parent may upload on behalf of a kid).
 *   - `title` is PII-adjacent (kids name songs with real first names); never log
 *     it — log `id` instead (D32).
 *   - `blobPath` is plumbing; the filename convention is in D8.
 */
export interface Song {
  /** Unique record id; also drives the blob shortid. Safe to log. */
  id: string;
  /** Application-level library label (D19). One value today: 'slaylist-home'. */
  libraryId: string;
  /** Display name. Contains PII (kids' names). Never log — log `id` instead (D32). */
  title: string;
  /** Entra `oid` claim. The only field used for authorization (D21). */
  ownerOid: string;
  /** Entra `preferred_username`. PII — display only, never log (D32). */
  ownerDisplayName: string;
  /** Optional: which kid made the song (distinct from `ownerDisplayName`). */
  createdByKid?: string;
  /** Optional: for later search. */
  genre?: string;
  /** Lifecycle state — one of `SONG_STATES`. */
  state: SongState;
  /** ISO timestamp when the record was created. */
  createdAt: string;
  /** ISO timestamp when the record was deactivated (soft-deleted). */
  deactivatedAt?: string;
  /** Pointer to the finished file in the `finished` blob container. */
  blobPath?: string;
  /** Finished-audio format (one of `AUDIO_FORMATS`; the transcoder writes `OUTPUT_FORMAT`). */
  format?: AudioFormat;
  /** Size of the finished blob in bytes. Filled by transcoder. */
  sizeBytes?: number;
  /** Duration of the finished audio in seconds. Filled by transcoder. */
  durationSec?: number;
}

/**
 * The client-supplied fields when creating a song record (the POST body).
 *
 * The SERVER sets everything else — `id`, `libraryId`, `ownerOid` (from the validated token,
 * never the client — it's the authz key, D21), `state` (`'processing'`), and `createdAt`. A
 * client may supply its own `ownerDisplayName` (display-only, never used in authz, D21/D32), so
 * a dishonest value only mislabels the client's own upload; it carries no authorization weight.
 */
export interface SongCreateInput {
  /** Display name for the song. Required. PII-adjacent — stored for display, never logged (D32). */
  title: string;
  /** Entra `preferred_username` of the uploader (display only). Stored, never used in authz (D21). */
  ownerDisplayName: string;
  /** Optional: which kid made the song. */
  createdByKid?: string;
  /** Optional: for later search. */
  genre?: string;
}

/**
 * The fields that may be changed on an existing song record (the PATCH body). Identity and
 * ownership (`id`, `libraryId`, `ownerOid`, `ownerDisplayName`, `createdAt`) are immutable — a
 * record never changes library or owner. All fields are optional; only those present are applied.
 */
export type SongUpdateInput = Partial<
  Pick<
    Song,
    'title' | 'genre' | 'createdByKid' | 'state' | 'blobPath' | 'format' | 'sizeBytes' | 'durationSec' | 'deactivatedAt'
  >
>;
