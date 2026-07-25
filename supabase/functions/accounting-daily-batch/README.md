# accounting-daily-batch

Creates one sales batch per business per calendar day from POS sales, booking payments, and refunds (pos_refunds + booking_payments refunded).

## Trigger

- **Manual (Queue):** Users can click "Create sales batches" in Accounting → Queue (calls with `business_id` and `backfill_days: 90`).
- **Scheduled:** Run once per day so new batches appear automatically.

## Scheduling (cron)

Run this function **once per day** after the latest `batch_run_time_local` across your businesses (e.g. 04:00 UTC so 2:00 AM Eastern is past).

### Option 1: External cron (recommended)

Use [cron-job.org](https://cron-job.org), GitHub Actions, or a server cron to call:

```http
POST https://<your-project-ref>.supabase.co/functions/v1/accounting-daily-batch
Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
Content-Type: application/json

{}
```

Or with a specific business and backfill:

```json
{ "business_id": "<uuid>", "backfill_days": 1 }
```

- Use **service role key** for the global cron run.
- Do **not** use the anon key for this endpoint.
- Do not expose the service role key in client code; keep it in the cron runner’s secrets.

### Option 2: Supabase scheduled invocations

If your plan supports it, configure a daily schedule in the Supabase Dashboard (Functions → accounting-daily-batch → Schedule) or via the API. Pass the same headers as above.

### Option 3: pg_cron (self-hosted / if enabled)

Only if pg_cron is enabled on your Supabase project, you can schedule a `pg_net` or `http` call to the function URL. Prefer Option 1 unless you already use pg_cron.

## Body parameters

| Parameter      | Description |
|----------------|-------------|
| `business_id`  | Optional. Run only for this business (requires auth if set). |
| `batch_date`   | Optional. Create batch for this date (YYYY-MM-DD) instead of "yesterday". |
| `backfill_days`| Optional. Create batches for this many days (default 1). Max 365. |

Without `business_id`, the function runs for **all** businesses that have accounting config with `erpnext_api_url` set.
