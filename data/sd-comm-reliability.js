L({
  id: "rest-rpc-graphql",
  title: "REST, RPC & GraphQL",
  sub: "Three API styles and where each one fits.",
  level: "Intermediate", min: 8,
  learn: ["Resource-oriented REST and HTTP semantics", "gRPC for service-to-service calls", "GraphQL's flexibility and its costs"],
  deep: [
    "REST maps operations to HTTP methods on resources; GET, PUT and DELETE are defined as idempotent, and responses can use standard HTTP caching.",
    "gRPC uses Protocol Buffers over HTTP/2: compact binary messages, generated typed clients, deadlines and streaming. It's very common between internal services.",
    "GraphQL lets clients request exactly the fields they need from one endpoint. Servers need query depth/cost limits and batching (e.g. DataLoader) to avoid N+1 resolvers, and HTTP caching is harder.",
  ],
  iv: ["Public API → REST (or GraphQL for flexible UIs). Internal high-volume calls → gRPC.", "Mention versioning, pagination and error format whichever style you pick."],
  refs: [["RFC 9110: HTTP Semantics", "https://www.rfc-editor.org/rfc/rfc9110"], ["gRPC docs", "https://grpc.io/docs/what-is-grpc/introduction/"], ["GraphQL: best practices", "https://graphql.org/learn/best-practices/"]],
  nodes: [N("client", "mobile app", 110, 220, "client"), N("api", "API gateway", 350, 220, "lb"), N("users", "users service", 620, 100), N("orders", "orders service", 620, 340)],
  steps: [
    { t: "concept", s: "REST", h: "REST: resources + HTTP verbs", b: "<code>GET /orders/42</code>, <code>POST /orders</code>. Uses status codes, caching headers and a well-understood model; easy for any client.", k: "REST leans on HTTP itself: methods, status codes, caching.", f: "client>api:req, api>orders:req, orders>client:res", a: "api orders" },
    { t: "concept", s: "gRPC", h: "gRPC between services", b: "The API gateway calls services with gRPC: typed contracts in .proto files, binary payloads, HTTP/2 multiplexing and per-call deadlines.", k: "gRPC: fast, typed, internal.", f: "api>users:sync, api>orders:sync, users>api:res", a: "users orders" },
    { t: "concept", s: "GraphQL", h: "GraphQL: the client picks fields", b: "A screen needs user name + last 3 orders. One GraphQL query fetches exactly that, instead of several REST calls or oversized responses.", k: "GraphQL fixes over- and under-fetching for UIs.", f: "client>api:req, api>users:req, api>orders:req, api>client:res", a: "api" },
    { t: "recap", s: "Costs", h: "Know the trade-offs", b: "GraphQL: needs query cost limits and batched resolvers. gRPC: harder to call from browsers directly. REST: many round trips for complex screens.", k: "Choose by consumer: public, internal, or UI-driven.", a: "api users orders" },
  ],
});

L({
  id: "message-queues",
  title: "Message Queues",
  sub: "Move slow work out of the request and absorb bursts.",
  level: "Intermediate", min: 7,
  learn: ["Async processing with a work queue", "Acknowledgements and at-least-once delivery", "Visibility timeouts, retries and DLQs"],
  deep: [
    "Typical brokers: RabbitMQ, Amazon SQS, Redis-based queues (Celery/RQ), Kafka (a log, used as a queue via consumer groups).",
    "A consumer acknowledges a message after processing. If it crashes first, the message is delivered again, so handlers must be idempotent.",
    "SQS hides an in-flight message for a visibility timeout; if not deleted in time it reappears. Messages failing repeatedly go to a dead-letter queue.",
  ],
  iv: ["Return 202 Accepted with a job ID, and let the client poll or get notified.", "Always say “at-least-once, so the consumer is idempotent”."],
  refs: [["Amazon SQS: visibility timeout", "https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html"], ["RabbitMQ: consumer acknowledgements", "https://www.rabbitmq.com/docs/confirms"]],
  mk: ["Response", "Queue depth"],
  nodes: [N("web", "web app", 130, 220), N("queue", "job queue", 390, 220, "queue"), N("w1", "worker 1", 640, 110, "worker"), N("w2", "worker 2", 640, 330, "worker")],
  steps: [
    { t: "problem", s: "Slow request", h: "PDF generation inside the request", b: "Generating an invoice PDF and emailing it takes 6 seconds, so the user waits and web workers are tied up.", k: "Don't make users wait for work they don't need to see.", f: "web>web:fail", v: "web", a: "web", m: { Response: "6.2 s" } },
    { t: "concept", s: "Enqueue", h: "Enqueue and respond", b: "The web app writes a job to the queue and immediately returns 202 with a job ID. Workers pull jobs at their own pace.", k: "Queues decouple request latency from work duration.", f: "web>queue:req, queue>w1:req, queue>w2:req", a: "queue", m: { Response: "40 ms", "Queue depth": "12" } },
    { t: "concept", s: "Ack", h: "Ack after success", b: "A worker acks only after finishing. If it crashes mid-job, the broker redelivers to another worker. The same job can run twice.", k: "At-least-once delivery → idempotent handlers.", f: "queue>w1:req, w1>queue:res, queue>w2:fail", a: "w1 w2" },
    { t: "case", s: "Bursts", h: "Bursts and poison jobs", b: "A 10× spike fills the queue instead of crashing the site; add workers to drain it. Jobs that fail N times go to a dead-letter queue for inspection.", k: "Queues smooth bursts; DLQs isolate bad messages.", f: "web>queue:req, queue>w1:req, queue>w2:req", a: "w1 w2", m: { Response: "40 ms", "Queue depth": "4,800 → 0" } },
  ],
});

L({
  id: "pub-sub",
  title: "Pub/Sub & Events",
  sub: "Publish a fact once; let any number of services react.",
  level: "Intermediate", min: 7,
  learn: ["Queues vs topics", "Kafka partitions and ordering", "Designing good event payloads"],
  deep: [
    "In a work queue, each message goes to one consumer. In pub/sub, each subscriber (or consumer group) receives its own copy.",
    "Kafka orders messages only within a partition; use the entity ID (e.g. order_id) as the key so events for one entity stay ordered.",
    "Name events as past-tense facts (OrderPlaced), include an event ID, timestamp, schema version and the IDs consumers need. Evolve schemas compatibly.",
  ],
  iv: ["Events decouple teams but make flows harder to trace, so propagate correlation IDs.", "Combine with the transactional outbox so events and DB state agree."],
  refs: [["Apache Kafka: introduction", "https://kafka.apache.org/intro"], ["Martin Fowler: What do you mean by “Event-Driven”?", "https://martinfowler.com/articles/201701-event-driven.html"]],
  nodes: [N("orders", "orders service", 120, 220), N("topic", "topic: order-events", 380, 220, "queue"), N("email", "email service", 650, 80, "worker"), N("analytics", "analytics", 680, 220, "worker"), N("inventory", "inventory", 650, 360, "worker")],
  steps: [
    { t: "concept", s: "Publish", h: "Publish once, consume many", b: "The orders service publishes OrderPlaced. It doesn't know or care who listens.", k: "Producers don't depend on consumers.", f: "orders>topic:req", a: "topic" },
    { t: "concept", s: "Fan-out", h: "Each subscriber gets a copy", b: "Email, analytics and inventory each consume the event independently, at their own speed. Adding a fourth consumer needs no change to orders.", k: "Pub/sub = fan-out; queue = work distribution.", f: "topic>email:req, topic>analytics:req, topic>inventory:req", a: "email analytics inventory" },
    { t: "case", s: "Ordering", h: "Ordering per key", b: "OrderPlaced then OrderCancelled must be processed in that order. Keying by order_id keeps both in the same partition, preserving their order.", k: "Order is guaranteed per partition, so choose the key carefully.", f: "orders>topic:req, topic>inventory:req", a: "inventory" },
    { t: "recap", s: "Trade-offs", h: "Eventual consistency", b: "Consumers update later than the producer, so the system is eventually consistent. Make consumers idempotent and use tracing to follow a flow across services.", k: "Decoupling costs immediacy and visibility.", f: "orders>topic:req, topic>email:req, topic>analytics:req, topic>inventory:req", a: "topic" },
  ],
});

L({
  id: "real-time",
  title: "Real-time Updates",
  sub: "Push changes to clients the moment they happen.",
  level: "Intermediate", min: 7,
  learn: ["Polling, long polling, SSE and WebSockets", "Scaling stateful connections", "Recovering missed messages"],
  deep: [
    "Server-Sent Events (SSE) is a one-way server→client stream over plain HTTP with built-in reconnection and Last-Event-ID.",
    "WebSockets give a full-duplex connection, suited to chat, collaboration and games.",
    "Connections are stateful: gateways subscribe to a shared bus (Redis pub/sub, NATS, Kafka) so a message reaches whichever gateway holds the user's socket.",
  ],
  iv: ["Pick SSE for one-way feeds (notifications, dashboards), WebSockets for two-way interaction.", "Explain reconnect + resume from the last sequence number so nothing is lost."],
  refs: [["MDN: Server-sent events", "https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events"], ["RFC 6455: The WebSocket Protocol", "https://www.rfc-editor.org/rfc/rfc6455"]],
  nodes: [N("client", "client", 100, 220, "client"), N("gw1", "gateway 1", 340, 110), N("gw2", "gateway 2", 340, 330), N("bus", "pub/sub bus", 580, 220, "queue"), N("app", "app", 740, 100)],
  steps: [
    { t: "concept", s: "Polling", h: "Polling: simple but wasteful", b: "The client asks “anything new?” every few seconds. Most answers are empty, and updates arrive up to one interval late.", k: "Polling trades latency for simplicity.", f: "client>gw1:req, gw1>client:res", v: "client gw1 app", a: "gw1" },
    { t: "concept", s: "Push", h: "SSE or WebSocket: server pushes", b: "The client keeps one connection open; the server sends events as they happen. SSE for one-way, WebSocket for two-way.", k: "Persistent connections give instant delivery.", f: "gw1>client:res", v: "client gw1 app", a: "client gw1" },
    { t: "concept", s: "Fan-out", h: "Many gateways, one bus", b: "The user is connected to gateway 1, but the event was produced by the app. The app publishes to a bus; every gateway subscribes and forwards to its own connected users.", k: "A shared bus routes messages to the right connection.", f: "app>bus:req, bus>gw1:sync, bus>gw2:sync, gw1>client:res", a: "bus" },
    { t: "case", s: "Resume", h: "Reconnects and missed messages", b: "Mobile networks drop. On reconnect the client sends its last seen event ID or sequence number, and the server replays what was missed from storage.", k: "Real-time needs a replay path, not just a socket.", f: "client>gw2:req, gw2>client:res", a: "gw2" },
  ],
});

L({
  id: "redundancy-failover",
  title: "Redundancy & Failover",
  sub: "Remove single points of failure and practise switching over.",
  level: "Intermediate", min: 8,
  learn: ["N+1 capacity across availability zones", "Database standby and promotion", "RPO and RTO"],
  deep: [
    "Availability zones are separate datacenters within a region; spreading instances across them survives the loss of one.",
    "RPO (recovery point objective) is how much data you can lose; RTO (recovery time objective) is how long you can be down. Synchronous replication can give RPO ≈ 0 at the cost of write latency.",
    "Failover that's never tested usually fails. Run regular game days.",
  ],
  iv: ["Walk the request path and ask “what if this dies?” for every box.", "Quote RPO/RTO targets and pick replication mode to match."],
  refs: [["AWS Well-Architected: Reliability pillar", "https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html"], ["Google SRE book", "https://sre.google/sre-book/table-of-contents/"]],
  mk: ["Healthy", "RTO", "RPO"],
  nodes: [N("lb", "load balancer", 110, 220, "lb"), N("a1", "app (zone A)", 350, 100), N("a2", "app (zone B)", 350, 340), N("p", "primary DB (A)", 620, 100, "db"), N("s", "standby DB (B)", 620, 340, "db")],
  steps: [
    { t: "concept", s: "N+1", h: "Spread across zones", b: "App servers run in two zones with enough capacity that either zone alone can carry the load.", k: "Redundant capacity must survive losing a whole zone.", f: "lb>a1:req, lb>a2:req, a1>p:req, a2>p:req", a: "a1 a2", m: { Healthy: "2 / 2 zones" } },
    { t: "concept", s: "Standby", h: "A replica ready to take over", b: "The primary streams its log to a standby in the other zone. Synchronous replication means no committed data is lost; asynchronous means lower latency but a few seconds of possible loss.", k: "Sync = RPO 0 but slower writes; async = faster but may lose data.", f: "p>s:sync", a: "p s" },
    { t: "case", s: "Failover", h: "Zone A goes dark", b: "Health checks fail; the load balancer stops sending traffic to zone A, and the standby is promoted to primary. Clients reconnect via the same DNS name or endpoint.", k: "Automated detection + promotion keeps RTO short.", f: "lb>a1:fail, lb>a2:req, a2>s:req", a: "a2 s", m: { Healthy: "1 / 2 zones", RTO: "~60 s", RPO: "0 (sync)" } },
    { t: "recap", s: "Practise", h: "Test it before you need it", b: "Run planned failovers, and rebuild a new standby afterwards so you're redundant again. Watch for split-brain if the old primary comes back.", k: "Untested failover isn't failover.", f: "lb>a2:req, a2>s:req, s>p:sync", a: "s" },
  ],
});

L({
  id: "rate-limiting",
  title: "Rate Limiting",
  sub: "Protect services and share capacity fairly.",
  level: "Intermediate", min: 7,
  learn: ["Token bucket and window algorithms", "Distributed counters", "Responding with 429 and Retry-After"],
  deep: [
    "Token bucket: a bucket of capacity B refills at r tokens/s; each request takes one token. It allows short bursts up to B and a sustained rate of r.",
    "Fixed windows are simple but let up to 2× the limit through around window boundaries; sliding-window counters smooth this.",
    "Across many servers, keep counters in a shared store such as Redis and update them atomically (INCR with EXPIRE, or a Lua script).",
  ],
  iv: ["Ask what to limit by: user, API key, IP or endpoint, and the limits for each tier.", "Return 429 Too Many Requests with Retry-After, and document limits in response headers."],
  refs: [["RFC 6585: 429 Too Many Requests", "https://www.rfc-editor.org/rfc/rfc6585#section-4"], ["Stripe: scaling your API with rate limiters", "https://stripe.com/blog/rate-limiters"]],
  mk: ["Tokens", "Allowed", "Rejected"],
  nodes: [N("client", "client", 100, 220, "client"), N("lim", "rate limiter", 340, 220, "lb"), N("redis", "counters (Redis)", 340, 390, "cache"), N("api", "API", 620, 220)],
  steps: [
    { t: "problem", s: "Abuse", h: "One client floods the API", b: "A buggy script sends 2,000 requests per second, slowing the API for everyone.", k: "Unbounded clients can take down shared services.", f: "client>api:fail", v: "client api", a: "api" },
    { t: "concept", s: "Bucket", h: "Token bucket", b: "Each client gets a bucket of 100 tokens refilling at 10/s. Requests spend tokens; with an empty bucket the request is rejected.", k: "Bursts up to B, sustained rate r.", f: "client>lim:req, lim>api:req, api>client:res", a: "lim", m: { Tokens: "100 → 0", Allowed: "10 / s", Rejected: "1,990 / s" } },
    { t: "concept", s: "Shared", h: "Shared counters", b: "There are many API servers, so limits live in Redis and are updated atomically, so every server sees the same count.", k: "Distributed limits need a shared, atomic store.", f: "lim>redis:sync, redis>lim:res", a: "redis" },
    { t: "case", s: "429", h: "Reject politely", b: "Return <code>429 Too Many Requests</code> with <code>Retry-After</code>. Good clients back off; your API stays healthy for everyone else.", k: "Fail fast with clear retry guidance.", f: "client>lim:req, lim>client:fail", a: "lim" },
  ],
});

L({
  id: "timeouts-retries",
  title: "Timeouts & Retries",
  sub: "Stop one slow dependency from taking everything down.",
  level: "Intermediate", min: 8,
  learn: ["Why every remote call needs a timeout", "Safe retries: idempotency, backoff, jitter", "Circuit breakers"],
  deep: [
    "Without timeouts, threads or connections wait forever on a hung dependency, the pool runs out, and failure cascades upstream.",
    "Retry only transient errors (timeouts, 503, connection resets) on idempotent operations. Use exponential backoff with jitter and a small max attempt count.",
    "A circuit breaker opens after repeated failures and fails fast for a cooldown period, then lets a few trial requests through (half-open).",
  ],
  iv: ["Set timeouts as a budget: the downstream timeout must be shorter than the caller's.", "Retry at one layer only, otherwise retries multiply."],
  refs: [["AWS Architecture Blog: Exponential backoff and jitter", "https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/"], ["Martin Fowler: Circuit Breaker", "https://martinfowler.com/bliki/CircuitBreaker.html"], ["requests: timeouts", "https://requests.readthedocs.io/en/latest/user/advanced/#timeouts"], ["tenacity docs", "https://tenacity.readthedocs.io/"], ["pybreaker", "https://github.com/danielfm/pybreaker"]],
  nodes: [
    N("client", "client", 90, 230, "client", "The shopper's browser. It calls <code>POST /checkout</code> and waits."),
    N("a", "checkout service", 360, 220, "server", "Django checkout service with a pool of 8 worker threads. A call to the payment API holds one worker until it returns."),
    N("b", "payment API", 650, 210, "ext", "Third-party payment API (<code>POST /v1/charges</code>). Outside your control: it can be slow or hang."),
  ],
  steps: (() => {
    const ev = (f, t, k, at, dur, o = {}) => ({ f, t, k, at, dur, ...o });
    const POOL = 8;
    const hang = [...Array.from({ length: POOL }, (_, k) => [
      ev("client", "a", "req", k * 600, 500, { log: "POST /checkout" }),
      ev("a", "b", "req", k * 600 + 450, 650, { endAt: 0.9 - k * 0.075, hold: 6400 - (k * 600 + 1100) - 300, end: "fade", log: "POST /v1/charges  (no timeout)" }),
    ]).flat(),
    ev("client", "a", "fail", 5000, 500, { endAt: 0.55, end: "pop", log: "POST /checkout", done: "503 · no free worker" }),
    ev("client", "a", "fail", 5650, 500, { endAt: 0.55, end: "pop", log: "POST /checkout", done: "503 · no free worker" })];
    return [
      { t: "problem", s: "Hang", h: "The payment API hangs", b: "Calls never return. Each one holds a worker thread, and within a minute every checkout worker is stuck, so checkout is down too.", k: "A missing timeout turns a slow dependency into an outage.",
        f: "client>a:req, a>b:fail", a: "a b", L: 6400, ev: hang,
        setup: [["timeout", "none", "bad"], ["workers", "8 threads"], ["retries", "—"], ["breaker", "—"]],
        code: "# no timeout: requests waits forever by default\nresp = requests.post(PAYMENT_URL, json=charge)",
        note: "requests has no default timeout, so a hung socket blocks the worker indefinitely.",
        fx(t, S) {
          const busy = Math.min(POOL, hang.filter((e) => e.f === "a" && t >= e.at + e.dur).length);
          S.pool("a", Array.from({ length: POOL }, (_, i) => (i < busy ? "stuck" : "idle")));
          S.metric("cpu", "Workers busy", `${busy} / ${POOL}`, busy === POOL ? "bad" : busy ? "warn" : "");
          S.metric("hourglass", "Payment reply", "never", "bad");
          S.metric("activity", "Checkout", busy === POOL ? "down" : "degrading", busy === POOL ? "bad" : "warn");
          S.tag("b", t > 1100 ? `no reply · ${(t / 1000).toFixed(1)} s` : "", "bad", "hourglass");
          S.tag("a", busy === POOL ? "pool exhausted 8/8" : busy ? `${busy}/8 workers stuck` : "worker pool", busy === POOL ? "bad" : busy ? "warn" : "", "cpu");
          S.tag("client", t > 5000 ? "503 checkout down" : "", "bad", "x");
        } },
      { t: "concept", s: "Timeout", h: "Bound every call", b: "Set a 2 s timeout on the payment call and a 5 s timeout at the edge. Workers are freed and the user gets a clear error.", k: "Timeouts cap how long failure can hold resources.",
        f: "client>a:req, a>b:req, a>client:res", a: "a", L: 4400,
        ev: [ev("client", "a", "req", 0, 550, { log: "POST /checkout" }), ev("a", "b", "req", 500, 650, { endAt: 0.82, hold: 1350, end: "pop", popKind: "fail", log: "POST /v1/charges  timeout=(0.5, 2)", done: "ReadTimeout after 2.0 s" }), ev("a", "client", "res", 2800, 650, { log: "502 payment unavailable, try again", tone: "warn" })],
        setup: [["timeout", "connect 0.5 s, read 2 s", "hi"], ["edge", "5 s"], ["retries", "—"], ["breaker", "—"]],
        code: "# (connect, read) timeouts in seconds\nresp = requests.post(PAYMENT_URL, json=charge, timeout=(0.5, 2))",
        note: "The downstream timeout (2 s) must be shorter than the caller's (5 s), or the caller gives up first.",
        fx(t, S) {
          const on = t >= 500 && t < 2500, freed = t >= 2500 && t < 3600;
          S.pool("a", Array.from({ length: POOL }, (_, i) => (i === 0 ? (on ? "busy" : freed ? "free" : "idle") : "idle")));
          S.ring("a", on ? (t - 500) / 2000 : 0, t > 2100 ? "--fail" : "--req");
          S.metric("timer", "Read timeout", "2.0 s", "ok");
          S.metric("cpu", "Workers busy", on ? `1 / ${POOL}` : `0 / ${POOL}`, on ? "warn" : "ok");
          S.metric("hourglass", "User waits", t > 3400 ? "≈ 2 s" : "…", t > 3400 ? "ok" : "");
          S.tag("a", on ? `timeout in ${Math.max(0, (2500 - t) / 1000).toFixed(1)} s` : freed ? "timed out · worker freed" : "worker pool", on ? "warn" : freed ? "ok" : "", on ? "timer" : freed ? "check" : "cpu", on ? (t - 500) / 2000 : null);
          S.tag("b", t >= 1150 && t < 2500 ? "slow…" : "", "bad", "hourglass");
          S.tag("client", t > 3400 ? "clear error, no hang" : "", "ok", "check");
        } },
      { t: "concept", s: "Retry", h: "Retry with backoff and jitter", b: "Retry transient failures after 100 ms, 200 ms, 400 ms (± random jitter), at most 3 times, and only if the operation is idempotent or carries an idempotency key.", k: "Backoff + jitter avoids synchronised retry waves.",
        f: "a>b:req, b>a:res, a>client:res", a: "a b", L: 6400,
        ev: [ev("a", "b", "fail", 0, 700, { endAt: 0.82, end: "pop", log: "POST /v1/charges  attempt 1", done: "503 Service Unavailable" }), ev("a", "b", "fail", 1450, 700, { endAt: 0.82, end: "pop", log: "POST /v1/charges  attempt 2 (after 100 ms)", done: "503 Service Unavailable" }),
          ev("a", "b", "req", 3350, 700, { log: "POST /v1/charges  attempt 3 (after 200 ms)" }), ev("b", "a", "res", 4100, 700, { log: "200 OK  ch_91x (same Idempotency-Key)", tone: "ok" }), ev("a", "client", "res", 4850, 650, { log: "201 Created", tone: "ok" })],
        setup: [["timeout", "connect 0.5 s, read 2 s"], ["retries", "max 3 attempts", "hi"], ["backoff", "100 → 200 → 400 ms ± jitter", "hi"], ["breaker", "—"]],
        code: "@retry(stop=stop_after_attempt(3),\n       wait=wait_random_exponential(multiplier=0.1, max=2),\n       retry=retry_if_exception_type(TRANSIENT))\ndef charge(payload, key):\n    resp = requests.post(PAYMENT_URL, json=payload, timeout=(0.5, 2),\n                         headers={\"Idempotency-Key\": key})\n    resp.raise_for_status()\n    return resp",
        note: "tenacity. TRANSIENT = (Timeout, ConnectionError) plus 502/503/504. Never retry a 4xx.",
        fx(t, S) {
          const ph = t < 1000 ? 1 : t < 1450 ? "w1" : t < 2450 ? 2 : t < 3350 ? "w2" : 3, wait = typeof ph !== "number";
          S.ring("a", ph === "w1" ? (t - 1000) / 450 : ph === "w2" ? (t - 2450) / 900 : 0, "--sync");
          S.metric("repeat", "Attempt", `${wait ? (ph === "w1" ? 1 : 2) : ph} / 3`, t > 4100 ? "ok" : "warn");
          S.metric("timer", "Backoff", ph === "w1" ? "100 ms ± jitter" : ph === "w2" ? "200 ms ± jitter" : "—", wait ? "warn" : "");
          S.metric("key", "Idempotency-Key", "pay_7f3a", "ok");
          S.tag("a", ph === "w1" ? "backoff 100 ms" : ph === "w2" ? "backoff 200 ms" : t > 4100 ? "succeeded on attempt 3" : `attempt ${ph} / 3`, t > 4100 ? "ok" : wait ? "warn" : "", t > 4100 ? "check" : wait ? "timer" : "repeat", ph === "w1" ? (t - 1000) / 450 : ph === "w2" ? (t - 2450) / 900 : null);
          S.tag("b", t < 2450 && t > 600 ? "503" : "", "bad", "x");
        } },
      { t: "case", s: "Breaker", h: "Circuit breaker", b: "After 50% failures in 10 s the breaker opens: calls fail instantly for 30 s instead of piling on. Then a few trial calls test whether the API recovered.", k: "Fail fast while a dependency is down; probe to recover.",
        f: "client>a:req, a>client:res, a>b:req, b>a:res", a: "a", L: 8200, gate: "a>b",
        ev: [0, 800, 1600].flatMap((t) => [ev("client", "a", "req", t, 400, { log: "POST /checkout" }), ev("a", "b", "fail", t + 350, 550, { endAt: 0.82, end: "pop", log: "POST /v1/charges", done: "503 Service Unavailable" })])
          .concat([2700, 3500, 4300, 5100].flatMap((t) => [ev("client", "a", "req", t, 400, { log: "POST /checkout" }), ev("a", "client", "fail", t + 420, 380, { log: "503 CircuitBreakerError (instant)", tone: "warn" })]))
          .concat([ev("a", "b", "req", 5800, 550, { log: "POST /v1/charges  trial call" }), ev("b", "a", "res", 6350, 550, { log: "200 OK  breaker closes", tone: "ok" }), ev("client", "a", "req", 7100, 400, { log: "POST /checkout" }), ev("a", "client", "res", 7500, 400, { log: "201 Created", tone: "ok" })]),
        setup: [["timeout", "connect 0.5 s, read 2 s"], ["retries", "max 3 attempts"], ["opens at", "50% failures in 10 s", "hi"], ["cooldown", "30 s, then 1 trial call", "hi"]],
        code: "breaker = pybreaker.CircuitBreaker(fail_max=5, reset_timeout=30)\n\n@breaker\ndef charge(payload, key): ...\n\ntry:\n    charge(payload, key)\nexcept pybreaker.CircuitBreakerError:\n    return JsonResponse({\"error\": \"payments degraded\"}, status=503)",
        note: "pybreaker opens after N consecutive failures; rate-based breakers (50% in 10 s) count a sliding window instead.",
        fx(t, S) {
          const st = t < 2400 ? "CLOSED" : t < 5600 ? "OPEN" : t < 6900 ? "HALF-OPEN" : "CLOSED";
          const tone = { CLOSED: t < 2400 ? "warn" : "ok", OPEN: "bad", "HALF-OPEN": "warn" }[st];
          S.gate(st);
          S.ring("a", st === "OPEN" ? (t - 2400) / 3200 : 0, "--fail");
          S.metric("shield", "Breaker", st, tone);
          S.metric("activity", "Failure rate", t < 2400 ? `${[0, 33, 66, 100][Math.min(3, Math.floor(t / 800) + (t >= 900 ? 1 : 0))]}%` : st === "OPEN" ? "over 50%" : "0%", t < 2400 ? "warn" : st === "OPEN" ? "bad" : "ok");
          S.metric("card", "Calls to payment", st === "OPEN" ? "blocked" : st === "HALF-OPEN" ? "1 trial call" : "flowing", st === "OPEN" ? "bad" : "");
          S.tag("mid", st === "OPEN" ? `OPEN · retry in ${Math.ceil(30 * (1 - (t - 2400) / 3200))} s` : st === "HALF-OPEN" ? "HALF-OPEN · trial call" : t < 2400 ? "CLOSED · counting failures" : "CLOSED · recovered", tone, "shield", st === "OPEN" ? (t - 2400) / 3200 : null);
          S.tag("client", st === "OPEN" ? "instant 503, no waiting" : "", "warn", "zap");
        } },
    ];
  })(),
});

L({
  id: "observability",
  title: "Observability",
  sub: "Know what your system is doing and why, from the outside.",
  level: "Intermediate", min: 7,
  learn: ["Metrics, logs and traces", "RED and USE methods", "SLOs and symptom-based alerts"],
  deep: [
    "RED for services: Rate, Errors, Duration. USE for resources: Utilisation, Saturation, Errors.",
    "Structured (JSON) logs with a request/trace ID let you join logs across services; never log secrets or unnecessary personal data.",
    "OpenTelemetry provides vendor-neutral instrumentation for traces, metrics and logs.",
  ],
  iv: ["Define an SLO (e.g. 99.9% of requests < 300 ms over 30 days) and alert on burning the error budget.", "Alert on user-visible symptoms; use causes (CPU, queue depth) for dashboards and debugging."],
  refs: [["Google SRE: Monitoring distributed systems", "https://sre.google/sre-book/monitoring-distributed-systems/"], ["OpenTelemetry docs", "https://opentelemetry.io/docs/"]],
  nodes: [N("app", "services", 130, 220), N("metrics", "metrics", 420, 80, "db"), N("logs", "logs", 470, 220, "db"), N("traces", "traces", 420, 360, "db"), N("oncall", "on-call engineer", 700, 220, "user")],
  steps: [
    { t: "concept", s: "Metrics", h: "Metrics: cheap numbers over time", b: "Request rate, error rate, latency percentiles, queue depth, DB connections. Cheap to store and great for dashboards and alerts.", k: "Metrics tell you that something is wrong.", f: "app>metrics:sync", a: "metrics" },
    { t: "concept", s: "Traces", h: "Traces: one request's path", b: "A trace shows each span: API 12 ms → DB 840 ms → cache 1 ms. It points straight to the slow hop.", k: "Traces tell you where it's wrong.", f: "app>traces:sync", a: "traces" },
    { t: "concept", s: "Logs", h: "Logs: the details", b: "Structured logs with the trace ID give the exact error, inputs and context for the failing requests.", k: "Logs tell you why it's wrong.", f: "app>logs:sync", a: "logs" },
    { t: "recap", s: "Alert", h: "Alert on symptoms, against SLOs", b: "Page a human when users are affected (error budget burning fast), not for every CPU spike.", k: "Good alerts are rare, actionable and user-centred.", f: "metrics>oncall:req, traces>oncall:res, logs>oncall:res", a: "oncall" },
  ],
});
