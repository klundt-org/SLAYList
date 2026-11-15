// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Magic-byte sniffing for uploaded audio (Sprint 5.2). The 5.1 validator checks the *declared*
 * filename/content-type; this checks the *actual bytes*, so a non-audio file renamed `.mp3` is
 * rejected. Pure function over the file's leading bytes — unit-testable, no I/O.
 *
 * Covers the Sprint 5.1 allowlist families. Signatures:
 *   - mp3   : "ID3" tag (0x49 0x44 0x33) OR an MPEG frame sync (0xFF 0xFB/0xF3/0xF2/0xFA/0xF9…)
 *   - wav   : "RIFF"…"WAVE" (RIFF container, WAVE form)
 *   - m4a   : "ftyp" at offset 4 (ISO-BMFF / MP4 container; M4A brand)
 *   - flac  : "fLaC"
 *   - ogg   : "OggS" (Ogg container — carries Vorbis or Opus)
 */

export type AudioFamily = 'mp3' | 'wav' | 'm4a' | 'flac' | 'ogg';

function hasAscii(bytes: Uint8Array, offset: number, ascii: string): boolean {
  for (let i = 0; i < ascii.length; i += 1) {
    if (bytes[offset + i] !== ascii.charCodeAt(i)) return false;
  }
  return true;
}

/** Detect the audio family from leading bytes, or null if nothing matches. */
export function sniffAudio(bytes: Uint8Array): AudioFamily | null {
  if (bytes.length < 12) return null;

  // FLAC
  if (hasAscii(bytes, 0, 'fLaC')) return 'flac';
  // OGG (Vorbis/Opus)
  if (hasAscii(bytes, 0, 'OggS')) return 'ogg';
  // WAV: RIFF....WAVE
  if (hasAscii(bytes, 0, 'RIFF') && hasAscii(bytes, 8, 'WAVE')) return 'wav';
  // M4A / MP4: "ftyp" box type at bytes 4..7
  if (hasAscii(bytes, 4, 'ftyp')) return 'm4a';
  // MP3: ID3 tag, or an MPEG audio frame sync (0xFF followed by 0xEx/0xFx)
  if (hasAscii(bytes, 0, 'ID3')) return 'mp3';
  if (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) return 'mp3';

  return null;
}

/**
 * True when the sniffed family is consistent with the declared extension. `ogg` and `opus`
 * extensions both live in the Ogg container, and `aac`/`m4a` both appear as MP4/ftyp — treat those
 * as matching their family.
 */
export function familyMatchesExtension(family: AudioFamily, ext: string): boolean {
  const e = ext.toLowerCase();
  switch (family) {
    case 'ogg':
      return e === 'ogg' || e === 'opus';
    case 'm4a':
      return e === 'm4a' || e === 'aac' || e === 'mp4';
    default:
      return family === e;
  }
}
