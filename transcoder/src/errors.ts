// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

/** HTTP-ish status of an Azure SDK (RestError-shaped) error, if any. */
export function statusOf(err: unknown): number | undefined {
  const s = (err as { statusCode?: unknown })?.statusCode;
  return typeof s === 'number' ? s : undefined;
}

/**
 * A PII-safe code for an error: `<status>` plus the service's error code when present (e.g.
 * `403:AuthorizationPermissionMismatch` — exactly what a D25 MI/RBAC diagnosis needs). NEVER the
 * error message: Azure SDK messages can embed the request URL, and blob URLs embed the song's
 * title slug (D8/D32).
 */
export function errorCode(err: unknown): string {
  const status = statusOf(err);
  const code = (err as { code?: unknown })?.code;
  const safeCode = typeof code === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(code) ? code : undefined;
  if (status !== undefined) return safeCode ? `${status}:${safeCode}` : String(status);
  if (safeCode) return safeCode;
  return 'error';
}
