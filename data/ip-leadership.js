/* Interview problems at senior, team-lead and CTO level. Same format as data/dsl.js. */

/* ───────── Senior: production problems ───────── */
L({
  id: "zero-downtime-migrations",
  title: "Zero-Downtime Schema Changes",
  sub: "Rename a column on a live table without breaking the pods that still run the old code.",
  level: "Senior", min: 9,
  learn: ["Why a rolling deploy runs old and new code at once", "Expand → migrate → contract", "Backfilling and indexing big tables without locking them"],
  deep: [
    "During a rolling deploy, old and new app versions share one database for minutes. Every schema change must work for both versions at the same time.",
    "Expand/contract (parallel change): add the new column as nullable, write to both, backfill in small batches, switch reads, and only drop the old column in a later release.",
    "On PostgreSQL, build indexes with <code>CREATE INDEX CONCURRENTLY</code> (Django: <code>AddIndexConcurrently</code> in a migration with <code>atomic = False</code>), and add constraints <code>NOT VALID</code> before validating them separately.",
  ],
  iv: ["Say how many deploys it takes (usually three) and what each one ships.", "Mention <code>lock_timeout</code>: an <code>ALTER TABLE</code> waiting for its lock makes every later query queue behind it, so let it fail fast and retry."],
  refs: [["Martin Fowler: Parallel Change", "https://martinfowler.com/bliki/ParallelChange.html"], ["Django: PostgreSQL migration operations", "https://docs.djangoproject.com/en/stable/ref/contrib/postgres/operations/"], ["PostgreSQL: CREATE INDEX (CONCURRENTLY)", "https://www.postgresql.org/docs/current/sql-createindex.html"]],
  mk: ["Old pods errors", "Deploys"],
  nodes: [N("v1", "app pods (old)", 130, 120, "server"), N("v2", "app pods (new)", 130, 330, "server"), N("db", "orders (40M rows)", 450, 225, "db"), N("job", "backfill job", 700, 225, "worker")],
  steps: [
    { t: "problem", s: "Rename", h: "Rename it in one go", b: "The migration renames <code>customer_name</code> to <code>buyer_name</code>. New pods are fine, but the old pods still serving traffic during the rolling deploy query <code>customer_name</code>, and every one of their requests fails until the rollout ends.", k: "Old and new code run side by side during every deploy.",
      f: "v1>db:fail, v2>db:req, db>v2:res", a: "v1 db", v: "v1 v2 db", m: { "Old pods errors": "100%", Deploys: "1" }, g: { v1: ["column does not exist", "bad", "x"] } },
    { t: "concept", s: "Expand", h: "Add, don't change", b: "Deploy 1 only adds a nullable <code>buyer_name</code> column, which PostgreSQL does without rewriting the table. New code writes both columns and still reads the old one. Old pods simply ignore the new column.", k: "Expand: ship only additive, backwards-compatible changes.",
      f: "v1>db:req, db>v1:res, v2>db:req", a: "db v2", v: "v1 v2 db", m: { "Old pods errors": "0", Deploys: "1 of 3" },
      setup: [["deploy 1", "add nullable column, write both", "hi"], ["deploy 2", "backfill, then read the new column"], ["deploy 3", "drop the old column"]],
      code: `# deploy 1: additive only (no table rewrite, no long lock)
migrations.AddField(
    "order", "buyer_name",
    models.CharField(max_length=200, null=True),
)`, note: "Adding a nullable column without a default is a metadata-only change in PostgreSQL." },
    { t: "concept", s: "Backfill", h: "Backfill in small batches", b: "A background job copies <code>customer_name</code> into <code>buyer_name</code> 5,000 rows at a time, each batch in its own short transaction. No long locks, no giant transaction, and it can stop and resume.", k: "Many small transactions beat one giant UPDATE.",
      f: "job>db:sync, db>job:res", a: "job db", v: "v2 db job", m: { "Old pods errors": "0", Deploys: "2 of 3" }, g: { job: ["5,000 rows per batch", "info", "db"] },
      code: `def backfill(apps, schema_editor):
    Order = apps.get_model("shop", "Order")
    todo = Order.objects.filter(buyer_name__isnull=True,
                                customer_name__isnull=False)
    while True:
        ids = list(todo.values_list("id", flat=True)[:5000])
        if not ids:
            break
        Order.objects.filter(id__in=ids).update(buyer_name=F("customer_name"))`,
      note: "Run it in a migration with atomic = False, or as a management command, so each batch commits on its own." },
    { t: "recap", s: "Contract", h: "Switch reads, then drop", b: "Deploy 2 reads <code>buyer_name</code>. When no running code touches <code>customer_name</code> any more, deploy 3 drops it. Every deploy on the way can be rolled back on its own.", k: "Contract only once nothing reads the old shape.",
      f: "v2>db:req, db>v2:res", a: "v2", v: "v2 db", m: { "Old pods errors": "0", Deploys: "3 of 3" }, g: { db: ["customer_name dropped", "ok", "check"] } },
  ],
});

L({
  id: "rollback-safety",
  title: "Rollback Safety",
  sub: "Roll back a bad release without the old version choking on data the new one wrote.",
  level: "Senior", min: 8,
  learn: ["Why rollbacks fail even when the old code is fine", "Two-phase deploys: teach readers first, then writers", "Treating messages and caches as contracts"],
  deep: [
    "A release that writes a new format (a new enum value, JSON field or message schema) can make the previous version crash after a rollback, because the old code meets data it has never seen.",
    "Ship such changes in two phases: first deploy code that can read both formats but still writes the old one; only when every node runs it, deploy the change that writes the new format.",
    "Queue messages, cache entries and events are part of the contract too: consumers must tolerate fields and values they don't recognise.",
  ],
  iv: ["Ask: if we roll back an hour after release, what data exists that the old code can't read?", "Make rollback a tested pipeline step, not a hope."],
  refs: [["AWS Builders' Library: Ensuring rollback safety during deployments", "https://aws.amazon.com/builders-library/ensuring-rollback-safety-during-deployments/"], ["AWS Builders' Library: Automating safe, hands-off deployments", "https://aws.amazon.com/builders-library/automating-safe-hands-off-deployments/"]],
  mk: ["Status values", "Rollback"],
  nodes: [N("v2", "api (new release)", 140, 120, "server"), N("v1", "api (previous release)", 140, 330, "server"), N("db", "orders DB", 420, 225, "db"), N("q", "order events", 650, 120, "queue"), N("w", "email worker", 650, 330, "worker")],
  steps: [
    { t: "problem", s: "New value", h: "The new release writes a new value", b: "Release 143 adds the status <code>partially_refunded</code> and starts writing it to the database and to order events.", k: "New writes create data the previous version has never seen.",
      f: "v2>db:req, v2>q:req, q>w:req", a: "v2", v: "v2 db q w", m: { "Status values": "5 (new: partially_refunded)", Rollback: "—" }, g: { v2: ["writes partially_refunded", "warn", "alert"] } },
    { t: "problem", s: "Rollback", h: "Rolling back makes it worse", b: "A bug forces a rollback to release 142. It loads an order with <code>partially_refunded</code> and raises <code>ValueError</code>; the old email worker crashes on the same events. The rollback has created a second outage.", k: "A rollback is only safe if the old code can read the new data.",
      f: "v1>db:req, db>v1:fail, q>w:fail", a: "v1 w", v: "v1 db q w", m: { "Status values": "old code knows 4", Rollback: "fails" }, g: { v1: ["ValueError: unknown status", "bad", "x"] } },
    { t: "concept", s: "Phase 1", h: "Teach the readers first", b: "Phase 1 ships code that understands all five statuses (and handles unknown ones without crashing) but still only writes the old four. Verify every node is on it before moving on.", k: "Phase 1: read both formats, write the old one.",
      f: "v1>db:req, db>v1:res, q>w:req", a: "v1 w", v: "v1 db q w", m: { "Status values": "readers know 5", Rollback: "safe" },
      setup: [["phase 1", "read old + new, write old", "hi"], ["check", "100% of nodes on phase 1"], ["phase 2", "start writing the new value"]],
      code: `class Status(models.TextChoices):
    PAID = "paid"
    REFUNDED = "refunded"
    PARTIALLY_REFUNDED = "partially_refunded"  # phase 1: known, not written yet

def parse_status(raw):
    try:
        return Status(raw)
    except ValueError:
        return None  # unknown future value: log and skip, never crash`,
      note: "The same rule applies to event consumers: ignore unknown fields and values." },
    { t: "recap", s: "Phase 2", h: "Then let the writers switch", b: "Phase 2 starts writing <code>partially_refunded</code>. If it has to be rolled back, you land on phase 1, which already reads the new value, so nothing breaks.", k: "Two-phase deploys make every step reversible.",
      f: "v2>db:req, v2>q:req, q>w:req, db>v1:res", a: "v2 v1", m: { "Status values": "5", Rollback: "safe at every step" }, g: { v1: ["reads new values", "ok", "check"] } },
  ],
});

L({
  id: "noisy-neighbour",
  title: "Noisy Neighbour (Multi-tenant)",
  sub: "One tenant's bulk import makes the app slow for every other customer.",
  level: "Senior", min: 8,
  learn: ["How shared queues and pools let one tenant starve the rest", "Per-tenant quotas and fair queuing", "Isolating heavy tenants: separate queues, pools or shards"],
  deep: [
    "In a shared multi-tenant system, one tenant's spike (a 2M-row import, a runaway integration) uses up shared workers, database connections and queue capacity.",
    "Apply per-tenant limits at the edge (rate and concurrency caps) and fair scheduling inside (separate queues or round-robin across tenants instead of one FIFO).",
    "Move consistently large tenants to their own queue, worker pool or database shard. Shuffle sharding limits how many tenants share the same failure.",
  ],
  iv: ["Measure per tenant: p99 and error rate by <code>tenant_id</code>, not only global averages.", "Decide what happens over quota: 429 with <code>Retry-After</code>, delayed processing, or a higher plan."],
  refs: [["AWS Builders' Library: Workload isolation using shuffle-sharding", "https://aws.amazon.com/builders-library/workload-isolation-using-shuffle-sharding/"], ["AWS Well-Architected SaaS Lens", "https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/saas-lens.html"], ["Celery: routing tasks", "https://docs.celeryq.dev/en/stable/userguide/routing.html"]],
  mk: ["Tenant A wait", "Others p99"],
  nodes: [N("ta", "tenant A (bulk import)", 110, 120, "user"), N("tb", "tenants B–Z", 110, 340, "user"), N("api", "API", 330, 225, "lb"), N("q", "shared queue", 540, 225, "queue"), N("qa", "bulk queue", 540, 375, "queue"), N("w", "workers", 740, 225, "worker")],
  steps: [
    { t: "problem", s: "Starved", h: "One tenant fills the shared queue", b: "Tenant A starts a 2M-row import. Its jobs fill the shared queue, so jobs from every other tenant wait behind them and their pages time out.", k: "Shared FIFO + one heavy tenant = everyone waits.",
      f: "ta>api:req, api>q:req, ta>api:req, api>q:req, q>w:req, tb>api:req, api>tb:fail", a: "ta q", v: "ta tb api q w", m: { "Tenant A wait": "40 min", "Others p99": "38 s" }, g: { q: ["2M jobs from tenant A", "bad", "alert"] } },
    { t: "concept", s: "Quotas", h: "Per-tenant quotas at the edge", b: "Cap each tenant's request rate and concurrent jobs. Over the cap, the API answers <code>429</code> with <code>Retry-After</code> instead of accepting unlimited work.", k: "Limit per tenant, not just globally.",
      f: "ta>api:req, api>ta:fail, tb>api:req, api>q:req, q>w:req", a: "api", v: "ta tb api q w", m: { "Tenant A wait": "throttled", "Others p99": "1.2 s" }, g: { api: ["tenant A capped: 50 req/s", "warn", "shield"] },
      code: `# fixed-window counter per tenant in Redis (sketch)
key = f"rl:{tenant_id}:{int(time.time())}"
count = redis.incr(key)
redis.expire(key, 2)
if count > TENANT_LIMITS.get(tenant_id, 50):
    return JsonResponse({"error": "rate limited"}, status=429,
                        headers={"Retry-After": "1"})`,
      note: "A token bucket smooths bursts better than a fixed window; the idea (limit per tenant) is the same." },
    { t: "concept", s: "Fair queues", h: "Give bulk work its own lane", b: "Bulk imports go to a separate queue with its own small worker pool, so interactive jobs for everyone else never wait behind them.", k: "Separate queues stop one workload from starving another.",
      f: "ta>api:req, api>qa:req, qa>w:req, tb>api:req, api>q:req, q>w:req", a: "qa q w", m: { "Tenant A wait": "12 min (batch)", "Others p99": "0.9 s" },
      code: `# send bulk work to its own queue
import_rows.apply_async(args=[batch_id], queue="bulk")

# run separate worker pools so "bulk" can't starve "default":
#   celery -A app worker -Q default -c 8
#   celery -A app worker -Q bulk -c 2`,
      note: "Celery. The same idea works with any broker: one queue per workload class." },
    { t: "recap", s: "Isolate", h: "Isolate the giants, watch per tenant", b: "Tenants that are always large get dedicated capacity (pool, queue or shard). Dashboards and alerts break latency and errors down by tenant, so the next noisy neighbour shows up before customers report it.", k: "Isolation plus per-tenant visibility.",
      f: "ta>api:req, api>qa:req, qa>w:req, tb>api:req, api>q:req, q>w:req", a: "ta tb", m: { "Tenant A wait": "isolated", "Others p99": "0.9 s" }, g: { ta: ["dedicated pool", "ok", "check"], tb: ["shared pool, p99 0.9 s", "ok", "check"] } },
  ],
});

L({
  id: "tail-latency",
  title: "Tail Latency at Fan-out",
  sub: "Every backend is fast on average, yet the page is slow: fan-out turns rare slowness into common slowness.",
  level: "Senior", min: 8,
  learn: ["Why p99 matters more than the average", "How fan-out amplifies tail latency", "Hedged requests, deadlines and partial results"],
  deep: [
    "If one call has a 1% chance of taking over 1 s, a request that waits for 100 such calls is slower than 1 s about 63% of the time (1 − 0.99¹⁰⁰).",
    "Find the tail with distributed traces and per-dependency p99, not averages. Usual causes: GC pauses, cold caches, noisy neighbours and queueing at high utilisation.",
    "Mitigate with per-call deadlines, partial results, hedged requests (send a duplicate to a replica after the p95 delay) and less fan-out through batching.",
  ],
  iv: ["Quote the 1 − 0.99ⁿ maths; it shows you understand why tails dominate at scale.", "Hedging adds load: only hedge after p95, so roughly 5% extra requests."],
  refs: [["Dean & Barroso: The Tail at Scale (CACM 2013)", "https://research.google/pubs/pub40801/"], ["Google SRE: Monitoring distributed systems", "https://sre.google/sre-book/monitoring-distributed-systems/"]],
  mk: ["p50", "p99", "Fan-out"],
  nodes: [N("client", "client", 100, 225, "client"), N("agg", "aggregator", 330, 225, "server"), N("s1", "shard 1", 580, 90, "db"), N("s2", "shard 2", 600, 225, "db"), N("s3", "shard 3 (slow)", 580, 360, "db"), N("r3", "shard 3 replica", 770, 330, "db")],
  steps: [
    { t: "problem", s: "Fan-out", h: "One slow shard holds up the page", b: "The aggregator queries 100 shards and waits for all of them. Shard 3 hits a 1-second GC pause, so the whole page takes over a second even though 99 shards answered in 40 ms.", k: "A fan-out request is as slow as its slowest call.",
      f: "client>agg:req, agg>s1:req, agg>s2:req, agg>s3:req, s1>agg:res, s2>agg:res", a: "s3", v: "client agg s1 s2 s3", m: { p50: "40 ms", p99: "1.2 s", "Fan-out": "100 shards" }, g: { s3: ["GC pause · 1 s", "bad", "hourglass"] } },
    { t: "concept", s: "Maths", h: "Rare per call, common per page", b: "A 1% chance per call becomes a 63% chance per page when the page needs 100 calls. That's why services publish p99 targets, and why averages hide the problem.", k: "Fan-out turns the p99 of a call into the median of a page.",
      f: "client>agg:req, agg>s1:req, agg>s2:req, agg>s3:req, s1>agg:res, s2>agg:res, s3>agg:res", a: "agg", v: "client agg s1 s2 s3", g: { agg: ["waits for the slowest", "warn", "timer"] }, m: { p50: "40 ms", p99: "1.2 s", "Fan-out": "100 shards" },
      setup: [["one call > 1 s", "1%"], ["calls per page", "100"], ["page > 1 s", "1 − 0.99¹⁰⁰ ≈ 63%", "bad"]] },
    { t: "concept", s: "Hedge", h: "Hedge after the p95", b: "If a shard hasn't answered by its p95 (80 ms), send the same query to a replica and take whichever answers first, cancelling the other.", k: "Hedging trims the tail for about 5% extra load.",
      f: "agg>s3:req, agg>r3:req, r3>agg:res, agg>client:res", a: "r3 agg", m: { p50: "40 ms", p99: "120 ms", "Fan-out": "100 (+5% hedges)" }, g: { r3: ["hedge after p95 = 80 ms", "ok", "repeat"] },
      code: `async def hedged(fetch, primary, replica, hedge_after=0.08):
    first = asyncio.create_task(fetch(primary))
    done, _ = await asyncio.wait({first}, timeout=hedge_after)
    if done:
        return first.result()
    second = asyncio.create_task(fetch(replica))
    done, pending = await asyncio.wait({first, second},
                                       return_when=asyncio.FIRST_COMPLETED)
    for task in pending:
        task.cancel()
    return done.pop().result()`, note: "Only hedge idempotent reads." },
    { t: "recap", s: "Deadline", h: "Deadlines and partial results", b: "Give the whole page a deadline (200 ms). Shards that miss it are skipped and the page shows results from the rest, flagged as partial. Batch small calls to cut the fan-out itself.", k: "Bound the wait; degrade gracefully.",
      f: "agg>s1:req, agg>s2:req, s1>agg:res, s2>agg:res, agg>client:res", a: "client agg", m: { p50: "40 ms", p99: "200 ms (deadline)", "Fan-out": "100" }, g: { client: ["98 of 100 shards answered", "ok", "check"] } },
  ],
});

/* ───────── Team lead: delivery & incidents ───────── */
L({
  id: "incident-response",
  title: "Leading an Incident",
  sub: "Checkout is failing at 2 a.m. You're the lead: who does what, and in what order?",
  level: "Lead", min: 9,
  learn: ["Mitigate first, find the root cause later", "Incident roles: commander, operations, communications", "Blameless postmortems that change something"],
  deep: [
    "The incident commander coordinates and decides; they don't debug. Operations people change production; a communications lead updates stakeholders and the status page on a fixed cadence.",
    "Stop the bleeding first: roll back the last change, flip the feature flag, fail over or shed load. Root-cause analysis waits until users are safe.",
    "Afterwards, write a blameless postmortem: timeline, impact, contributing factors, and action items with owners and due dates, tracked to completion.",
  ],
  iv: ["Say what happens in the first five minutes: declare, assign roles, open one channel, check recent changes.", "Track time to detect and time to recover, and whether postmortem actions actually get done."],
  refs: [["Google SRE: Managing incidents", "https://sre.google/sre-book/managing-incidents/"], ["Google SRE: Postmortem culture", "https://sre.google/sre-book/postmortem-culture/"], ["PagerDuty incident response guide", "https://response.pagerduty.com/"]],
  mk: ["Error rate", "Since alert"],
  nodes: [N("users", "customers", 90, 340, "user"), N("svc", "checkout", 310, 340, "server"), N("mon", "monitoring", 310, 90, "ext"), N("ic", "commander", 560, 90, "client"), N("ops", "on-call", 560, 340, "client"), N("page", "status page", 790, 215, "edge")],
  steps: [
    { t: "problem", s: "Alert", h: "The pager goes off", b: "After the 01:40 deploy, 38% of checkouts fail. Monitoring pages the on-call engineer.", k: "Detection starts the clock.",
      f: "users>svc:req, svc>users:fail, svc>mon:sync, mon>ops:fail", a: "svc mon", v: "users svc mon ops", m: { "Error rate": "38%", "Since alert": "0 min" }, g: { svc: ["5xx 38%", "bad", "alert"] } },
    { t: "concept", s: "Roles", h: "Declare and assign roles", b: "The on-call engineer declares a SEV-1. You take incident command, assign an operations lead and someone on comms, and open one channel for everything.", k: "One commander, clear roles, one channel.",
      f: "ops>ic:req, ic>ops:req, ic>page:sync", a: "ic", m: { "Error rate": "38%", "Since alert": "5 min" }, g: { ic: ["SEV-1 declared", "warn", "shield"], page: ["investigating", "warn", "alert"] },
      setup: [["commander", "coordinates and decides, doesn't debug", "hi"], ["operations", "makes production changes"], ["comms", "status page every 30 min"], ["scribe", "keeps the timeline in the channel"]] },
    { t: "concept", s: "Mitigate", h: "Stop the bleeding", b: "The last change is the prime suspect, so roll it back before debugging. Errors drop within minutes; the root cause can wait for daylight.", k: "Mitigate first, investigate second.",
      f: "ops>svc:sync, users>svc:req, svc>users:res", a: "ops svc", m: { "Error rate": "0.4%", "Since alert": "18 min" }, g: { svc: ["rolled back to v142", "ok", "check"] },
      code: `# undo the last deploy, then watch it finish
kubectl rollout undo deployment/checkout
kubectl rollout status deployment/checkout`, note: "Feature flag off, failover or load shedding are other ways to stop the bleeding." },
    { t: "recap", s: "Postmortem", h: "A blameless postmortem", b: "Within a few days: timeline, impact, what made it possible, and action items with owners and dates. Blame-free, so people share what really happened.", k: "Postmortems are worth their action items.",
      f: "ic>page:sync, ops>ic:res", a: "ic", m: { "Error rate": "0.2%", "Since alert": "resolved in 25 min" }, g: { page: ["Resolved", "ok", "check"] },
      setup: [["impact", "38% of checkouts failed for 18 min"], ["trigger", "v143 changed the DB pool size"], ["action", "validate config in CI · owner A · 5 Dec", "hi"], ["action", "canary config changes · owner B · 12 Dec", "hi"]] },
  ],
});

L({
  id: "progressive-delivery",
  title: "Canaries & Feature Flags",
  sub: "Ship to 1% of users first and let metrics, not hope, decide whether to continue.",
  level: "Lead", min: 8,
  learn: ["Canary releases with automatic rollback", "Feature flags: separate deploy from release", "Choosing guardrail metrics"],
  deep: [
    "A canary sends a small slice of traffic to the new version and compares its error rate and latency with the stable fleet before widening the rollout.",
    "Feature flags let you deploy code switched off, turn it on per user or percentage, and turn it off again in seconds without a deploy.",
    "Flags are debt: give each one an owner and an expiry date, and delete it after full rollout.",
  ],
  iv: ["Name the guardrails: 5xx rate, p99 latency and one business metric such as checkout conversion.", "Automate the decision: promote or roll back from metrics, with a bake time at each stage."],
  refs: [["Martin Fowler: Canary Release", "https://martinfowler.com/bliki/CanaryRelease.html"], ["Pete Hodgson: Feature Toggles", "https://martinfowler.com/articles/feature-toggles.html"], ["AWS Builders' Library: Automating safe, hands-off deployments", "https://aws.amazon.com/builders-library/automating-safe-hands-off-deployments/"]],
  mk: ["Canary traffic", "Canary 5xx", "Stable 5xx"],
  nodes: [N("users", "users", 100, 225, "user"), N("lb", "router", 320, 225, "lb"), N("stable", "stable v41", 560, 110, "server"), N("canary", "canary v42", 560, 340, "server"), N("mon", "metrics", 770, 225, "ext")],
  steps: [
    { t: "concept", s: "1%", h: "Send 1% to the canary", b: "The router sends 1% of requests to v42. Both versions report error rate and latency to the same metrics system, labelled by version.", k: "Small blast radius, real traffic.",
      f: "users>lb:req, lb>stable:req, lb>canary:req, stable>mon:sync, canary>mon:sync", a: "canary lb", m: { "Canary traffic": "1%", "Canary 5xx": "0.1%", "Stable 5xx": "0.1%" }, g: { canary: ["1% of traffic", "info", "activity"] } },
    { t: "problem", s: "Regression", h: "The canary misbehaves", b: "v42's error rate climbs to 4.2% while stable stays at 0.1%. The guardrail is 1%.", k: "Compare canary against stable, not against zero.",
      f: "lb>canary:req, canary>lb:fail, canary>mon:fail", a: "canary mon", m: { "Canary traffic": "1%", "Canary 5xx": "4.2%", "Stable 5xx": "0.1%" }, g: { mon: ["canary 5xx 4.2% > 1% guardrail", "bad", "alert"] } },
    { t: "concept", s: "Rollback", h: "Roll back automatically", b: "The pipeline sees the breach and removes the canary without waiting for a human. Only 1% of users saw errors, for three minutes.", k: "Let metrics make the rollback decision.",
      f: "users>lb:req, lb>stable:req, stable>lb:res, lb>users:res", a: "lb stable", v: "users lb stable mon", m: { "Canary traffic": "0%", "Canary 5xx": "—", "Stable 5xx": "0.1%" }, g: { lb: ["auto-rollback in 3 min", "ok", "check"] } },
    { t: "recap", s: "Flags", h: "Release behind a flag", b: "The fixed version is deployed with the feature switched off, then enabled for staff, then 10%, then everyone. Turning it off needs a click, not a deploy.", k: "Deploy is technical; release is a business decision.",
      f: "users>lb:req, lb>stable:req, stable>lb:res", a: "stable", v: "users lb stable mon",
      setup: [["stages", "1% → 10% → 50% → 100%"], ["bake time", "30 min per stage"], ["guardrails", "5xx, p99, conversion", "hi"], ["flag", "owner + expiry date"]],
      code: `# deploy switched off, release by flag (django-waffle)
from waffle import flag_is_active

def checkout(request):
    if flag_is_active(request, "new_checkout"):
        return new_checkout(request)
    return old_checkout(request)`, note: "Remove the flag and the old path once the rollout is complete." },
  ],
});

L({
  id: "error-budgets",
  title: "SLOs & Error Budgets",
  sub: "Product wants features, operations wants stability. An error budget turns the argument into a number.",
  level: "Lead", min: 7,
  learn: ["SLIs, SLOs and error budgets", "Burn-rate alerts", "What happens when the budget runs out"],
  deep: [
    "An SLO such as 99.9% of requests succeeding over 30 days allows 0.1% failures, about 43 minutes of full downtime a month. That allowance is the error budget.",
    "Burn-rate alerts page when the budget is being spent much faster than planned (for example 2% of the monthly budget in one hour), which catches real incidents without paging on noise.",
    "An agreed policy says what happens when the budget is gone: pause risky launches and spend engineering time on reliability until it recovers.",
  ],
  iv: ["Agree the policy with product before you need it.", "100% is the wrong target: users can't tell 99.99% from 100%, and the cost of the extra nines is huge."],
  refs: [["Google SRE: Service level objectives", "https://sre.google/sre-book/service-level-objectives/"], ["Google SRE workbook: Error budget policy", "https://sre.google/workbook/error-budget-policy/"], ["Google SRE workbook: Alerting on SLOs", "https://sre.google/workbook/alerting-on-slos/"]],
  mk: ["SLO", "Budget left", "Burn rate"],
  nodes: [N("users", "users", 100, 225, "user"), N("svc", "API", 340, 225, "server"), N("slo", "SLO monitor", 580, 110, "ext"), N("team", "team + product", 580, 340, "client")],
  steps: [
    { t: "concept", s: "SLO", h: "Define good, then the budget", b: "The SLI is the share of good requests. The SLO says 99.9% over 30 days. Whatever is left (0.1%) is the budget the team may spend on risk.", k: "The error budget is permission to take risks.",
      f: "users>svc:req, svc>users:res, svc>slo:sync", a: "slo", m: { SLO: "99.9% / 30 days", "Budget left": "43 min", "Burn rate": "1×" },
      setup: [["SLI", "good requests / all requests"], ["SLO", "99.9% over 30 days", "hi"], ["budget", "0.1% ≈ 43 min of downtime"]] },
    { t: "problem", s: "Burn", h: "A bad deploy burns the budget", b: "Errors spike. The monitor sees the budget burning at 14× the sustainable rate and pages the team.", k: "Alert on burn rate, not on every error.",
      f: "users>svc:req, svc>users:fail, svc>slo:fail, slo>team:fail", a: "slo team", m: { SLO: "99.9% / 30 days", "Budget left": "12 min", "Burn rate": "14×" }, g: { slo: ["2% of budget in 1 h → page", "bad", "alert"] } },
    { t: "concept", s: "Policy", h: "The policy decides, not a debate", b: "The budget is spent. As agreed in advance, risky launches pause and the next sprint goes to reliability work.", k: "Agree the consequences before the budget runs out.",
      f: "team>svc:sync, svc>slo:sync", a: "team", m: { SLO: "99.9% / 30 days", "Budget left": "0 min", "Burn rate": "0.5×" }, g: { team: ["launch freeze: reliability work", "warn", "shield"] },
      setup: [["budget left", "ship features normally"], ["budget spent", "pause risky launches", "hi"], ["one incident > 20% of budget", "postmortem required"]] },
    { t: "recap", s: "Balance", h: "Healthy budget, faster shipping", b: "With budget to spare, the team can ship more often and take bigger bets. Reliability and speed become one negotiation instead of a fight.", k: "Spend the budget on purpose.",
      f: "users>svc:req, svc>users:res, svc>slo:sync, slo>team:res", a: "users team", m: { SLO: "99.9% / 30 days", "Budget left": "31 min", "Burn rate": "0.6×" } },
  ],
});

L({
  id: "strangler-migration",
  title: "Strangling a Legacy Monolith",
  sub: "Replace a legacy system route by route, without a big-bang rewrite.",
  level: "Lead", min: 8,
  learn: ["The strangler fig pattern", "Shadow traffic and response comparison", "Retiring the old path safely"],
  deep: [
    "Put a routing layer in front of the legacy system. Move one capability at a time to new code and switch its route, while everything else still goes to the old system.",
    "Before switching a route, mirror real traffic to the new service and compare its responses with the legacy ones, throwing the shadow results away.",
    "Big-bang rewrites stall because the old system keeps changing underneath them; incremental replacement delivers value at every step and can be paused.",
  ],
  iv: ["Pick the first slice by value and risk: a well-understood area that changes often.", "Plan data ownership: who writes which data during the transition, and how it stays in sync."],
  refs: [["Martin Fowler: Strangler Fig Application", "https://martinfowler.com/bliki/StranglerFigApplication.html"]],
  mk: ["Routes moved", "Diff rate"],
  nodes: [N("users", "users", 100, 225, "user"), N("gw", "routing facade", 320, 225, "lb"), N("mono", "legacy monolith", 560, 110, "server"), N("svc", "new invoices service", 560, 340, "server"), N("db", "legacy DB", 770, 110, "db")],
  steps: [
    { t: "problem", s: "Legacy", h: "A monolith nobody wants to touch", b: "12 years old, 400k lines, slow to change. A full rewrite would take two years, and the business won't stop for it.", k: "Big-bang rewrites rarely ship.",
      f: "users>gw:req, gw>mono:req, mono>db:req, db>mono:res", a: "mono", v: "users gw mono db", m: { "Routes moved": "0 / 40", "Diff rate": "—" }, g: { mono: ["400k lines, 12 years", "warn", "alert"] } },
    { t: "concept", s: "Shadow", h: "Shadow traffic first", b: "The new invoices service goes live in shadow mode: the facade copies every <code>/invoices</code> request to it, compares the answers and discards them. Users only ever see the monolith's response.", k: "Compare on real traffic before switching.",
      f: "users>gw:req, gw>mono:req, gw>svc:sync, mono>gw:res", a: "svc gw", m: { "Routes moved": "0 / 40", "Diff rate": "2.1% → 0.02%" }, g: { svc: ["shadow: responses discarded", "info", "repeat"] } },
    { t: "concept", s: "Switch", h: "Switch one route", b: "With differences near zero, <code>/invoices</code> is routed to the new service. Everything else still goes to the monolith, and switching back is one line.", k: "Move one capability at a time.",
      f: "users>gw:req, gw>svc:req, svc>gw:res, gw>mono:req", a: "svc", m: { "Routes moved": "1 / 40", "Diff rate": "0.02%" },
      code: `location /invoices/ { proxy_pass http://invoices-svc; }   # moved
location /          { proxy_pass http://legacy-monolith; } # everything else`, note: "nginx shown; any gateway or service mesh can do the routing." },
    { t: "recap", s: "Retire", h: "The old system withers away", b: "Route by route, over months, capabilities move. When the last route has moved, the monolith and its database are switched off.", k: "Strangle, don't rewrite.",
      f: "users>gw:req, gw>svc:req, svc>gw:res", a: "gw svc", v: "users gw svc", m: { "Routes moved": "40 / 40", "Diff rate": "—" }, g: { gw: ["monolith retired", "ok", "check"] } },
  ],
});

/* ───────── CTO: architecture & strategy ───────── */
L({
  id: "build-vs-buy",
  title: "Build vs Buy",
  sub: "Auth, payments, search, email: which do you build, which do you buy, and how do you avoid lock-in?",
  level: "CTO", min: 8,
  learn: ["Utility vs differentiating capabilities", "Total cost of ownership, including on-call", "Adapters and exit plans for vendors"],
  deep: [
    "Build what differentiates your product; buy what is a utility. Authentication, email delivery, payments and monitoring are rarely where you win.",
    "Compare total cost: fees versus engineers to build, run, secure, patch and be on call for it for years.",
    "Wrap each vendor behind your own interface, keep your data exportable, and know what switching would cost before you sign.",
  ],
  iv: ["Talk in money and time: \"2 engineers for 6 months, plus on-call forever\" versus a monthly fee.", "Name the risks of buying: price changes, outages you can't fix, data residency and compliance."],
  refs: [["Martin Fowler: Utility vs Strategic Dichotomy", "https://martinfowler.com/bliki/UtilityVsStrategicDichotomy.html"]],
  mk: ["Build", "Buy"],
  nodes: [N("app", "your product", 130, 225, "server"), N("core", "pricing engine", 400, 100, "worker"), N("adapter", "payments adapter", 400, 340, "lb"), N("pa", "payment provider A", 680, 260, "ext"), N("pb", "payment provider B", 680, 400, "ext")],
  steps: [
    { t: "concept", s: "Split", h: "Differentiator or utility?", b: "Your pricing engine is why customers choose you, so you build and own it. Card payments are a solved problem with strict compliance rules, so you buy them.", k: "Build what makes you different; buy the rest.",
      f: "app>core:req, core>app:res, app>adapter:req", a: "core adapter", v: "app core adapter", m: { Build: "pricing engine", Buy: "?" }, g: { core: ["differentiator: build", "ok", "check"], adapter: ["utility: buy", "info", "card"] } },
    { t: "concept", s: "TCO", h: "Count the whole cost", b: "Building payments means PCI scope, fraud tooling, 3-D Secure, bank integrations and on-call for all of it. A provider charges per transaction. Compare both over three years, not just the first invoice.", k: "Engineering time and on-call are real costs.",
      f: "app>adapter:req, adapter>pa:req, pa>adapter:res", a: "pa", v: "app core adapter pa", m: { Build: "pricing engine", Buy: "payments" },
      setup: [["build", "2 engineers × 6 months + on-call forever"], ["buy", "a fee per transaction"], ["hidden costs", "PCI scope, fraud, 3-D Secure, audits", "hi"]] },
    { t: "problem", s: "Lock-in", h: "Then the vendor changes", b: "Provider A raises prices and has a long outage. If its SDK is called from 200 places in your code, switching is a project of its own.", k: "Lock-in is the price of buying carelessly.",
      f: "app>adapter:req, adapter>pa:fail", a: "pa adapter", v: "app core adapter pa", m: { Build: "pricing engine", Buy: "payments (locked in?)" }, g: { pa: ["outage + price rise", "bad", "alert"] } },
    { t: "recap", s: "Adapter", h: "Own the interface, rent the implementation", b: "Because the app only talks to your own payments interface, adding provider B is a new adapter and a config change. Your data stays exportable, and the switch costs weeks, not quarters.", k: "Put vendors behind your own interface.",
      f: "app>adapter:req, adapter>pb:req, pb>adapter:res, adapter>app:res", a: "adapter pb", m: { Build: "pricing engine", Buy: "payments (switchable)" },
      code: `class PaymentGateway(Protocol):
    def charge(self, amount_cents: int, currency: str, token: str,
               idempotency_key: str) -> ChargeResult: ...

# app code depends on the interface, never on a vendor SDK
gateway = get_payment_gateway()  # provider A or B, chosen in settings`, note: "Keep the interface small and in your own domain terms." },
  ],
});

L({
  id: "disaster-recovery",
  title: "Disaster Recovery: RPO & RTO",
  sub: "A whole region goes down. How much data can you lose, how long can you be down, and what does each answer cost?",
  level: "CTO", min: 9,
  learn: ["RPO and RTO as business decisions", "Backup/restore, pilot light, warm standby, active-active", "Testing recovery for real"],
  deep: [
    "RPO is how much data you can afford to lose (the time since the last good copy); RTO is how long you can afford to be down. Both have a price.",
    "From cheap and slow to expensive and fast: backup and restore, pilot light (data replicated, little or no compute running), warm standby (a scaled-down copy running) and multi-site active-active.",
    "A recovery plan you haven't exercised is a hope. Run game days: restore backups, fail over, and time it.",
  ],
  iv: ["Tie the choice to money: the cost of an hour of downtime versus the monthly cost of standby.", "Cross-region replication is usually asynchronous, so RPO is rarely zero."],
  refs: [["AWS whitepaper: Disaster recovery of workloads on AWS", "https://docs.aws.amazon.com/whitepapers/latest/disaster-recovery-workloads-on-aws/disaster-recovery-workloads-on-aws.html"], ["AWS Builders' Library: Static stability using Availability Zones", "https://aws.amazon.com/builders-library/static-stability-using-availability-zones/"]],
  mk: ["RPO", "RTO", "Standby cost"],
  nodes: [N("users", "users", 100, 225, "user"), N("dns", "DNS / global router", 300, 225, "lb"), N("pa", "region A (primary)", 530, 100, "server"), N("pdb", "DB in region A", 750, 100, "db"), N("sb", "region B (standby)", 530, 350, "server"), N("sdb", "DB in region B", 750, 350, "db")],
  steps: [
    { t: "concept", s: "Targets", h: "Start from the business", b: "Before choosing technology, agree two numbers with the business: how much recent data may be lost (RPO) and how long the service may be down (RTO).", k: "RPO and RTO are business decisions.",
      f: "users>dns:req, dns>pa:req, pa>pdb:req, pdb>sdb:sync", a: "pdb sdb", v: "users dns pa pdb sdb", m: { RPO: "?", RTO: "?", "Standby cost": "?" },
      setup: [["RPO", "max data loss: time since last good copy"], ["RTO", "max time to restore service"], ["ask", "what does one hour down cost us?", "hi"]] },
    { t: "problem", s: "Outage", h: "Region A goes dark", b: "The primary region is unavailable. Writes made in the last few seconds may not have reached region B yet, because replication is asynchronous.", k: "Async replication means some data loss.",
      f: "users>dns:req, dns>pa:fail", a: "pa pdb", v: "users dns pa pdb sdb", m: { RPO: "replication lag ≈ 5 s", RTO: "depends on the plan", "Standby cost": "?" }, g: { pa: ["region A unavailable", "bad", "alert"] } },
    { t: "concept", s: "Options", h: "Four strategies, four prices", b: "The more you keep running in region B, the faster you recover and the more you pay every month.", k: "Faster recovery costs more every month.",
      f: "pdb>sdb:sync, dns>sb:req, sb>sdb:req", a: "sb sdb", m: { RPO: "seconds", RTO: "minutes", "Standby cost": "+35% infra" },
      setup: [["backup & restore", "RPO hours · RTO hours · $"], ["pilot light", "RPO minutes · RTO tens of min · $$"], ["warm standby", "RPO seconds · RTO minutes · $$$", "hi"], ["active-active", "RPO ≈ 0 · RTO ≈ 0 · $$$$"]] },
    { t: "recap", s: "Failover", h: "Fail over, and practise it", b: "The global router sends users to region B, which scales up. Because the team rehearses this every quarter, it takes 12 minutes instead of a long night.", k: "An untested recovery plan is a hope.",
      f: "users>dns:req, dns>sb:req, sb>sdb:req, sdb>sb:res", a: "dns sb", m: { RPO: "5 s", RTO: "12 min", "Standby cost": "+35% infra" }, g: { dns: ["failover drill every quarter", "ok", "check"] } },
  ],
});

L({
  id: "cell-architecture",
  title: "Blast Radius & Cells",
  sub: "One bad deploy or one poison tenant should hurt a few customers, not all of them.",
  level: "CTO", min: 8,
  learn: ["Blast radius and shared fate", "Cells: full independent copies behind a thin router", "Deploying cell by cell"],
  deep: [
    "A cell is a complete, independent copy of the workload (app, queue, database) serving a subset of customers, with no shared state and no cross-cell calls.",
    "A thin routing layer maps each customer, by a partition key such as tenant id, to its cell. Keep the router as simple and stable as possible.",
    "Deploy to one cell first and watch it. Bad releases, overloads and poison requests stay inside that cell.",
  ],
  iv: ["Discuss the cost: more copies to run and upgrade, harder cross-tenant queries, capacity planning per cell.", "Choose the partition key carefully: cross-cell work reintroduces coupling."],
  refs: [["AWS: Reducing the scope of impact with cell-based architecture", "https://docs.aws.amazon.com/wellarchitected/latest/reducing-scope-of-impact-with-cell-based-architecture/reducing-scope-of-impact-with-cell-based-architecture.html"], ["AWS Builders' Library: Workload isolation using shuffle-sharding", "https://aws.amazon.com/builders-library/workload-isolation-using-shuffle-sharding/"]],
  mk: ["Customers affected", "Cells"],
  nodes: [N("users", "all customers", 100, 225, "user"), N("router", "cell router", 320, 225, "lb"), N("c1", "cell 1", 560, 90, "server"), N("c2", "cell 2", 590, 225, "server"), N("c3", "cell 3", 560, 360, "server"), N("shared", "shared DB", 780, 225, "db")],
  steps: [
    { t: "problem", s: "Shared fate", h: "Everything shares one database", b: "Three app stacks, one database. A single bad query from one tenant saturates it, and every customer is down at once.", k: "Shared dependencies mean shared failures.",
      f: "router>c1:req, router>c2:req, router>c3:req, c1>shared:req, c2>shared:req, c3>shared:req, shared>c2:fail", a: "shared", m: { "Customers affected": "100%", Cells: "—" }, g: { shared: ["one bad query: everyone down", "bad", "alert"] } },
    { t: "concept", s: "Cells", h: "Split into independent cells", b: "Each cell gets its own app, queue and database. The router sends each tenant to exactly one cell, and cells never call each other.", k: "A cell is a whole copy of the system.",
      f: "users>router:req, router>c1:req, router>c2:req, router>c3:req", a: "router", v: "users router c1 c2 c3", m: { "Customers affected": "—", Cells: "3, each with its own DB" }, g: { router: ["tenant_id → cell", "info", "split"] } },
    { t: "problem", s: "Contained", h: "Failure stays in its cell", b: "A poison tenant breaks cell 2. Cells 1 and 3 don't notice. With 20 cells, one failing cell would affect about 5% of customers.", k: "Smaller cells, smaller blast radius.",
      f: "router>c2:req, c2>router:fail, router>c1:req, c1>router:res, router>c3:req, c3>router:res", a: "c2", v: "users router c1 c2 c3", m: { "Customers affected": "≈ 33% (1 of 3 cells)", Cells: "3" }, g: { c2: ["contained in cell 2", "bad", "alert"] } },
    { t: "recap", s: "Waves", h: "Deploy cell by cell", b: "Releases go to one cell, bake, then roll out in waves. A bad change is caught while it affects one cell's customers.", k: "Cells also make deployments safer.",
      f: "router>c1:req, c1>router:res", a: "c1", v: "users router c1 c2 c3", m: { "Customers affected": "≤ one cell", Cells: "3" }, g: { c1: ["wave 1: 1 cell, bake 1 h", "ok", "check"] },
      setup: [["wave 1", "1 cell, bake 1 hour"], ["wave 2", "25% of cells"], ["wave 3", "the rest", "hi"]] },
  ],
});

L({
  id: "conways-law",
  title: "Conway's Law & Team Boundaries",
  sub: "Your architecture will mirror your org chart. Design both on purpose.",
  level: "CTO", min: 7,
  learn: ["Conway's law and the inverse Conway manoeuvre", "Teams that own a capability end to end", "Platform teams that reduce cognitive load"],
  deep: [
    "Systems end up shaped like the communication structure of the organisation that builds them. Several teams on one shared codebase produce coupling and coordination meetings.",
    "Give each product team a business capability it owns end to end (code, data, deploys, on-call), with explicit APIs between teams.",
    "A platform team provides self-service paved roads (CI/CD, observability, databases) so product teams don't each rebuild infrastructure.",
  ],
  iv: ["Ask how many teams must coordinate to ship a typical feature; aim for one.", "Draw boundaries around business domains, not technologies (avoid 'the frontend team' and 'the database team')."],
  refs: [["Martin Fowler: Conway's Law", "https://martinfowler.com/bliki/ConwaysLaw.html"], ["Team Topologies: key concepts", "https://teamtopologies.com/key-concepts"]],
  mk: ["Teams per feature", "Deploys / week"],
  nodes: [N("ta", "orders team", 120, 100, "user"), N("tb", "payments team", 120, 350, "user"), N("mono", "shared monolith", 380, 225, "server"), N("so", "orders service", 600, 100, "server"), N("sp", "payments service", 600, 350, "server"), N("plat", "platform team", 780, 225, "ext")],
  steps: [
    { t: "problem", s: "Coupled", h: "Two teams, one codebase", b: "Both teams change the same monolith and the same database. Every feature needs a meeting, merges collide, and releases go out once a week on a train.", k: "Shared code means shared coordination.",
      f: "ta>mono:req, tb>mono:req, mono>ta:fail, mono>tb:fail", a: "mono", v: "ta tb mono", m: { "Teams per feature": "3", "Deploys / week": "1" }, g: { mono: ["merge conflicts, shared DB", "bad", "alert"] } },
    { t: "concept", s: "Align", h: "One team, one capability", b: "Split along business lines: the orders team owns the orders service and its data; the payments team owns payments. They talk through versioned APIs.", k: "Shape services around teams and domains.",
      f: "ta>so:req, tb>sp:req, so>sp:req, sp>so:res", a: "so sp", v: "ta tb so sp", m: { "Teams per feature": "1", "Deploys / week": "8" }, g: { so: ["owned by orders team", "ok", "check"], sp: ["owned by payments team", "ok", "check"] } },
    { t: "concept", s: "Platform", h: "A platform team paves the road", b: "Instead of every team building its own pipelines and dashboards, a platform team offers self-service CI/CD, logging and databases.", k: "Platforms reduce each team's cognitive load.",
      f: "plat>so:sync, plat>sp:sync", a: "plat", m: { "Teams per feature": "1", "Deploys / week": "20+" }, g: { plat: ["paved road: CI/CD, logs, DBs", "info", "cog"] } },
    { t: "recap", s: "Contracts", h: "Clear contracts between teams", b: "Each team owns its code, data, deploys and on-call. Between teams there are only APIs and events, versioned like public products.", k: "Ownership inside, contracts between.",
      f: "so>sp:req, sp>so:res", a: "so sp", m: { "Teams per feature": "1", "Deploys / week": "20+" },
      setup: [["a team owns", "code, data, deploys, on-call"], ["between teams", "versioned APIs and events", "hi"], ["platform", "self-service, not tickets"]] },
  ],
});

L({
  id: "cloud-costs",
  title: "Cutting the Cloud Bill",
  sub: "The bill doubled while traffic grew 20%. Find where the money goes and cut it without hurting reliability.",
  level: "CTO", min: 7,
  learn: ["Unit economics: cost per request or per customer", "The big levers: rightsizing, commitments, storage tiers, data transfer", "Making cost visible to the teams who cause it"],
  deep: [
    "Track cost per unit of value (per 1,000 requests, per active customer). A total bill alone can't tell you whether you're getting less efficient.",
    "Common waste: oversized instances at 10% CPU, idle non-production environments, logs and snapshots kept forever, and cross-zone or internet data transfer.",
    "Levers: rightsize and autoscale, commit to baseline usage (savings plans or reserved capacity), move cold data to cheaper storage tiers, and tag resources so each team sees its own spend.",
  ],
  iv: ["Don't cut redundancy blindly: price an hour of downtime before removing a standby.", "Report cost per unit before and after, not just total dollars."],
  refs: [["AWS Well-Architected: Cost optimization pillar", "https://docs.aws.amazon.com/wellarchitected/latest/cost-optimization-pillar/welcome.html"], ["FinOps Foundation", "https://www.finops.org/"]],
  mk: ["Monthly bill", "Cost / 1k requests"],
  nodes: [N("users", "users", 100, 225, "user"), N("lb", "load balancer", 300, 225, "lb"), N("app", "app fleet", 520, 100, "server"), N("logs", "logs & snapshots", 520, 350, "db"), N("store", "object storage", 760, 225, "db")],
  steps: [
    { t: "problem", s: "The bill", h: "Where is the money going?", b: "Tagging and a cost report show two big items: an app fleet averaging 10% CPU, and 38 TB of logs and snapshots that are never deleted.", k: "Measure cost per unit, then find the biggest waste.",
      f: "users>lb:req, lb>app:req, app>logs:sync, app>store:sync", a: "app logs", m: { "Monthly bill": "$84k", "Cost / 1k requests": "$0.42" }, g: { app: ["average CPU 10%", "bad", "cpu"], logs: ["38 TB, never deleted", "bad", "disk"] } },
    { t: "concept", s: "Rightsize", h: "Rightsize, autoscale, commit", b: "Halve the instance size, autoscale on load, shrink non-production at night, and buy a savings plan for the steady baseline.", k: "Pay for what you use, commit to what you always use.",
      f: "users>lb:req, lb>app:req, app>lb:res", a: "app", m: { "Monthly bill": "$61k", "Cost / 1k requests": "$0.30" }, g: { app: ["half size + autoscaling", "ok", "check"] },
      setup: [["rightsize", "match instance size to p95 usage"], ["autoscale", "scale on load, minimum at night"], ["commit", "savings plan for the steady baseline", "hi"]] },
    { t: "concept", s: "Tier", h: "Expire and tier your data", b: "Keep 30 days of logs hot, move older data to an archive tier, and delete it after a year.", k: "Old data should be cheap or gone.",
      f: "app>logs:sync, logs>store:sync", a: "logs store", m: { "Monthly bill": "$47k", "Cost / 1k requests": "$0.23" }, g: { logs: ["30-day retention", "ok", "check"], store: ["cold data → archive tier", "info", "db"] },
      code: `{"Rules": [{"ID": "logs-to-archive", "Status": "Enabled",
  "Filter": {"Prefix": "logs/"},
  "Transitions": [{"Days": 30, "StorageClass": "GLACIER"}],
  "Expiration": {"Days": 365}}]}`, note: "An S3 lifecycle rule; other clouds have equivalent storage tiers." },
    { t: "recap", s: "Visible", h: "Make cost visible to teams", b: "Every resource is tagged by team and service. Each team sees its own spend and cost per 1,000 requests every week, with budget alerts.", k: "Teams optimise what they can see.",
      f: "users>lb:req, lb>app:req", a: "users", m: { "Monthly bill": "$47k", "Cost / 1k requests": "$0.21" },
      setup: [["tag", "team, service, env on every resource"], ["report", "cost per 1k requests, weekly", "hi"], ["guard", "budget alerts per team"]] },
  ],
});
