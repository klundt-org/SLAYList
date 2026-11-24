# Copyright (c) 2026 Ray Klundt
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Sprint 6.0 PLACEHOLDER image. Its only job is to prove the build -> push (GHCR) ->
# deploy (dev Container App revision) pipeline works before Sprint 6.1 drops in the real
# ffmpeg transcode logic and Sprint 6.2 bakes ffmpeg into the image. Deliberately trivial:
# no app code, no ffmpeg yet, no network ingress. It logs a startup line (so the revision's
# console logs prove the image was pulled and ran) and then stays alive, so the Container
# App revision provisions healthy rather than looking like a crash-loop.
#
# Pinned by digest-free tag is fine here because this is a throwaway placeholder; the real
# image (6.2) pins a specific ffmpeg base per D27 (libfdk_aac forbidden) and records the
# version in docs/VERSIONS.md.

FROM alpine:3.21

# Non-root: nothing here needs root, and the real transcoder won't either.
RUN addgroup -S slay && adduser -S slay -G slay
USER slay

# Log a startup line, then block forever. Under scale-to-zero (minReplicas=0, D4) with no
# ingress/queue trigger there is nothing to activate a replica at rest, so the 6.0 proof is the
# revision reaching `Provisioned` on the pushed digest (asserted in the deploy workflow), not a
# console log. The long sleep still matters: IF a replica ever starts (minReplicas raised, or
# Epic 7's queue trigger), the process stays up instead of exiting 0 and looking like a crash.
CMD ["sh", "-c", "echo 'slaylist-transcoder placeholder: image pulled and running (Sprint 6.0)'; while true; do sleep 3600; done"]
