# Backups & recovery

The system of record has two parts, and both must be backed up together:

1. **PostgreSQL**: all business data, the audit log and manifest version snapshots.
2. **Object storage**: photos, signatures, generated PDFs and uploaded documents. Database rows
   reference files by storage key.

## Recommended policy

| What | How | Retention |
|---|---|---|
| Database | Managed point-in-time recovery (Neon, Supabase, RDS, Cloud SQL) | ≥ 7 days PITR |
| Database | Nightly logical dump to separate storage or a separate account | 35 daily, 12 monthly |
| Files | Bucket **versioning** on, plus a lifecycle rule to expire non-current versions after 90 days | Current versions kept indefinitely |
| Files | Cross-region or cross-account replication (optional) | Same as source |

Manifests and disposal records are compliance records. Set retention to at least what your
permits and local authority require. **Settings → Documents** records the policy (default 5
years). The app never deletes documents automatically; archiving is a soft delete.

## Nightly dump example

```bash
pg_dump --format=custom --no-owner --no-privileges "$DIRECT_DATABASE_URL" \
  > sewersquad-$(date -u +%Y%m%dT%H%MZ).dump
# upload to a bucket/account that the app's credentials cannot write to
```

## Restore

1. Restore the database into a **new** database:
   ```bash
   createdb sewersquad_restore
   pg_restore --no-owner --no-privileges -d sewersquad_restore sewersquad-<stamp>.dump
   ```
   The dump includes the immutability triggers, and `pg_restore` loads data before it creates
   them, so they do not block the restore.
2. Restore the bucket to the same point in time, using object versions or the replica.
3. Point `DATABASE_URL` at the restored database, deploy, and check `/api/health`.
4. Spot-check a recent manifest PDF, an invoice and a photo from the portal.
5. Stripe stays the source of truth for payments. After a restore to an earlier point, compare
   recent payments with the Stripe dashboard. Re-send events from after the restore point with
   `stripe events resend <evt_id>` (or from the dashboard). Processing is idempotent, so re-sending
   an event that was already applied is harmless.

Test a restore **at least quarterly** and record the result.

## Local-storage deployments

With `STORAGE_DRIVER=local`, back up `LOCAL_STORAGE_DIR` with the same schedule as the database
(for example `restic` or `borg` snapshots taken right after the dump).
