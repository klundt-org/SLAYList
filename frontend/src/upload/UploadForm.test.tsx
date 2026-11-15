// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@azure/msal-react', () => ({
  useMsal: () => ({
    instance: { acquireTokenSilent: vi.fn().mockResolvedValue({ accessToken: 'test-token' }) },
    accounts: [{ homeAccountId: 'a1', username: 'uploader@example.com' }],
  }),
}));

const { UploadForm } = await import('./UploadForm.js');

function stubFetch(result: { ok: boolean; status?: number; body?: unknown }) {
  const mock = vi.fn((_url: string, _init: RequestInit) =>
    Promise.resolve({
      ok: result.ok,
      status: result.status ?? (result.ok ? 201 : 400),
      json: async () => result.body ?? {},
    }),
  );
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Fill the form and submit it directly (fireEvent.submit bypasses native required-validation,
 *  which happy-dom would otherwise fail on a programmatically-set file input; the disabled-button
 *  logic is the real gate and is covered by its own test). */
function fillAndSubmit() {
  fireEvent.change(screen.getByPlaceholderText(/song title/i), { target: { value: 'My Song' } });
  const fileInput = screen.getByLabelText(/file/i) as HTMLInputElement;
  const file = new File([new Uint8Array([0x49, 0x44, 0x33])], 'My Song.mp3', { type: 'audio/mpeg' });
  Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
  fireEvent.change(fileInput);
  fireEvent.submit(fileInput.closest('form')!);
}

describe('UploadForm (Sprint 5.2)', () => {
  it('POSTs multipart to /api/upload with the SWA-safe custom header, then calls onUploaded', async () => {
    const fetchMock = stubFetch({ ok: true, body: { id: 'song_x', state: 'processing' } });
    const onUploaded = vi.fn();
    render(<UploadForm onUploaded={onUploaded} />);
    fillAndSubmit();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/api/upload');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    const headers = init.headers as Record<string, string>;
    expect(headers['X-SLAYLIST-Authorization']).toMatch(/^Bearer /);
    expect(headers['Authorization']).toBeUndefined();
    const form = init.body as FormData;
    expect(form.get('title')).toBe('My Song');
    expect(form.get('ownerDisplayName')).toBe('uploader@example.com');

    await waitFor(() => expect(onUploaded).toHaveBeenCalled());
    expect(screen.getByText(/processing/i)).toBeTruthy();
  });

  it('shows the server error message on a rejected upload', async () => {
    stubFetch({ ok: false, status: 400, body: { error: 'File is too large. Maximum is 50 MB.' } });
    render(<UploadForm onUploaded={vi.fn()} />);
    fillAndSubmit();
    await waitFor(() => expect(screen.getByText(/too large.*50 MB/i)).toBeTruthy());
  });

  it('keeps the button disabled until a title and file are provided', () => {
    stubFetch({ ok: true });
    render(<UploadForm onUploaded={vi.fn()} />);
    expect((screen.getByRole('button', { name: /upload/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
