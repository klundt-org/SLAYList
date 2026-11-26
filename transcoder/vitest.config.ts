// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

// Scoped to `src` so Vitest 4 never discovers anything under `dist` (same reason as api/).
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
  },
});
