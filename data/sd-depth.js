/* Extra depth for system-design lessons: setup tables, code and ground tags per step.
   Keys: lesson id → step index → fields (see data/dsl.js). */
(() => {
  const P = {
    "anatomy-of-a-request": {
      1: { g: { dns: ["cached after the first lookup", "info", "timer"] } },
      2: { setup: [["TCP", "1 round trip"], ["TLS 1.3", "1 more round trip", "hi"], ["reuse", "keep-alive / HTTP/2 skip it next time"]] },
      3: {
        code: `# where did the server time go? log it per request
timer = QueryTimer()               # counts queries and their time
start = time.perf_counter()
with connection.execute_wrapper(timer):
    response = view(request)
log.info("app_ms=%d db_ms=%d queries=%d",
         (time.perf_counter() - start) * 1000, timer.ms, timer.count)`,
        note: "Django's execute_wrapper sees every SQL query, so you can split app time from database time.",
      },
      5: { setup: [["HTML / API", "from the origin"], ["JS, CSS, images", "from a CDN edge near the user", "hi"], ["caching", "long max-age + hashed file names"]] },
    },
    "latency-and-throughput": {
      1: { setup: [["Little's law", "in flight = arrival rate × time in system", "hi"], ["example", "200 req/s × 0.25 s = 50 in flight"], ["so", "you need about 50 concurrent workers"]] },
      2: { g: { queue: ["90% busy: waits explode", "bad", "alert"] } },
      3: { setup: [["p50", "the typical request"], ["p99", "1 in 100 requests", "hi"], ["measure", "histograms, not averages"]] },
    },
    "napkin-math": {
      1: { setup: [["traffic", "10M users × 20 req = 200M req/day"], ["÷ 86,400 s", "≈ 2,300 req/s on average", "hi"], ["peak", "× 2–3 ≈ 7,000 req/s"]] },
      2: { setup: [["writes", "10M × 2 items × 1 KB = 20 GB/day"], ["per year", "× 365 ≈ 7.3 TB", "hi"], ["with 3 replicas", "≈ 22 TB"]] },
    },
    "vertical-vs-horizontal": {
      1: { g: { a2: ["bigger box: easy, but it has a ceiling", "warn", "alert"] } },
      2: { setup: [["scale up", "simple; one failure domain; hard ceiling"], ["scale out", "needs stateless apps + a load balancer", "hi"], ["data tier", "usually the hard part"]] },
    },
    "load-balancing": {
      2: { setup: [["round robin", "equal servers, similar requests"], ["least connections", "requests of uneven cost", "hi"], ["consistent hashing", "keep a key on the same server"]] },
      3: {
        code: `upstream app {
    least_conn;
    server a1:8000 max_fails=3 fail_timeout=10s;
    server a2:8000 max_fails=3 fail_timeout=10s;
    server a3:8000 max_fails=3 fail_timeout=10s;
}`,
        note: "Open-source nginx takes a server out after failed requests (passive checks). Active health checks need NGINX Plus or a cloud load balancer.",
      },
    },
    "stateless-services": {
      1: { g: { lb: ["sticky sessions: uneven load", "warn", "alert"] } },
      2: {
        code: `# sessions in Redis, so any app server can handle any request
SESSION_ENGINE = "django.contrib.sessions.backends.cache"
CACHES = {"default": {
    "BACKEND": "django.core.cache.backends.redis.RedisCache",
    "LOCATION": "redis://redis:6379/0",
}}`,
        note: "Use the cached_db backend if losing sessions on a Redis restart isn't acceptable.",
      },
    },
    "caching": {
      1: {
        code: `def get_user(uid):
    key = f"user:{uid}"
    user = cache.get(key)
    if user is None:                     # miss: load and fill
        user = User.objects.get(id=uid)
        cache.set(key, user, timeout=300)
    return user`,
        note: "Cache-aside: the app reads the cache first and fills it on a miss.",
      },
      3: {
        code: `def update_email(uid, email):
    User.objects.filter(id=uid).update(email=email)
    transaction.on_commit(lambda: cache.delete(f"user:{uid}"))`,
        note: "Delete after the commit, so a concurrent request can't re-cache the old value before the write lands.",
      },
      4: { g: { db: ["many misses at once", "bad", "alert"] } },
    },
    "content-delivery": {
      1: { g: { edge: ["MISS: fetch from origin", "warn", "repeat"] } },
      2: { setup: [["Cache-Control", "public, max-age=31536000, immutable", "hi"], ["file names", "content-hashed (app.3f9a.js)"], ["HTML", "short max-age or no-cache"]] },
      3: { g: { edge: ["purge, or ship a new file name", "info", "repeat"] } },
    },
    "rest-rpc-graphql": {
      1: {
        code: `service Orders {
  rpc GetOrder (GetOrderRequest) returns (Order);
}
message GetOrderRequest { int64 id = 1; }`,
        note: "A gRPC contract in Protocol Buffers: typed, compact, and generated into client and server code.",
      },
      3: { setup: [["REST", "simple and cacheable; more round trips"], ["gRPC", "fast and typed; best between services", "hi"], ["GraphQL", "flexible for clients; watch N+1 and query cost"]] },
    },
    "message-queues": {
      1: {
        code: `def signup(request):
    user = create_user(request.POST)
    transaction.on_commit(lambda: send_welcome_email.delay(user.id))
    return redirect("home")   # respond now; a worker sends the email`,
        note: "on_commit stops the worker from running before the user row is committed.",
      },
      2: { setup: [["ack", "after the work is done (acks_late)", "hi"], ["crash", "the message is delivered again"], ["so", "tasks must be idempotent"]] },
    },
    "pub-sub": {
      1: { g: { topic: ["every subscriber gets a copy", "info", "list"] } },
      2: { setup: [["Kafka", "ordered per partition: key by order_id", "hi"], ["consumer groups", "each group gets every event"], ["no global order", "across partitions"]] },
    },
    "real-time": {
      1: { setup: [["polling", "simple, wasteful, delayed"], ["SSE", "server → client over HTTP"], ["WebSocket", "two-way and long-lived", "hi"]] },
      2: {
        code: `# send to everyone in a room, whichever gateway holds their socket
async_to_sync(channel_layer.group_send)(
    f"room_{room_id}", {"type": "chat.message", "text": text})`,
        note: "Django Channels with a Redis channel layer plays the role of the bus.",
      },
    },
    "redundancy-failover": {
      2: { setup: [["detect", "health checks with a quorum"], ["promote", "the standby becomes primary", "hi"], ["fence", "the old primary must stop accepting writes"]], g: { s: ["promoted to primary", "ok", "check"] } },
    },
    "rate-limiting": {
      1: { setup: [["capacity", "burst size, e.g. 20 tokens"], ["refill", "steady rate, e.g. 10 tokens/s", "hi"], ["each request", "takes a token, or gets 429"]] },
      3: {
        code: `REST_FRAMEWORK = {
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.UserRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {"user": "100/min"},
}
# DRF answers 429 with a Retry-After header when the rate is exceeded`,
        note: "DRF keeps throttle history in the cache, so point it at a shared cache like Redis when you run several servers.",
      },
    },
    "observability": {
      2: {
        code: `log.info("payment_failed", extra={
    "trace_id": trace_id, "order_id": order.id,
    "provider": "stripe", "latency_ms": 840})`,
        note: "Use a JSON formatter so these fields are searchable. Never log card data or secrets.",
      },
      3: { setup: [["page on", "the error budget burning fast"], ["dashboards for", "CPU, queue depth, pool usage"], ["every alert", "actionable, with a runbook", "hi"]] },
    },
    "authentication": {
      1: { setup: [["sessions", "server-side state, easy to revoke"], ["JWTs", "stateless, hard to revoke before expiry", "hi"], ["either way", "short expiry plus refresh"]] },
      3: {
        code: `PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",  # pip install argon2-cffi
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]`,
        note: "The first hasher is used for new passwords; older hashes are upgraded when users log in.",
      },
    },
    "authorization": {
      0: { g: { db: ["/orders/42 → someone else's order", "bad", "alert"] } },
      2: {
        code: `class OrderViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = OrderSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Order.objects.filter(owner=self.request.user)  # scope every query`,
        note: "Scoping the queryset turns someone else's ID into a 404 instead of a leak.",
      },
    },
    "encryption-secrets": {
      0: { setup: [["TLS", "everywhere, including internal hops", "hi"], ["HSTS", "tells browsers to use HTTPS only"]] },
      2: {
        code: `# read secrets from the environment, filled from a secret manager
SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]
DATABASES["default"]["PASSWORD"] = os.environ["DB_PASSWORD"]`,
        note: "Never commit secrets. Inject them at deploy time from a secret manager.",
      },
    },
    "testing": {
      0: {
        code: `def test_discount_never_goes_negative():
    assert apply_discount(price=10, percent=150) == 0`,
        note: "pytest. Unit tests check pure logic in milliseconds, so you can have thousands.",
      },
      3: { setup: [["unit", "many, fast, pure logic"], ["integration", "real DB, cache and queues", "hi"], ["end-to-end", "a few critical journeys"], ["production", "canaries and synthetic checks"]] },
    },
    "ci-cd": {
      0: {
        code: `on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: {POSTGRES_PASSWORD: postgres}
        ports: ["5432:5432"]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: {python-version: "3.12"}
      - run: pip install -r requirements.txt && pytest`,
        note: "GitHub Actions: every push runs the tests against a real PostgreSQL.",
      },
      3: { setup: [["artifact", "the same image in staging and production", "hi"], ["deploy", "canary, then waves"], ["rollback", "redeploy the previous image"]] },
    },
  };
  for (const [id, steps] of Object.entries(P)) {
    const l = window.LESSONS[id];
    if (!l) continue;
    for (const [i, patch] of Object.entries(steps)) if (l.steps[i]) Object.assign(l.steps[i], patch);
  }
})();
