// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Transcoder telemetry → Application Insights (D24) + a JSON console line (→ Log Analytics via the
 * Container App Environment).
 *
 * Why a tiny hand-rolled sender and not the App Insights / OpenTelemetry SDK: the SDKs
 * AUTO-INSTRUMENT outbound HTTP, and every Azure Storage call URL carries the blob name — which
 * embeds the song's title slug (D8). Auto-collected dependency telemetry would leak kids' names
 * into an indexed, hard-to-purge store (D32). Sending only explicit custom events means nothing
 * reaches App Insights that this file didn't name.
 *
 * D32 enforcement is structural: `TelemetryProps` is a closed allowlist of fields, AND `pick()`
 * copies only those keys at runtime — so even an `as any` caller can't smuggle `title`,
 * `ownerDisplayName`, or a blob name through. Never add a free-form "message"/"name" field here.
 *
 * Events land in App Insights `customEvents` (LAW table `AppEvents`). Sending never throws: a
 * telemetry outage must not fail a transcode.
 */

/** The only event names the transcoder emits. */
export type TelemetryEventName =
  | 'TranscoderStarted'
  | 'TranscodeStarted'
  | 'TranscodeSucceeded'
  | 'TranscodeFailed'
  | 'TranscodeSkipped';

/** The closed allowlist of properties an event may carry. None of these may ever hold PII (D32). */
export interface TelemetryProps {
  /** Opaque song id — safe to log (never the title). */
  songId?: string;
  /** Library label (D19) — not PII. */
  libraryId?: string;
  /** Short machine-readable reason code, e.g. `encode:ffmpeg-exit-1`. Never free text. */
  reason?: string;
  /** Sanitized ffmpeg stderr tail (songId-named paths only — D32 mitigation (a)). */
  detail?: string;
  /** How the job was started (`oneshot` today; `queue` from Epic 7). */
  mode?: string;
  /** Container App revision name (Azure-injected). */
  revision?: string;
  /** ffmpeg version line (startup event only). */
  ffmpegVersion?: string;
}

const ALLOWED_KEYS: readonly (keyof TelemetryProps)[] = [
  'songId',
  'libraryId',
  'reason',
  'detail',
  'mode',
  'revision',
  'ffmpegVersion',
];

/** Numeric measurements (sizes, durations, timings) — numbers only, never strings. */
export type TelemetryMeasurements = Partial<Record<'sizeBytes' | 'durationSec' | 'elapsedMs', number>>;

export interface Telemetry {
  event(name: TelemetryEventName, props: TelemetryProps, measurements?: TelemetryMeasurements): Promise<void>;
}

/** Copy ONLY allowlisted, string-valued keys (runtime guard behind the compile-time allowlist). */
export function pick(props: TelemetryProps): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ALLOWED_KEYS) {
    const v = (props as Record<string, unknown>)[key];
    if (typeof v === 'string' && v.length > 0) out[key] = v.slice(0, 1024);
  }
  return out;
}

function pickMeasurements(m: TelemetryMeasurements | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!m) return out;
  for (const key of ['sizeBytes', 'durationSec', 'elapsedMs'] as const) {
    const v = m[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
  }
  return out;
}

/** Parse `InstrumentationKey=...;IngestionEndpoint=https://...` — returns null if unusable. */
export function parseConnectionString(cs: string | undefined): { iKey: string; endpoint: string } | null {
  if (!cs) return null;
  const parts = new Map<string, string>();
  for (const seg of cs.split(';')) {
    const i = seg.indexOf('=');
    if (i > 0) parts.set(seg.slice(0, i).trim().toLowerCase(), seg.slice(i + 1).trim());
  }
  const iKey = parts.get('instrumentationkey');
  const endpoint = parts.get('ingestionendpoint') ?? 'https://dc.services.visualstudio.com/';
  if (!iKey) return null;
  return { iKey, endpoint: endpoint.endsWith('/') ? endpoint : `${endpoint}/` };
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

export interface TelemetryOptions {
  connectionString?: string;
  /** App Insights cloud role name (groups this component in the portal). */
  roleName: string;
  roleInstance?: string;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: Fetch;
  /** Injected for tests; defaults to console.log. */
  logLine?: (line: string) => void;
}

export function createTelemetry(opts: TelemetryOptions): Telemetry {
  const target = parseConnectionString(opts.connectionString);
  const doFetch: Fetch = opts.fetchImpl ?? (globalThis.fetch as unknown as Fetch);
  const logLine = opts.logLine ?? ((line: string) => console.log(line));

  return {
    async event(name, props, measurements) {
      const properties = pick(props);
      const metrics = pickMeasurements(measurements);
      // 1) Console line (structured JSON) → Container App console logs → Log Analytics.
      logLine(JSON.stringify({ event: name, ...properties, ...metrics }));
      // 2) App Insights custom event (skipped when no connection string, e.g. local runs).
      if (!target) return;
      const envelope = {
        name: 'Microsoft.ApplicationInsights.Event',
        time: new Date().toISOString(),
        iKey: target.iKey,
        tags: {
          'ai.cloud.role': opts.roleName,
          ...(opts.roleInstance ? { 'ai.cloud.roleInstance': opts.roleInstance } : {}),
        },
        data: {
          baseType: 'EventData',
          baseData: { ver: 2, name, properties, measurements: metrics },
        },
      };
      try {
        const res = await doFetch(`${target.endpoint}v2/track`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify([envelope]),
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) logLine(JSON.stringify({ event: 'TelemetrySendFailed', status: res.status }));
      } catch {
        logLine(JSON.stringify({ event: 'TelemetrySendFailed', status: 0 }));
      }
    },
  };
}
