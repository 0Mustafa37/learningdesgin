/* Instruments for the Senior Django walkthroughs: live metrics (fx), ground tags, setup tables and per-step code.
   Keys: scene id (data/django-scenes.js) → step index → fields. See data/dsl.js for the story API. */
(() => {
  const fails = (e) => e.k === "fail";
  const P = {
    "n-plus-one": {
      0: {
        fx(t, S) {
          const n = S.total(fails), d = S.done(fails, t), q = 1 + Math.round((200 * d) / Math.max(1, n));
          S.metric("db", "Queries", String(q), q > 100 ? "bad" : "warn");
          S.metric("timer", "Time", `~${Math.round(q * 4.5)} ms`, q > 100 ? "bad" : "");
          S.tag("db", `${q} ${q === 1 ? "query" : "queries"} for 100 orders`, q > 1 ? "bad" : "", "db");
          S.tag("view", "lazy access inside a loop", "warn", "alert");
        },
        code: `orders = Order.objects.all()[:100]          # 1 query
for order in orders:
    print(order.customer.name)              # +1 query per order
    print(order.items.count())              # +1 query per order`,
        note: "Django loads relations lazily, so each attribute access inside the loop is a new query.",
      },
      1: {
        code: `orders = Order.objects.select_related("customer")[:100]
# one query: SELECT ... FROM orders JOIN customers ON ...`,
        g: { orm: ["JOIN customer", "ok", "check"] },
      },
      2: {
        setup: [["select_related", "FK / one-to-one → SQL JOIN"], ["prefetch_related", "reverse FK / M2M → 2nd query, joined in Python", "hi"], ["guard", "assertNumQueries in tests"]],
        code: `orders = (Order.objects
          .select_related("customer")
          .prefetch_related("items")[:100])   # 2 queries in total

def test_order_list_queries(self):
    with self.assertNumQueries(2):
        list_orders()`,
        g: { db: ["2 queries", "ok", "check"] },
      },
    },
    "prefetch-object": {
      0: { g: { db: ["filter() after prefetch: 1 + N queries", "bad", "alert"] }, code: `orders = Order.objects.prefetch_related("items")
for o in orders:
    o.items.filter(active=True)   # new query: ignores the prefetch cache` },
      1: { code: `orders = Order.objects.prefetch_related(
    Prefetch("items", queryset=Item.objects.filter(active=True)))` },
      2: { code: `orders = Order.objects.prefetch_related(
    Prefetch("items", queryset=Item.objects.filter(active=True),
             to_attr="active_items"))
for o in orders:
    o.active_items        # a plain list, no extra queries`, g: { cache: ["to_attr: plain list", "ok", "check"] } },
    },
    "queryset-laziness": {
      0: { code: `qs = Order.objects.filter(status="paid")   # no query yet
qs = qs.exclude(total=0)                   # still no query
for o in qs:                               # the query runs here
    ...` },
      1: { setup: [["evaluates", "iteration, len(), list(), bool(), slicing with a step"], ["cached", "the result cache is reused by the same QuerySet", "hi"], ["new query", "every new filter() or count()"]] },
      2: {
        setup: [["iterator()", "streams rows, skips the result cache", "hi"], ["values_list()", "tuples, no model objects"], ["only()", "fewer columns"]],
        code: `for order in Order.objects.filter(year=2026).iterator(chunk_size=2000):
    export(order)   # memory stays flat for millions of rows`,
      },
    },
    "subquery-exists": {
      0: { g: { view: ["one query per customer", "bad", "alert"] } },
      1: { code: `recent = Order.objects.filter(customer=OuterRef("pk"),
                              created_at__gte=since)
customers = (Customer.objects
             .annotate(has_recent=Exists(recent))
             .filter(has_recent=True))` },
      2: { g: { db: ["1 query with EXISTS", "ok", "check"] } },
    },
    "f-expressions": {
      0: {
        g: { db: ["lost update: 11, not 12", "bad", "x"] },
        code: `post = Post.objects.get(pk=pk)
post.views += 1        # read in Python...
post.save()            # ...write back: another request's +1 is lost`,
      },
      1: { code: `Post.objects.filter(pk=pk).update(views=F("views") + 1)   # atomic in SQL`, g: { db: ["UPDATE views = views + 1", "ok", "check"] } },
      2: { code: `post.views = F("views") + 1
post.save(update_fields=["views"])
post.refresh_from_db(fields=["views"])   # load the real number`, note: "After saving an F() expression, the attribute holds the expression until you refresh it." },
    },
    "bulk-ops": {
      0: { g: { db: ["10,000 single INSERTs", "bad", "alert"] } },
      1: { code: `Item.objects.bulk_create(items, batch_size=1000)
Item.objects.bulk_update(items, ["price"], batch_size=1000)` },
      2: { setup: [["save()", "not called"], ["signals", "pre_save / post_save are not sent", "hi"], ["primary keys", "set on PostgreSQL after bulk_create"]] },
    },
    "slow-endpoint": {
      1: { g: { apm: ["DB: 2.7 s of 3.0 s", "warn", "timer"] } },
      2: {
        setup: [["fix", "select_related + the right index"], ["guard", "assertNumQueries in tests", "hi"], ["watch", "p95 alert per endpoint"]],
        code: `def test_order_list_queries(self):
    with self.assertNumQueries(3):
        self.client.get("/api/orders/")`,
      },
    },
    "indexes": {
      0: { g: { db: ["Seq Scan · 1.2 s", "bad", "alert"] } },
      1: { code: `class Order(models.Model):
    ...
    class Meta:
        indexes = [models.Index(fields=["customer", "-created_at"],
                                name="order_cust_created")]`, g: { idx: ["Index Scan · 2 ms", "ok", "check"] } },
      2: { setup: [["partial", "Index(..., condition=Q(active=True))"], ["GIN", "JSONB, arrays, full-text search"], ["covering", "include=[...] for index-only scans", "hi"]] },
    },
    "caching-django": {
      0: { code: `stats = cache.get_or_set(f"stats:{shop_id}",
                        lambda: compute_stats(shop_id), timeout=300)` },
      1: { code: `@receiver(post_save, sender=Order)
def drop_stats(sender, instance, **kwargs):
    transaction.on_commit(lambda: cache.delete(f"stats:{instance.shop_id}"))` },
      2: { g: { db: ["key expired: 500 rebuilds at once", "bad", "alert"] }, setup: [["lock", "cache.add() so one request rebuilds"], ["jitter", "random extra TTL", "hi"], ["stale", "serve the old value while rebuilding"]] },
    },
    "conn-pooling": {
      0: {
        L: 6500,
        fx(t, S) {
          const f = Math.min(1, t / 4200), used = Math.round(12 * f);
          S.pool("db", Array.from({ length: 12 }, (_, i) => (i < used ? "stuck" : "idle")));
          S.metric("cpu", "Connections", f < 1 ? `${Math.round(720 * f)}` : "720 ✗", f < 1 ? "warn" : "bad");
          S.metric("db", "max_connections", "100", "");
          S.tag("db", f < 1 ? "connections filling up" : "FATAL: too many clients already", "bad", "alert");
          S.tag("w", "20 pods × 9 workers × 4 threads", "warn", "cpu");
        },
        note: "PostgreSQL's default max_connections is 100, and each connection is a whole backend process.",
      },
      1: {
        code: `DATABASES["default"]["CONN_MAX_AGE"] = 60           # reuse per worker
DATABASES["default"]["CONN_HEALTH_CHECKS"] = True   # Django 4.1+`,
        g: { w: ["one connection per worker, reused", "ok", "repeat"] },
      },
      2: {
        fx(t, S) {
          const k = Math.floor(t / 300);
          S.pool("pool", Array.from({ length: 8 }, (_, i) => ((i * 7 + k) % 3 === 0 ? "busy" : "idle")));
          S.metric("cpu", "Client connections", "720", "");
          S.metric("db", "Server connections", "50 ✓", "ok");
          S.tag("pool", "transaction pooling", "ok", "repeat");
        },
        setup: [["PgBouncer", "transaction pooling, ~50 server connections", "hi"], ["Django", "CONN_MAX_AGE = 0 behind it"], ["Django 5.1+", "psycopg 3 pool: OPTIONS {\"pool\": True}"]],
        note: "Behind transaction pooling, set DISABLE_SERVER_SIDE_CURSORS = True: server-side cursors don't survive between transactions.",
      },
    },
    "atomic": {
      0: { code: `@transaction.atomic
def place_order(cart):
    order = Order.objects.create(user=cart.user)
    OrderLine.objects.bulk_create(lines_for(order, cart))
    # any exception rolls back both` },
      1: { code: `with transaction.atomic():             # outer transaction
    order.save()
    try:
        with transaction.atomic():         # savepoint
            send_loyalty_points(order)
    except LoyaltyError:
        pass                               # only the savepoint rolled back` },
      2: { g: { tx: ["caught inside atomic: broken transaction", "bad", "x"] }, note: "Catch exceptions outside the atomic() block, never inside it." },
    },
    "on-commit": {
      0: { g: { worker: ["DoesNotExist: row not committed yet", "bad", "x"] } },
      1: { code: `with transaction.atomic():
    order = Order.objects.create(...)
    transaction.on_commit(lambda: send_receipt.delay(order.id))` },
      2: { setup: [["gap", "commit succeeds, broker is down → task lost", "hi"], ["fix", "an outbox table + relay"], ["or", "a periodic job that re-sends missing work"]] },
    },
    "select-for-update": {
      0: {
        fx(t, S) {
          const n = S.total(), d = S.done(() => true, t);
          S.metric("db", "Stock", d < n / 2 ? "1" : "0", d < n / 2 ? "" : "bad");
          S.metric("activity", "Sold", d < n / 2 ? "…" : "2 ✗", d < n / 2 ? "" : "bad");
          S.tag("db", d < n / 2 ? "both read stock = 1" : "the last item was sold twice", d < n / 2 ? "warn" : "bad", d < n / 2 ? "alert" : "x");
        },
        code: `product = Product.objects.get(pk=pk)    # both buyers read stock = 1
if product.stock > 0:
    product.stock -= 1
    product.save()                       # both succeed: oversold`,
      },
      1: { code: `sold = (Product.objects
        .filter(pk=pk, stock__gt=0)
        .update(stock=F("stock") - 1))
if not sold:
    raise OutOfStock()`, g: { db: ["1 row updated, 1 refused", "ok", "check"] } },
      2: { code: `with transaction.atomic():
    product = Product.objects.select_for_update().get(pk=pk)
    if product.stock < qty:
        raise OutOfStock()
    product.stock -= qty
    product.save(update_fields=["stock"])`, setup: [["conditional UPDATE", "one row, simple rule", "hi"], ["select_for_update", "complex checks; keep the transaction short"], ["skip_locked", "for job queues: take the next free row"]] },
    },
    "db-constraints": {
      0: { g: { db: ["2 bookings for one seat", "bad", "x"] } },
      1: { code: `class Booking(models.Model):
    ...
    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["event", "seat"],
                                    name="one_booking_per_seat"),
            models.CheckConstraint(condition=Q(price__gte=0),
                                   name="price_not_negative"),
        ]`, note: "CheckConstraint takes check= instead of condition= before Django 5.1." },
      2: { setup: [["validation", "friendly errors in the serializer"], ["constraint", "the real guarantee, race-proof", "hi"], ["IntegrityError", "catch it and return 409"]] },
    },
    "zero-downtime-migrations": {
      0: { g: { old: ["column missing: 500 errors", "bad", "x"] } },
      1: { setup: [["deploy 1", "add a nullable column, write both", "hi"], ["deploy 2", "backfill, read the new column"], ["deploy 3", "drop the old column"]] },
      2: { code: `# deploy 3, after no running code reads the old column
migrations.RemoveField("order", "customer_name")`, g: { db: ["old column dropped", "ok", "check"] } },
    },
    "data-migrations": {
      0: { code: `def forwards(apps, schema_editor):
    Order = apps.get_model("shop", "Order")   # the historical model
    Order.objects.filter(status="").update(status="new")`, note: "Never import your models directly in a migration: they may not match the schema at that point." },
      1: { g: { db: ["5,000 rows per batch", "info", "db"] } },
      2: { code: `migrations.RunPython(forwards, backwards)
# or, if there's nothing to undo:
migrations.RunPython(forwards, migrations.RunPython.noop)` },
    },
    "custom-user": {
      0: { code: `# settings.py, before the first migration
AUTH_USER_MODEL = "accounts.User"

class User(AbstractUser):
    pass   # empty now, easy to extend later` },
      1: { code: `owner = models.ForeignKey(settings.AUTH_USER_MODEL,
                          on_delete=models.CASCADE)
# in code: get_user_model(), never django.contrib.auth.models.User` },
      2: { setup: [["AbstractUser", "keeps username, names, permissions", "hi"], ["AbstractBaseUser", "only password + last_login; you build the rest"], ["email login", "USERNAME_FIELD = \"email\""]] },
    },
    "async-views": {
      0: { code: `async def dashboard(request):
    async with httpx.AsyncClient(timeout=2) as client:
        weather, rates = await asyncio.gather(
            client.get(WEATHER_URL), client.get(RATES_URL))
    return JsonResponse({"weather": weather.json(), "rates": rates.json()})`, g: { asgi: ["2 calls in parallel", "ok", "activity"] } },
      1: { code: `order = await Order.objects.aget(pk=pk)          # async ORM API
count = await Order.objects.filter(paid=True).acount()
legacy = await sync_to_async(old_report)(order)  # wrap sync code` },
      2: { g: { asgi: ["blocking call: event loop stalls", "bad", "alert"] }, note: "Calling requests.get() or a sync ORM query inside an async view blocks every other request on that worker." },
    },
    "celery-reliability": {
      0: { code: `charge_order.delay(order.id)    # pass IDs, not model instances`, g: { broker: ["payload: {order_id: 42}", "info", "list"] } },
      1: {
        code: `@app.task(bind=True, acks_late=True,
          autoretry_for=(ConnectionError,), retry_backoff=True, max_retries=5)
def charge_order(self, order_id):
    ...
# settings: task_reject_on_worker_lost = True`,
        note: "acks_late acknowledges after the task finishes, so a crashed worker's task is redelivered.",
        g: { worker: ["crashed mid-task → redelivered", "warn", "repeat"] },
      },
      2: { g: { psp: ["Idempotency-Key: order-42", "ok", "key"] }, setup: [["delivery", "at-least-once with acks_late"], ["so", "every task must be idempotent", "hi"], ["how", "state checks + provider idempotency keys"]] },
    },
    "drf-serializer-perf": {
      0: { g: { db: ["301 queries per page", "bad", "alert"] } },
      1: { code: `class OrderViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = OrderSerializer

    def get_queryset(self):
        return (Order.objects
                .select_related("customer")
                .prefetch_related("items__product"))` },
      2: { code: `REST_FRAMEWORK = {
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.CursorPagination",
    "PAGE_SIZE": 50,
}` },
    },
    "drf-permissions": {
      0: { g: { db: ["GET /orders/42 → someone else's order", "bad", "alert"] } },
      1: { code: `def get_queryset(self):
    return Order.objects.filter(owner=self.request.user)` },
      2: { code: `class IsOwner(BasePermission):
    def has_object_permission(self, request, view, obj):
        return obj.owner_id == request.user.id`, note: "Object permissions only run when the view calls get_object(); list views still need a scoped queryset." },
    },
    "api-idempotency": {
      0: {
        fx(t, S) {
          const n = S.total(), d = S.done(() => true, t);
          S.metric("repeat", "Attempts", d > n / 2 ? "2" : "1", d > n / 2 ? "warn" : "");
          S.metric("card", "Charges", d >= n ? "2 ✗" : d > 0 ? "1" : "0", d >= n ? "bad" : "");
          S.tag("client", d > 0 && d < n ? "timed out: retrying" : "", "warn", "hourglass");
        },
      },
      1: { setup: [["key", "client UUID per operation"], ["store", "key, fingerprint, status, response", "hi"], ["race", "a unique constraint on the key"]] },
      2: { g: { api: ["replayed the saved 201", "ok", "repeat"] } },
    },
    "security-basics": {
      1: { g: { tpl: ["|safe on user input: XSS", "bad", "alert"] } },
      2: {
        code: `python manage.py check --deploy`,
        setup: [["DEBUG", "False"], ["SECURE_HSTS_SECONDS", "31536000 (after testing)", "hi"], ["cookies", "SESSION_COOKIE_SECURE, CSRF_COOKIE_SECURE"], ["SECRET_KEY", "from the environment"]],
      },
    },
    "rate-limiting": {
      0: { g: { login: ["10k password guesses / min", "bad", "alert"] } },
      1: { code: `class LoginIPThrottle(AnonRateThrottle):
    scope = "login_ip"            # e.g. "20/min" per IP

class LoginUserThrottle(SimpleRateThrottle):
    scope = "login_user"          # e.g. "5/min" per username
    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope,
                                    "ident": request.data.get("username", "")}` },
      2: { setup: [["edge", "WAF / CDN rules for floods"], ["app", "per IP and per account throttles", "hi"], ["account", "lockout or CAPTCHA after failures"]] },
    },
    "business-logic": {
      0: { g: { view: ["thin: parse, call, respond", "ok", "check"] } },
      1: { code: `# services.py
def place_order(*, user, cart) -> Order:
    with transaction.atomic():
        order = Order.objects.create(user=user, total=cart.total)
        reserve_stock(cart)
    transaction.on_commit(lambda: send_receipt.delay(order.id))
    return order` },
      2: { code: `class OrderQuerySet(models.QuerySet):
    def paid(self):
        return self.filter(status="paid")

class Order(models.Model):
    objects = OrderQuerySet.as_manager()

Order.objects.paid().filter(user=user)` },
    },
    "multi-tenancy": {
      0: {
        setup: [["shared schema", "tenant_id on every row", "hi"], ["schema per tenant", "PostgreSQL schemas (django-tenants)"], ["DB per tenant", "strongest isolation, most ops"]],
        code: `class TenantMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response
    def __call__(self, request):
        request.tenant = Tenant.objects.get(domain=request.get_host())
        return self.get_response(request)

Invoice.objects.filter(tenant=request.tenant)   # scope every query`,
      },
      2: { g: { dedicated: ["big customer: own database", "info", "db"] } },
    },
    "read-replica-routing": {
      0: { code: `class ReplicaRouter:
    def db_for_read(self, model, **hints):
        return "replica"
    def db_for_write(self, model, **hints):
        return "default"` },
      1: { g: { replica: ["lag 1.8 s", "warn", "hourglass"] } },
      2: { code: `# read your own writes: pin to the primary for a moment
order = Order.objects.using("default").get(pk=pk)` },
    },
    "testcase-types": {
      1: { code: `def test_sends_receipt(self):
    with self.captureOnCommitCallbacks(execute=True) as callbacks:
        place_order(user=self.user, cart=self.cart)
    self.assertEqual(len(callbacks), 1)` , note: "TestCase wraps each test in a transaction, so on_commit callbacks never fire unless you capture them." },
      2: { setup: [["TestCase", "fast, rolls back each test", "hi"], ["TransactionTestCase", "real commits, truncates tables: slow"], ["use it for", "select_for_update, multiple connections"]] },
    },
    "production-setup": {
      0: { setup: [["web", "gunicorn behind a load balancer"], ["static", "CDN or WhiteNoise"], ["jobs", "Celery + Redis/RabbitMQ"], ["DB", "PostgreSQL + PgBouncer", "hi"]] },
      1: { code: `gunicorn config.wsgi --workers 5 --threads 2 --timeout 30 \\
    --max-requests 1000 --max-requests-jitter 100`, note: "Gunicorn's docs suggest (2 × CPU cores) + 1 workers as a starting point; --max-requests recycles workers to contain leaks." },
      2: { g: { gunicorn: ["health check: /healthz", "ok", "check"] } },
    },
    "observability": {
      0: { code: `class RequestIDMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response
    def __call__(self, request):
        rid = request.headers.get("X-Request-ID") or uuid.uuid4().hex
        request.request_id = rid
        response = self.get_response(request)
        response["X-Request-ID"] = rid
        return response` },
      1: { setup: [["traces", "OpenTelemetry auto-instrumentation for Django", "hi"], ["errors", "Sentry with release tags"], ["logs", "JSON, with the request ID"]] },
      2: { setup: [["SLO", "99.9% of requests < 300 ms", "hi"], ["alert", "on error-budget burn rate"], ["dashboards", "RED per endpoint"]] },
    },
  };
  const S = window.DJANGO_SCENES || {};
  for (const [id, steps] of Object.entries(P)) {
    const sc = S[id];
    if (!sc) continue;
    for (const [i, patch] of Object.entries(steps)) if (sc.steps[i]) Object.assign(sc.steps[i], patch);
  }
})();
