/* 3D walkthrough scenes for each Senior Django question (keyed by question id).
   Same step format as lessons (see data/dsl.js). The full model answer is shown under the stage. */
window.DJANGO_SCENES = {
  "n-plus-one": {
    t: "N+1 Queries", mk: ["Queries", "Time"],
    nodes: [N("view", "OrderListView", 130, 220), N("orm", "Django ORM", 380, 220, "lb"), N("db", "PostgreSQL", 640, 220, "db")],
    steps: [
      { t: "problem", s: "1 + N", h: "One query per row", b: "The loop touches <code>order.customer</code> and <code>order.items</code> for 100 orders: 1 query for orders + 200 lazy queries.", k: "Lazy relation access inside a loop = N+1.", f: "view>orm:req, orm>db:fail, orm>db:fail, orm>db:fail", a: "db", m: { Queries: "201", Time: "~900 ms" } },
      { t: "concept", s: "select_related", h: "JOIN forward relations", b: "<code>select_related('customer')</code> adds a SQL JOIN, so customers come back in the same query as orders.", k: "FK / one-to-one → select_related (JOIN).", f: "view>orm:req, orm>db:req, db>orm:res", a: "orm", m: { Queries: "101", Time: "~450 ms" } },
      { t: "concept", s: "prefetch", h: "Prefetch reverse / M2M", b: "<code>prefetch_related('items')</code> runs one extra <code>WHERE order_id IN (...)</code> query and attaches items in Python.", k: "Reverse FK / M2M → prefetch_related (IN query).", f: "orm>db:req, db>orm:res, orm>db:req, db>orm:res, orm>view:res", a: "orm db", m: { Queries: "2", Time: "~15 ms" } },
    ],
  },
  "prefetch-object": {
    t: "Prefetch Objects", mk: ["Queries"],
    nodes: [N("view", "view", 130, 220), N("cache", "prefetch cache", 400, 90, "cache"), N("db", "database", 640, 260, "db")],
    steps: [
      { t: "problem", s: "Filter breaks", h: "Filtering a prefetched relation", b: "<code>author.books.filter(published=True)</code> ignores the prefetch cache and queries again for every author.", k: "Filtering after prefetch brings N+1 back.", f: "view>db:fail, view>db:fail", a: "db", m: { Queries: "1 + N" } },
      { t: "concept", s: "Prefetch()", h: "Filter inside the prefetch", b: "<code>Prefetch('books', queryset=Book.objects.filter(published=True), to_attr='published_books')</code> runs the filtered query once.", k: "Put the filter in the Prefetch queryset.", f: "view>db:req, db>cache:sync", a: "cache", m: { Queries: "2" } },
      { t: "recap", s: "to_attr", h: "Read from the list", b: "<code>author.published_books</code> is a plain list already in memory, with no further queries.", k: "to_attr stores results as a list attribute.", f: "view>cache:req, cache>view:res", a: "cache view", m: { Queries: "2" } },
    ],
  },
  "queryset-laziness": {
    t: "QuerySet Laziness",
    nodes: [N("code", "your code", 130, 220), N("qs", "QuerySet", 390, 220, "lb"), N("db", "database", 640, 220, "db")],
    steps: [
      { t: "concept", s: "Lazy", h: "Building a query runs nothing", b: "<code>User.objects.filter(is_active=True).order_by('name')</code> only builds SQL. No database call yet.", k: "Chaining methods doesn't hit the DB.", f: "code>qs:sync", a: "qs" },
      { t: "concept", s: "Evaluate", h: "Iteration evaluates and caches", b: "Iterating, <code>list()</code>, <code>len()</code>, <code>bool()</code> or slicing with a step runs the query and caches rows on that QuerySet.", k: "Evaluation triggers the SQL; results are cached.", f: "code>qs:req, qs>db:req, db>qs:res, qs>code:res", a: "db" },
      { t: "case", s: "Big data", h: "Large result sets", b: "<code>.exists()</code> checks without fetching rows; <code>.iterator(chunk_size=2000)</code> streams rows without caching them.", k: "Use exists() and iterator() deliberately.", f: "code>qs:req, qs>db:req, db>code:res", a: "qs" },
    ],
  },
  "subquery-exists": {
    t: "Subquery & Exists",
    nodes: [N("view", "view", 130, 220), N("outer", "customers query", 390, 120, "lb"), N("inner", "orders subquery", 390, 340, "lb"), N("db", "database", 650, 220, "db")],
    steps: [
      { t: "problem", s: "Loop", h: "Latest order per customer, in Python", b: "Looping over customers and querying each one's latest order is N+1 again.", k: "Per-row lookups belong in SQL.", f: "view>db:fail, view>db:fail", a: "db" },
      { t: "concept", s: "OuterRef", h: "Correlated subquery", b: "<code>Subquery(Order.objects.filter(customer=OuterRef('pk')).order_by('-created_at').values('created_at')[:1])</code> is embedded in the customer query.", k: "OuterRef links the subquery to each outer row.", f: "outer>inner:sync, inner>outer:res", a: "outer inner" },
      { t: "recap", s: "One query", h: "Single query, still chainable", b: "<code>annotate(last_order_at=...)</code> plus <code>Exists(...)</code> for booleans returns one QuerySet you can filter and order.", k: "Annotate with Subquery/Exists to stay in one query.", f: "view>outer:req, outer>db:req, db>view:res", a: "db" },
    ],
  },
  "f-expressions": {
    t: "F() Expressions", mk: ["views (DB)", "Expected"],
    nodes: [N("r1", "request 1", 120, 100), N("r2", "request 2", 120, 340), N("db", "articles", 520, 220, "db")],
    steps: [
      { t: "problem", s: "Race", h: "Read-modify-write in Python", b: "Both requests read views = 10, add 1 in Python, and save 11. One increment is lost.", k: "Python-side increments race.", f: "r1>db:req, r2>db:req, db>r1:res, db>r2:res, r1>db:req, r2>db:fail", a: "db", m: { "views (DB)": "11", Expected: "12 ✗" } },
      { t: "concept", s: "F()", h: "Let the database do the maths", b: "<code>.update(views=F('views') + 1)</code> sends <code>SET views = views + 1</code>. Each UPDATE applies atomically on top of the other.", k: "F() pushes arithmetic into one SQL statement.", f: "r1>db:req, r2>db:req", a: "db", m: { "views (DB)": "12", Expected: "12 ✓" } },
      { t: "recap", s: "Refresh", h: "Refresh the instance", b: "After <code>obj.views = F('views') + 1; obj.save()</code>, call <code>refresh_from_db()</code> to read the real value.", k: "In-memory instances don't know the new value.", f: "db>r1:res", a: "r1" },
    ],
  },
  "bulk-ops": {
    t: "bulk_create & bulk_update", mk: ["Queries", "Signals fired"],
    nodes: [N("job", "import job", 130, 220, "worker"), N("orm", "ORM", 380, 220, "lb"), N("db", "products", 640, 220, "db")],
    steps: [
      { t: "problem", s: "Row by row", h: "10,000 save() calls", b: "Saving rows one at a time means 10,000 round trips and minutes of runtime.", k: "Per-row saves don't scale for imports.", f: "job>orm:req, orm>db:fail, orm>db:fail", a: "db", m: { Queries: "10,000", "Signals fired": "yes" } },
      { t: "concept", s: "Batch", h: "bulk_create in batches", b: "<code>bulk_create(objs, batch_size=1000)</code> inserts many rows per query. With <code>update_conflicts=True</code> and <code>unique_fields</code> it becomes an upsert.", k: "Batching cuts round trips by orders of magnitude.", f: "job>orm:req, orm>db:req, db>orm:res", a: "orm", m: { Queries: "10", "Signals fired": "no" } },
      { t: "case", s: "Caveats", h: "What you give up", b: "No <code>save()</code> override and no pre/post_save signals; <code>ignore_conflicts</code> won't set PKs on objects.", k: "Logic in save()/signals is skipped by bulk ops.", f: "orm>db:req", a: "job" },
    ],
  },
  "slow-endpoint": {
    t: "Debug a Slow Endpoint", mk: ["p95", "DB time"],
    nodes: [N("user", "users", 100, 220, "user"), N("gunicorn", "Gunicorn", 300, 220), N("view", "Django view", 500, 110), N("db", "PostgreSQL", 680, 220, "db"), N("apm", "APM / traces", 500, 380, "ext")],
    steps: [
      { t: "problem", s: "Regressed", h: "p95 jumped 200 ms → 3 s", b: "First scope it: one endpoint or all? Since which deploy? Did traffic or data change?", k: "Scope before guessing.", f: "user>gunicorn:req, gunicorn>view:fail", a: "view", m: { p95: "3.0 s" } },
      { t: "concept", s: "Trace", h: "Break down the time", b: "APM traces show 2.7 s in DB spans: 350 queries per request after a serializer added a nested field.", k: "Measure where time goes: DB, HTTP, CPU, or queueing.", f: "view>db:fail, view>apm:sync", a: "apm db", m: { p95: "3.0 s", "DB time": "2.7 s" } },
      { t: "recap", s: "Fix + guard", h: "Fix and add a guardrail", b: "Add <code>prefetch_related</code>, confirm with <code>EXPLAIN ANALYZE</code>, and add <code>assertNumQueries</code> to the test suite plus a p95 alert.", k: "Every fix gets a regression test.", f: "view>db:req, db>view:res, view>user:res", a: "view", m: { p95: "190 ms", "DB time": "40 ms" } },
    ],
  },
  "indexes": {
    t: "Choosing Indexes", mk: ["Plan", "Time"],
    nodes: [N("app", "Django", 130, 220), N("idx", "composite index", 400, 100, "cache"), N("db", "orders table", 620, 280, "db")],
    steps: [
      { t: "problem", s: "Seq scan", h: "Sequential scan on a hot query", b: "<code>Order.objects.filter(customer=c).order_by('-created_at')</code> shows <code>Seq Scan</code> in <code>.explain()</code>.", k: "Start from the query plan.", f: "app>db:fail", a: "db", m: { Plan: "Seq Scan", Time: "1.2 s" } },
      { t: "concept", s: "Composite", h: "Index matching filter + order", b: "<code>Index(fields=['customer', '-created_at'])</code> serves the filter and the ordering in one index scan.", k: "Equality columns first, then sort.", f: "app>idx:req, idx>db:req, db>app:res", a: "idx", m: { Plan: "Index Scan", Time: "2 ms" } },
      { t: "case", s: "Special", h: "Partial, covering, GIN", b: "<code>condition=Q(status='open')</code> for partial indexes, <code>include=[...]</code> for covering, <code>GinIndex</code> for JSONB/full-text.", k: "Pick the index type for the query shape.", f: "app>idx:req", a: "idx" },
    ],
  },
  "caching-django": {
    t: "Caching in Django", mk: ["Hit ratio"],
    nodes: [N("view", "view", 130, 220), N("cache", "Redis cache", 400, 90, "cache"), N("db", "database", 400, 360, "db")],
    steps: [
      { t: "concept", s: "get_or_set", h: "Low-level cache API", b: "<code>cache.get_or_set('product:42:v2', compute, 300)</code> reads from Redis and computes only on a miss.", k: "Cache computed data under versioned keys.", f: "view>cache:req, cache>view:res", a: "cache", m: { "Hit ratio": "97%" } },
      { t: "concept", s: "Invalidate", h: "Invalidate after commit", b: "Inside <code>atomic()</code>, register <code>transaction.on_commit(lambda: cache.delete(key))</code> so readers never re-cache uncommitted or rolled-back data.", k: "Delete after commit, not before.", f: "view>db:req, view>cache:fail", a: "db cache" },
      { t: "case", s: "Stampede", h: "Hot key expiry", b: "Add TTL jitter and single-flight recompute (lock) for hot keys; never cache per-user data under a shared key.", k: "Protect hot keys from stampedes.", f: "view>db:req, db>view:res, view>cache:sync", a: "view" },
    ],
  },
  "conn-pooling": {
    t: "Connection Pooling", mk: ["Connections"],
    nodes: [N("w", "Gunicorn workers × pods", 130, 220), N("pool", "pool / PgBouncer", 400, 220, "lb"), N("db", "PostgreSQL", 650, 220, "db")],
    steps: [
      { t: "problem", s: "Too many", h: "Too many connections", b: "20 pods × 9 workers × 4 threads, each with its own DB connection, exceeds Postgres' max_connections.", k: "Connections multiply with processes.", f: "w>db:fail, w>db:fail", v: "w db", a: "db", m: { Connections: "720 ✗" } },
      { t: "concept", s: "Reuse", h: "Persistent connections", b: "<code>CONN_MAX_AGE=60</code> + <code>CONN_HEALTH_CHECKS=True</code> reuse connections per thread. Django 5.1+ also offers a native psycopg pool via <code>OPTIONS={'pool': True}</code>.", k: "Reuse instead of reconnecting per request.", f: "w>db:req, db>w:res", v: "w db", a: "w" },
      { t: "recap", s: "PgBouncer", h: "Server-side pooler", b: "PgBouncer in transaction mode multiplexes many clients onto few server connections. Disable server-side cursors (<code>DISABLE_SERVER_SIDE_CURSORS</code>) and avoid session state.", k: "A pooler caps real DB connections.", f: "w>pool:req, pool>db:req, db>pool:res", a: "pool", m: { Connections: "50 ✓" } },
    ],
  },
  "atomic": {
    t: "transaction.atomic",
    nodes: [N("view", "view", 120, 220), N("tx", "transaction", 380, 120, "lb"), N("sp", "savepoint", 380, 340, "lb"), N("db", "database", 650, 220, "db")],
    steps: [
      { t: "concept", s: "Outer", h: "Outermost atomic = transaction", b: "Entering <code>atomic()</code> starts a transaction; leaving normally commits, an exception rolls back.", k: "All-or-nothing for the block.", f: "view>tx:req, tx>db:req", a: "tx" },
      { t: "concept", s: "Nested", h: "Nested atomic = savepoint", b: "An inner <code>atomic()</code> creates a savepoint. Catch the IntegrityError outside the inner block, and only the inner work rolls back.", k: "Savepoints allow partial rollback.", f: "tx>sp:sync, sp>db:fail, tx>db:req", a: "sp" },
      { t: "case", s: "Pitfall", h: "Don't swallow DB errors inside atomic", b: "Catching a DatabaseError inside the same atomic block leaves the transaction broken (TransactionManagementError). Keep external API calls outside transactions.", k: "Short transactions; errors handled at savepoint boundaries.", f: "view>tx:fail", a: "view" },
    ],
  },
  "on-commit": {
    t: "on_commit & Celery",
    nodes: [N("view", "view", 120, 220), N("db", "database", 380, 100, "db"), N("broker", "broker", 380, 350, "queue"), N("worker", "Celery worker", 650, 220, "worker")],
    steps: [
      { t: "problem", s: "Too early", h: "Task runs before the commit", b: "<code>send_confirmation.delay(order.id)</code> inside atomic: the worker starts, queries the order, and gets DoesNotExist because the transaction hasn't committed.", k: "Tasks can outrun transactions.", f: "view>broker:req, broker>worker:req, worker>db:fail", a: "worker" },
      { t: "concept", s: "on_commit", h: "Enqueue after commit", b: "<code>transaction.on_commit(partial(task.delay, order.id))</code> runs only after a successful commit, and is discarded on rollback. Celery 5.4+ also has <code>delay_on_commit()</code>.", k: "Side effects after commit.", f: "view>db:req, db>view:res, view>broker:req, broker>worker:req, worker>db:req", a: "broker" },
      { t: "case", s: "Gap", h: "Crash after commit", b: "If the process dies between commit and enqueue, the task is lost. For must-not-lose events, use a transactional outbox.", k: "on_commit isn't durable; outbox is.", f: "view>db:req, view>broker:fail", a: "db" },
    ],
  },
  "select-for-update": {
    t: "Overselling & Row Locks", mk: ["Stock", "Sold"],
    nodes: [N("b1", "buyer 1", 110, 100, "client"), N("b2", "buyer 2", 110, 340, "client"), N("app", "checkout view", 380, 220), N("db", "products", 640, 220, "db")],
    steps: [
      { t: "problem", s: "Race", h: "Two checkouts, one item", b: "Both requests read stock = 1 and both save stock = 0. Two orders, one item.", k: "Check-then-act races without a lock.", f: "b1>app:req, b2>app:req, app>db:req, app>db:fail", a: "db", m: { Stock: "0", Sold: "2 ✗" } },
      { t: "concept", s: "Conditional", h: "Conditional UPDATE with F()", b: "<code>filter(pk=pid, stock__gte=qty).update(stock=F('stock') - qty)</code> returns rows updated; 0 means sold out.", k: "One atomic statement, no held locks.", f: "app>db:req, db>app:res, app>b2:fail", a: "app", m: { Stock: "0", Sold: "1 ✓" } },
      { t: "concept", s: "Lock", h: "select_for_update when you must read first", b: "Inside <code>atomic()</code>, <code>select_for_update()</code> locks the row; the second buyer waits, then sees stock 0. Use <code>skip_locked</code> for job queues and lock rows in a consistent order.", k: "Pessimistic lock = serialised access.", f: "b1>app:req, app>db:req, b2>app:req, app>db:fail", a: "db" },
    ],
  },
  "db-constraints": {
    t: "Database Constraints",
    nodes: [N("r1", "request 1", 120, 100), N("r2", "request 2", 120, 340), N("ser", "serializer check", 380, 220, "lb"), N("db", "unique constraint", 640, 220, "db")],
    steps: [
      { t: "problem", s: "Race", h: "Both pass the serializer", b: "Two signups with the same email run “does it exist?” at the same moment; both see no, both insert.", k: "App-level uniqueness checks race.", f: "r1>ser:req, r2>ser:req, ser>db:req, ser>db:req", a: "ser" },
      { t: "concept", s: "Constraint", h: "The database decides", b: "<code>UniqueConstraint(Lower('email'), name='uniq_email_ci')</code>: the second insert fails with IntegrityError.", k: "Constraints are the final guarantee.", f: "ser>db:req, ser>db:fail", a: "db" },
      { t: "recap", s: "Both", h: "Validate twice, trust the DB", b: "Keep serializer validation for friendly errors, catch IntegrityError for the race, and use CheckConstraint for invariants such as non-negative balances.", k: "Friendly checks in Python, guarantees in SQL.", f: "r1>ser:req, ser>db:req, db>r1:res", a: "db ser" },
    ],
  },
  "zero-downtime-migrations": {
    t: "Zero-Downtime Migrations",
    nodes: [N("old", "old code (v1)", 120, 100), N("new", "new code (v2)", 120, 340), N("mig", "migration", 400, 220, "worker"), N("db", "200M-row table", 650, 220, "db")],
    steps: [
      { t: "problem", s: "Rolling", h: "Old and new code run together", b: "During a rolling deploy v1 and v2 serve traffic simultaneously, so every schema change must work for both.", k: "Each migration must be backward-compatible.", f: "old>db:req, new>db:req", a: "db" },
      { t: "concept", s: "Expand", h: "Expand: add, don't change", b: "Add nullable columns (or <code>db_default</code>), create indexes with <code>AddIndexConcurrently</code> (atomic = False), and set a <code>lock_timeout</code>.", k: "Additive, non-blocking changes first.", f: "mig>db:req", a: "mig" },
      { t: "recap", s: "Contract", h: "Backfill, switch, then contract", b: "Backfill in batches, switch reads to the new column, then drop the old one in a later release (<code>SeparateDatabaseAndState</code> to remove it from the model first).", k: "Expand → migrate → contract across releases.", f: "mig>db:req, new>db:req", v: "new mig db", a: "new" },
    ],
  },
  "data-migrations": {
    t: "Data Migrations",
    nodes: [N("mig", "RunPython", 130, 220, "worker"), N("apps", "apps.get_model", 390, 100, "lb"), N("db", "orders", 640, 220, "db")],
    steps: [
      { t: "concept", s: "Historical", h: "Use historical models", b: "<code>apps.get_model('orders', 'Order')</code> matches the schema at that point in history. Direct imports break when the model changes later.", k: "Never import models in migrations.", f: "mig>apps:req, apps>mig:res", a: "apps" },
      { t: "concept", s: "Batches", h: "Work in batches", b: "Iterate with <code>.iterator(chunk_size=5000)</code> and <code>bulk_update</code> per batch to avoid giant transactions and memory spikes.", k: "Small batches, bounded memory.", f: "mig>db:req, db>mig:res, mig>db:req", a: "db" },
      { t: "recap", s: "Reversible", h: "Reversible and idempotent", b: "Provide <code>reverse_code</code> (or <code>RunPython.noop</code>), make it safe to rerun, and move huge backfills to a management command or background job.", k: "Migrations should be safe to rerun and reverse.", f: "mig>db:req", a: "mig" },
    ],
  },
  "custom-user": {
    t: "Custom User Model",
    nodes: [N("settings", "AUTH_USER_MODEL", 140, 220, "ext"), N("user", "accounts.User", 400, 220, "db"), N("fk1", "orders.owner FK", 650, 100, "db"), N("fk2", "projects.members M2M", 650, 340, "db")],
    steps: [
      { t: "concept", s: "Day one", h: "Set it before the first migration", b: "<code>class User(AbstractUser): pass</code> and <code>AUTH_USER_MODEL = 'accounts.User'</code> from day one.", k: "Swapping the user model later is a manual, risky migration.", f: "settings>user:sync", a: "user" },
      { t: "concept", s: "References", h: "Reference it indirectly", b: "Models use <code>settings.AUTH_USER_MODEL</code>; runtime code uses <code>get_user_model()</code>.", k: "Never import auth.User directly.", f: "fk1>user:req, fk2>user:req", a: "fk1 fk2" },
      { t: "recap", s: "Choose base", h: "AbstractUser vs AbstractBaseUser", b: "Extend <code>AbstractUser</code> for most cases; use <code>AbstractBaseUser + PermissionsMixin</code> for full control (e.g. email login). Put large optional data in a profile model.", k: "Start simple, keep the option open.", f: "settings>user:sync, user>fk1:res", a: "user" },
    ],
  },
  "async-views": {
    t: "Async Views",
    nodes: [N("client", "client", 100, 220, "client"), N("asgi", "ASGI server", 330, 220), N("api1", "weather API", 620, 90, "ext"), N("api2", "rates API", 620, 220, "ext"), N("db", "DB (sync_to_async)", 620, 360, "db")],
    steps: [
      { t: "concept", s: "Fan-out", h: "Concurrent I/O with asyncio.gather", b: "Under ASGI, an async view calls two external APIs concurrently with <code>httpx.AsyncClient</code>; total time ≈ the slowest call, not the sum.", k: "Async pays off for concurrent network waits.", f: "client>asgi:req, asgi>api1:req, asgi>api2:req, api1>asgi:res, api2>asgi:res", a: "asgi" },
      { t: "concept", s: "ORM", h: "Async ORM methods", b: "<code>aget()</code>, <code>acreate()</code> and <code>async for</code> exist, but queries still run in a thread pool under the hood.", k: "Async ORM API ≠ async database driver.", f: "asgi>db:req, db>asgi:res", a: "db" },
      { t: "problem", s: "Blocking", h: "Never block the event loop", b: "Calling <code>requests.get()</code> or sync ORM code directly in an async view blocks every request on that loop. Wrap it with <code>sync_to_async</code>.", k: "Blocking calls in async code stall everyone.", f: "asgi>api1:fail", a: "asgi" },
    ],
  },
  "celery-reliability": {
    t: "Reliable Celery Tasks",
    nodes: [N("app", "Django", 110, 220), N("broker", "broker", 340, 220, "queue"), N("worker", "worker", 580, 110, "worker"), N("psp", "payment API", 580, 350, "ext")],
    steps: [
      { t: "concept", s: "IDs", h: "Pass IDs, not objects", b: "<code>charge_invoice.delay(invoice.id)</code>; the task re-fetches fresh data.", k: "Serialized model instances go stale.", f: "app>broker:req, broker>worker:req", a: "broker" },
      { t: "concept", s: "acks_late", h: "Survive worker crashes", b: "<code>acks_late=True</code> acks after success, so a crashed worker's task is redelivered, which means it may run twice.", k: "Redelivery is a feature; design for it.", f: "broker>worker:req, worker>broker:fail, broker>worker:req", a: "worker" },
      { t: "recap", s: "Idempotent", h: "Idempotent + retried with backoff", b: "Check state (already PAID? return), pass an idempotency key to the payment API, and use <code>autoretry_for</code> with <code>retry_backoff</code> for transient errors only.", k: "Idempotency makes retries safe.", f: "worker>psp:fail, worker>psp:req, psp>worker:res", a: "psp" },
    ],
  },
  "drf-serializer-perf": {
    t: "Fast DRF List Endpoints", mk: ["Queries", "p95"],
    nodes: [N("client", "client", 100, 220, "client"), N("view", "ViewSet", 330, 220), N("ser", "serializer", 560, 100, "lb"), N("db", "database", 600, 340, "db")],
    steps: [
      { t: "problem", s: "Nested", h: "Nested serializers trigger N+1", b: "Each order serializes its customer and items, plus a <code>SerializerMethodField</code> calling <code>obj.items.count()</code>.", k: "Serializers hide queries.", f: "view>ser:req, ser>db:fail, ser>db:fail", a: "ser", m: { Queries: "301", p95: "2.1 s" } },
      { t: "concept", s: "get_queryset", h: "Optimise in get_queryset()", b: "<code>select_related('customer').prefetch_related('items__product').annotate(item_count=Count('items'))</code>.", k: "Shape the query once, in the view.", f: "view>db:req, db>view:res, view>ser:req", a: "view", m: { Queries: "3", p95: "120 ms" } },
      { t: "recap", s: "Paginate", h: "Always paginate", b: "<code>CursorPagination</code> stays fast on deep pages and stable while rows are inserted.", k: "Unbounded lists are a latency bug waiting to happen.", f: "client>view:req, view>client:res", a: "client" },
    ],
  },
  "drf-permissions": {
    t: "Object-Level Permissions",
    nodes: [N("user", "user (tenant A)", 100, 220, "client"), N("view", "ViewSet", 340, 220), N("perm", "permission classes", 340, 390, "lb"), N("db", "projects", 620, 220, "db")],
    steps: [
      { t: "problem", s: "IDOR", h: "Requesting another tenant's object", b: "GET <code>/projects/42/</code> belongs to tenant B. If the queryset isn't scoped, the user can read it.", k: "Unscoped querysets leak data.", f: "user>view:req, view>db:req, db>user:fail", a: "db" },
      { t: "concept", s: "Scope", h: "Scope get_queryset()", b: "<code>Project.objects.filter(account=request.user.account)</code>: other tenants' rows don't exist for this user → 404, including list endpoints.", k: "Queryset scoping is the primary defence.", f: "user>view:req, view>db:req, db>view:res", a: "view" },
      { t: "recap", s: "Object perm", h: "has_object_permission for finer rules", b: "Use it for “only owners can edit”. It runs on <code>get_object()</code> only, not on list views, so it can't replace scoping.", k: "Object permissions add rules; scoping prevents leaks.", f: "view>perm:req, perm>view:res", a: "perm" },
    ],
  },
  "api-idempotency": {
    t: "Idempotent POST /payments", mk: ["Attempts", "Charges"],
    nodes: [N("client", "client", 100, 220, "client"), N("api", "payments view", 340, 220), N("keys", "IdempotencyRecord", 340, 390, "db"), N("psp", "processor", 620, 220, "ext")],
    steps: [
      { t: "problem", s: "Retry", h: "A retried POST", b: "The response timed out; the client retries the same payment.", k: "Clients will retry.", f: "client>api:req, api>psp:req, api>client:fail, client>api:req", a: "api", m: { Attempts: "2", Charges: "?" } },
      { t: "concept", s: "Record", h: "Unique key in the same transaction", b: "Create <code>IdempotencyRecord(account, key)</code> under a unique constraint inside <code>atomic()</code>, together with the payment.", k: "The unique constraint resolves races.", f: "api>keys:req, api>psp:req", a: "keys" },
      { t: "recap", s: "Replay", h: "Replay the stored response", b: "On IntegrityError, load the record: return its stored response, or 409 if still in progress. Reject a reused key with a different body hash.", k: "Duplicates get the original response.", f: "client>api:req, api>keys:req, keys>api:res, api>client:res", a: "keys", m: { Attempts: "2", Charges: "1 ✓" } },
    ],
  },
  "security-basics": {
    t: "Django Security Defaults",
    nodes: [N("attacker", "attacker", 100, 220, "client"), N("mw", "middleware (CSRF, security)", 350, 220, "lb"), N("tpl", "templates (auto-escape)", 600, 100), N("orm", "ORM (parameterised)", 600, 340, "db")],
    steps: [
      { t: "concept", s: "Defaults", h: "Protections on by default", b: "CSRF middleware, template auto-escaping (XSS), parameterised ORM queries (SQL injection), clickjacking headers, and strong password hashing.", k: "Django is secure by default, until you opt out.", f: "attacker>mw:fail", a: "mw" },
      { t: "problem", s: "Opt-outs", h: "How people disable them", b: "<code>|safe</code>/<code>mark_safe</code> on user input, f-strings in <code>raw()</code>/<code>cursor.execute()</code>, and <code>@csrf_exempt</code> on cookie-auth views.", k: "Most Django vulns are self-inflicted opt-outs.", f: "attacker>tpl:req, attacker>orm:req", a: "tpl orm" },
      { t: "recap", s: "Deploy check", h: "Harden production", b: "Run <code>manage.py check --deploy</code>; set HSTS, secure cookies, strict <code>ALLOWED_HOSTS</code>, and rotate <code>SECRET_KEY</code> with <code>SECRET_KEY_FALLBACKS</code>.", k: "check --deploy catches common misconfigurations.", f: "mw>tpl:sync, mw>orm:sync", a: "mw" },
    ],
  },
  "rate-limiting": {
    t: "Login Brute-Force Protection",
    nodes: [N("bot", "attacker", 100, 220, "client"), N("throttle", "throttle", 350, 220, "lb"), N("redis", "shared cache", 350, 390, "cache"), N("login", "login view", 620, 220)],
    steps: [
      { t: "problem", s: "Stuffing", h: "Credential stuffing", b: "Bots try leaked passwords against many accounts from many IPs.", k: "Per-IP limits alone aren't enough.", f: "bot>login:fail, bot>login:fail", v: "bot login", a: "login" },
      { t: "concept", s: "Two keys", h: "Throttle by IP and by account", b: "DRF <code>ScopedRateThrottle</code> or django-ratelimit, with counters in a shared cache (Redis) so limits hold across all processes.", k: "Limit on two dimensions, with shared counters.", f: "bot>throttle:req, throttle>redis:sync, throttle>bot:fail", a: "throttle redis" },
      { t: "recap", s: "Layers", h: "Defence in depth", b: "Generic error messages, temporary lockouts, MFA, and Argon2/PBKDF2 password hashing.", k: "Throttling + MFA + slow hashes.", f: "throttle>login:req, login>throttle:res", a: "login" },
    ],
  },
  "business-logic": {
    t: "Where Business Logic Lives",
    nodes: [N("view", "views / serializers", 120, 220), N("svc", "services.place_order()", 380, 220, "worker"), N("qs", "custom QuerySets", 640, 100, "lb"), N("models", "models", 640, 340, "db")],
    steps: [
      { t: "concept", s: "Thin views", h: "Views handle HTTP only", b: "Parse input, check permissions, call domain code, return a response.", k: "Keep HTTP concerns at the edge.", f: "view>svc:req, svc>view:res", a: "view" },
      { t: "concept", s: "Services", h: "Workflows in service functions", b: "<code>place_order()</code> coordinates several models, a transaction and <code>on_commit</code> side effects. It's callable from views, tasks and commands.", k: "Explicit services for multi-model workflows.", f: "svc>qs:req, svc>models:req", a: "svc" },
      { t: "recap", s: "QuerySets", h: "Reusable queries, few signals", b: "<code>Order.objects.open().for_account(a)</code> via <code>QuerySet.as_manager()</code>. Use signals sparingly: they hide flow and skip bulk/update() operations.", k: "Queries in QuerySets; avoid hidden signal logic.", f: "qs>models:req, models>qs:res", a: "qs" },
    ],
  },
  "multi-tenancy": {
    t: "Multi-Tenancy Approaches",
    nodes: [N("req", "request", 100, 220, "client"), N("mw", "tenant middleware", 330, 220, "lb"), N("shared", "shared tables + tenant_id", 600, 80, "db"), N("schema", "schema per tenant", 650, 220, "db"), N("dedicated", "DB per tenant", 600, 360, "db")],
    steps: [
      { t: "concept", s: "Shared", h: "Shared tables, tenant_id column", b: "Simplest and cheapest. Enforce scoping with tenant-aware managers and Postgres Row-Level Security as a backstop.", k: "Shared schema = simple, but a missed filter leaks data.", f: "req>mw:req, mw>shared:req", a: "shared" },
      { t: "concept", s: "Schema", h: "Schema per tenant", b: "django-tenants sets the search_path per request. Stronger isolation, but migrations run once per schema.", k: "Isolation at the cost of migration time.", f: "req>mw:req, mw>schema:req", a: "schema" },
      { t: "recap", s: "Dedicated", h: "Database per tenant", b: "Strongest isolation and noisy-neighbour control for a few large or regulated customers; highest ops cost. Many SaaS products mix tiers.", k: "Choose per customer tier.", f: "req>mw:req, mw>dedicated:req", a: "dedicated" },
    ],
  },
  "read-replica-routing": {
    t: "Read Replica Routing", mk: ["Replica lag"],
    nodes: [N("app", "Django", 120, 220), N("router", "DATABASE_ROUTERS", 360, 220, "lb"), N("primary", "default (primary)", 620, 90, "db"), N("replica", "replica", 620, 350, "db")],
    steps: [
      { t: "concept", s: "Router", h: "db_for_read / db_for_write", b: "A router sends writes to <code>default</code> and reads to replicas; <code>allow_migrate</code> keeps migrations on the primary.", k: "Routers centralise database selection.", f: "app>router:req, router>primary:req, router>replica:req", a: "router" },
      { t: "problem", s: "Lag", h: "Read-your-writes breaks", b: "A user saves, then the next page reads from a lagging replica and shows the old value.", k: "Replicas lag; users notice.", f: "app>primary:req, app>replica:fail", a: "replica", m: { "Replica lag": "1.8 s" } },
      { t: "recap", s: "Pin", h: "Pin to primary after writes", b: "Middleware sets a short-lived flag after a write so the router returns <code>default</code> for that user; reads inside transactions also use the primary.", k: "Route a writer's reads to the primary briefly.", f: "app>router:req, router>primary:req, primary>app:res", a: "primary" },
    ],
  },
  "testcase-types": {
    t: "TestCase vs TransactionTestCase",
    nodes: [N("tc", "TestCase", 130, 110, "worker"), N("ttc", "TransactionTestCase", 130, 340, "worker"), N("db", "test database", 450, 220, "db"), N("cb", "on_commit callbacks", 700, 220, "ext")],
    steps: [
      { t: "concept", s: "TestCase", h: "Wrapped in a rolled-back transaction", b: "Fast: each test runs in a transaction that's rolled back; <code>setUpTestData</code> runs once per class.", k: "TestCase = fast isolation via rollback.", f: "tc>db:req, db>tc:res", a: "tc" },
      { t: "case", s: "on_commit", h: "Commit hooks don't fire by themselves", b: "Nothing really commits, so use <code>self.captureOnCommitCallbacks(execute=True)</code> to run and assert them.", k: "Capture on_commit callbacks explicitly.", f: "tc>cb:sync", a: "cb" },
      { t: "recap", s: "Transaction", h: "When you need real commits", b: "TransactionTestCase truncates tables instead; use it for locking across connections or threads. It's much slower. In pytest: <code>django_db(transaction=True)</code>.", k: "Use the slow one only when commits matter.", f: "ttc>db:req, db>ttc:res", a: "ttc" },
    ],
  },
  "production-setup": {
    t: "Production Deployment",
    nodes: [N("lb", "load balancer", 100, 220, "lb"), N("gunicorn", "Gunicorn / Uvicorn", 320, 220), N("db", "PostgreSQL + pooler", 560, 90, "db"), N("redis", "Redis", 600, 230, "cache"), N("celery", "Celery workers", 560, 370, "worker"), N("cdn", "CDN (static)", 100, 390, "edge")],
    steps: [
      { t: "concept", s: "Stack", h: "The typical stack", b: "LB → Gunicorn (WSGI) or Uvicorn workers (ASGI) in containers; Postgres with a pooler; Redis for cache/broker; Celery workers; static files via CDN or WhiteNoise.", k: "Stateless app tier + managed state.", f: "lb>gunicorn:req, gunicorn>db:req, gunicorn>redis:req, redis>celery:req", a: "gunicorn" },
      { t: "concept", s: "Workers", h: "Size workers by measurement", b: "Start near 2 × cores + 1 sync workers, or gthread for I/O-heavy apps. Each worker holds a DB connection, so check totals against Postgres limits, then load test.", k: "Formulas start the conversation; load tests end it.", f: "gunicorn>db:req, db>gunicorn:res", a: "db" },
      { t: "recap", s: "Ops", h: "Operational hygiene", b: "DEBUG=False, config from env vars, health/readiness endpoints, request timeouts below the LB's, <code>max_requests</code> with jitter, and migrations as a separate release step.", k: "Twelve-factor config + health checks + safe releases.", f: "lb>gunicorn:req, cdn>lb:sync", a: "lb cdn" },
    ],
  },
  "observability": {
    t: "Observing a Django Service",
    nodes: [N("mw", "RequestId middleware", 120, 220, "lb"), N("app", "Django + OpenTelemetry", 380, 220), N("logs", "JSON logs", 640, 80, "db"), N("traces", "traces", 680, 220, "db"), N("sentry", "error tracking", 640, 360, "ext")],
    steps: [
      { t: "concept", s: "Request ID", h: "Correlate everything", b: "Middleware assigns <code>X-Request-ID</code> and stores it in a <code>contextvars.ContextVar</code> so every log line and Celery task carries it.", k: "One ID ties logs, traces and tasks together.", f: "mw>app:req, app>logs:sync", a: "mw" },
      { t: "concept", s: "Traces", h: "Auto-instrumentation", b: "OpenTelemetry instruments Django, psycopg, Redis and HTTP clients, showing exactly which span is slow.", k: "Traces show where time goes.", f: "app>traces:sync", a: "traces" },
      { t: "recap", s: "SLOs", h: "Errors and SLO alerts", b: "Error tracking with release tags; RED metrics per route; alerts on SLO burn rate rather than every spike.", k: "Alert on user impact.", f: "app>sentry:sync, app>logs:sync, app>traces:sync", a: "sentry" },
    ],
  },
};

/* Official references per Django topic, shown under each model answer. */
window.DJANGO_REFS = {
  orm: [["Django: QuerySet API reference", "https://docs.djangoproject.com/en/stable/ref/models/querysets/"], ["Django: Database access optimization", "https://docs.djangoproject.com/en/stable/topics/db/optimization/"], ["Django: Query expressions (F, Subquery, Exists)", "https://docs.djangoproject.com/en/stable/ref/models/expressions/"]],
  perf: [["Django: Database access optimization", "https://docs.djangoproject.com/en/stable/topics/db/optimization/"], ["Django: Cache framework", "https://docs.djangoproject.com/en/stable/topics/cache/"], ["Django: Databases (connection management)", "https://docs.djangoproject.com/en/stable/ref/databases/"], ["PostgreSQL: Using EXPLAIN", "https://www.postgresql.org/docs/current/using-explain.html"]],
  tx: [["Django: Database transactions", "https://docs.djangoproject.com/en/stable/topics/db/transactions/"], ["Django: select_for_update()", "https://docs.djangoproject.com/en/stable/ref/models/querysets/#select-for-update"], ["Django: Constraints reference", "https://docs.djangoproject.com/en/stable/ref/models/constraints/"]],
  migrations: [["Django: Migrations", "https://docs.djangoproject.com/en/stable/topics/migrations/"], ["Django: Migration operations", "https://docs.djangoproject.com/en/stable/ref/migration-operations/"], ["Django: PostgreSQL-specific operations (AddIndexConcurrently)", "https://docs.djangoproject.com/en/stable/ref/contrib/postgres/operations/"], ["Django: Customizing authentication", "https://docs.djangoproject.com/en/stable/topics/auth/customizing/"]],
  async: [["Django: Asynchronous support", "https://docs.djangoproject.com/en/stable/topics/async/"], ["Celery: Tasks user guide", "https://docs.celeryq.dev/en/stable/userguide/tasks.html"]],
  drf: [["DRF: Permissions", "https://www.django-rest-framework.org/api-guide/permissions/"], ["DRF: Pagination", "https://www.django-rest-framework.org/api-guide/pagination/"], ["Stripe API: Idempotent requests", "https://docs.stripe.com/api/idempotent_requests"]],
  security: [["Django: Security overview", "https://docs.djangoproject.com/en/stable/topics/security/"], ["Django: Deployment checklist", "https://docs.djangoproject.com/en/stable/howto/deployment/checklist/"], ["DRF: Throttling", "https://www.django-rest-framework.org/api-guide/throttling/"]],
  arch: [["Django: Managers (custom QuerySets)", "https://docs.djangoproject.com/en/stable/topics/db/managers/"], ["Django: Multiple databases (routers)", "https://docs.djangoproject.com/en/stable/topics/db/multi-db/"], ["PostgreSQL: Row Security Policies", "https://www.postgresql.org/docs/current/ddl-rowsecurity.html"]],
  testing: [["Django: Testing tools", "https://docs.djangoproject.com/en/stable/topics/testing/tools/"], ["pytest-django: database access", "https://pytest-django.readthedocs.io/en/latest/database.html"]],
  ops: [["Django: Deploying Django", "https://docs.djangoproject.com/en/stable/howto/deployment/"], ["Gunicorn: Design (worker types)", "https://docs.gunicorn.org/en/stable/design.html"], ["OpenTelemetry Python: Django instrumentation", "https://opentelemetry-python-contrib.readthedocs.io/en/latest/instrumentation/django/django.html"]],
};
