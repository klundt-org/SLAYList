// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared storage connection-string resolver (D25). The SWA managed-functions API authenticates to
 * Storage with a connection string from app settings — not a key in code, not Managed Identity
 * (platform-forced for managed functions). Locally the same var points at Azurite.
 */

/** The storage connection string from app settings, or throw a clear error if unset. */
export function storageConnectionString(): string {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING ?? process.env.AzureWebJobsStorage;
  if (!conn) {
    throw new Error('No storage connection string: set AZURE_STORAGE_CONNECTION_STRING (or AzureWebJobsStorage).');
  }
  return conn;
}
