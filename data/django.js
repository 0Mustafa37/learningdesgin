/* Senior backend Django interview questions.
   level: "Senior" | "Staff"
   a: answer paragraphs (HTML allowed), code: optional Python snippet,
   follow: likely follow-up questions an interviewer will ask next. */
window.DJANGO_CATEGORIES = [
  { id: "orm", title: "ORM & Queries" },
  { id: "perf", title: "Performance" },
  { id: "tx", title: "Transactions & Concurrency" },
  { id: "migrations", title: "Migrations & Schema" },
  { id: "async", title: "Async & Background Jobs" },
  { id: "drf", title: "APIs & DRF" },
  { id: "security", title: "Security" },
  { id: "arch", title: "Architecture" },
  { id: "testing", title: "Testing" },
  { id: "ops", title: "Deployment & Operations" },
];

window.DJANGO_QUESTIONS = [
  /* ───────────── ORM & Queries ───────────── */
  {
    id: "n-plus-one",
    cat: "orm",
    level: "Senior",
    q: "What is the N+1 query problem, and when do you use select_related vs prefetch_related?",
    short: "select_related = SQL JOIN for forward FK / one-to-one; prefetch_related = a second query joined in Python for reverse FK and M2M.",
    a: [
      "N+1 happens when you load N objects with one query, then touch a relation on each, triggering one extra query per object.",
      "<code>select_related</code> follows <b>forward ForeignKey and OneToOne</b> relations with a SQL JOIN, so the data comes back in the same query. <code>prefetch_related</code> handles <b>reverse FKs and ManyToMany</b>: it runs one extra query per relation using <code>IN (...)</code> and stitches the results together in Python.",
      "Detect it with <code>assertNumQueries</code> in tests, django-debug-toolbar locally, or APM query counts in production.",
    ],
    code: `# 1 + N queries: one per order for the customer, one per order for items
for order in Order.objects.all():
    print(order.customer.name, order.items.count())

# 2 queries total
orders = (
    Order.objects
    .select_related("customer")          # JOIN
    .prefetch_related("items")           # 1 extra IN query
)
for order in orders:
    print(order.customer.name, len(order.items.all()))  # len(), not .count()`,
    follow: [
      "Why does calling .count() or .filter() on a prefetched relation trigger a new query?",
      "How would you catch N+1 regressions in CI?",
    ],
  },
  {
    id: "prefetch-object",
    cat: "orm",
    level: "Senior",
    q: "How do you prefetch a filtered or ordered relation without breaking the prefetch cache?",
    short: "Use Prefetch(lookup, queryset=..., to_attr=...) so the filter runs inside the prefetch query.",
    a: [
      "Filtering a prefetched manager (<code>author.books.filter(published=True)</code>) ignores the cache and runs a new query per object, bringing N+1 back.",
      "A <code>Prefetch</code> object lets you pass a custom queryset, including its own <code>select_related</code>, and store the results in a plain list attribute with <code>to_attr</code>.",
    ],
    code: `from django.db.models import Prefetch

authors = Author.objects.prefetch_related(
    Prefetch(
        "books",
        queryset=Book.objects.filter(published=True)
                             .select_related("publisher")
                             .order_by("-published_at"),
        to_attr="published_books",
    )
)
for a in authors:
    a.published_books  # list, no extra queries`,
    follow: ["What's the downside of to_attr vs. overriding the default relation cache?"],
  },
  {
    id: "queryset-laziness",
    cat: "orm",
    level: "Senior",
    q: "Explain QuerySet laziness and caching. When is the query actually executed?",
    short: "QuerySets are lazy; they hit the DB on evaluation (iteration, len, list, bool, slicing with step, repr) and then cache results on that instance.",
    a: [
      "Building a QuerySet with <code>filter</code>, <code>exclude</code> or <code>order_by</code> doesn't touch the database. Evaluation happens on iteration, <code>list()</code>, <code>len()</code>, <code>bool()</code>, pickling, or slicing with a step.",
      "Once evaluated, a QuerySet caches its rows. Re-iterating the same object is free, but chaining a new method creates a new QuerySet with an empty cache.",
      "Use <code>.exists()</code> instead of <code>if qs:</code> when you don't need the rows, and <code>.iterator(chunk_size=...)</code> for large result sets to avoid loading everything into memory. <code>iterator()</code> bypasses the result cache.",
    ],
    code: `qs = User.objects.filter(is_active=True)   # no query yet
if qs.exists():                             # SELECT 1 ... LIMIT 1
    ...

for u in User.objects.iterator(chunk_size=2000):  # streams, no result cache
    export(u)`,
    follow: ["Does .iterator() work together with prefetch_related?"],
  },
  {
    id: "subquery-exists",
    cat: "orm",
    level: "Senior",
    q: "How do you annotate each row with data from another table without N+1, e.g. each customer's latest order date?",
    short: "Use Subquery + OuterRef (or Exists for booleans) inside annotate().",
    a: [
      "<code>Subquery</code> embeds a correlated subquery; <code>OuterRef</code> references a column of the outer query. Use <code>Exists</code> when you only need a boolean: it's cheaper and can be used directly in <code>filter()</code>.",
      "This keeps the work in the database and returns a single queryset you can still filter and order.",
    ],
    code: `from django.db.models import OuterRef, Subquery, Exists

latest = (Order.objects
          .filter(customer=OuterRef("pk"))
          .order_by("-created_at")
          .values("created_at")[:1])

customers = Customer.objects.annotate(
    last_order_at=Subquery(latest),
    has_open_ticket=Exists(Ticket.objects.filter(customer=OuterRef("pk"), open=True)),
).filter(has_open_ticket=True)`,
    follow: ["When would a window function be a better fit than a subquery?"],
  },
  {
    id: "f-expressions",
    cat: "orm",
    level: "Senior",
    q: "Two requests increment the same counter at once and one update is lost. Why, and how do you fix it?",
    short: "Read-modify-write in Python races. Use F() so the database does the increment atomically.",
    a: [
      "<code>obj.views += 1; obj.save()</code> reads the value, increments in Python, and writes it back. Two concurrent requests read the same value and one increment is lost.",
      "<code>F('views') + 1</code> pushes the arithmetic into a single <code>UPDATE ... SET views = views + 1</code>, which the database applies atomically.",
      "After an F() update the in-memory instance holds an expression, so call <code>refresh_from_db()</code> if you need the new value.",
    ],
    code: `from django.db.models import F

Article.objects.filter(pk=pk).update(views=F("views") + 1)

# or on an instance
article.views = F("views") + 1
article.save(update_fields=["views"])
article.refresh_from_db(fields=["views"])`,
    follow: ["What if the rule is 'decrement stock only if stock > 0'?"],
  },
  {
    id: "bulk-ops",
    cat: "orm",
    level: "Senior",
    q: "What are the trade-offs of bulk_create and bulk_update?",
    short: "Far fewer queries, but no save(), no pre/post_save signals, and limited PK return on some databases.",
    a: [
      "They batch many rows into a few queries, often 10–100× faster for imports.",
      "Caveats: <code>Model.save()</code> isn't called and <code>pre_save</code>/<code>post_save</code> signals don't fire, so any logic there is skipped. Set <code>batch_size</code> to stay under parameter limits.",
      "<code>bulk_create(..., update_conflicts=True, unique_fields=..., update_fields=...)</code> gives you an upsert on PostgreSQL, MariaDB, MySQL and SQLite. <code>ignore_conflicts=True</code> skips duplicates but won't set primary keys on the returned objects.",
    ],
    code: `Product.objects.bulk_create(
    [Product(sku=r["sku"], price=r["price"]) for r in rows],
    batch_size=1000,
    update_conflicts=True,
    unique_fields=["sku"],
    update_fields=["price"],
)`,
    follow: ["How would you import 50M rows? (COPY, chunking, disabling indexes, etc.)"],
  },

  /* ───────────── Performance ───────────── */
  {
    id: "slow-endpoint",
    cat: "perf",
    level: "Staff",
    q: "A Django endpoint's p95 jumped from 200 ms to 3 s in production. Walk me through how you'd debug it.",
    short: "Scope it, find which phase grew (DB, external calls, CPU, queueing), confirm with data, fix the biggest contributor, add a guardrail.",
    a: [
      "<b>Scope:</b> is it one endpoint or all? Since when? Correlate with deploys, traffic, data growth and infra changes.",
      "<b>Break down the time</b> with APM traces (OpenTelemetry, Sentry, Datadog): DB time vs external HTTP vs Python CPU vs time waiting for a worker. If every endpoint is slow, suspect worker saturation or DB-wide problems.",
      "<b>DB:</b> query count (N+1 after a serializer change?), slow queries in <code>pg_stat_statements</code>, <code>EXPLAIN ANALYZE</code> for a missing index or a plan flip, lock waits.",
      "<b>Fix and guard:</b> add the index or prefetch, add <code>assertNumQueries</code> or a performance test, and alert on p95 for that route.",
    ],
    code: `# quick check from a shell
from django.db import connection
from django.test.utils import CaptureQueriesContext

with CaptureQueriesContext(connection) as ctx:
    client.get("/api/orders/")
print(len(ctx.captured_queries))
print(Order.objects.filter(status="open").explain(analyze=True))`,
    follow: ["How do you tell DB slowness from Gunicorn worker starvation?"],
  },
  {
    id: "indexes",
    cat: "perf",
    level: "Senior",
    q: "How do you decide which indexes to add, and what index types does Django support?",
    short: "Index for real query patterns (filter + order), verify with EXPLAIN; use composite, partial, covering and GIN/BRIN where they fit.",
    a: [
      "Start from slow or frequent queries, not from fields. A composite index should match the filter columns first (equality before range), then the ordering.",
      "<b>Partial indexes</b> (<code>condition=</code>) index only the rows you query, e.g. open orders. <b>Covering indexes</b> (<code>include=</code>, PostgreSQL) allow index-only scans. <code>GinIndex</code> works for JSONB, arrays and full-text search; <code>BrinIndex</code> suits huge append-only time series.",
      "Every index slows writes and uses memory, so drop unused ones (<code>pg_stat_user_indexes</code>).",
    ],
    code: `from django.contrib.postgres.indexes import GinIndex
from django.db.models import Index, Q

class Order(models.Model):
    class Meta:
        indexes = [
            Index(fields=["customer", "-created_at"], name="order_cust_created"),
            Index(fields=["created_at"], condition=Q(status="open"),
                  name="order_open_created"),
            GinIndex(fields=["metadata"], name="order_meta_gin"),
        ]`,
    follow: ["Why might Postgres ignore your index?", "How do you add an index to a 200M-row table without downtime?"],
  },
  {
    id: "caching-django",
    cat: "perf",
    level: "Senior",
    q: "What caching layers does Django offer, and how do you keep cached data correct?",
    short: "Per-site, per-view, template fragment and low-level cache API; invalidate on write (transaction.on_commit) or version keys.",
    a: [
      "Layers: per-site middleware, <code>@cache_page</code> per view, the <code>{% cache %}</code> template fragment tag, and the low-level API (<code>cache.get/set/get_or_set</code>). Low-level caching of computed data gives the most control.",
      "Correctness: delete keys after writes commit (<code>transaction.on_commit</code>), or embed a version or <code>updated_at</code> in the key so stale entries are never read.",
      "Hot keys: prevent stampedes with a lock or single-flight recompute and TTL jitter. Never cache per-user data under a shared key.",
    ],
    code: `from django.core.cache import cache
from django.db import transaction

def get_product(pk):
    return cache.get_or_set(f"product:{pk}:v2",
                            lambda: ProductDTO.from_model(Product.objects.get(pk=pk)),
                            timeout=300)

def update_price(product, price):
    with transaction.atomic():
        product.price = price
        product.save(update_fields=["price"])
        transaction.on_commit(lambda: cache.delete(f"product:{product.pk}:v2"))`,
    follow: ["Why delete after commit rather than before?"],
  },
  {
    id: "conn-pooling",
    cat: "perf",
    level: "Senior",
    q: "How does Django manage database connections, and when do you need a pooler?",
    short: "By default one connection per request/thread; CONN_MAX_AGE keeps them alive; Django 5.1+ has native psycopg pooling; PgBouncer for many processes.",
    a: [
      "With <code>CONN_MAX_AGE=0</code> (default), Django opens and closes a connection per request. A positive value reuses persistent connections per thread; <code>CONN_HEALTH_CHECKS=True</code> verifies them before reuse.",
      "Since Django 5.1 the PostgreSQL backend supports psycopg 3 connection pools via <code>OPTIONS={'pool': True}</code>.",
      "With many Gunicorn workers × pods, total connections can exceed Postgres' limit. A server-side pooler like PgBouncer in transaction mode fixes this. In that mode, avoid session-level features such as server-side cursors (<code>DISABLE_SERVER_SIDE_CURSORS = True</code>) and session advisory locks.",
    ],
    code: `DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": "app",
        "CONN_MAX_AGE": 60,
        "CONN_HEALTH_CHECKS": True,
        # Django 5.1+: native pool (don't combine with CONN_MAX_AGE)
        # "OPTIONS": {"pool": {"min_size": 2, "max_size": 10}},
    }
}`,
    follow: ["Why are persistent connections a problem with async views?"],
  },

  /* ───────────── Transactions & Concurrency ───────────── */
  {
    id: "atomic",
    cat: "tx",
    level: "Senior",
    q: "How does transaction.atomic work, including nesting and savepoints?",
    short: "Outermost atomic opens a transaction; nested atomic blocks create savepoints that can roll back independently.",
    a: [
      "The outermost <code>atomic()</code> starts a transaction and commits on clean exit or rolls back on exception. Nested blocks create savepoints, so an exception inside rolls back only to that savepoint, as long as you catch it <i>outside</i> the inner block.",
      "Catching a DatabaseError <i>inside</i> an atomic block without a savepoint leaves the transaction broken, and further queries raise <code>TransactionManagementError</code>.",
      "<code>ATOMIC_REQUESTS=True</code> wraps every view in a transaction. It's convenient, but it holds locks for the whole request, including slow external calls.",
    ],
    code: `from django.db import transaction, IntegrityError

with transaction.atomic():
    order = Order.objects.create(...)
    try:
        with transaction.atomic():          # savepoint
            Coupon.objects.create(order=order, code=code)
    except IntegrityError:
        pass                                 # coupon rolled back, order survives`,
    follow: ["Why shouldn't you call an external payment API inside atomic()?"],
  },
  {
    id: "on-commit",
    cat: "tx",
    level: "Senior",
    q: "Why should you enqueue Celery tasks with transaction.on_commit?",
    short: "Otherwise the worker can run before the transaction commits (row not visible) or after a rollback (row never existed).",
    a: [
      "If you call <code>task.delay(order.id)</code> inside a transaction, a fast worker may query the order before the commit and get <code>DoesNotExist</code>. If the transaction rolls back, the task processes data that never existed.",
      "<code>transaction.on_commit</code> defers the callback until the outermost transaction commits, and drops it on rollback. Celery 5.4+ also ships <code>delay_on_commit()</code>.",
    ],
    code: `from functools import partial
from django.db import transaction

with transaction.atomic():
    order = Order.objects.create(...)
    transaction.on_commit(partial(send_confirmation.delay, order.id))

# tests: use self.captureOnCommitCallbacks(execute=True)`,
    follow: ["What happens if the process crashes after commit but before the task is enqueued? (transactional outbox)"],
  },
  {
    id: "select-for-update",
    cat: "tx",
    level: "Senior",
    q: "How do you prevent overselling the last item in stock when two users check out simultaneously?",
    short: "Lock the row with select_for_update() inside atomic(), or use a conditional UPDATE with F() and check the affected row count.",
    a: [
      "<b>Pessimistic:</b> <code>select_for_update()</code> takes a row lock until the transaction ends. The second buyer blocks, then sees the updated stock. It must run inside <code>atomic()</code>. <code>nowait=True</code> fails fast and <code>skip_locked=True</code> skips locked rows, which is ideal for job queues.",
      "<b>Optimistic / conditional:</b> <code>filter(pk=..., stock__gte=qty).update(stock=F('stock') - qty)</code> returns the number of rows updated; 0 means sold out. It takes no long-held locks.",
      "Lock rows in a consistent order (e.g. by PK) to avoid deadlocks, and keep locked transactions short.",
    ],
    code: `from django.db import transaction
from django.db.models import F

# conditional update – usually the best choice
updated = (Product.objects
           .filter(pk=pid, stock__gte=qty)
           .update(stock=F("stock") - qty))
if not updated:
    raise OutOfStock

# pessimistic lock when you need to read then decide
with transaction.atomic():
    p = Product.objects.select_for_update().get(pk=pid)
    if p.stock < qty:
        raise OutOfStock
    p.stock -= qty
    p.save(update_fields=["stock"])`,
    follow: ["How would you build a job queue on Postgres with skip_locked?"],
  },
  {
    id: "db-constraints",
    cat: "tx",
    level: "Senior",
    q: "Why enforce rules with database constraints instead of only in forms or serializers?",
    short: "App-level checks race under concurrency and are bypassed by bulk ops, scripts and other services; constraints are the final guarantee.",
    a: [
      "A check like 'email must be unique' in a serializer does a SELECT then an INSERT, and two concurrent requests can both pass. Only a unique constraint guarantees it.",
      "Django supports <code>UniqueConstraint</code> (with <code>condition</code>, <code>fields</code> or expressions) and <code>CheckConstraint</code>. Since Django 4.1, <code>full_clean()</code> validates them too.",
      "Keep app-level validation for friendly error messages, and treat the database as the source of truth (catch <code>IntegrityError</code>).",
    ],
    code: `from django.db.models import CheckConstraint, Q, UniqueConstraint
from django.db.models.functions import Lower

class Membership(models.Model):
    class Meta:
        constraints = [
            UniqueConstraint(fields=["team", "user"], condition=Q(deleted_at__isnull=True),
                             name="uniq_active_membership"),
            UniqueConstraint(Lower("email"), name="uniq_email_ci"),
            CheckConstraint(condition=Q(seats__gte=0),  # Django 5.1+ (check= before)
                            name="seats_non_negative"),
        ]`,
    follow: ["How do you add a constraint to a large table with existing bad data?"],
  },

  /* ───────────── Migrations ───────────── */
  {
    id: "zero-downtime-migrations",
    cat: "migrations",
    level: "Staff",
    q: "How do you run schema migrations with zero downtime on a large, busy table?",
    short: "Expand → migrate → contract: backward-compatible steps, batched backfills, concurrent indexes, and never drop what running code still uses.",
    a: [
      "During a rolling deploy, old and new code run side by side, so each migration must be compatible with both.",
      "<b>Add a column:</b> add it nullable (or with a <code>db_default</code> in Django 5.0+, which Postgres 11+ applies without a rewrite), backfill in batches, then add NOT NULL or constraints in a later release.",
      "<b>Indexes:</b> use <code>AddIndexConcurrently</code> from <code>django.contrib.postgres.operations</code> in a migration with <code>atomic = False</code>.",
      "<b>Rename or remove:</b> never in one step. Add the new field, dual-write, backfill, switch reads, then drop the old one. Use <code>SeparateDatabaseAndState</code> to drop a field from the model before dropping the column. Set <code>lock_timeout</code> so a migration that can't get its lock fails fast instead of queueing all traffic behind it.",
    ],
    code: `from django.contrib.postgres.operations import AddIndexConcurrently
from django.db import migrations, models

class Migration(migrations.Migration):
    atomic = False
    dependencies = [("orders", "0041_order_region")]
    operations = [
        AddIndexConcurrently(
            "order",
            models.Index(fields=["region", "created_at"], name="order_region_created"),
        ),
    ]`,
    follow: ["How do you backfill 100M rows without long locks or replication lag?"],
  },
  {
    id: "data-migrations",
    cat: "migrations",
    level: "Senior",
    q: "What are the rules for writing a data migration with RunPython?",
    short: "Use apps.get_model (historical models), batch the work, make it reversible or explicitly noop, and keep it idempotent.",
    a: [
      "Import models via <code>apps.get_model('app', 'Model')</code>, never directly. The historical model matches the schema at that point in history. Custom methods and managers aren't available unless <code>use_in_migrations = True</code>.",
      "Process rows in batches to avoid giant transactions, provide <code>reverse_code</code> (or <code>RunPython.noop</code>), and make the code safe to re-run.",
      "For very large backfills, prefer a management command or background job run outside the deploy, and keep the migration for schema only.",
    ],
    code: `def forwards(apps, schema_editor):
    Order = apps.get_model("orders", "Order")
    qs = Order.objects.filter(region__isnull=True).only("pk", "country")
    batch = []
    for o in qs.iterator(chunk_size=5000):
        o.region = REGION_BY_COUNTRY.get(o.country, "other")
        batch.append(o)
        if len(batch) == 5000:
            Order.objects.bulk_update(batch, ["region"]); batch.clear()
    Order.objects.bulk_update(batch, ["region"])

class Migration(migrations.Migration):
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]`,
    follow: ["How do you squash migrations in a long-lived project?"],
  },
  {
    id: "custom-user",
    cat: "migrations",
    level: "Senior",
    q: "Why set a custom user model at project start, and how do you reference users in other models?",
    short: "Swapping AUTH_USER_MODEL later is a painful manual migration; always reference settings.AUTH_USER_MODEL / get_user_model().",
    a: [
      "Changing <code>AUTH_USER_MODEL</code> after the first migration affects foreign keys and M2M tables everywhere, and Django doesn't automate it. Starting with <code>class User(AbstractUser): pass</code> costs nothing and keeps you flexible.",
      "Use <code>AbstractUser</code> to extend the defaults, or <code>AbstractBaseUser</code> + <code>PermissionsMixin</code> for full control (e.g. email as username).",
      "In models use <code>settings.AUTH_USER_MODEL</code>; at runtime use <code>get_user_model()</code>. Keep profile-like data in a separate one-to-one model if it's large or optional.",
    ],
    code: `# accounts/models.py
class User(AbstractUser):
    email = models.EmailField(unique=True)

# settings.py
AUTH_USER_MODEL = "accounts.User"

# elsewhere
owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)`,
    follow: [],
  },

  /* ───────────── Async & Background Jobs ───────────── */
  {
    id: "async-views",
    cat: "async",
    level: "Senior",
    q: "When do async views in Django actually help, and what are the pitfalls?",
    short: "They help with many concurrent I/O-bound waits (external APIs, streaming) under ASGI; mixing sync code adds thread hops and can block the loop.",
    a: [
      "Async views pay off under ASGI when a request spends most of its time waiting on network I/O, e.g. fanning out to several HTTP APIs with <code>httpx.AsyncClient</code>, long polling or SSE.",
      "The ORM has async methods (<code>aget</code>, <code>acreate</code>, <code>async for</code>), but queries still run in a thread pool underneath. Synchronous middleware forces thread switching per request.",
      "Never call blocking code (<code>requests</code>, <code>time.sleep</code>, sync ORM) directly in an async view. Wrap it with <code>sync_to_async</code>. Under WSGI, async views gain nothing.",
    ],
    code: `import asyncio, httpx
from django.http import JsonResponse

async def dashboard(request):
    async with httpx.AsyncClient(timeout=2) as client:
        weather, rates = await asyncio.gather(
            client.get(WEATHER_URL), client.get(RATES_URL)
        )
    user = await User.objects.aget(pk=request.user.pk)
    return JsonResponse({"user": user.username,
                         "weather": weather.json(), "rates": rates.json()})`,
    follow: ["What does thread_sensitive=True mean in sync_to_async?"],
  },
  {
    id: "celery-reliability",
    cat: "async",
    level: "Senior",
    q: "How do you make Celery tasks reliable?",
    short: "Idempotent tasks, pass IDs not objects, retries with backoff for transient errors, acks_late for crash safety, timeouts, and monitoring.",
    a: [
      "<b>Idempotency:</b> tasks may run more than once (retries, redelivery), so design them to be safe to repeat, e.g. by checking state or using idempotency keys.",
      "<b>Arguments:</b> pass primary keys and re-fetch inside the task. Serialized model instances go stale.",
      "<b>Retries:</b> <code>autoretry_for</code> on transient errors, with <code>retry_backoff</code> and <code>max_retries</code>. <b>acks_late</b> + <code>reject_on_worker_lost</code> redeliver if a worker dies mid-task. Set <code>time_limit</code>/<code>soft_time_limit</code>.",
      "Separate queues for slow vs latency-sensitive work, and alert on queue depth and task failure rate.",
    ],
    code: `@shared_task(
    bind=True,
    acks_late=True,
    autoretry_for=(requests.ConnectionError, requests.Timeout),
    retry_backoff=True, retry_jitter=True, max_retries=5,
    soft_time_limit=30,
)
def charge_invoice(self, invoice_id):
    invoice = Invoice.objects.get(pk=invoice_id)
    if invoice.status == Invoice.PAID:
        return                                    # idempotent
    payments.charge(invoice, idempotency_key=f"inv-{invoice.pk}")`,
    follow: ["How do you handle a task that keeps failing permanently? (dead-letter queue)"],
  },

  /* ───────────── DRF ───────────── */
  {
    id: "drf-serializer-perf",
    cat: "drf",
    level: "Senior",
    q: "A DRF list endpoint is slow. What are common causes in serializers, and how do you fix them?",
    short: "Nested serializers and SerializerMethodFields causing N+1; fix with select/prefetch in get_queryset, annotations, and pagination.",
    a: [
      "Nested serializers and <code>SerializerMethodField</code>s often touch relations per object. Optimise in the view's <code>get_queryset()</code> with <code>select_related</code>/<code>prefetch_related</code>, and compute counts with <code>annotate()</code> instead of <code>obj.items.count()</code>.",
      "Always paginate list endpoints. <code>CursorPagination</code> stays fast on deep pages and is stable under inserts, unlike <code>OFFSET</code>.",
      "For very hot read endpoints, serialising with <code>.values()</code> or a plain function can be several times faster than ModelSerializer.",
    ],
    code: `class OrderViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = OrderSerializer
    pagination_class = CursorPagination

    def get_queryset(self):
        return (Order.objects
                .filter(account=self.request.user.account)
                .select_related("customer")
                .prefetch_related("items__product")
                .annotate(item_count=Count("items")))`,
    follow: ["How do you test that the endpoint's query count stays constant as data grows?"],
  },
  {
    id: "drf-permissions",
    cat: "drf",
    level: "Senior",
    q: "How do you implement object-level authorization and multi-tenant isolation in DRF?",
    short: "Scope get_queryset to the tenant/user (primary defence) and add has_object_permission for finer rules.",
    a: [
      "The most important control is <b>filtering the queryset</b> by the current user or tenant. Objects the user can't see then return 404, and list endpoints can't leak data.",
      "<code>has_object_permission</code> adds rules such as 'only owners can edit'. It runs only when <code>get_object()</code> is called, <i>not</i> for list views, so it can't replace queryset scoping.",
      "Add tests that request another tenant's IDs and expect 404, because IDOR bugs are the most common API vulnerability.",
    ],
    code: `class IsOwnerOrReadOnly(permissions.BasePermission):
    def has_object_permission(self, request, view, obj):
        if request.method in permissions.SAFE_METHODS:
            return True
        return obj.owner_id == request.user.id

class ProjectViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, IsOwnerOrReadOnly]
    def get_queryset(self):
        return Project.objects.filter(account=self.request.user.account)`,
    follow: ["How would you enforce tenant scoping so a developer can't forget it?"],
  },
  {
    id: "api-idempotency",
    cat: "drf",
    level: "Staff",
    q: "How do you make a POST /payments endpoint safe against client retries?",
    short: "Require an Idempotency-Key header, store it with a unique constraint and the response, and replay the stored response on retries.",
    a: [
      "Networks time out after the server has already processed a request, so clients retry. Without protection that creates double charges.",
      "Require an <code>Idempotency-Key</code> header. In one transaction, insert a row keyed by (account, key) under a unique constraint. If it already exists, return the stored response; if it's still in progress, return 409.",
      "Also hash the request body and reject a reused key with different parameters.",
    ],
    code: `def create_payment(request):
    key = request.headers.get("Idempotency-Key")
    if not key:
        return JsonResponse({"error": "Idempotency-Key required"}, status=400)
    try:
        with transaction.atomic():
            record = IdempotencyRecord.objects.create(account=request.account, key=key,
                                                      request_hash=hash_body(request.body))
            payment = Payment.objects.create(...)
            record.response = PaymentSerializer(payment).data
            record.save(update_fields=["response"])
    except IntegrityError:
        record = IdempotencyRecord.objects.get(account=request.account, key=key)
        if record.response is None:
            return JsonResponse({"error": "in progress"}, status=409)
    return JsonResponse(record.response, status=201)`,
    follow: ["How long should keys be retained, and how do you clean them up?"],
  },

  /* ───────────── Security ───────────── */
  {
    id: "security-basics",
    cat: "security",
    level: "Senior",
    q: "Which security protections does Django give you by default, and how do developers accidentally disable them?",
    short: "CSRF, auto-escaping (XSS), parameterised queries (SQLi), clickjacking headers, password hashing — undone by csrf_exempt, mark_safe/|safe, raw SQL with string formatting.",
    a: [
      "<b>XSS:</b> templates auto-escape. <code>mark_safe</code>, <code>|safe</code> and <code>{% autoescape off %}</code> on user input disable it.",
      "<b>SQL injection:</b> the ORM parameterises queries. <code>raw()</code>, <code>extra()</code> and <code>cursor.execute()</code> with f-strings undo that, so always pass params separately.",
      "<b>CSRF:</b> middleware protects cookie-authenticated forms. <code>@csrf_exempt</code> on session-auth endpoints reopens the hole.",
      "Run <code>manage.py check --deploy</code> and set <code>SECURE_HSTS_SECONDS</code>, <code>SESSION_COOKIE_SECURE</code>, <code>CSRF_COOKIE_SECURE</code>, <code>SECURE_PROXY_SSL_HEADER</code> (only behind a trusted proxy), plus a strict <code>ALLOWED_HOSTS</code>.",
    ],
    code: `# vulnerable
cursor.execute(f"SELECT * FROM users WHERE email = '{email}'")

# safe
cursor.execute("SELECT * FROM users WHERE email = %s", [email])
User.objects.raw("SELECT * FROM auth_user WHERE email = %s", [email])`,
    follow: ["How do you store secrets and rotate SECRET_KEY safely? (SECRET_KEY_FALLBACKS)"],
  },
  {
    id: "rate-limiting",
    cat: "security",
    level: "Senior",
    q: "How would you protect a login endpoint from brute force and credential stuffing?",
    short: "Rate limit per IP and per account (Redis-backed), progressive delays or lockout, MFA, breached-password checks, and generic error messages.",
    a: [
      "Throttle on two dimensions: per IP (blocks single-source attacks) and per username (blocks distributed attacks on one account). Use a shared store like Redis so limits hold across all app servers.",
      "Use generic messages ('invalid credentials') to avoid user enumeration, and add progressive delays or CAPTCHA after failures. Lock out temporarily rather than permanently, so attackers can't lock out real users.",
      "Offer MFA and use Argon2 or PBKDF2 hashing (Django defaults to PBKDF2; Argon2 is available via <code>PASSWORD_HASHERS</code>).",
    ],
    code: `# DRF throttling
REST_FRAMEWORK = {
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.ScopedRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {"login": "5/min"},
}

class LoginView(APIView):
    throttle_scope = "login"`,
    follow: ["Why must the throttle cache be shared across processes?"],
  },

  /* ───────────── Architecture ───────────── */
  {
    id: "business-logic",
    cat: "arch",
    level: "Staff",
    q: "Where should business logic live in a large Django codebase: models, views, signals or services?",
    short: "Keep views thin; put queries in custom QuerySets/managers and multi-step workflows in explicit service functions; use signals sparingly.",
    a: [
      "<b>Views/serializers:</b> HTTP concerns only (parse, authorize, call domain code, render).",
      "<b>Models + custom QuerySets:</b> invariants of a single model and reusable query logic (<code>Order.objects.open().for_account(a)</code>).",
      "<b>Services:</b> workflows that touch several models, external APIs or transactions (<code>place_order()</code>). They're easy to test and to call from views, commands and tasks.",
      "<b>Signals</b> hide control flow and fire on <code>save()</code> but not <code>update()</code> or bulk operations. Reserve them for decoupling truly separate apps, or prefer explicit calls.",
    ],
    code: `class OrderQuerySet(models.QuerySet):
    def open(self):
        return self.filter(status=Order.Status.OPEN)
    def for_account(self, account):
        return self.filter(account=account)

class Order(models.Model):
    objects = OrderQuerySet.as_manager()

# services.py
def place_order(*, account, cart) -> Order:
    with transaction.atomic():
        order = Order.objects.create(account=account, total=cart.total)
        reserve_stock(cart.items)
        transaction.on_commit(lambda: send_receipt.delay(order.pk))
    return order`,
    follow: ["How do you stop apps from importing each other's models everywhere?"],
  },
  {
    id: "multi-tenancy",
    cat: "arch",
    level: "Staff",
    q: "Compare approaches to multi-tenancy in Django.",
    short: "Shared tables + tenant_id (simplest, scales well), schema-per-tenant (stronger isolation, migration cost), database-per-tenant (strongest, most ops).",
    a: [
      "<b>Shared schema, tenant_id column:</b> cheapest and easiest to query across tenants. The risk is a missing filter leaking data. Mitigate with tenant-aware managers, middleware that sets the current tenant, and Postgres Row-Level Security as a backstop.",
      "<b>Schema per tenant</b> (e.g. django-tenants): good isolation and easy per-tenant restore, but migrations run N times and thousands of schemas strain Postgres.",
      "<b>Database per tenant:</b> best isolation and noisy-neighbour control, suited to few, large or regulated customers, with the highest operational cost. Many SaaS products mix approaches: shared by default, dedicated for enterprise.",
    ],
    code: null,
    follow: ["How would you move a large tenant to a dedicated database with no downtime?"],
  },
  {
    id: "read-replica-routing",
    cat: "arch",
    level: "Senior",
    q: "How do you route reads to replicas in Django, and what can go wrong?",
    short: "Use a database router (db_for_read/db_for_write) or .using(); watch for replication lag breaking read-your-writes.",
    a: [
      "Define multiple <code>DATABASES</code> and a router class in <code>DATABASE_ROUTERS</code>. <code>db_for_read</code> can return a replica, and <code>db_for_write</code> always returns the primary.",
      "Problem: replicas lag, so a user who just saved data may not see it. Pin reads to the primary for a while after writes (a cookie or thread-local flag set by middleware), and always read from the primary inside transactions.",
      "Also set <code>allow_migrate</code> so migrations run only against the primary.",
    ],
    code: `import random

class PrimaryReplicaRouter:
    def db_for_read(self, model, **hints):
        if get_pin_to_primary():          # set by middleware after a write
            return "default"
        return random.choice(["replica1", "replica2"])

    def db_for_write(self, model, **hints):
        return "default"

    def allow_relation(self, obj1, obj2, **hints):
        return True

    def allow_migrate(self, db, app_label, **hints):
        return db == "default"`,
    follow: [],
  },

  /* ───────────── Testing ───────────── */
  {
    id: "testcase-types",
    cat: "testing",
    level: "Senior",
    q: "TestCase vs TransactionTestCase: what's the difference and when do you need each?",
    short: "TestCase wraps each test in a transaction rolled back at the end (fast); TransactionTestCase truncates tables, needed to test real commit behaviour.",
    a: [
      "<code>TestCase</code> runs each test inside a transaction (plus <code>setUpTestData</code> at class level) and rolls back, so it's fast. Because nothing really commits, <code>on_commit</code> callbacks don't fire unless you use <code>captureOnCommitCallbacks</code>.",
      "<code>TransactionTestCase</code> lets transactions commit and flushes tables afterwards. Use it for row locking with multiple connections, threading, or code that depends on transaction boundaries. It's much slower.",
      "With pytest-django: <code>@pytest.mark.django_db</code> vs <code>@pytest.mark.django_db(transaction=True)</code>.",
    ],
    code: `class CheckoutTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.product = ProductFactory(stock=1)

    def test_sends_receipt_after_commit(self):
        with self.captureOnCommitCallbacks(execute=True) as callbacks:
            place_order(account=self.account, cart=make_cart(self.product))
        self.assertEqual(len(callbacks), 1)

    def test_list_query_count_is_constant(self):
        OrderFactory.create_batch(20)
        with self.assertNumQueries(3):
            self.client.get("/api/orders/")`,
    follow: ["How do you keep a 5,000-test suite fast? (parallel, setUpTestData, factories, avoid TransactionTestCase)"],
  },

  /* ───────────── Operations ───────────── */
  {
    id: "production-setup",
    cat: "ops",
    level: "Senior",
    q: "Describe a production deployment for a Django app. How do you size Gunicorn workers?",
    short: "Reverse proxy/LB → Gunicorn (or Uvicorn for ASGI) in containers; static files via CDN/WhiteNoise; Postgres, Redis, Celery; workers sized by CPU and I/O profile, verified by load tests.",
    a: [
      "A typical stack: load balancer → Gunicorn running WSGI (or Uvicorn/Gunicorn with uvicorn workers for ASGI) in containers, static files from a CDN or WhiteNoise after <code>collectstatic</code>, PostgreSQL (plus a pooler), Redis for cache and broker, and Celery workers.",
      "Workers: start around <code>2 × cores + 1</code> sync workers for CPU-light, I/O-moderate apps. For I/O-heavy apps, use <code>gthread</code> with threads. Each worker holds a DB connection, so multiply by pods to check against Postgres limits. Confirm with a load test, not a formula.",
      "Configure via environment variables (12-factor), set <code>DEBUG=False</code>, add liveness/readiness endpoints, structured logging, request timeouts shorter than the LB's, <code>--max-requests</code> to contain memory leaks, and run migrations as a separate release step.",
    ],
    code: `# gunicorn.conf.py
import multiprocessing
workers = multiprocessing.cpu_count() * 2 + 1
worker_class = "gthread"
threads = 4
timeout = 30
max_requests = 2000
max_requests_jitter = 200
accesslog = "-"`,
    follow: ["How do you deploy a migration that removes a column with rolling deploys?"],
  },
  {
    id: "observability",
    cat: "ops",
    level: "Senior",
    q: "What would you instrument in a Django service to run it confidently in production?",
    short: "RED metrics per endpoint, distributed traces including DB/HTTP spans, structured logs with request IDs, error tracking, and queue/DB health.",
    a: [
      "<b>Metrics:</b> request rate, errors and duration (p50/p95/p99) per route, Celery queue depth and task latency, DB connections, slow-query counts and cache hit ratio.",
      "<b>Traces:</b> OpenTelemetry auto-instrumentation for Django, psycopg, Redis and requests/httpx shows where request time goes.",
      "<b>Logs:</b> structured JSON with a request ID propagated to tasks. Never log secrets or PII.",
      "<b>Errors:</b> Sentry or similar with release tags. Then define SLOs and alert on symptoms (error rate, latency) rather than causes.",
    ],
    code: `# middleware adding a request id to every log line
import uuid, contextvars, logging
request_id = contextvars.ContextVar("request_id", default="-")

class RequestIdMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response
    def __call__(self, request):
        rid = request.headers.get("X-Request-ID") or uuid.uuid4().hex
        token = request_id.set(rid)
        try:
            response = self.get_response(request)
            response["X-Request-ID"] = rid
            return response
        finally:
            request_id.reset(token)`,
    follow: ["Why use contextvars instead of threading.local?"],
  },
];
