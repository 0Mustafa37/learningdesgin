/* Extra depth for Data & Storage, Architecture and Whole Systems lessons. Keys: lesson id → step index → fields. */
(() => {
  const P = {
    "sql-vs-nosql": {
      1: {
        code: `# an order read as one document (MongoDB, pymongo)
db.orders.insert_one({"_id": 42, "customer": {"id": 7, "name": "Sara"},
                      "items": [{"sku": "MUG-1", "qty": 2, "price": 9.5}]})
order = db.orders.find_one({"_id": 42})   # one read, no joins`,
        note: "Great when you always read the aggregate together; painful when you need to query across documents.",
      },
      3: { setup: [["relational", "joins, transactions, constraints", "hi"], ["document", "nested aggregates read together"], ["key-value", "lookups by key at huge scale"], ["wide-column", "write-heavy time series"]] },
    },
    "indexes": {
      0: { g: { db: ["Seq Scan: every row read", "bad", "alert"] } },
      2: {
        code: `CREATE INDEX CONCURRENTLY orders_customer_created
    ON orders (customer_id, created_at DESC);

EXPLAIN ANALYZE
SELECT * FROM orders WHERE customer_id = 7
ORDER BY created_at DESC LIMIT 20;   -- Index Scan, no sort step`,
        note: "Put equality columns first, then the range or sort column.",
      },
      3: { setup: [["reads", "faster lookups and sorts"], ["writes", "every index is updated on insert/update", "hi"], ["storage", "extra disk and memory"]] },
    },
    "storage-engines": {
      0: { setup: [["write", "append to the WAL first, then fsync", "hi"], ["crash", "replay the WAL on restart"], ["data pages", "updated later, in the background"]] },
      3: { setup: [["B-tree", "read-heavy; in-place updates (PostgreSQL, InnoDB)"], ["LSM tree", "write-heavy; sequential writes + compaction (Cassandra, RocksDB)", "hi"], ["trade-off", "read vs write vs space amplification"]] },
    },
    "read-replicas": {
      1: { setup: [["async", "fast writes; replicas may lag", "hi"], ["sync", "no lag at commit; slower writes"], ["watch", "replication lag in seconds"]] },
      2: {
        code: `class ReplicaRouter:
    def db_for_read(self, model, **hints):
        return random.choice(["replica1", "replica2"])

    def db_for_write(self, model, **hints):
        return "default"

DATABASE_ROUTERS = ["app.routers.ReplicaRouter"]`,
        note: "A Django database router: writes go to the primary, reads are spread across replicas.",
      },
      3: { g: { r2: ["lag 2.1 s: stale read", "bad", "hourglass"] } },
    },
    "sharding": {
      1: {
        code: `SHARDS = ["shard0", "shard1", "shard2"]

def shard_for(user_id: int) -> str:
    return SHARDS[user_id % len(SHARDS)]

Order.objects.using(shard_for(user_id)).filter(user_id=user_id)`,
        note: "Modulo is simple, but adding a shard moves most keys; consistent hashing fixes that.",
      },
      2: { g: { s2: ["60% of writes: hot shard", "bad", "alert"] } },
      3: { setup: [["shard key", "high cardinality, even load", "hi"], ["avoid", "cross-shard joins and transactions"], ["plan", "resharding from day one"]] },
    },
    "consistent-hashing": {
      1: {
        code: `ring = sorted((h(f"{node}#{v}"), node) for node in nodes for v in range(100))

def node_for(key):
    i = bisect.bisect(ring, (h(key),)) % len(ring)
    return ring[i][1]   # first virtual node clockwise`,
        note: "100 virtual nodes per server spread keys evenly around the ring.",
      },
      2: { g: { n4: ["takes about 1/4 of the keys", "ok", "check"] } },
      3: { setup: [["modulo", "adding a node moves almost every key"], ["ring", "adding a node moves about 1/N of keys", "hi"], ["virtual nodes", "even spread, smooth rebalancing"]] },
    },
    "unique-ids": {
      1: {
        code: `import uuid
order_id = uuid.uuid4()   # random, no coordination, 122 random bits
# time-ordered UUIDv7 indexes better: uuid.uuid7() in Python 3.14+`,
        note: "Random UUIDs scatter inserts across a B-tree index; time-ordered IDs keep inserts at the end.",
      },
      2: { setup: [["41 bits", "milliseconds since a custom epoch"], ["10 bits", "machine ID"], ["12 bits", "sequence: 4,096 IDs per ms per machine", "hi"]] },
      3: { g: { gen: ["clock went back: wait or refuse", "warn", "timer"] } },
    },
    "cap-consistency": {
      1: { g: { n2: ["cut off from n1", "bad", "alert"] } },
      2: { setup: [["CP", "refuse writes on the minority side", "hi"], ["AP", "accept writes, reconcile later"], ["no partition", "still latency vs consistency (PACELC)"]] },
      3: { setup: [["linearizable", "every read sees the latest write"], ["read-your-writes", "you always see your own writes", "hi"], ["eventual", "replicas converge over time"]] },
    },
    "consensus-leaders": {
      1: { setup: [["cluster", "5 nodes"], ["quorum", "3 of 5", "hi"], ["survives", "2 failed nodes"]] },
      2: { g: { f2: ["new leader, higher term", "ok", "check"] } },
      3: { setup: [["use", "etcd, ZooKeeper, Consul", "hi"], ["for", "leader election, config, locks"], ["not for", "high-volume application data"]] },
    },
    "transactions-isolation": {
      2: { g: { rule: ["invariant broken: 0 doctors on call", "bad", "alert"] } },
      3: {
        setup: [["Read Committed", "PostgreSQL default; allows write skew"], ["Repeatable Read", "a snapshot; still allows write skew"], ["Serializable", "prevents it; retry serialization errors", "hi"]],
        code: `with transaction.atomic():
    # lock the rows the rule depends on, then check and write
    on_call = list(Shift.objects.select_for_update()
                   .filter(day=today, on_call=True))
    if len(on_call) <= 1:
        raise MustKeepOneOnCall()
    Shift.objects.filter(id=my_shift).update(on_call=False)`,
        note: "Locking the rows the rule reads turns write skew into an ordinary wait.",
      },
    },
    "files-media": {
      1: {
        code: `url = s3.generate_presigned_url(
    "put_object",
    Params={"Bucket": "uploads", "Key": f"raw/{uuid4()}.jpg",
            "ContentType": "image/jpeg"},
    ExpiresIn=300)   # the client uploads straight to S3 for 5 minutes`,
        note: "boto3. The bytes never pass through your app servers.",
      },
      2: { g: { worker: ["3 thumbnail sizes", "info", "cog"] } },
      3: { setup: [["originals", "private bucket"], ["variants", "public via CDN, long cache", "hi"], ["keys", "content-hashed names"]] },
    },
    "monolith-microservices": {
      2: { setup: [["network", "latency, retries, partial failure", "hi"], ["data", "no joins or transactions across services"], ["operations", "deploys, tracing and on-call per service"]] },
      3: { g: { mono: ["modular monolith first", "ok", "check"] } },
    },
    "service-discovery": {
      1: {
        code: `apiVersion: v1
kind: Service
metadata: {name: orders}
spec:
  selector: {app: orders}
  ports: [{port: 80, targetPort: 8000}]
# callers use http://orders/; traffic goes only to ready pods`,
        note: "In Kubernetes the registry is built in: pods register through labels, and readiness probes take them out.",
      },
      3: { g: { i3: ["failed health check: removed", "bad", "x"] } },
    },
    "sagas": {
      1: { setup: [["1", "charge the payment"], ["2", "reserve inventory"], ["3", "create the shipment"], ["on failure", "run compensations in reverse", "hi"]] },
      2: { g: { pay: ["refund (compensation)", "warn", "repeat"], ship: ["no courier available", "bad", "x"] } },
      3: { setup: [["orchestration", "one coordinator calls each step", "hi"], ["choreography", "services react to each other's events"], ["either way", "idempotent steps and compensations"]] },
    },
    "batch-stream": {
      2: { setup: [["event time", "when it happened"], ["processing time", "when we saw it"], ["watermark", "how long to wait for late events", "hi"]] },
      3: { setup: [["batch", "complete and cheap, hours late"], ["stream", "fresh, more moving parts", "hi"], ["common", "stream for dashboards, batch to correct"]] },
    },
    "hld-lld": {
      0: { setup: [["functional", "what users can do"], ["non-functional", "scale, latency, availability", "hi"], ["numbers", "users, requests/s, storage"]] },
      3: { setup: [["APIs", "endpoints and payloads"], ["data model", "tables, keys and indexes", "hi"], ["code", "classes, responsibilities, interfaces"]] },
    },
    "url-shortener": {
      1: {
        code: `ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

def base62(n: int) -> str:
    s = ""
    while n:
        n, r = divmod(n, 62)
        s = ALPHABET[r] + s
    return s or "0"
# 7 characters cover 62^7 ≈ 3.5 trillion links`,
        note: "Encode a unique ID (from a sequence or Snowflake) instead of hashing the URL, and collisions can't happen.",
      },
      2: { setup: [["301", "permanent: browsers cache it, fewer hits"], ["302", "temporary: every click reaches you", "hi"], ["hot codes", "cached in Redis"]] },
      3: { g: { queue: ["click events, async", "info", "list"] } },
    },
    "news-feed": {
      0: { setup: [["fan-out on write", "precompute each follower's feed", "hi"], ["cost", "one post = one write per follower"]] },
      1: { g: { fan: ["40M followers: too many writes", "bad", "alert"] } },
      2: { setup: [["normal users", "push to followers' feeds"], ["celebrities", "pulled at read time and merged", "hi"]] },
      3: {
        code: `# each feed is a capped list of post IDs in Redis
r.lpush(f"feed:{follower_id}", post_id)
r.ltrim(f"feed:{follower_id}", 0, 799)    # keep the latest 800
ids = r.lrange(f"feed:{user_id}", 0, 49)   # first page`,
        note: "Store IDs only; hydrate the posts from a cache in one batch.",
      },
    },
    "chat-system": {
      0: { setup: [["connection", "one WebSocket per device"], ["gateway", "holds sockets, otherwise stateless", "hi"], ["presence", "heartbeats with a TTL"]] },
      1: { g: { db: ["saved before delivery", "ok", "check"] } },
      2: {
        code: `# a sequence number per conversation keeps order and allows resume
msg = Message.objects.create(conversation=conv, sender=user, text=text,
                             seq=next_seq(conv.id))
async_to_sync(channel_layer.group_send)(f"conv_{conv.id}", {
    "type": "chat.message", "seq": msg.seq, "text": text})`,
        note: "Django Channels; next_seq can be a Redis INCR per conversation.",
      },
      3: { setup: [["offline", "push notification"], ["reconnect", "fetch messages after the last seq", "hi"], ["ack", "the client acks the seq it has"]] },
    },
  };
  for (const [id, steps] of Object.entries(P)) {
    const l = window.LESSONS[id];
    if (!l) continue;
    for (const [i, patch] of Object.entries(steps)) if (l.steps[i]) Object.assign(l.steps[i], patch);
  }
})();
