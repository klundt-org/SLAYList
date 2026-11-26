# Copyright (c) 2026 Ray Klundt
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# SLAYList transcoder image (Sprint 6.1, folding 6.2/6.3): Node 22 + Debian's ffmpeg + the
# esbuild-bundled transcoder (dist/index.mjs — shared + Azure SDKs inlined, so no node_modules,
# no pnpm, no workspace in the image).
#
# BUILD: the bundle is produced BEFORE `docker build` (the context is ./transcoder, which can't see
# ../shared), by `pnpm --filter @slaylist/transcoder build` — the CI workflow does this. Locally:
#   pnpm install && pnpm --filter @slaylist/transcoder build && docker build transcoder
#
# BASE: node:22-bookworm-slim pinned by DIGEST (reproducible; bump deliberately and re-record in
# docs/VERSIONS.md). ffmpeg comes from Debian bookworm `main`, which is built WITHOUT
# --enable-nonfree — so libfdk_aac cannot be present (D27). The guard step below proves it on
# every build rather than assuming it.

FROM node:22-bookworm-slim@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb

LABEL org.opencontainers.image.source="https://github.com/klundt-org/slayList" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.description="SLAYList transcoder (ffmpeg, built-in AAC)"

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

# D27 codec verification — FAILS THE BUILD unless: built-in `aac` present, `libopus` present,
# `libfdk_aac` absent. Also prints the version + encoder lines into the build log (recorded in
# docs/VERSIONS.md) so the verification is auditable per image.
RUN set -e; \
    ffmpeg -hide_banner -version | head -n 1; \
    ffmpeg -hide_banner -encoders 2>/dev/null | grep -E '(opus|aac)' || true; \
    ffmpeg -hide_banner -encoders 2>/dev/null | grep -qE '^ A[^ ]* aac ' || { echo 'D27: built-in aac encoder missing'; exit 1; }; \
    ffmpeg -hide_banner -encoders 2>/dev/null | grep -qE '^ A[^ ]* libopus ' || { echo 'D27: libopus encoder missing'; exit 1; }; \
    if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q 'libfdk_aac'; then echo 'D27: libfdk_aac present (nonfree) - forbidden'; exit 1; fi

WORKDIR /app
COPY dist/ ./

# Non-root: the base image's unprivileged `node` user. Scratch files go to /tmp (ephemeral).
USER node
ENV NODE_ENV=production

CMD ["node", "index.mjs"]
