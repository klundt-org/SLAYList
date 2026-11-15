# Restoring the Songs table from a backup (D33 / Sprint 4.4)

The dev `Songs` metadata table is exported nightly to JSON Lines backups in the `table-backups`
blob container (same storage account). Table Storage has **no soft-delete and no versioning**, so if
records are deleted or corrupted, this backup is the only recovery path. (Audio is **not** involved —
it lives in Blob Storage, which has its own soft-delete + versioning.)

This is a runbook for a future operator who needs to restore — a checklist, not an improvisation.

## What a backup looks like

- One blob per day in `table-backups`, named `songs-YYYY-MM-DD.jsonl`.
- JSON Lines: one full `Song` record per line (including `deactivated` rows — a backup is a full
  export). Human-readable; you can open it and inspect.
- Retained 30 days, then auto-pruned by a lifecycle rule on the container (see Bicep). Older than 30
  days → gone, so restore from a *recent* backup.

## Restore procedure

Prerequisite: the storage connection string for the target environment (dev: in the gitignored
`infra/dev-resources.md`; it is also the `AZURE_STORAGE_CONNECTION_STRING` GitHub secret). The
restore **writes to the table the connection string points at** — double-check the environment.

1. Pick the backup to restore from. List the container (Azure Portal → storage account → Containers →
   `table-backups`, or `az storage blob list`) and choose the dated file — usually the latest good
   one from *before* the incident.

2. Run the restore script (from the repo root). It upserts every record back into the table —
   idempotent, so it's safe to re-run, and it works whether the rows are missing (deleted) or still
   present (overwrites with the backup's version):

   ```bash
   # restore directly from a backup blob by name:
   AZURE_STORAGE_CONNECTION_STRING="<conn>" pnpm --filter @slaylist/api run restore -- --blob songs-2026-11-15.jsonl

   # or, if you've downloaded the backup file locally:
   AZURE_STORAGE_CONNECTION_STRING="<conn>" pnpm --filter @slaylist/api run restore -- ./songs-2026-11-15.jsonl
   ```

   (The script imports the compiled repo, so run `pnpm --filter @slaylist/api run build` first if
   `api/dist` is stale.)

3. Verify: the script prints `Restored N record(s)`. Spot-check in the app (sign in → the song list)
   or query the table.

> **Note on partial restores.** Restore is an *upsert of everything in the backup file*. It does not
> delete rows that exist now but weren't in the backup. If you need to roll back to exactly a prior
> state (including removing rows added since), that's a manual step — restore the backup, then delete
> the extra rows individually.

## Taking a backup manually (off-schedule)

```bash
AZURE_STORAGE_CONNECTION_STRING="<conn>" pnpm --filter @slaylist/api run backup
```

Writes `songs-<today>.jsonl` to `table-backups`.

## Turning the nightly backup OFF

The nightly job is **only** a GitHub Actions workflow (`.github/workflows/backup-dev.yml`) — there is
**no standing Azure resource** for it. To stop it, pick any one:

- **GitHub repo → Actions tab → "backup-dev" → ⋯ → Disable workflow.** One toggle. (Re-enable the
  same way.)
- Delete `.github/workflows/backup-dev.yml` and push.
- Delete / archive the repo.

Nothing in Azure keeps running or billing afterward: the backups are tiny blobs (KB–MB), and the
30-day prune rule is free. If you also want to stop paying for the already-stored backups, delete the
`table-backups` blobs (they are *only* metadata backups — deleting them is safe; it does **not** touch
`raw-uploads` or `finished`).

## Cost

Negligible — a few KB to a few MB per day, 30 files retained; well under $1/month at family scale.
