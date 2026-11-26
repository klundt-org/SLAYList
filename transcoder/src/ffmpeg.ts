// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ffmpeg / ffprobe child-process wrapper.
 *
 * Encoder: ffmpeg's BUILT-IN `aac` (D27 — LGPL, AGPL-compatible). `libfdk_aac` is FORBIDDEN
 * (non-free, non-redistributable); the Dockerfile fails the image build if it's ever present.
 *
 * D32 (PII in logs) — mitigation (a): the caller hands us songId-named local paths, so any path
 * ffmpeg prints is the opaque songId, never the title-slug blob name. On top of that:
 *   - `-loglevel error` + `-hide_banner`: ffmpeg does NOT dump the input's metadata block (the
 *     title/artist tags a kid's file may carry) — that dump is info-level.
 *   - `-map_metadata -1 -map_chapters -1`: those tags are also STRIPPED from the output .m4a, so a
 *     kid's name embedded in the source file doesn't ride along into the finished copy.
 *   - captured stderr is capped and the work directory is replaced with `<work>` before anyone
 *     sees it.
 */

import { spawn } from 'node:child_process';

/** An ffmpeg/ffprobe failure with a short machine code + a sanitized stderr tail. */
export class FfmpegError extends Error {
  constructor(
    readonly code: string,
    readonly detail: string,
  ) {
    super(code);
    this.name = 'FfmpegError';
  }
}

const STDERR_CAP = 2000;

/** Keep the LAST `STDERR_CAP` chars (the error is at the end) and scrub the work dir. */
export function sanitizeStderr(stderr: string, workDir?: string): string {
  let s = stderr;
  if (workDir) s = s.split(workDir).join('<work>');
  s = s.trim();
  return s.length > STDERR_CAP ? s.slice(s.length - STDERR_CAP) : s;
}

export interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Run a process with a hard timeout (SIGKILL), capturing stdout/stderr (bounded). */
export function runProcess(cmd: string, args: readonly string[], timeoutMs: number): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const cap = (acc: string, chunk: Buffer) => {
      const next = acc + chunk.toString('utf8');
      return next.length > 64_000 ? next.slice(next.length - 64_000) : next;
    };
    child.stdout.on('data', (c: Buffer) => (stdout = cap(stdout, c)));
    child.stderr.on('data', (c: Buffer) => (stderr = cap(stderr, c)));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, timedOut });
    });
  });
}

/** AAC bitrate. D27 sets the floor (>= 128 kbps stereo); 160k is the Sprint 6.1 choice. */
export const AAC_BITRATE_KBPS = 160;

/** Build the ffmpeg argument list for raw -> AAC/.m4a. Pure, so it's unit-tested. */
export function encodeArgs(input: string, output: string, bitrateKbps: number = AAC_BITRATE_KBPS): string[] {
  return [
    '-nostdin',
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-i', input,
    '-map', '0:a:0', // first audio stream only (drops cover art / video / data streams)
    '-vn', '-sn', '-dn',
    '-map_metadata', '-1', // strip source tags (may contain kids' names) — D32
    '-map_chapters', '-1',
    '-c:a', 'aac', // ffmpeg built-in AAC encoder — D27 (never libfdk_aac)
    '-b:a', `${bitrateKbps}k`,
    '-movflags', '+faststart', // moov atom up front -> playback starts before the full download
    output,
  ];
}

export interface Encoder {
  /** Transcode `input` -> AAC `.m4a` at `output`. Throws `FfmpegError` on failure. */
  encode(input: string, output: string, opts: { timeoutMs: number; workDir: string }): Promise<void>;
  /** Duration of `path` in seconds. Throws `FfmpegError` on failure. */
  probeDurationSec(path: string, opts: { workDir: string }): Promise<number>;
  /** First line of `ffmpeg -version` (startup telemetry), or 'unknown'. */
  version(): Promise<string>;
}

export function createEncoder(bin = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }): Encoder {
  return {
    async encode(input, output, { timeoutMs, workDir }) {
      const r = await runProcess(bin.ffmpeg, encodeArgs(input, output), timeoutMs);
      if (r.timedOut) throw new FfmpegError('ffmpeg-timeout', sanitizeStderr(r.stderr, workDir));
      if (r.exitCode !== 0) throw new FfmpegError(`ffmpeg-exit-${r.exitCode}`, sanitizeStderr(r.stderr, workDir));
    },
    async probeDurationSec(path, { workDir }) {
      const r = await runProcess(
        bin.ffprobe,
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path],
        60_000,
      );
      if (r.exitCode !== 0) throw new FfmpegError(`ffprobe-exit-${r.exitCode}`, sanitizeStderr(r.stderr, workDir));
      const d = Number.parseFloat(r.stdout.trim());
      if (!Number.isFinite(d) || d <= 0) throw new FfmpegError('ffprobe-no-duration', '');
      return Math.round(d * 100) / 100;
    },
    async version() {
      try {
        const r = await runProcess(bin.ffmpeg, ['-hide_banner', '-version'], 10_000);
        return r.stdout.split('\n')[0]?.trim() || 'unknown';
      } catch {
        return 'unknown';
      }
    },
  };
}
