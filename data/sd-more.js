/* Data-intensive patterns and designs from the field. Same format as data/dsl.js. */

L({
  id: "cdc",
  title: "Change Data Capture",
  sub: "Stream every committed database change to search, caches and analytics, without dual writes.",
  level: "Advanced", min: 8,
  learn: ["How CDC reads the database's own log", "Feeding search, caches and a warehouse from one stream", "Snapshots, ordering and replication-slot lag"],
  deep: [
    "CDC tools such as Debezium read the write-ahead log (PostgreSQL logical decoding with <code>pgoutput</code>, or the MySQL binlog) and emit one event per committed row change.",
    "Because events come from committed transactions, downstream systems never see rolled-back changes, and the application no longer has to publish events itself.",
    "Plan for the initial snapshot, ordering per primary key (partition topics by key), schema changes, and idempotent consumers that can handle replays.",
  ],
  iv: ["Contrast it with dual writes and the outbox pattern; CDC on an outbox table combines both.", "Mention replication slots: an unconsumed PostgreSQL slot keeps WAL on disk until the connector catches up, and can fill the disk."],
  refs: [["Debezium: PostgreSQL connector", "https://debezium.io/documentation/reference/stable/connectors/postgresql.html"], ["PostgreSQL: Logical decoding", "https://www.postgresql.org/docs/current/logicaldecoding.html"]],
  mk: ["Consumers in sync", "Slot lag"],
  nodes: [N("app", "orders service", 100, 330, "server"), N("db", "PostgreSQL", 300, 330, "db"), N("cdc", "Debezium", 300, 100, "worker"), N("kafka", "Kafka topic", 520, 100, "queue"), N("search", "search index", 740, 60, "db"), N("cache", "Redis cache", 740, 220, "cache"), N("dw", "warehouse", 740, 380, "db")],
  steps: [
    { t: "problem", s: "Drift", h: "The app updates everything itself", b: "After saving an order, the service also updates search and the cache. When one of those calls fails, the copies drift apart, and nobody notices until a customer does.", k: "Every extra write the app makes is another way to drift.",
      f: "app>db:req, app>search:req, app>cache:fail", a: "app", v: "app db search cache", m: { "Consumers in sync": "1 of 2", "Slot lag": "—" }, g: { cache: ["stale: update failed", "bad", "x"] } },
    { t: "concept", s: "Read the log", h: "Read the database's own log", b: "The database already records every committed change in its write-ahead log. Debezium reads it through a logical replication slot and turns each row change into an event.", k: "The WAL is already a perfect, ordered change feed.",
      f: "app>db:req, db>cdc:sync", a: "db cdc", v: "app db cdc", m: { "Consumers in sync": "—", "Slot lag": "0 MB" },
      setup: [["source", "PostgreSQL WAL via logical decoding"], ["output", "one event per committed row change", "hi"], ["order", "commit order, per key"]] },
    { t: "concept", s: "Fan out", h: "One stream, many consumers", b: "Change events land in a Kafka topic (<code>shop.public.orders</code>). Search, cache invalidation and the warehouse each consume it at their own pace and can replay it.", k: "Derived data comes from one source of truth.",
      f: "db>cdc:sync, cdc>kafka:req, kafka>search:req, kafka>cache:req, kafka>dw:req", a: "kafka", m: { "Consumers in sync": "3 of 3", "Slot lag": "0.4 MB" }, g: { kafka: ["shop.public.orders", "info", "list"] },
      code: `{"name": "orders-cdc",
 "config": {
   "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
   "database.hostname": "db", "database.dbname": "shop",
   "plugin.name": "pgoutput",
   "topic.prefix": "shop",
   "table.include.list": "public.orders"}}`, note: "Kafka Connect config for Debezium 2.x; credentials omitted. Topics are named prefix.schema.table." },
    { t: "recap", s: "Operate", h: "Run it like production", b: "The first run snapshots existing rows, then streams. Watch slot lag, keep consumers idempotent (upsert by primary key), and plan schema changes with the consumers.", k: "CDC is reliable, if you watch the slot.",
      f: "kafka>search:req, kafka>cache:req", a: "search cache", m: { "Consumers in sync": "3 of 3", "Slot lag": "2 MB (alert at 1 GB)" }, g: { db: ["replication slot healthy", "ok", "check"] },
      setup: [["first run", "initial snapshot, then stream"], ["watch", "replication slot lag (WAL retained)", "hi"], ["consumers", "idempotent upserts by primary key"]] },
  ],
});

L({
  id: "event-sourcing",
  title: "Event Sourcing",
  sub: "Store what happened, not just the current state, and rebuild any view from the history.",
  level: "Advanced", min: 8,
  learn: ["Events as the source of truth", "Projections and read models", "Snapshots, versioning and when not to use it"],
  deep: [
    "Instead of updating a balance row, append events (Deposited, Withdrawn). Current state is a fold over that entity's events.",
    "Projections consume the event stream to build read models (balances, statements, search) that can be rebuilt from scratch at any time.",
    "Costs: event schemas live forever, long histories need snapshots, and every query needs a projection. Use it where history and audit matter (ledgers, orders), not for every table.",
  ],
  iv: ["Separate event sourcing from event-driven messaging; you can have either without the other.", "Concurrency: append with an expected version so two writers can't both act on stale state."],
  refs: [["Martin Fowler: Event Sourcing", "https://martinfowler.com/eaaDev/EventSourcing.html"], ["Martin Fowler: CQRS", "https://martinfowler.com/bliki/CQRS.html"], ["microservices.io: Event sourcing", "https://microservices.io/patterns/data/event-sourcing.html"]],
  mk: ["Events", "Balance"],
  nodes: [N("client", "teller app", 100, 225, "client"), N("api", "accounts API", 310, 225, "server"), N("store", "account store", 530, 225, "db"), N("proj", "projector", 750, 100, "worker"), N("view", "balances view", 750, 350, "db")],
  steps: [
    { t: "problem", s: "Overwrite", h: "UPDATE throws the history away", b: "The table only says the balance is 70. When a customer disputes a withdrawal, nobody can say how it got there.", k: "Current state alone can't explain itself.",
      f: "client>api:req, api>store:req", a: "store", v: "client api store", m: { Events: "—", Balance: "70" }, g: { store: ["balance = 70 (why?)", "warn", "alert"] } },
    { t: "concept", s: "Append", h: "Append events instead", b: "Every change is appended as an event and never updated. The balance is computed by replaying the account's events: 100 − 50 + 20.", k: "State is a fold over events.",
      f: "client>api:req, api>store:req, store>api:res", a: "store", v: "client api store", m: { Events: "3", Balance: "100 − 50 + 20 = 70" },
      setup: [["write", "append-only, never update"], ["concurrency", "append with an expected version", "hi"], ["state", "fold over the entity's events"]],
      code: `events = [Deposited(100), Withdrawn(50), Deposited(20)]

def balance(events):
    total = 0
    for e in events:
        total += e.amount if isinstance(e, Deposited) else -e.amount
    return total   # 70, and you can see exactly why` },
    { t: "concept", s: "Project", h: "Projections build the read side", b: "A projector consumes new events and keeps a balances table up to date for fast reads. If the projection has a bug, fix it and rebuild it from the events.", k: "Read models are disposable; events are not.",
      f: "store>proj:sync, proj>view:req, client>api:req, api>view:req, view>api:res", a: "proj view", m: { Events: "3", Balance: "70 (from the view)" }, g: { view: ["read model: rebuildable", "info", "db"] } },
    { t: "recap", s: "Trade-offs", h: "Worth it for ledgers, not for everything", b: "Snapshots keep replays fast, and event versioning keeps old events readable. The price is complexity, so keep plain CRUD where history doesn't matter.", k: "Use it where the history is the product.",
      f: "store>proj:sync, proj>view:req", a: "store", m: { Events: "12,400", Balance: "snapshot every 500 events" },
      setup: [["good fit", "ledgers, orders, audit trails", "hi"], ["costs", "event versioning, snapshots, eventually consistent reads"], ["poor fit", "simple settings and CRUD tables"]] },
  ],
});

L({
  id: "search-indexing",
  title: "Keeping Search in Sync",
  sub: "A seller saves a product and can't find it in search. Index pipelines, lag and zero-downtime reindexing.",
  level: "Intermediate", min: 8,
  learn: ["Why search is a separate, eventually consistent copy", "Indexing from committed changes through a queue", "Reindexing with no downtime using aliases"],
  deep: [
    "Search engines such as Elasticsearch or OpenSearch keep their own inverted index. It is a derived copy of the database, updated asynchronously.",
    "Index from committed changes (an outbox or CDC) through a queue, so a failed index update is retried without blocking or failing the user's write.",
    "For mapping changes, build a new index in the background and then switch an alias to it; several alias actions in one request apply atomically.",
  ],
  iv: ["New documents become searchable after the next index refresh (about one second by default), so say 'near real-time'.", "Always have a full reindex path: you'll need it after mapping changes or bugs."],
  refs: [["Elasticsearch: Aliases", "https://www.elastic.co/guide/en/elasticsearch/reference/current/aliases.html"], ["microservices.io: Transactional outbox", "https://microservices.io/patterns/data/transactional-outbox.html"]],
  mk: ["Index lag", "Searchable"],
  nodes: [N("user", "seller", 90, 225, "client"), N("app", "catalog API", 290, 225, "server"), N("db", "PostgreSQL", 500, 90, "db"), N("q", "index queue", 500, 350, "queue"), N("idx", "indexer", 740, 190, "worker"), N("es", "search index", 740, 390, "db")],
  steps: [
    { t: "problem", s: "Missing", h: "Saved, but not searchable", b: "The product is in the database, but the request that should have updated the search index failed silently. Search returns nothing.", k: "Search is a copy, and copies drift.",
      f: "user>app:req, app>db:req, app>es:fail", a: "es", v: "user app db es", m: { "Index lag": "never indexed", Searchable: "no" }, g: { es: ["0 results for 'red mug'", "bad", "x"] } },
    { t: "concept", s: "Pipeline", h: "Index from committed changes", b: "After the commit, an outbox row (or CDC) puts the change on a queue. An indexer consumes it and updates the search index, retrying on failure.", k: "Writes never wait for search; search catches up.",
      f: "app>db:req, db>q:sync, q>idx:req, idx>es:req", a: "q idx", m: { "Index lag": "≈ 1.5 s", Searchable: "after the next refresh" },
      setup: [["source", "outbox or CDC, after commit", "hi"], ["queue", "retries without blocking writes"], ["refresh", "searchable after about 1 s"]] },
    { t: "concept", s: "Lag", h: "Hide the lag from the author", b: "For the seller who just saved the product, show it from the database on their own pages until the index catches up. Everyone else sees it a second later.", k: "Read your own writes from the source of truth.",
      f: "user>app:req, app>db:req, db>app:res", a: "app db", m: { "Index lag": "≈ 1.5 s", Searchable: "yes" }, g: { app: ["author sees the DB copy", "info", "check"] } },
    { t: "recap", s: "Reindex", h: "Reindex without downtime", b: "To change the mapping, build <code>products_v2</code> in the background from the database, then point the <code>products</code> alias at it in one atomic call.", k: "Search through an alias, never a bare index name.",
      f: "idx>es:sync, app>es:req, es>app:res", a: "es idx", m: { "Index lag": "≈ 1.5 s", Searchable: "yes, on v2" }, g: { es: ["alias products → v2", "ok", "repeat"] },
      code: `POST _aliases
{"actions": [
  {"remove": {"index": "products_v1", "alias": "products"}},
  {"add":    {"index": "products_v2", "alias": "products"}}]}`, note: "Both actions apply atomically, so searches never hit a missing or half-built index." },
  ],
});

L({
  id: "field-service-design",
  title: "Design a Field-Service System",
  sub: "Tickets, dispatch, technicians in the field with bad signal, and spare parts synced with an ERP.",
  level: "Senior", min: 10,
  learn: ["Modelling the ticket lifecycle as a state machine", "Offline-first sync for technicians' phones", "Integrating stock with an ERP without depending on it"],
  deep: [
    "Model the ticket as an explicit state machine (open → assigned → en route → on site → resolved → closed). Reject invalid transitions in the service and keep an audit log of who changed what.",
    "Technicians often have poor signal: the app stores changes locally with client-generated IDs and syncs later. The server accepts idempotent, versioned updates and resolves conflicts per field.",
    "ERP integration goes through an outbox and an integration worker with retries, so ERP downtime never blocks closing a ticket. Stock reservations are reconciled on a schedule.",
  ],
  iv: ["Start with the lifecycle and its invariants, then the data model, then the integrations.", "Say what happens when a technician uses a part offline that the ERP says is out of stock."],
  refs: [["microservices.io: Transactional outbox", "https://microservices.io/patterns/data/transactional-outbox.html"], ["Django: select_for_update", "https://docs.djangoproject.com/en/stable/ref/models/querysets/#select-for-update"]],
  mk: ["Open tickets", "Offline changes"],
  nodes: [N("cust", "customers", 90, 110, "user"), N("disp", "dispatcher", 90, 340, "client"), N("api", "ticketing API", 320, 225, "server"), N("db", "tickets DB", 540, 100, "db"), N("tech", "technician app", 540, 350, "client"), N("erp", "ERP", 770, 225, "ext")],
  steps: [
    { t: "concept", s: "Lifecycle", h: "Tickets are a state machine", b: "Customers open tickets and dispatchers move them along. Every status change goes through one function that checks the transition is allowed and records who made it.", k: "Make illegal states impossible to reach.",
      f: "cust>api:req, api>db:req, disp>api:req", a: "api db", v: "cust disp api db", m: { "Open tickets": "48", "Offline changes": "—" },
      setup: [["states", "open → assigned → en route → on site → resolved → closed", "hi"], ["rule", "reject transitions not in the table"], ["audit", "who changed what, and when"]],
      code: `ALLOWED = {
    "open": {"assigned", "cancelled"},
    "assigned": {"en_route", "open"},
    "en_route": {"on_site"},
    "on_site": {"resolved"},
    "resolved": {"closed", "on_site"},   # reopen
}

def transition(ticket_id, new, user):
    with transaction.atomic():
        t = Ticket.objects.select_for_update().get(id=ticket_id)
        if new not in ALLOWED.get(t.status, set()):
            raise InvalidTransition(t.status, new)
        TicketEvent.objects.create(ticket=t, old=t.status, new=new, by=user)
        t.status = new
        t.save(update_fields=["status"])`, note: "select_for_update() stops two dispatchers from racing on the same ticket." },
    { t: "concept", s: "Dispatch", h: "Dispatch to a technician", b: "The dispatcher assigns the ticket; the technician's app gets a push notification and the day's route.", k: "Assignment is just another transition.",
      f: "disp>api:req, api>tech:req", a: "disp tech", v: "cust disp api db tech", m: { "Open tickets": "48", "Offline changes": "—" }, g: { tech: ["3 tickets today", "info", "check"] } },
    { t: "problem", s: "Offline", h: "No signal in the basement", b: "The technician records parts and notes with no connection. The app queues the changes with client-generated IDs and versions, then syncs when the signal returns, so retries can't create duplicates.", k: "Design the mobile app offline-first.",
      f: "tech>api:fail, tech>api:req, api>db:req", a: "tech", v: "cust disp api db tech", m: { "Open tickets": "48", "Offline changes": "4 → 0" }, g: { tech: ["offline: 4 changes queued", "warn", "hourglass"] },
      setup: [["IDs", "client-generated UUIDs"], ["updates", "idempotent, with a version number", "hi"], ["conflicts", "per field; the server wins on status"]] },
    { t: "recap", s: "ERP", h: "Sync parts with the ERP, asynchronously", b: "Closing a ticket writes the parts used to an outbox in the same transaction. A worker sends them to the ERP and retries while it's down; a nightly job reconciles stock.", k: "Never let the ERP's uptime decide yours.",
      f: "api>db:req, db>erp:sync", a: "erp", m: { "Open tickets": "41", "Offline changes": "0" }, g: { erp: ["down? retried later", "warn", "repeat"] } },
  ],
});

L({
  id: "live-tracking-design",
  title: "Design Live Location Tracking",
  sub: "Thousands of field staff send GPS pings every few seconds; supervisors watch a live map and get alerted on violations.",
  level: "Senior", min: 10,
  learn: ["Ingesting high-frequency location pings", "A hot path for the live map, a cold path for history", "Geofence rules and real-time alerts"],
  deep: [
    "Batch pings on the device (send every 10–30 s) to save battery and requests. A lightweight ingest endpoint only validates and enqueues, then answers 202.",
    "Hot path: keep each worker's latest position in Redis (a geo set keyed per company) for the live map. Cold path: bulk-insert the full history into a time-partitioned table for reports.",
    "Run geofence and attendance rules in a stream consumer. Push violations to supervisors over WebSockets, deduplicated so one breach is one alert.",
  ],
  iv: ["Do the numbers: 5,000 workers × one ping every 10 s = 500 pings/s, up to about 43M rows a day.", "Mention privacy: track only during shifts, and set a retention period."],
  refs: [["Redis: Geospatial", "https://redis.io/docs/latest/develop/data-types/geospatial/"], ["PostgreSQL: Table partitioning", "https://www.postgresql.org/docs/current/ddl-partitioning.html"], ["Django Channels", "https://channels.readthedocs.io/"]],
  mk: ["Pings / s", "Map latency"],
  nodes: [N("staff", "field staff (5k)", 90, 225, "user"), N("ingest", "ingest API", 290, 225, "lb"), N("q", "ping stream", 500, 225, "queue"), N("redis", "latest positions", 720, 90, "cache"), N("hist", "history (partitioned)", 720, 350, "db"), N("rules", "rules engine", 500, 400, "worker"), N("sup", "supervisor map", 290, 410, "client")],
  steps: [
    { t: "problem", s: "Volume", h: "One INSERT per ping melts the database", b: "Every ping is written straight to the main database as its own row and transaction. At peak, the database spends its time on tiny inserts and the live map lags.", k: "High-frequency writes need a different path.",
      f: "staff>ingest:req, ingest>hist:fail", a: "hist", v: "staff ingest hist", m: { "Pings / s": "500", "Map latency": "12 s" }, g: { hist: ["500 single-row INSERTs/s", "bad", "alert"] } },
    { t: "concept", s: "Ingest", h: "Validate, enqueue, answer fast", b: "Devices batch their pings. The ingest API checks auth and shape, puts the batch on a stream and returns 202 straight away.", k: "Keep the ingest path thin.",
      f: "staff>ingest:req, ingest>q:req", a: "ingest q", v: "staff ingest q hist", m: { "Pings / s": "500", "Map latency": "—" },
      setup: [["device", "batch pings, send every 10–30 s"], ["ingest", "validate + enqueue, return 202", "hi"], ["volume", "5k staff × 0.1/s = 500 pings/s"]] },
    { t: "concept", s: "Hot & cold", h: "A hot path and a cold path", b: "One consumer keeps only the latest position per worker in Redis for the live map. Another bulk-inserts history into daily partitions for reports.", k: "Latest state in memory; history in bulk.",
      f: "q>redis:req, q>hist:sync, redis>sup:res", a: "redis hist", v: "staff ingest q redis hist sup", m: { "Pings / s": "500", "Map latency": "≈ 2 s" },
      code: `# hot path: latest position per worker, for the live map
r.geoadd(f"pos:company:{cid}", (lng, lat, f"worker:{wid}"))
r.hset(f"last:{wid}", mapping={"ts": ts, "lat": lat, "lng": lng})

# cold path: bulk-insert history every few seconds
Ping.objects.bulk_create(batch, batch_size=1000)`, note: "redis-py. Partition the history table by day so old days can be dropped in one statement." },
    { t: "recap", s: "Rules", h: "Rules and alerts in the stream", b: "A rules consumer checks geofences and shift times for each ping and pushes violations to the supervisor's map over WebSockets, once per breach.", k: "Alert on state changes, not on every ping.",
      f: "q>rules:req, rules>sup:fail", a: "rules sup", m: { "Pings / s": "500", "Map latency": "≈ 2 s" }, g: { sup: ["alert: left site during shift", "bad", "alert"] },
      setup: [["geofence", "point-in-polygon per site"], ["dedupe", "one alert per breach, not per ping", "hi"], ["push", "WebSockets (Django Channels)"]] },
  ],
});
