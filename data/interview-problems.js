/* Classic interview problems: each one names the failure, shows why the naive fix breaks, and gives the standard solution. */
L({
  id: "dual-write",
  title: "Dual Write Problem",
  sub: "Saving to the database and publishing an event can't be atomic. Here's what to do.",
  level: "Advanced", min: 9,
  learn: ["Why writing to two systems loses or invents events", "The transactional outbox pattern", "Change data capture as an alternative", "Idempotent consumers"],
  deep: [
    "Order 1: commit to DB, then publish. A crash or broker error between them means the DB changed but nobody hears about it.",
    "Order 2: publish, then commit. If the commit fails, consumers react to an event for data that never existed.",
    "Outbox: write the business row and an outbox row in the same local transaction. A relay (poller, or CDC tool such as Debezium reading the WAL) publishes outbox rows and marks them sent. Delivery is at-least-once, so consumers dedupe by event ID.",
  ],
  iv: ["Name it explicitly: “this is a dual write; I'll use a transactional outbox”.", "Don't propose distributed transactions (2PC) with the broker; mention CDC as the alternative."],
  refs: [["microservices.io: Transactional outbox", "https://microservices.io/patterns/data/transactional-outbox.html"], ["Debezium: Outbox Event Router", "https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html"]],
  nodes: [N("app", "order service", 110, 220), N("db", "orders DB + outbox", 360, 340, "db"), N("relay", "outbox relay", 360, 100, "worker"), N("broker", "message broker", 600, 220, "queue"), N("consumer", "search indexer", 740, 380, "worker")],
  steps: [
    { t: "problem", s: "Two writes", h: "Two systems, no shared transaction", b: "Creating an order must update the database and publish OrderCreated so search, email and analytics react. These are two separate systems.", k: "No transaction spans a database and a broker.", f: "app>db:req, app>broker:req, broker>consumer:req", v: "app db broker consumer", a: "app" },
    { t: "case", s: "Crash", h: "Crash between the writes", b: "The DB commit succeeds, then the process crashes (or the broker times out) before publishing. The order exists, but search never indexes it.\n\nPublishing first is worse: if the commit then fails, consumers act on an order that doesn't exist.", k: "Either order of two writes can leave systems disagreeing.", f: "app>db:req, app>broker:fail", v: "app db broker consumer", a: "broker" },
    { t: "concept", s: "Outbox", h: "Transactional outbox", b: "In one local transaction, insert the order and an outbox row describing the event. Both commit or neither does.\n\nA relay reads unsent outbox rows (polling, or CDC from the WAL), publishes them and marks them sent.", k: "One atomic local write; publishing happens after commit, reliably.", f: "app>db:req, db>relay:sync, relay>broker:req", a: "db relay" },
    { t: "recap", s: "Idempotent", h: "Consumers must dedupe", b: "If the relay crashes after publishing but before marking a row sent, it publishes again. Consumers record processed event IDs (or upsert) so duplicates are harmless.", k: "Outbox = at-least-once; pair it with idempotent consumers.", f: "relay>broker:req, broker>consumer:req, broker>consumer:sync", a: "consumer" },
  ],
});

L({
  id: "duplicate-requests",
  title: "Duplicate Requests",
  sub: "Retries are inevitable. Make them safe with idempotency keys.",
  level: "Intermediate", min: 8,
  learn: ["Why clients retry requests that already succeeded", "Which HTTP methods are idempotent", "Implementing idempotency keys", "Passing keys to downstream providers"],
  deep: [
    "RFC 9110 defines PUT, DELETE and the safe methods (GET, HEAD, OPTIONS, TRACE) as idempotent; POST is not.",
    "Idempotency key: the client generates a unique key per logical operation and resends the same key on retry. The server stores (key, request fingerprint, status, response) under a unique constraint and replays the saved response.",
    "If the first request is still in progress, return 409 (or wait). If the key is reused with a different payload, reject it. Stripe's API works this way, and keys can be pruned after 24 hours.",
  ],
  iv: ["Start from the scenario: “client timed out after the server charged the card”.", "The unique constraint on the key is what makes it race-safe, not a SELECT before INSERT."],
  refs: [["RFC 9110 §9.2.2: Idempotent methods", "https://www.rfc-editor.org/rfc/rfc9110#section-9.2.2"], ["Stripe API: Idempotent requests", "https://docs.stripe.com/api/idempotent_requests"], ["IETF draft: The Idempotency-Key HTTP header", "https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/"]],
  mk: ["Requests", "Charges"],
  nodes: [N("client", "mobile app", 100, 220, "client"), N("api", "payments API", 340, 220), N("keys", "idempotency keys", 340, 390, "db"), N("psp", "card processor", 620, 220, "ext")],
  steps: [
    { t: "problem", s: "Timeout", h: "The response got lost", b: "The API charges the card, but the response times out on a flaky mobile network. The app retries the POST.", k: "A timeout doesn't mean the request failed.", f: "client>api:req, api>psp:req, psp>api:res, api>client:fail", v: "client api psp", a: "api", m: { Requests: "1", Charges: "1" } },
    { t: "case", s: "Double", h: "The retry charges again", b: "Without protection, the server treats the retry as a new payment. The customer is charged twice.", k: "Retried non-idempotent POSTs duplicate side effects.", f: "client>api:req, api>psp:fail", v: "client api psp", a: "psp", m: { Requests: "2", Charges: "2 ✗" } },
    { t: "concept", s: "Key", h: "Send an idempotency key", b: "The client creates a UUID for this payment and sends it in an <code>Idempotency-Key</code> header on every attempt. The server inserts the key under a unique constraint before doing the work.", k: "Same operation → same key, on every retry.", f: "client>api:req, api>keys:req, api>psp:req", a: "keys", m: { Requests: "1", Charges: "1" } },
    { t: "recap", s: "Replay", h: "Replay the stored response", b: "On retry the insert hits the unique constraint; the server returns the saved response instead of charging. Pass the same key downstream to the card processor too.", k: "Duplicates return the original result, with no second side effect.", f: "client>api:req, api>keys:req, keys>api:res, api>client:res", a: "keys api", m: { Requests: "2", Charges: "1 ✓" } },
  ],
});

L({
  id: "lost-update",
  title: "Lost Update & Double Booking",
  sub: "Two concurrent read-modify-write cycles: one silently wins.",
  level: "Intermediate", min: 8,
  learn: ["How lost updates happen", "Atomic updates and conditional writes", "Pessimistic locks (SELECT … FOR UPDATE)", "Optimistic concurrency with versions"],
  deep: [
    "Two requests read stock = 1, both decide to sell, both write 0. Two items sold, one in stock.",
    "Atomic conditional update: <code>UPDATE … SET stock = stock - 1 WHERE id = ? AND stock >= 1</code>, then check rows affected.",
    "Optimistic concurrency: add a version column; <code>UPDATE … WHERE id = ? AND version = ?</code>. 0 rows → someone else changed it; reload and retry. For double booking of seats or slots, a unique constraint on (resource, time slot) is the strongest guard.",
  ],
  iv: ["Prefer pushing the check into one atomic statement or a constraint over application-level locks.", "Know when to lock (high contention, complex reads) vs optimistic retry (low contention)."],
  refs: [["PostgreSQL: Explicit Locking (row-level locks)", "https://www.postgresql.org/docs/current/explicit-locking.html"], ["Designing Data-Intensive Applications, ch. 7", "https://dataintensive.net/"]],
  mk: ["Stock", "Sold"],
  nodes: [N("u1", "buyer 1", 100, 100, "client"), N("u2", "buyer 2", 100, 340, "client"), N("app", "shop API", 370, 220), N("db", "inventory", 640, 220, "db")],
  steps: [
    { t: "problem", s: "Race", h: "Both read stock = 1", b: "Two buyers click “buy” for the last item at the same moment. Each request reads stock = 1 and decides the sale is OK.", k: "Check-then-act in application code is a race.", f: "u1>app:req, u2>app:req, app>db:req, db>app:res", a: "app db", m: { Stock: "1", Sold: "0" } },
    { t: "case", s: "Oversold", h: "Both write stock = 0", b: "Each writes stock = 0 and confirms the order. Two items sold, one existed. The second write silently overwrote the first.", k: "The last writer wins and the other update is lost.", f: "app>db:req, app>db:fail, app>u1:res, app>u2:res", a: "db", m: { Stock: "0", Sold: "2 ✗" } },
    { t: "concept", s: "Atomic", h: "One atomic conditional update", b: "<code>UPDATE products SET stock = stock - 1 WHERE id = 7 AND stock >= 1</code>. The database serialises the two updates; the second matches 0 rows, so that buyer gets “sold out”.", k: "Put the condition and the change in one statement.", f: "u1>app:req, u2>app:req, app>db:req, db>app:res, app>u2:fail", a: "db", m: { Stock: "0", Sold: "1 ✓" } },
    { t: "recap", s: "Options", h: "Locks, versions, constraints", b: "Pessimistic: <code>SELECT … FOR UPDATE</code> inside a transaction. Optimistic: version column + retry on conflict. Bookings: a unique constraint on (seat, show) makes double booking impossible.", k: "Let the database enforce the invariant.", f: "app>db:req, db>app:res", a: "db" },
  ],
});

L({
  id: "exactly-once",
  title: "Exactly-Once Delivery",
  sub: "Why it's (mostly) a myth, and how to get effectively-once.",
  level: "Advanced", min: 8,
  learn: ["At-most-once vs at-least-once", "Why redelivery is unavoidable", "Effectively-once with idempotent processing", "What Kafka's exactly-once actually covers"],
  deep: [
    "A consumer can't atomically perform an external side effect and acknowledge the message, so a crash between the two forces a choice: ack first (may lose) or process first (may duplicate).",
    "Effectively-once = at-least-once delivery + idempotent processing: record processed message IDs in the same DB transaction as the side effect, or use upserts/conditional writes.",
    "Kafka transactions provide exactly-once semantics for read-process-write within Kafka (consume, produce, commit offsets atomically). Side effects outside Kafka still need idempotency.",
  ],
  iv: ["If asked “can you guarantee exactly-once?”, explain at-least-once + dedupe and where the dedupe key lives.", "Dedupe storage needs a retention window at least as long as possible redelivery delays."],
  refs: [["Confluent: Exactly-once semantics in Kafka", "https://www.confluent.io/blog/exactly-once-semantics-are-possible-heres-how-apache-kafka-does-it/"], ["Apache Kafka docs: Message delivery semantics", "https://kafka.apache.org/documentation/#semantics"]],
  nodes: [N("producer", "producer", 100, 220), N("broker", "broker", 340, 220, "queue"), N("consumer", "consumer", 580, 220, "worker"), N("db", "DB + processed_ids", 580, 390, "db"), N("email", "email provider", 720, 80, "ext")],
  steps: [
    { t: "concept", s: "Semantics", h: "Two honest options", b: "<b>At-most-once</b>: ack before processing, so a crash loses the message. <b>At-least-once</b>: ack after processing, so a crash causes redelivery.", k: "Real systems choose at-least-once and handle duplicates.", f: "producer>broker:req, broker>consumer:req", a: "broker consumer" },
    { t: "problem", s: "Crash", h: "Processed, then crashed before ack", b: "The consumer sends the email, then crashes before acking. The broker redelivers, and the customer gets two emails.", k: "Side effect + ack can't be one atomic step.", f: "consumer>email:req, consumer>broker:fail, broker>consumer:req", a: "consumer email" },
    { t: "concept", s: "Dedupe", h: "Make processing idempotent", b: "Insert the message ID into <code>processed_ids</code> (unique) in the same transaction as the DB change. A redelivered message hits the constraint and is skipped. For external calls, pass an idempotency key.", k: "Effectively-once = at-least-once + dedupe.", f: "broker>consumer:req, consumer>db:req, db>consumer:res", a: "db" },
    { t: "recap", s: "Kafka EOS", h: "Know what “exactly-once” products mean", b: "Kafka's exactly-once covers consuming, producing and committing offsets within Kafka atomically. Emails, payments and other external effects still need idempotency.", k: "Exactly-once claims stop at the system boundary.", f: "producer>broker:req, broker>consumer:req, consumer>db:req", a: "broker" },
  ],
});

L({
  id: "distributed-locks",
  title: "Distributed Locks",
  sub: "Locks with timeouts can be held by two processes at once, unless you fence.",
  level: "Advanced", min: 8,
  learn: ["Lease-based locks with a TTL", "How pauses break lock safety", "Fencing tokens", "When to use a database or consensus system instead"],
  deep: [
    "A common Redis lock: <code>SET lock:job worker1 NX PX 30000</code>, then release only if the value still matches (compare-and-delete in a Lua script).",
    "A GC pause, VM freeze or network delay longer than the TTL lets a second worker acquire the lock while the first still believes it holds it.",
    "Fencing: the lock service issues a monotonically increasing token with each grant; the storage layer rejects writes carrying a smaller token than one it has already seen.",
  ],
  iv: ["Ask whether the lock is for efficiency (avoid duplicate work, so a Redis lock is OK) or correctness (needs fencing or DB-level guarantees).", "Often a row lock, unique constraint or SELECT … FOR UPDATE SKIP LOCKED is simpler than a distributed lock."],
  refs: [["Martin Kleppmann: How to do distributed locking", "https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html"], ["Redis: SET command (NX, PX)", "https://redis.io/docs/latest/commands/set/"]],
  nodes: [N("w1", "worker 1", 110, 100, "worker"), N("w2", "worker 2", 110, 340, "worker"), N("lock", "lock service", 390, 220, "cache"), N("store", "storage", 660, 220, "db")],
  steps: [
    { t: "concept", s: "Lease", h: "Acquire a lock with a TTL", b: "Worker 1 acquires the lock for 30 s. The TTL ensures the lock is freed if the worker dies.", k: "Leases avoid locks held forever by dead processes.", f: "w1>lock:req, lock>w1:res", a: "lock w1" },
    { t: "problem", s: "Pause", h: "A long pause", b: "Worker 1 hits a 40 s GC pause. Its lease expires; worker 2 acquires the lock and writes. Worker 1 wakes, still believing it holds the lock, and writes too, corrupting data.", k: "Timeouts + pauses = two lock holders.", f: "w2>lock:req, lock>w2:res, w2>store:req, w1>store:fail", a: "w1 w2" },
    { t: "concept", s: "Fencing", h: "Fencing tokens", b: "Each grant comes with an increasing token: worker 1 got 33, worker 2 got 34. Storage records the highest token seen and rejects worker 1's late write with token 33.", k: "Storage enforces order; the lock alone can't.", f: "w2>store:req, w1>store:fail", a: "store" },
    { t: "recap", s: "Choose", h: "Pick the right tool", b: "Efficiency-only locks: Redis is fine. Correctness: use fencing with etcd/ZooKeeper, or avoid distributed locks entirely with DB constraints and row locks.", k: "Correctness needs fencing or the database's own guarantees.", f: "w1>lock:req, w2>lock:req, lock>w2:res", a: "lock store" },
  ],
});

L({
  id: "stale-reads",
  title: "Stale Reads & Read-Your-Writes",
  sub: "Replica lag makes users see old data right after they changed it.",
  level: "Intermediate", min: 7,
  learn: ["How replication lag appears to users", "Read-your-writes and monotonic reads", "Routing strategies that fix it"],
  deep: [
    "Asynchronous replicas apply changes slightly later than the primary; under load, lag can grow from milliseconds to seconds.",
    "Read-your-writes: a user always sees their own changes. Monotonic reads: a user never sees data go backwards (e.g. hopping between replicas with different lag).",
    "Fixes: read from the primary for a short window after a write; pin a user to one replica; or wait until a replica has replayed past the write's log position (e.g. comparing LSNs in PostgreSQL).",
  ],
  iv: ["Mention which screens need read-your-writes (profile, settings, the post you just made) and which can be stale (public feeds).", "Note that caches cause the same problem, so invalidate on write."],
  refs: [["Designing Data-Intensive Applications, ch. 5: Problems with replication lag", "https://dataintensive.net/"], ["PostgreSQL: Hot standby", "https://www.postgresql.org/docs/current/hot-standby.html"]],
  mk: ["Lag"],
  nodes: [N("user", "user", 100, 220, "client"), N("app", "app", 340, 220), N("primary", "primary", 600, 100, "db"), N("replica", "replica", 600, 340, "db")],
  steps: [
    { t: "concept", s: "Write", h: "User updates their name", b: "The write goes to the primary and commits.", k: "Writes always go to the primary.", f: "user>app:req, app>primary:req", a: "primary", m: { Lag: "1.5 s" } },
    { t: "problem", s: "Stale", h: "The redirect reads from a lagging replica", b: "The profile page reads from a replica that hasn't applied the change yet. The user sees their old name and thinks the save failed.", k: "Replica lag breaks read-your-writes.", f: "app>replica:req, replica>user:fail", a: "replica", m: { Lag: "1.5 s" } },
    { t: "concept", s: "Pin", h: "Read from the primary after writing", b: "After a write, set a short-lived marker (cookie/session) so this user's reads go to the primary for a few seconds, or until replicas have caught up to the write's position.", k: "Route the writer's reads to an up-to-date copy.", f: "user>app:req, app>primary:req, primary>user:res", a: "primary" },
    { t: "recap", s: "Monotonic", h: "Don't go back in time", b: "Pin each user's reads to one replica (e.g. hash of user ID) so refreshes don't jump between replicas with different lag.", k: "Sticky replica routing gives monotonic reads.", f: "app>replica:req, replica>app:res, primary>replica:sync", a: "replica" },
  ],
});

L({
  id: "ordering-clocks",
  title: "Ordering & Clocks",
  sub: "Wall-clock timestamps can't reliably order events across machines.",
  level: "Advanced", min: 8,
  learn: ["Why clock skew breaks last-write-wins", "Logical clocks and sequence numbers", "Per-key ordering in partitioned logs"],
  deep: [
    "Server clocks drift and are corrected by NTP; skew of milliseconds (or worse during faults) is normal, so a later write can carry an earlier timestamp.",
    "Last-write-wins by wall-clock time can silently discard the newest update.",
    "Alternatives: a single leader assigns sequence numbers per key; Lamport clocks give an order consistent with causality; version vectors detect concurrent updates so they can be merged.",
  ],
  iv: ["When ordering matters, route all updates for one entity through one place (partition key or leader) and use its sequence.", "Use wall-clock time for display and approximate analytics, not for correctness."],
  refs: [["Lamport, Time, Clocks, and the Ordering of Events (1978)", "https://lamport.azurewebsites.net/pubs/time-clocks.pdf"], ["Designing Data-Intensive Applications, ch. 8: Unreliable clocks", "https://dataintensive.net/"]],
  nodes: [N("a", "server A (clock +40 ms)", 150, 110), N("b", "server B (clock −30 ms)", 150, 340), N("db", "replicated store (LWW)", 450, 220, "db"), N("log", "partitioned log", 700, 220, "queue")],
  steps: [
    { t: "problem", s: "Skew", h: "Clocks disagree", b: "Server A's clock is 40 ms fast, B's is 30 ms slow. B handles the user's second (newer) update but stamps it with an earlier time.", k: "Physical clocks aren't a global order.", f: "a>db:req, b>db:req", v: "a b db", a: "a b" },
    { t: "case", s: "LWW", h: "Last-write-wins drops the newest write", b: "The store keeps the value with the larger timestamp: A's older update wins, and the user's latest change vanishes.", k: "LWW + skew = silent data loss.", f: "b>db:fail, a>db:req", v: "a b db", a: "db" },
    { t: "concept", s: "Sequence", h: "Order per key through one place", b: "Send all updates for a key through one partition (or leader) that assigns increasing sequence numbers. Order is defined by the sequence, not the clock.", k: "A single sequencer per key gives a total order for that key.", f: "a>log:req, b>log:req, log>db:sync", a: "log" },
    { t: "recap", s: "Logical", h: "Logical clocks and versions", b: "Lamport clocks order causally related events; version vectors detect truly concurrent writes so the app can merge them instead of dropping one.", k: "Use logical time for correctness, wall time for humans.", f: "log>db:sync", a: "db log" },
  ],
});

L({
  id: "split-brain",
  title: "Split Brain",
  sub: "Two nodes both think they're the leader, and both accept writes.",
  level: "Advanced", min: 7,
  learn: ["How network partitions create two leaders", "Majority quorums prevent it", "Fencing the old leader"],
  deep: [
    "If the leader is cut off but still running, and the rest promote a new leader, both may accept writes that later conflict.",
    "Requiring a majority quorum to lead means only one side of a partition can elect a leader; with an even number of nodes, a 50/50 split leaves no majority.",
    "Fencing (tokens, epochs/terms, STONITH, revoking storage access) makes sure the old leader can't keep writing after it's been replaced.",
  ],
  iv: ["Use an odd number of nodes (3, 5) or a tie-breaker witness.", "Mention leases: a leader stops serving when its lease can't be renewed."],
  refs: [["Raft paper and visualisation", "https://raft.github.io/"], ["Designing Data-Intensive Applications, ch. 8–9", "https://dataintensive.net/"]],
  nodes: [N("c1", "clients (side 1)", 100, 120, "client"), N("n1", "node A (old leader)", 330, 120, "db"), N("n2", "node B", 560, 120, "db"), N("n3", "node C", 560, 340, "db"), N("c2", "clients (side 2)", 760, 230, "client")],
  steps: [
    { t: "concept", s: "Normal", h: "One leader, two followers", b: "A leads and replicates to B and C.", k: "One leader = one order of writes.", f: "n1>n2:sync, n1>n3:sync, c1>n1:req", a: "n1" },
    { t: "problem", s: "Partition", h: "A is cut off", b: "A can't reach B or C, but it's still running and clients on its side keep writing to it. B and C elect B as the new leader.", k: "A partition can produce two “leaders”.", f: "n1>n2:fail, n1>n3:fail, n3>n2:sync, c1>n1:req, c2>n2:req", a: "n1 n2" },
    { t: "concept", s: "Quorum", h: "Only the majority may lead", b: "A has 1 of 3 votes, so it can't commit writes (no majority acks) and steps down. B has 2 of 3 and continues.", k: "Majority quorum: at most one side can make progress.", f: "c1>n1:fail, c2>n2:req, n2>n3:sync", a: "n2 n3" },
    { t: "recap", s: "Fence", h: "Fence the old leader", b: "When A returns, its older term/epoch is rejected. Storage and clients refuse requests carrying an old fencing token.", k: "Epochs and fencing stop zombie leaders.", f: "n1>n2:fail, n2>n1:sync", a: "n2" },
  ],
});

L({
  id: "thundering-herd",
  title: "Thundering Herd",
  sub: "Many clients wake up at once and stampede the same resource.",
  level: "Intermediate", min: 7,
  learn: ["Cache stampedes on hot keys", "Synchronized retries and cron jobs", "Request coalescing, stale-while-revalidate and jitter"],
  deep: [
    "When a hot cache key expires, thousands of concurrent misses all recompute the same value against the database.",
    "Request coalescing (single-flight): the first miss recomputes while others wait for its result, or a short lock lets only one rebuild.",
    "Serve stale while revalidating, add random jitter to TTLs and schedules, and refresh hot keys before expiry (probabilistic early expiration).",
  ],
  iv: ["Name both causes: synchronized expiry and synchronized clients (retries after an outage, cron at :00).", "Jitter is the cheapest fix; single-flight is the strongest for hot keys."],
  refs: [["AWS Architecture Blog: Exponential backoff and jitter", "https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/"], ["RFC 5861: stale-while-revalidate", "https://www.rfc-editor.org/rfc/rfc5861"]],
  mk: ["DB queries/s", "p99"],
  nodes: [N("clients", "10k requests", 100, 220, "user"), N("app", "app servers", 340, 220), N("cache", "cache", 580, 90, "cache"), N("db", "database", 580, 350, "db")],
  steps: [
    { t: "concept", s: "Hot key", h: "A hot key served from cache", b: "The homepage config is read 10,000 times a second, all from cache.", k: "Hot keys are fine while cached.", f: "clients>app:req, app>cache:req, cache>app:res", a: "cache", m: { "DB queries/s": "0", p99: "8 ms" } },
    { t: "problem", s: "Expiry", h: "The key expires", b: "At expiry every request misses at once and runs the same expensive query. The database melts; latency explodes.", k: "Synchronized misses multiply load by the request rate.", f: "app>cache:fail, app>db:fail, app>db:fail", a: "db", m: { "DB queries/s": "10,000", p99: "9 s" } },
    { t: "concept", s: "Coalesce", h: "One rebuilds, others wait or get stale", b: "The first miss takes a short lock and rebuilds; others wait for that result or are served the stale value meanwhile.", k: "Single-flight turns N identical queries into 1.", f: "app>db:req, db>app:res, app>cache:sync", a: "app", m: { "DB queries/s": "1", p99: "12 ms" } },
    { t: "recap", s: "Jitter", h: "Spread things out", b: "Add random jitter to TTLs, retry delays and scheduled jobs so they don't align. Refresh very hot keys before they expire.", k: "Randomness desynchronises the herd.", f: "clients>app:req, app>cache:req, cache>app:res", a: "cache" },
  ],
});

L({
  id: "hot-partition",
  title: "Hot Partition (Celebrity Problem)",
  sub: "One key gets so much traffic that its shard can't keep up.",
  level: "Advanced", min: 7,
  learn: ["Why even hashing can't fix one hot key", "Key salting / splitting", "Caching and dedicated capacity for hot keys"],
  deep: [
    "Hashing spreads many keys evenly, but all traffic for a single key still lands on one partition (one celebrity, one viral product, one big tenant).",
    "Write-heavy hot keys: split into N sub-keys (e.g. counter:likes:post42:{0..N-1}), write to a random one, and sum on read.",
    "Read-heavy hot keys: cache aggressively (including in-process), replicate the hot partition, or serve from a CDN.",
  ],
  iv: ["Detect it with per-partition metrics: averages hide hot spots.", "Mention the read cost of salting (fan-in of N sub-keys)."],
  refs: [["Amazon DynamoDB: Designing partition keys", "https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html"], ["Designing Data-Intensive Applications, ch. 6: Skewed workloads", "https://dataintensive.net/"]],
  mk: ["Shard A", "Shard B", "Shard C"],
  nodes: [N("app", "app", 110, 220), N("s1", "shard A", 450, 80, "db"), N("s2", "shard B", 600, 220, "db"), N("s3", "shard C", 450, 360, "db")],
  steps: [
    { t: "concept", s: "Even", h: "Normally load is even", b: "Millions of keys hash across shards; each shard gets about a third of the traffic.", k: "Hashing balances many keys.", f: "app>s1:req, app>s2:req, app>s3:req", a: "s1 s2 s3", m: { "Shard A": "33%", "Shard B": "33%", "Shard C": "34%" } },
    { t: "problem", s: "Viral", h: "One post goes viral", b: "Every like for post 42 increments the same counter on shard B. Shard B saturates while A and C idle.", k: "One key can't be spread by hashing.", f: "app>s2:fail, app>s2:fail", a: "s2", m: { "Shard A": "10%", "Shard B": "100% ✗", "Shard C": "10%" } },
    { t: "concept", s: "Salt", h: "Split the hot key", b: "Store the counter as 16 sub-counters <code>likes:42:0..15</code> spread across shards. Writes pick one at random; reads sum all 16 (and cache the total).", k: "Salting spreads one logical key across many partitions.", f: "app>s1:req, app>s2:req, app>s3:req", a: "s1 s2 s3", m: { "Shard A": "36%", "Shard B": "38%", "Shard C": "36%" } },
    { t: "recap", s: "Reads", h: "Hot reads: cache and replicate", b: "For read-hot keys, cache in memory at the app tier and in Redis, or replicate the hot item. Alert on per-shard load.", k: "Find hot keys with per-partition metrics, then cache or split.", f: "app>s2:req, s2>app:res", a: "app" },
  ],
});

L({
  id: "retry-storms",
  title: "Retry Storms",
  sub: "Retries meant to help can multiply load and keep a service down.",
  level: "Advanced", min: 7,
  learn: ["How retries multiply across layers", "Backoff, jitter and retry budgets", "Circuit breakers and load shedding"],
  deep: [
    "If three layers each retry 3 times, one user request can become 3 × 3 × 3 = 27 calls to the bottom service exactly when it's struggling.",
    "Retry at one layer only (usually closest to the user or the client library), cap attempts, back off exponentially with jitter, and use a retry budget (e.g. retries ≤ 10% of requests).",
    "Overloaded services should shed load early (503/429) and clients should respect Retry-After.",
  ],
  iv: ["Mention metastable failures: the system stays down even after the trigger is gone because retries keep it overloaded.", "Combine with circuit breakers and timeouts."],
  refs: [["Google SRE book: Handling overload", "https://sre.google/sre-book/handling-overload/"], ["AWS Builders' Library: Timeouts, retries and backoff with jitter", "https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/"]],
  mk: ["Calls per request"],
  nodes: [N("client", "client", 90, 220, "client"), N("api", "API (3 tries)", 290, 220), N("svc", "service (3 tries)", 490, 220), N("db", "database (overloaded)", 700, 220, "db")],
  steps: [
    { t: "problem", s: "Slow DB", h: "The database slows down", b: "A heavy query makes the database slow. Some calls time out.", k: "The trigger is small; the reaction is what hurts.", f: "client>api:req, api>svc:req, svc>db:fail", a: "db", m: { "Calls per request": "1" } },
    { t: "case", s: "Multiply", h: "Every layer retries", b: "The client retries 3×, the API retries 3×, the service retries 3×: up to 27 database calls per user action, aimed at the component that's already overloaded.", k: "Layered retries multiply load exponentially.", f: "client>api:fail, api>svc:fail, svc>db:fail, svc>db:fail, svc>db:fail", a: "api svc db", m: { "Calls per request": "up to 27" } },
    { t: "concept", s: "Budget", h: "Retry once, with backoff and a budget", b: "Only the edge retries, with exponential backoff and jitter, and only while retries stay under ~10% of traffic. Inner layers fail fast.", k: "One retry layer, bounded by a budget.", f: "client>api:req, api>svc:req, svc>db:req", a: "api", m: { "Calls per request": "≤1.1" } },
    { t: "recap", s: "Shed", h: "Shed load and break circuits", b: "The database tier rejects excess work quickly (503) and callers open circuit breakers, giving it room to recover.", k: "Fast rejection beats slow collapse.", f: "svc>db:fail, svc>api:res, api>client:res", a: "svc" },
  ],
});

L({
  id: "poison-messages",
  title: "Poison Messages",
  sub: "One bad message that fails forever can block a whole queue.",
  level: "Intermediate", min: 6,
  learn: ["Why some messages can never succeed", "Max attempts and dead-letter queues", "Handling poison messages in ordered partitions"],
  deep: [
    "Bad payloads, schema mismatches or bugs make a message fail every time. Infinite retries waste capacity and, in ordered partitions, block every message behind it.",
    "After N attempts, move the message to a dead-letter queue with the error and metadata; alert on DLQ depth; provide a replay tool once fixed.",
    "Distinguish transient errors (retry with backoff) from permanent ones (validation errors: dead-letter immediately).",
  ],
  iv: ["Always mention a DLQ, alerting on it, and a redrive path.", "For ordered streams, discuss whether skipping a message is acceptable for that entity."],
  refs: [["Amazon SQS: dead-letter queues", "https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html"], ["RabbitMQ: dead lettering", "https://www.rabbitmq.com/docs/dlx"]],
  nodes: [N("queue", "orders queue", 130, 220, "queue"), N("worker", "consumer", 400, 220, "worker"), N("db", "database", 650, 100, "db"), N("dlq", "dead-letter queue", 650, 340, "queue")],
  steps: [
    { t: "problem", s: "Poison", h: "A message that always fails", b: "A message has a malformed date. The consumer throws, the message is redelivered, throws again, forever.", k: "Permanent failures can't be fixed by retrying.", f: "queue>worker:req, worker>queue:fail", v: "queue worker db", a: "worker" },
    { t: "case", s: "Blocked", h: "Everything behind it waits", b: "In an ordered partition, every later message waits behind the poison one. Lag grows and alerts fire everywhere.", k: "One bad message can stall a partition.", f: "queue>worker:fail, queue>worker:fail", v: "queue worker db", a: "queue" },
    { t: "concept", s: "DLQ", h: "Dead-letter after N attempts", b: "After 5 attempts (or immediately for validation errors) the message moves to a DLQ with the error. The main flow continues.", k: "Isolate failures; keep the main path moving.", f: "queue>worker:req, worker>dlq:req, worker>db:req", a: "dlq" },
    { t: "recap", s: "Redrive", h: "Alert, fix, replay", b: "Alert when the DLQ is non-empty, fix the bug or data, then redrive messages back to the main queue.", k: "A DLQ without alerts is a silent data-loss bucket.", f: "dlq>queue:sync, queue>worker:req, worker>db:req", a: "dlq queue" },
  ],
});

L({
  id: "backpressure",
  title: "Backpressure",
  sub: "When producers are faster than consumers, something has to give.",
  level: "Intermediate", min: 6,
  learn: ["Why unbounded queues are dangerous", "Bounded buffers, blocking and shedding", "Scaling consumers on lag"],
  deep: [
    "An unbounded queue hides overload until memory runs out or latency becomes useless; by then every message is stale.",
    "Backpressure signals producers to slow down: bounded buffers that block, 429/503 responses, or flow-control credits (as in TCP and reactive streams).",
    "Options under overload: buffer (bounded), drop/shed (lowest priority first), slow producers, or scale consumers based on lag.",
  ],
  iv: ["Ask which work is droppable and which isn't; prioritise accordingly.", "Autoscale consumers on queue lag or age of the oldest message, not on CPU alone."],
  refs: [["Reactive Streams specification", "https://www.reactive-streams.org/"], ["Google SRE book: Handling overload", "https://sre.google/sre-book/handling-overload/"]],
  mk: ["In", "Out", "Backlog"],
  nodes: [N("prod", "producers", 110, 220, "user"), N("buf", "bounded queue", 370, 220, "queue"), N("c1", "consumer 1", 630, 110, "worker"), N("c2", "consumer 2", 630, 330, "worker")],
  steps: [
    { t: "problem", s: "Overload", h: "Producers outpace consumers", b: "Producers send 5,000 msg/s; consumers handle 2,000. With an unbounded queue the backlog grows without limit, and so does latency.", k: "Unbounded buffers turn overload into outage later.", f: "prod>buf:req, prod>buf:req, buf>c1:req", v: "prod buf c1", a: "buf", m: { In: "5,000/s", Out: "2,000/s", Backlog: "↑ 3,000/s" } },
    { t: "concept", s: "Bound", h: "Bound the buffer and push back", b: "When the queue is full, producers get 429/503 or block. Clients slow down or retry later with backoff.", k: "Backpressure moves the problem to where it can be handled.", f: "prod>buf:fail, buf>prod:res", v: "prod buf c1", a: "prod buf" },
    { t: "concept", s: "Scale", h: "Scale consumers on lag", b: "Autoscaling watches queue lag and adds consumers until Out ≥ In.", k: "Scale on lag, the real signal of falling behind.", f: "prod>buf:req, buf>c1:req, buf>c2:req", a: "c1 c2", m: { In: "5,000/s", Out: "5,200/s", Backlog: "↓" } },
    { t: "recap", s: "Shed", h: "Shed what you can afford to lose", b: "If capacity can't grow fast enough, drop low-priority work (analytics, previews) first and keep critical paths (payments) flowing.", k: "Decide in advance what gets dropped.", f: "prod>buf:req, buf>c1:req, buf>c2:req", a: "buf" },
  ],
});

L({
  id: "pagination-at-scale",
  title: "Pagination at Scale",
  sub: "Why OFFSET gets slower and less correct, and how cursors fix it.",
  level: "Intermediate", min: 6,
  learn: ["The cost of large OFFSETs", "Duplicates and skips under concurrent inserts", "Keyset (cursor) pagination"],
  deep: [
    "<code>OFFSET 100000 LIMIT 20</code> still makes the database find and discard 100,000 rows; cost grows with page depth.",
    "New rows inserted while paging shift offsets, causing duplicates or skipped items.",
    "Keyset pagination: <code>WHERE (created_at, id) &lt; (:last_created_at, :last_id) ORDER BY created_at DESC, id DESC LIMIT 20</code> with a matching index. The cursor encodes the last row's values. The trade-off is no random “jump to page 500”.",
  ],
  iv: ["Include a unique tiebreaker (id) in the sort and the cursor.", "Return an opaque cursor token rather than raw column values in public APIs."],
  refs: [["Use The Index, Luke: Paging through results", "https://use-the-index-luke.com/no-offset"], ["Django REST framework: CursorPagination", "https://www.django-rest-framework.org/api-guide/pagination/#cursorpagination"]],
  mk: ["Rows scanned", "Latency"],
  nodes: [N("client", "client", 100, 220, "client"), N("api", "API", 350, 220), N("idx", "index (created_at, id)", 600, 90, "cache"), N("db", "posts table", 620, 330, "db")],
  steps: [
    { t: "problem", s: "Offset", h: "Deep OFFSET is slow", b: "Page 5,000 with <code>OFFSET 100000 LIMIT 20</code>: the database walks 100,020 rows to return 20.", k: "OFFSET cost grows with page number.", f: "client>api:req, api>db:fail", v: "client api db", a: "db", m: { "Rows scanned": "100,020", Latency: "900 ms" } },
    { t: "case", s: "Shifting", h: "Inserts shift the pages", b: "While a user reads page 1, 5 new posts arrive. Page 2 now starts 5 rows earlier, so they see 5 duplicates.", k: "Offsets move when data changes.", f: "client>api:req, api>db:req, db>client:fail", v: "client api db", a: "api" },
    { t: "concept", s: "Cursor", h: "Seek from the last row", b: "The cursor holds the last row's (created_at, id). The next query seeks directly to it in the index and reads 20 rows.", k: "Keyset pagination costs the same on every page.", f: "client>api:req, api>idx:req, idx>db:req, db>client:res", a: "idx", m: { "Rows scanned": "20", Latency: "3 ms" } },
    { t: "recap", s: "Trade-off", h: "What you give up", b: "No direct jump to page N and no cheap total count. For feeds and infinite scroll that's fine; for admin tables with page numbers, cap the depth or use search.", k: "Cursors for feeds/APIs; offsets only for shallow pages.", f: "client>api:req, api>idx:req", a: "api" },
  ],
});
