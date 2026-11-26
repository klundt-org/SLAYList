// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { createTelemetry, parseConnectionString, pick, type TelemetryProps } from './telemetry.js';

describe('telemetry allowlist (D32)', () => {
  it('pick() drops any key outside the allowlist, even when forced through a cast', () => {
    const sneaky = { songId: 's1', title: 'Kidname song', ownerDisplayName: 'kid@example.com', blobName: 'x.mp3' };
    expect(pick(sneaky as unknown as TelemetryProps)).toEqual({ songId: 's1' });
  });

  it('pick() drops non-string values and empty strings', () => {
    expect(pick({ songId: '', reason: 42 } as unknown as TelemetryProps)).toEqual({});
  });
});

describe('parseConnectionString', () => {
  it('extracts the key and normalizes the endpoint', () => {
    expect(parseConnectionString('InstrumentationKey=k1;IngestionEndpoint=https://x.in.example/')).toEqual({
      iKey: 'k1',
      endpoint: 'https://x.in.example/',
    });
    expect(parseConnectionString('InstrumentationKey=k1;IngestionEndpoint=https://x.in.example')?.endpoint).toBe(
      'https://x.in.example/',
    );
  });

  it('returns null without an instrumentation key', () => {
    expect(parseConnectionString(undefined)).toBeNull();
    expect(parseConnectionString('IngestionEndpoint=https://x/')).toBeNull();
  });
});

describe('createTelemetry', () => {
  it('posts an EventData envelope to <endpoint>v2/track and logs a JSON line', async () => {
    const calls: { url: string; body: string }[] = [];
    const lines: string[] = [];
    const t = createTelemetry({
      connectionString: 'InstrumentationKey=k1;IngestionEndpoint=https://x.in.example/',
      roleName: 'slaylist-transcoder',
      roleInstance: 'rev-1',
      logLine: (l) => lines.push(l),
      fetchImpl: async (url, init) => {
        calls.push({ url, body: init.body });
        return { ok: true, status: 200 };
      },
    });
    await t.event('TranscodeFailed', { songId: 's1', reason: 'encode:ffmpeg-exit-1' }, { elapsedMs: 12 });
    expect(calls[0]!.url).toBe('https://x.in.example/v2/track');
    const env = JSON.parse(calls[0]!.body)[0];
    expect(env.iKey).toBe('k1');
    expect(env.tags['ai.cloud.role']).toBe('slaylist-transcoder');
    expect(env.data.baseType).toBe('EventData');
    expect(env.data.baseData).toMatchObject({
      name: 'TranscodeFailed',
      properties: { songId: 's1', reason: 'encode:ffmpeg-exit-1' },
      measurements: { elapsedMs: 12 },
    });
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: 'TranscodeFailed', songId: 's1' });
  });

  it('never throws when the sink is down (a telemetry outage must not fail a transcode)', async () => {
    const lines: string[] = [];
    const t = createTelemetry({
      connectionString: 'InstrumentationKey=k1',
      roleName: 'r',
      logLine: (l) => lines.push(l),
      fetchImpl: async () => {
        throw new Error('network down');
      },
    });
    await expect(t.event('TranscoderStarted', {})).resolves.toBeUndefined();
    expect(lines.at(-1)).toContain('TelemetrySendFailed');
  });

  it('console-only (no POST) without a connection string', async () => {
    let posted = false;
    const t = createTelemetry({
      roleName: 'r',
      logLine: () => undefined,
      fetchImpl: async () => {
        posted = true;
        return { ok: true, status: 200 };
      },
    });
    await t.event('TranscoderStarted', {});
    expect(posted).toBe(false);
  });
});
