L({
  id: "hld-lld",
  title: "HLD & LLD",
  sub: "A repeatable framework for any system design interview.",
  level: "Intermediate", min: 7,
  learn: ["Clarifying requirements and estimating scale", "Drawing the high-level design", "Deep-diving bottlenecks", "Low-level design: APIs, schemas, classes"],
  deep: [
    "Functional requirements: what users can do. Non-functional: scale, latency, availability, consistency, cost, compliance.",
    "High-level design (HLD): main components and data flow. Low-level design (LLD): API contracts, database schema, indexes, class/module structure.",
    "Reserve time to discuss trade-offs and what you'd do next. Interviewers grade reasoning more than diagrams.",
  ],
  iv: ["A good time split for 45 minutes: ~5 requirements, ~5 estimates, ~15 HLD, ~15 deep dives, ~5 wrap-up.", "Say what you're not designing (out of scope) explicitly."],
  refs: [["Alex Xu, System Design Interview, ch. 3 (framework)", "https://bytebytego.com/"], ["Designing Data-Intensive Applications", "https://dataintensive.net/"]],
  nodes: [N("client", "clients", 100, 220, "client"), N("lb", "load balancer", 290, 220, "lb"), N("app", "API servers", 480, 220), N("cache", "cache", 480, 70, "cache"), N("db", "database", 690, 220, "db"), N("queue", "queue + workers", 480, 380, "queue")],
  steps: [
    { t: "concept", s: "Requirements", h: "1. Clarify requirements", b: "Ask who the users are, the core features, and the non-functional targets: users, QPS, latency, availability, consistency. Write them down.", k: "Requirements turn a vague prompt into a design problem.", v: "client", a: "client" },
    { t: "concept", s: "HLD", h: "2. High-level design", b: "Draw the request path end to end: clients → load balancer → stateless API → cache → database, plus async workers. Keep it simple first.", k: "Get a working end-to-end design before optimising.", f: "client>lb:req, lb>app:req, app>cache:req, app>db:req, app>queue:req", a: "lb app db" },
    { t: "case", s: "Deep dive", h: "3. Deep-dive the bottlenecks", b: "Use your estimates to find pressure points: hot reads → cache; heavy writes → partitioning; slow work → queue. Discuss failure modes for each.", k: "Spend time where the numbers say it matters.", f: "app>cache:req, cache>app:res, app>db:fail", a: "cache db" },
    { t: "recap", s: "LLD", h: "4. Low-level design and wrap-up", b: "Define key APIs (request/response), tables and indexes, and module responsibilities. Finish with trade-offs, risks and next steps.", k: "Close with trade-offs, not just boxes.", f: "client>lb:req, lb>app:req, app>db:req, db>app:res, app>client:res", a: "app db" },
  ],
});

L({
  id: "url-shortener",
  title: "Design a URL Shortener",
  sub: "A read-heavy key-value system with interesting ID generation.",
  level: "Intermediate", min: 9,
  learn: ["Estimating a read-heavy workload", "Generating short, unique keys", "Fast redirects with caching", "301 vs 302 and analytics"],
  deep: [
    "Example scale: 100M new URLs/month ≈ 40 writes/s; at a 100:1 read ratio ≈ 4,000 redirects/s on average.",
    "7 base62 characters give 62⁷ ≈ 3.5 trillion keys. Options: encode a unique counter/Snowflake ID in base62, or hash + check for collisions.",
    "301 (permanent) lets browsers cache the redirect, so you lose analytics on repeat clicks. 302/307 keeps every click going through you.",
  ],
  iv: ["Store mappings in a key-value store or a Postgres table keyed by short code; cache hot codes in Redis.", "Collect click analytics asynchronously via a queue, never on the redirect's critical path."],
  refs: [["MDN: 301 Moved Permanently", "https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/301"], ["MDN: 302 Found", "https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/302"]],
  mk: ["Writes/s", "Reads/s", "Key space"],
  nodes: [N("client", "browser", 100, 220, "client"), N("app", "shortener API", 340, 220), N("cache", "Redis", 340, 60, "cache"), N("db", "url mappings", 600, 220, "db"), N("queue", "click events", 340, 390, "queue"), N("stats", "analytics", 620, 390, "worker")],
  steps: [
    { t: "concept", s: "Estimate", h: "Read-heavy by design", b: "100M new links/month ≈ 40 writes/s. With 100 reads per write, ≈ 4,000 redirects/s on average, with higher peaks.", k: "Optimise the redirect path above all.", v: "client app db", a: "app", m: { "Writes/s": "≈40", "Reads/s": "≈4,000" } },
    { t: "concept", s: "Keys", h: "Generate the short code", b: "Take a unique 64-bit ID (from a counter or Snowflake-style generator) and base62-encode it. 7 characters cover ~3.5 trillion codes without collisions.", k: "Unique ID + base62 → no collision checks needed.", f: "client>app:req, app>db:req, db>app:res", v: "client app db", a: "app db", m: { "Writes/s": "≈40", "Reads/s": "≈4,000", "Key space": "62⁷ ≈ 3.5T" } },
    { t: "concept", s: "Redirect", h: "Serve redirects from cache", b: "GET /aZ3k9Qx → look up Redis, fall back to the database, respond 302 with the Location header. Popular links stay hot in cache.", k: "Cache-first lookup keeps redirects in single-digit ms.", f: "client>app:req, app>cache:req, cache>app:res, app>client:res", a: "cache" },
    { t: "case", s: "Analytics", h: "Count clicks off the critical path", b: "Emit a click event to a queue and return immediately; workers aggregate counts. Use 302 if you need every click; 301 lets browsers skip you next time.", k: "Async analytics; choose the status code deliberately.", f: "app>queue:req, queue>stats:req", a: "queue stats" },
  ],
});

L({
  id: "news-feed",
  title: "Design a News Feed",
  sub: "Fan-out on write, fan-out on read, and the celebrity problem.",
  level: "Advanced", min: 10,
  learn: ["Fan-out on write (push)", "Why celebrities break push", "Hybrid push/pull", "Ranking and cursor pagination"],
  deep: [
    "Push model: when a user posts, write the post ID into each follower's precomputed feed (e.g. a Redis list). Reads are fast.",
    "An account with tens of millions of followers would trigger tens of millions of writes per post, so pull celebrity posts at read time instead and merge.",
    "Store only IDs in feeds and hydrate post details in batch; paginate with a cursor (last seen post ID/score).",
  ],
  iv: ["State the read/write ratio first; feeds are read far more often than written.", "Explain the hybrid threshold (e.g. accounts above N followers use pull)."],
  refs: [["Designing Data-Intensive Applications, ch. 1 (Twitter timelines example)", "https://dataintensive.net/"]],
  nodes: [N("poster", "author", 100, 110, "client"), N("post", "post service", 330, 110), N("fan", "fan-out workers", 560, 110, "worker"), N("feed", "feed cache", 560, 330, "cache"), N("reader", "follower", 100, 330, "client"), N("db", "posts DB", 330, 330, "db")],
  steps: [
    { t: "concept", s: "Push", h: "Fan-out on write", b: "A post is saved, then workers push its ID into every follower's feed list. Reading a feed is one cache read.", k: "Push = cheap reads, expensive writes.", f: "poster>post:req, post>db:req, post>fan:req, fan>feed:sync", a: "fan feed" },
    { t: "problem", s: "Celebrity", h: "A celebrity posts", b: "An account with 50M followers posts: 50M feed writes, delaying everyone's feeds and overloading the cache.", k: "Fan-out cost grows with follower count.", f: "post>fan:req, fan>feed:fail", a: "fan" },
    { t: "concept", s: "Hybrid", h: "Hybrid: push for most, pull for celebrities", b: "Normal accounts are pushed. At read time, the feed service also pulls recent posts from the few celebrities the user follows and merges them.", k: "Bound the fan-out by switching strategy above a threshold.", f: "reader>feed:req, feed>reader:res, reader>db:req, db>reader:res", a: "feed db" },
    { t: "recap", s: "Read path", h: "Rank, hydrate, paginate", b: "Fetch IDs, rank (by time or a model), hydrate post details in one batch, return a cursor for the next page.", k: "IDs in feeds; details hydrated in batches; cursor pagination.", f: "reader>feed:req, feed>reader:res", a: "reader" },
  ],
});

L({
  id: "chat-system",
  title: "Design a Chat System",
  sub: "Persistent connections, ordering, delivery and offline users.",
  level: "Advanced", min: 10,
  learn: ["WebSocket gateways and routing", "Persist-then-deliver", "Per-conversation ordering", "Offline sync and presence"],
  deep: [
    "Users hold a WebSocket to a gateway; a session registry or pub/sub bus routes messages to the gateway that holds the recipient's connection.",
    "Persist the message first (assign a per-conversation sequence number), then deliver. Clients ack, and reconnecting clients sync from their last sequence.",
    "Messages are often stored in a wide-column store partitioned by conversation_id and clustered by sequence/time.",
  ],
  iv: ["Use client-generated message IDs to dedupe resends after network failures.", "Presence via periodic heartbeats with a TTL; don't fan presence out to everyone instantly."],
  refs: [["RFC 6455: The WebSocket Protocol", "https://www.rfc-editor.org/rfc/rfc6455"], ["Discord: How Discord stores trillions of messages", "https://discord.com/blog/how-discord-stores-trillions-of-messages"]],
  nodes: [N("alice", "Alice", 90, 110, "client"), N("gw1", "gateway 1", 300, 110), N("bus", "message bus", 420, 260, "queue"), N("gw2", "gateway 2", 560, 110), N("bob", "Bob", 730, 110, "client"), N("db", "messages DB", 420, 400, "db")],
  steps: [
    { t: "concept", s: "Connect", h: "Persistent connections", b: "Alice and Bob each keep a WebSocket open to whichever gateway they connected to.", k: "Gateways hold long-lived connections.", f: "alice>gw1:sync, bob>gw2:sync", a: "gw1 gw2" },
    { t: "concept", s: "Persist", h: "Persist first", b: "Alice sends a message with a client-generated ID. The server assigns the next sequence number for the conversation and stores it before acknowledging.", k: "Store, then ack: a message is never “sent” but lost.", f: "alice>gw1:req, gw1>db:req, db>gw1:res, gw1>alice:res", a: "db" },
    { t: "concept", s: "Deliver", h: "Route to the recipient", b: "The gateway publishes to the bus; gateway 2, which holds Bob's connection, delivers it. Bob's client acks the sequence number.", k: "A bus routes between gateways.", f: "gw1>bus:req, bus>gw2:req, gw2>bob:res", a: "bus gw2" },
    { t: "case", s: "Offline", h: "Bob was offline", b: "Bob reconnects and sends his last seen sequence number; the server returns everything after it. A push notification was sent while he was away.", k: "Sequence numbers make sync and ordering simple.", f: "bob>gw2:req, gw2>db:req, db>gw2:res, gw2>bob:res", a: "bob db" },
  ],
});
