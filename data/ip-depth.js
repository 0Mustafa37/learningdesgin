/* Extra depth for the classic interview problems: setup tables, code and ground tags per step.
   Kept separate so the lesson text in interview-problems.js stays readable. Keys: lesson id → step index → fields. */
(() => {
  const P = {
    "dual-write": {
      1: { g: { broker: ["publish failed after commit", "bad", "x"] } },
      2: {
        setup: [["write", "order + outbox row in one transaction", "hi"], ["relay", "poll or CDC, publish, mark sent"], ["delivery", "at-least-once"]],
        code: `with transaction.atomic():
    order = Order.objects.create(**data)
    OutboxEvent.objects.create(
        aggregate_id=order.id, type="OrderCreated",
        payload={"order_id": order.id, "total": str(order.total)},
    )
# a relay publishes unsent OutboxEvent rows, then marks them sent`,
        note: "Both rows commit or neither does. Debezium can read the outbox table from the WAL instead of polling.",
        g: { db: ["order + outbox: one commit", "ok", "check"] },
      },
      3: {
        code: `def handle(event):
    with transaction.atomic():
        _, created = ProcessedEvent.objects.get_or_create(event_id=event["id"])
        if not created:
            return  # duplicate delivery: already handled
        index_order(event["order_id"])`,
        note: "event_id needs a unique constraint so two concurrent deliveries can't both get through.",
        g: { consumer: ["duplicate ignored", "ok", "check"] },
      },
    },
    "duplicate-requests": {
      1: { g: { psp: ["card charged twice", "bad", "x"] } },
      2: {
        setup: [["key", "client-generated UUID per operation"], ["store", "key, request fingerprint, status, response", "hi"], ["expiry", "prune after about 24 h"]],
        code: `key = request.headers["Idempotency-Key"]
try:
    with transaction.atomic():
        IdempotencyRecord.objects.create(key=key, fingerprint=fp(request))
except IntegrityError:            # the key already exists
    rec = IdempotencyRecord.objects.get(key=key)
    if rec.fingerprint != fp(request):
        return JsonResponse({"error": "key reused"}, status=422)
    if rec.response is None:
        return JsonResponse({"error": "in progress"}, status=409)
    return JsonResponse(rec.response, status=rec.status)  # replay`,
        note: "The unique constraint on key is what makes this race-safe. Save the response once the charge completes.",
      },
      3: {
        code: `# pass the same key downstream so the processor dedupes too
stripe.PaymentIntent.create(amount=2000, currency="usd",
                            idempotency_key=key)`,
        g: { api: ["replayed the saved 201", "ok", "repeat"] },
      },
    },
    "lost-update": {
      0: { g: { db: ["both read stock = 1", "warn", "alert"] } },
      1: { g: { db: ["stock −1: oversold", "bad", "x"] } },
      2: {
        code: `# one atomic statement: no read-modify-write race
updated = (Product.objects
           .filter(id=pid, stock__gt=0)
           .update(stock=F("stock") - 1))
if updated == 0:
    raise OutOfStock()`,
        note: "The database applies the check and the decrement together, so two buyers can't both take the last item.",
      },
      3: {
        setup: [["atomic UPDATE", "simplest, for one row"], ["SELECT … FOR UPDATE", "pessimistic lock, keep it short"], ["version column", "optimistic, retry on conflict", "hi"], ["SERIALIZABLE", "database detects it; retry on error"]],
        code: `# pessimistic: lock the row until commit
with transaction.atomic():
    p = Product.objects.select_for_update().get(id=pid)
    p.stock -= 1
    p.save(update_fields=["stock"])

# optimistic: only write if nobody changed it meanwhile
n = Product.objects.filter(id=pid, version=v).update(stock=s - 1, version=v + 1)`,
      },
    },
    "exactly-once": {
      1: { g: { email: ["receipt sent twice", "bad", "x"] } },
      2: {
        setup: [["broker", "at-least-once delivery"], ["consumer", "dedupe by event ID", "hi"], ["result", "exactly-once processing, not delivery"]],
        code: `def on_order_paid(event):
    with transaction.atomic():
        _, created = ProcessedEvent.objects.get_or_create(event_id=event["id"])
        if not created:
            return
        EmailOutbox.objects.create(order_id=event["order_id"], kind="receipt")`,
        note: "Effects outside your database (sending the email) still need their own idempotency: an outbox, or the provider's idempotency key.",
      },
      3: { setup: [["producer", "enable.idempotence=true"], ["transactions", "transactional.id + read_committed consumers", "hi"], ["scope", "Kafka to Kafka only; external side effects still need idempotency"]] },
    },
    "distributed-locks": {
      1: { g: { w1: ["GC pause: lease expired", "bad", "hourglass"] } },
      2: {
        setup: [["lease", "TTL so a dead holder can't block forever"], ["fencing token", "an increasing number per grant", "hi"], ["store", "rejects writes with an older token"]],
        code: `token = lock.acquire("invoice-42", ttl=10)   # increasing number
...
# the store rejects writes carrying an older token
rows = Invoice.objects.filter(id=42, fence__lt=token).update(
    status="sent", fence=token)
if rows == 0:
    raise StaleLockError()`,
        g: { store: ["token 33 < 34: rejected", "ok", "shield"] },
      },
      3: { setup: [["efficiency only", "Redis SET key val NX PX 10000 is fine"], ["correctness", "consensus store (etcd, ZooKeeper) + fencing", "hi"], ["or avoid the lock", "row locks or unique constraints in the DB"]] },
    },
    "stale-reads": {
      1: { g: { replica: ["replication lag 800 ms", "warn", "hourglass"] } },
      2: {
        code: `class PrimaryAfterWriteRouter:
    def db_for_read(self, model, **hints):
        if recently_wrote():   # e.g. a timestamp in the session
            return "default"   # primary
        return "replica"

    def db_for_write(self, model, **hints):
        return "default"`,
        note: "A Django database router. Pin a user to the primary for a few seconds after they write.",
      },
      3: { setup: [["read-your-writes", "primary after a write, or for your own data", "hi"], ["monotonic reads", "stick each user to one replica"], ["bounded staleness", "skip replicas lagging more than N s"]] },
    },
    "ordering-clocks": {
      0: { g: { a: ["clock +40 ms", "warn", "timer"], b: ["clock −30 ms", "warn", "timer"] } },
      1: { g: { db: ["newer write lost", "bad", "x"] } },
      2: {
        code: `-- one writer assigns the order: a sequence or a log offset
INSERT INTO events (seq, payload)
VALUES (nextval('events_seq'), '...');`,
        note: "Sequences are unique and increasing but can have gaps; that's fine for ordering.",
      },
      3: { setup: [["wall clock", "can jump backwards, skews between hosts"], ["Lamport clock", "max(local, received) + 1", "hi"], ["version vectors", "detect truly concurrent writes"]] },
    },
    "split-brain": {
      1: { g: { n1: ["still thinks it's leader", "bad", "alert"] } },
      2: { setup: [["cluster", "3 nodes"], ["majority", "2 of 3", "hi"], ["minority side", "stops accepting writes"]] },
      3: { g: { n2: ["new leader, higher term", "ok", "check"] } },
    },
    "thundering-herd": {
      1: { g: { db: ["10k identical queries", "bad", "alert"] } },
      2: {
        code: `def get_product(pid):
    v = cache.get(f"p:{pid}")
    if v is not None:
        return v
    if cache.add(f"lock:p:{pid}", 1, timeout=10):   # only one rebuilds
        try:
            v = load_product(pid)
            cache.set(f"p:{pid}", v, timeout=300 + random.randint(0, 60))
        finally:
            cache.delete(f"lock:p:{pid}")
        return v
    time.sleep(0.05)                                 # others wait briefly
    return cache.get(f"p:{pid}") or load_product(pid)`,
        note: "cache.add only succeeds if the key doesn't exist, so it works as a short lock. The random TTL is the jitter from step 4.",
        g: { app: ["1 rebuild, others wait", "ok", "check"] },
      },
      3: { setup: [["TTL", "300 s + random 0–60 s", "hi"], ["refresh early", "rebuild hot keys before they expire"], ["serve stale", "while one request rebuilds"]] },
    },
    "hot-partition": {
      1: { g: { s2: ["one key: 80% of traffic", "bad", "alert"] } },
      2: {
        code: `N = 8   # spread one hot counter over N sub-keys

def add_like(post_id, user_id):
    incr(f"likes:{post_id}:{user_id % N}")

def count_likes(post_id):
    return sum(get(f"likes:{post_id}:{i}") or 0 for i in range(N))`,
        note: "Writes spread over 8 partitions; reads pay with 8 lookups, so cache the total.",
      },
      3: { setup: [["writes", "salt hot keys across partitions", "hi"], ["reads", "cache and replicas for hot items"], ["detect", "per-key metrics, top-k hot keys"]] },
    },
    "retry-storms": {
      1: { g: { db: ["up to 27× the load", "bad", "alert"] } },
      2: {
        setup: [["retry layer", "the edge only", "hi"], ["budget", "retries ≤ 10% of requests"], ["inner calls", "fail fast, no retries"]],
        code: `# retry once, at the edge only, with backoff and jitter
retry = Retry(total=1, backoff_factor=0.2, backoff_jitter=0.2,
              status_forcelist=[502, 503, 504],
              allowed_methods=["GET"])
session.mount("https://", HTTPAdapter(max_retries=retry))`,
        note: "requests + urllib3 2.x. Only retry idempotent methods.",
      },
      3: { g: { db: ["fast 503s, recovering", "ok", "check"] } },
    },
    "poison-messages": {
      0: { g: { worker: ["fails every time", "bad", "x"] } },
      2: {
        setup: [["max attempts", "5, with backoff"], ["then", "move it to a dead-letter queue", "hi"], ["alert", "when DLQ depth > 0"]],
        code: `@app.task(bind=True, max_retries=5, acks_late=True)
def process(self, msg_id):
    try:
        handle(msg_id)
    except TransientError as exc:
        raise self.retry(exc=exc, countdown=2 ** self.request.retries)
    except Exception:
        DeadLetter.objects.create(msg_id=msg_id, error=traceback.format_exc())`,
        note: "Celery has no built-in DLQ: record failures yourself, or use the broker's (SQS redrive policy, RabbitMQ dead-letter exchange).",
      },
      3: { g: { dlq: ["bug fixed: redrive 312 messages", "ok", "repeat"] } },
    },
    "backpressure": {
      0: { g: { buf: ["queue grows without limit", "bad", "alert"] } },
      1: {
        code: `queue = asyncio.Queue(maxsize=1000)   # bounded

async def produce(item):
    await queue.put(item)   # waits when full: that's backpressure`,
        note: "A bounded buffer turns overload into waiting at the producer instead of memory growth in the middle.",
      },
      3: { setup: [["bounded buffer", "producer waits when full", "hi"], ["scale", "add consumers if lag keeps growing"], ["shed", "reject with 429/503 when still full"]] },
    },
    "pagination-at-scale": {
      0: { g: { db: ["OFFSET 1,000,000: scans 1M rows", "bad", "alert"] } },
      2: {
        code: `# keyset pagination: continue after the last row seen
qs = (Order.objects
      .filter(Q(created_at__lt=ts) | Q(created_at=ts, id__lt=last_id))
      .order_by("-created_at", "-id")[:50])
# needs an index on (created_at, id); DRF has CursorPagination`,
        note: "The id tie-breaker stops rows with the same timestamp from being skipped or repeated.",
      },
      3: { setup: [["offset", "can jump to page N; deep pages are slow"], ["cursor", "fast at any depth; no page numbers", "hi"], ["consistency", "a cursor doesn't skip or repeat rows on inserts"]] },
    },
  };
  for (const [id, steps] of Object.entries(P)) {
    const l = window.LESSONS[id];
    if (!l) continue;
    for (const [i, patch] of Object.entries(steps)) if (l.steps[i]) Object.assign(l.steps[i], patch);
  }
})();
