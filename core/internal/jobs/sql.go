package jobs

// These query templates document the ownership and lease semantics intended for
// the second migration phase. They are kept beside the supervisor so local work
// can replace the legacy workers without changing the database contract again.
const ClaimMailboxSyncJobsSQL = `
WITH claimable AS (
    SELECT id
    FROM mailbox_sync_jobs
    WHERE status IN ('PENDING', 'RETRY')
      AND next_attempt_at <= now()
      AND (locked_until IS NULL OR locked_until < now())
    ORDER BY priority DESC, next_attempt_at ASC, id ASC
    LIMIT $1
    FOR UPDATE SKIP LOCKED
)
UPDATE mailbox_sync_jobs AS job
SET status = 'RUNNING',
    locked_by = $2,
    locked_until = now() + $3::interval,
    updated_at = now()
FROM claimable
WHERE job.id = claimable.id
RETURNING job.*;
`
