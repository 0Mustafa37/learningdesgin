L({
  id: "sql-vs-nosql",
  title: "SQL vs NoSQL",
  sub: "Pick a data model from your access patterns, not from hype.",
  level: "Intermediate", min: 8,
  learn: ["What relational databases are best at", "Document, key-value and wide-column models", "How to choose for a given workload"],
  deep: [
    "Relational databases give schemas, joins, constraints and multi-row ACID transactions, and PostgreSQL/MySQL scale much further than people assume with indexes, replicas and partitioning.",
    "Document stores (e.g. MongoDB) suit data read and written as one aggregate. Key-value and wide-column stores (e.g. DynamoDB, Cassandra) trade query flexibility for predictable performance at very large scale.",
    "In wide-column/key-value stores you design tables around the queries you'll run; ad-hoc queries become expensive.",
  ],
  iv: ["Default to a relational database unless a specific requirement pushes you elsewhere, and say which requirement.", "Avoid “NoSQL scales, SQL doesn't”. Talk about access patterns, consistency needs and operational maturity."],
  refs: [["PostgreSQL documentation", "https://www.postgresql.org/docs/current/"], ["Designing Data-Intensive Applications, ch. 2 (M. Kleppmann)", "https://dataintensive.net/"]],
  nodes: [N("app", "application", 120, 220), N("sql", "relational", 400, 80, "db"), N("doc", "document", 640, 170, "db"), N("kv", "key-value", 640, 330, "cache"), N("wide", "wide-column", 400, 370, "db")],
  steps: [
    { t: "concept", s: "Relational", h: "Relational: the safe default", b: "Tables, foreign keys, joins and transactions across many rows. Great when data is highly related and correctness matters (orders, payments, inventory).", k: "Strong consistency + flexible queries make SQL the default choice.", f: "app>sql:req, sql>app:res", a: "sql" },
    { t: "concept", s: "Document", h: "Document: aggregates as JSON", b: "A whole order with its line items is stored as one document. Reads of the aggregate are one lookup; cross-document joins and transactions are more limited.", k: "Fits when you mostly read and write whole aggregates.", f: "app>doc:req, doc>app:res", a: "doc" },
    { t: "concept", s: "KV / wide", h: "Key-value and wide-column", b: "Lookups by key (and range within a partition) at massive scale with predictable latency. You model tables per query. Ad-hoc filtering is costly or impossible.", k: "Design for known access patterns; get horizontal scale.", f: "app>kv:req, app>wide:req, kv>app:res", a: "kv wide" },
    { t: "recap", s: "Choose", h: "Choosing in practice", b: "Many systems use several: Postgres for core data, Redis for cache and counters, a wide-column store for huge event or time-series data, a search engine for text search.", k: "Polyglot persistence: right store per access pattern.", f: "app>sql:req, app>kv:req, app>wide:req", a: "sql kv wide" },
  ],
});

L({
  id: "indexes",
  title: "Indexes",
  sub: "Turn full table scans into a handful of page reads.",
  level: "Intermediate", min: 8,
  learn: ["How a B-tree index finds rows", "Composite index column order", "The write cost of indexes", "Verifying with EXPLAIN"],
  deep: [
    "A B-tree keeps keys sorted, so equality and range lookups take O(log n) page reads, typically 3–4 levels even for hundreds of millions of rows.",
    "Composite index (a, b) serves filters on a, or on a and b, and ordering by b within a. A filter on b alone usually can't use it efficiently.",
    "Every index must be updated on insert/update/delete and occupies memory. Remove unused ones.",
  ],
  iv: ["Tie each index to a query: “WHERE customer_id = ? ORDER BY created_at DESC → index (customer_id, created_at)”.", "Mention partial and covering indexes for hot queries."],
  refs: [["PostgreSQL: Indexes", "https://www.postgresql.org/docs/current/indexes.html"], ["Use The Index, Luke", "https://use-the-index-luke.com/"]],
  mk: ["Rows read", "Query time"],
  nodes: [N("app", "app", 120, 220), N("idx", "B-tree index", 400, 110, "cache"), N("db", "orders table (50M rows)", 620, 270, "db")],
  steps: [
    { t: "problem", s: "Full scan", h: "Every query reads the whole table", b: "<code>WHERE customer_id = 42</code> with no index makes the database read all 50M rows to find a few dozen.", k: "No index → cost grows with table size.", f: "app>db:fail", v: "app db", a: "db", m: { "Rows read": "50,000,000", "Query time": "~8 s" } },
    { t: "concept", s: "B-tree", h: "A sorted tree of keys", b: "The index stores customer_id values in sorted order with pointers to rows. The database walks a few tree levels, then reads just the matching rows.", k: "B-tree lookups are logarithmic: a few page reads.", f: "app>idx:req, idx>db:req, db>app:res", a: "idx", m: { "Rows read": "37", "Query time": "~1 ms" } },
    { t: "concept", s: "Composite", h: "Column order matters", b: "For <code>WHERE customer_id = ? ORDER BY created_at DESC LIMIT 20</code>, an index on (customer_id, created_at) finds the rows already sorted, with no extra sort step.", k: "Equality columns first, then range/sort columns.", f: "app>idx:req, idx>db:req, db>app:res", a: "idx db" },
    { t: "case", s: "Cost", h: "Indexes aren't free", b: "Each insert updates every index on the table. Ten indexes can make writes several times slower and use lots of RAM. Confirm usage with <code>EXPLAIN ANALYZE</code> and index statistics.", k: "Index for real queries; verify with EXPLAIN; drop unused.", f: "app>db:req, db>idx:sync", a: "db idx" },
  ],
});

L({
  id: "storage-engines",
  title: "Storage Engines",
  sub: "B-trees vs LSM-trees, and the write-ahead log beneath both.",
  level: "Advanced", min: 8,
  learn: ["Why databases write a log first", "How B-tree engines update data", "How LSM-tree engines absorb writes", "Which to choose for a workload"],
  deep: [
    "The write-ahead log (WAL) is appended sequentially before data pages change; after a crash it's replayed to restore committed transactions. It's also what replication streams.",
    "B-tree engines (PostgreSQL, MySQL InnoDB) update fixed-size pages in place: predictable reads, more random I/O on writes.",
    "LSM engines (RocksDB, Cassandra, ScyllaDB) buffer writes in memory, flush sorted immutable files and merge them by compaction. Writes are fast; reads may check several files, helped by Bloom filters.",
  ],
  iv: ["Connect engine choice to workload: heavy ingest/time series → LSM; mixed OLTP with complex queries → B-tree.", "Mention write and read amplification as the trade-off vocabulary."],
  refs: [["PostgreSQL: Write-Ahead Logging", "https://www.postgresql.org/docs/current/wal-intro.html"], ["RocksDB wiki", "https://github.com/facebook/rocksdb/wiki"]],
  nodes: [N("app", "writes", 110, 220), N("wal", "write-ahead log", 360, 220, "queue"), N("btree", "B-tree pages", 620, 100, "db"), N("lsm", "LSM: memtable → SSTables", 620, 340, "db")],
  steps: [
    { t: "concept", s: "WAL", h: "Log first, then data", b: "Every change is appended to the WAL and flushed before the commit is acknowledged. Appends are sequential, so they're fast, and they make the change durable.", k: "Durability comes from the log, not from the data files.", f: "app>wal:req", a: "wal" },
    { t: "concept", s: "B-tree", h: "B-tree engines update in place", b: "Pages in the tree are modified where they live; a page split happens when one fills up. Reads find data in one place.", k: "B-tree: read-optimised, in-place updates.", f: "wal>btree:sync", a: "btree" },
    { t: "concept", s: "LSM", h: "LSM engines append and compact", b: "Writes go to an in-memory memtable, then are flushed as sorted immutable SSTable files. Background compaction merges files and drops overwritten values.", k: "LSM: write-optimised, background compaction.", f: "wal>lsm:sync", a: "lsm" },
    { t: "recap", s: "Choose", h: "Picking an engine", b: "General OLTP with joins and secondary indexes: B-tree. Very high write rates, append-heavy or time-series data: LSM. Benchmark with your real access pattern.", k: "Engine choice is a read/write amplification trade-off.", f: "app>wal:req, wal>btree:sync, wal>lsm:sync", a: "btree lsm" },
  ],
});

L({
  id: "consistent-hashing",
  title: "Consistent Hashing",
  sub: "Add or remove nodes while moving only a small slice of keys.",
  level: "Advanced", min: 8,
  learn: ["Why hash(key) % N reshuffles almost everything", "How the hash ring assigns keys", "Virtual nodes for balance"],
  deep: [
    "Going from 3 to 4 nodes with modulo hashing keeps only ~25% of keys in place; ~75% move, which floods caches and databases.",
    "On a ring, a key belongs to the first node clockwise from its hash. Adding a node only takes keys from its neighbour: about 1/N of all keys.",
    "Each physical server is placed at many points (virtual nodes) so load spreads evenly and bigger servers can take more points.",
  ],
  iv: ["Use it when partitioning caches or data across a changing set of nodes.", "Mention virtual nodes and replication to the next N nodes on the ring."],
  refs: [["Karger et al. 1997, Consistent Hashing and Random Trees", "https://dl.acm.org/doi/10.1145/258533.258660"], ["Amazon Dynamo paper (2007)", "https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf"]],
  mk: ["Nodes", "Keys moved"],
  nodes: [N("router", "hash ring", 380, 220, "lb"), N("n1", "node A", 160, 90, "db"), N("n2", "node B", 640, 90, "db"), N("n3", "node C", 640, 350, "db"), N("n4", "node D (new)", 160, 350, "db")],
  steps: [
    { t: "problem", s: "Modulo", h: "hash(key) % N breaks on resize", b: "With 3 nodes, key → node = hash % 3. Add a 4th and the formula becomes hash % 4: about 75% of keys now map to a different node.", k: "Modulo placement remaps almost everything when N changes.", f: "router>n1:fail, router>n2:fail, router>n3:fail", v: "router n1 n2 n3", a: "router", m: { Nodes: "3 → 4", "Keys moved": "≈75%" } },
    { t: "concept", s: "Ring", h: "Place nodes and keys on a ring", b: "Hash both nodes and keys onto the same circular space. Each key is owned by the next node clockwise.", k: "Ownership = next node clockwise.", f: "router>n1:req, router>n2:req, router>n3:req", v: "router n1 n2 n3", a: "n1 n2 n3" },
    { t: "concept", s: "Add node", h: "Adding a node moves ~1/N keys", b: "Node D lands on the ring and takes over only the keys between it and its predecessor. Everything else stays put.", k: "Resizing touches a small, bounded slice of data.", f: "n1>n4:sync, router>n4:req", a: "n4", m: { Nodes: "4", "Keys moved": "≈25%" } },
    { t: "recap", s: "Vnodes", h: "Virtual nodes even out load", b: "With one point per server, arcs are uneven. Giving each server 100+ virtual points smooths the distribution and lets you weight bigger machines.", k: "Many points per server → balanced load.", f: "router>n1:req, router>n2:req, router>n3:req, router>n4:req", a: "n1 n2 n3 n4" },
  ],
});

L({
  id: "unique-ids",
  title: "Unique IDs at Scale",
  sub: "Generate IDs without a single bottleneck, and keep them sortable.",
  level: "Intermediate", min: 7,
  learn: ["Limits of auto-increment IDs", "UUIDv4 vs time-ordered IDs", "Snowflake-style bit layouts"],
  deep: [
    "Auto-increment needs one authority; across shards, sequences collide unless partitioned, and sequential IDs leak business volume.",
    "UUIDv4 is 122 random bits and needs no coordination, but random keys spread inserts across a B-tree index and hurt locality.",
    "Snowflake-style IDs pack 41 bits of millisecond timestamp, 10 bits of machine ID and a 12-bit sequence into 64 bits: roughly time-sortable, up to 4,096 IDs/ms per machine. UUIDv7 (RFC 9562) is a standard time-ordered 128-bit alternative.",
  ],
  iv: ["Ask whether IDs must be sortable, guessable, and how many bits fit the storage.", "Mention clock skew: generators must handle a clock moving backwards."],
  refs: [["RFC 9562: UUIDs (incl. UUIDv7)", "https://www.rfc-editor.org/rfc/rfc9562"], ["Twitter Snowflake announcement (2010)", "https://blog.x.com/engineering/en_us/a/2010/announcing-snowflake"]],
  nodes: [N("a1", "app 1", 130, 110), N("a2", "app 2", 130, 330), N("seq", "single DB sequence", 420, 220, "db"), N("gen", "ID generator (per node)", 660, 220, "worker")],
  steps: [
    { t: "problem", s: "Sequence", h: "One counter for everyone", b: "Every insert asks one database for the next number. That database becomes a bottleneck and a single point of failure, and shards can't share it.", k: "Central counters don't scale out.", f: "a1>seq:req, a2>seq:req, seq>a1:res", v: "a1 a2 seq", a: "seq" },
    { t: "concept", s: "UUIDv4", h: "Random UUIDs", b: "Each server generates 122 random bits; collisions are practically impossible. The downside is that random keys aren't sortable and scatter writes across the index.", k: "No coordination, but poor index locality.", f: "a1>a1:sync", v: "a1 a2 seq", a: "a1 a2" },
    { t: "concept", s: "Snowflake", h: "Time + machine + sequence", b: "64-bit ID = timestamp (ms) | machine ID | per-ms counter. IDs from one machine increase over time and are roughly sorted globally.", k: "Time-ordered IDs keep index inserts at the end.", f: "a1>gen:req, a2>gen:req, gen>a1:res, gen>a2:res", a: "gen" },
    { t: "case", s: "Clock", h: "When the clock goes backwards", b: "If NTP moves the clock back, a generator could repeat IDs. It must wait until time passes the last timestamp, or refuse. Machine IDs must also be assigned uniquely.", k: "Time-based IDs depend on sane clocks and unique machine IDs.", f: "gen>gen:fail", a: "gen" },
  ],
});

L({
  id: "cap-consistency",
  title: "CAP & Consistency",
  sub: "When the network splits, choose between answering and being correct.",
  level: "Advanced", min: 8,
  learn: ["What CAP actually says", "CP vs AP behaviour during a partition", "Consistency models from strong to eventual"],
  deep: [
    "CAP: during a network partition, a replicated system must choose between consistency (every read sees the latest write) and availability (every request gets a non-error response).",
    "PACELC adds: Else, when there's no partition, the trade-off is latency vs consistency.",
    "Useful models in between: read-your-writes, monotonic reads, causal consistency, eventual consistency.",
  ],
  iv: ["Don't say “pick 2 of 3”. Partitions aren't optional; the choice is what happens during one.", "Choose per feature: account balance → strong; like counts → eventual."],
  refs: [["Brewer, CAP Twelve Years Later (2012)", "https://www.infoq.com/articles/cap-twelve-years-later-how-the-rules-have-changed/"], ["Jepsen: consistency models", "https://jepsen.io/consistency"]],
  nodes: [N("c1", "client 1", 110, 120, "client"), N("n1", "replica A", 330, 220, "db"), N("n2", "replica B", 560, 220, "db"), N("c2", "client 2", 720, 340, "client")],
  steps: [
    { t: "concept", s: "Replicate", h: "Normal operation", b: "A write to replica A is copied to replica B. Both clients see the same data.", k: "Replication gives availability and read scale.", f: "c1>n1:req, n1>n2:sync, n2>c2:res", a: "n1 n2" },
    { t: "problem", s: "Partition", h: "The link between replicas fails", b: "A and B can't talk. Client 1 writes to A; client 2 reads from B. B doesn't know about the write.", k: "Partitions happen; design for them.", f: "c1>n1:req, n1>n2:fail, c2>n2:req", a: "n1 n2" },
    { t: "concept", s: "CP vs AP", h: "Choose: refuse or answer stale", b: "<b>CP</b>: B refuses reads (or the minority side stops accepting writes) until it can confirm the latest value.\n\n<b>AP</b>: B answers with possibly stale data and reconciles later.", k: "During a partition: consistency or availability.", f: "c2>n2:req, n2>c2:fail", a: "n2" },
    { t: "recap", s: "Models", h: "A spectrum, chosen per feature", b: "Linearizable for money and uniqueness. Read-your-writes for profile edits. Eventual for counters, feeds and analytics.", k: "Use the weakest model the feature can tolerate.", f: "c1>n1:req, n1>n2:sync, n2>c2:res", a: "n1 n2" },
  ],
});

L({
  id: "consensus-leaders",
  title: "Consensus & Leaders",
  sub: "How a cluster agrees on one leader and one log, even when nodes fail.",
  level: "Advanced", min: 9,
  learn: ["Leader-based replication of a log", "Majority quorums and fault tolerance", "Leader election with terms", "Where consensus is used in practice"],
  deep: [
    "Raft and Multi-Paxos replicate an ordered log. An entry is committed once a majority of nodes have stored it.",
    "With 2f+1 nodes the cluster tolerates f failures: 3 nodes survive 1 failure, 5 survive 2.",
    "In Raft, followers that stop hearing heartbeats start an election in a new term; a candidate needs a majority of votes, and messages from older terms are rejected.",
  ],
  iv: ["Use an existing consensus system (etcd, ZooKeeper, Consul) for leader election, locks and config. Don't implement Raft in an interview design.", "Consensus is for small, critical metadata, not bulk data throughput."],
  refs: [["The Raft paper and visualisation", "https://raft.github.io/"], ["etcd documentation", "https://etcd.io/docs/"]],
  mk: ["Nodes", "Quorum", "Tolerates"],
  nodes: [N("client", "client", 90, 220, "client"), N("l", "leader", 330, 220, "db"), N("f1", "follower 1", 560, 70, "db"), N("f2", "follower 2", 710, 175, "db"), N("f3", "follower 3", 710, 305, "db"), N("f4", "follower 4", 560, 395, "db")],
  steps: [
    { t: "concept", s: "Leader", h: "One leader orders all writes", b: "Clients send writes to the leader, which appends them to its log and replicates entries to followers.", k: "A single leader gives one agreed order.", f: "client>l:req, l>f1:sync, l>f2:sync, l>f3:sync, l>f4:sync", a: "l", m: { Nodes: "5", Quorum: "3 of 5" } },
    { t: "concept", s: "Quorum", h: "Commit on a majority", b: "Once a majority (here 3 of 5, counting the leader) has the entry, it's committed and the client gets a success. Followers 3 and 4 are slow, but a slow or dead minority doesn't block progress.", k: "2f+1 nodes tolerate f failures.", f: "f1>l:res, f2>l:res, l>client:res", a: "l f1 f2", m: { Nodes: "5", Quorum: "3 of 5", Tolerates: "2 failures" } },
    { t: "case", s: "Election", h: "The leader crashes", b: "Followers stop receiving heartbeats, time out, and one becomes a candidate for a new term. With a majority of votes it becomes leader; the old leader is ignored if it returns with an old term.", k: "Terms + majority votes prevent two valid leaders.", f: "f2>f1:sync, f2>f3:sync, f2>f4:sync, f1>f2:res, f3>f2:res", a: "f2", v: "client f1 f2 f3 f4", m: { Nodes: "4 of 5 up", Quorum: "3 of 5", Tolerates: "1 more failure" } },
    { t: "recap", s: "In practice", h: "Use, don't build", b: "etcd (Kubernetes), ZooKeeper (Kafka historically), Consul and many databases embed consensus. Use them for leader election, locks with fencing tokens, and configuration.", k: "Consensus systems are coordination tools for small, critical data.", f: "client>f2:req, f2>f1:sync, f2>f3:sync, f2>f4:sync", a: "f2", v: "client f1 f2 f3 f4" },
  ],
});

L({
  id: "transactions-isolation",
  title: "Transactions & Isolation",
  sub: "What concurrent transactions can see, and the anomalies each level allows.",
  level: "Advanced", min: 9,
  learn: ["ACID in one sentence each", "Common anomalies: dirty read, lost update, write skew", "Isolation levels in PostgreSQL", "Handling serialization failures"],
  deep: [
    "PostgreSQL's default is Read Committed: each statement sees data committed before it began. Repeatable Read uses one snapshot for the whole transaction. Serializable (SSI) also prevents write skew and may abort a transaction with a serialization failure, which the app should retry.",
    "In PostgreSQL, Read Uncommitted behaves like Read Committed, and Repeatable Read also prevents phantom reads. MySQL InnoDB defaults to Repeatable Read.",
    "Write skew: two transactions read the same condition, then write different rows, together breaking an invariant (e.g. both on-call doctors go off call).",
  ],
  iv: ["Name the anomaly first, then the cheapest fix: atomic UPDATE, row lock (SELECT … FOR UPDATE), unique constraint, or Serializable with retries.", "Say Serializable requires retry logic."],
  refs: [["PostgreSQL: Transaction Isolation", "https://www.postgresql.org/docs/current/transaction-iso.html"], ["PostgreSQL: Explicit Locking", "https://www.postgresql.org/docs/current/explicit-locking.html"]],
  nodes: [N("t1", "transaction A", 140, 110), N("db", "PostgreSQL", 420, 220, "db"), N("t2", "transaction B", 140, 340), N("rule", "invariant: ≥1 doctor on call", 660, 220, "ext")],
  steps: [
    { t: "concept", s: "ACID", h: "What a transaction promises", b: "<b>Atomic</b>: all or nothing. <b>Consistent</b>: constraints hold. <b>Isolated</b>: concurrent transactions don't see each other's partial work (to a chosen degree). <b>Durable</b>: committed means persisted.", k: "Isolation is the one with dials.", f: "t1>db:req, db>t1:res", v: "t1 db t2", a: "db" },
    { t: "problem", s: "Anomalies", h: "What goes wrong concurrently", b: "Dirty read (seeing uncommitted data), non-repeatable read, phantom rows, lost update (two read-modify-writes) and write skew (two transactions jointly violate a rule).", k: "Each isolation level forbids a different set of anomalies.", f: "t1>db:req, t2>db:req", v: "t1 db t2", a: "t1 t2" },
    { t: "case", s: "Write skew", h: "Both doctors go off call", b: "A and B each check “2 doctors on call”, see it's fine, and each removes themselves. Different rows were updated, so row locks never conflicted. Under Read Committed or Repeatable Read both commit, breaking the rule.", k: "Write skew slips past snapshot isolation.", f: "t1>db:req, t2>db:req, db>rule:fail", a: "rule" },
    { t: "recap", s: "Fixes", h: "Choosing a fix", b: "Lock the rows you read with <code>SELECT … FOR UPDATE</code>, materialise the conflict in a row you can lock, add a constraint, or run Serializable and retry on serialization failures.", k: "Pick the narrowest tool that enforces the invariant.", f: "t1>db:req, db>t1:res, t2>db:fail", a: "db" },
  ],
});

L({
  id: "files-media",
  title: "Files & Media",
  sub: "Keep large uploads off your app servers.",
  level: "Intermediate", min: 7,
  learn: ["Direct-to-storage uploads with presigned URLs", "Async processing of media", "Serving files through a CDN securely"],
  deep: [
    "A presigned URL is a short-lived URL signed with your credentials that lets the client PUT or GET one object directly against S3-compatible storage.",
    "Store only metadata (owner, key, size, checksum, status) in the database; keep bytes in object storage.",
    "Large files use multipart uploads (resumable parts). Private files are served via short-lived signed URLs or signed CDN cookies.",
  ],
  iv: ["Say “presigned upload → storage event → queue → workers → CDN” early in any media design.", "Mention virus scanning, size and type limits, and lifecycle rules to archive old files."],
  refs: [["Amazon S3: presigned URLs", "https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html"], ["Amazon S3: multipart upload", "https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html"]],
  nodes: [N("client", "client", 100, 220, "client"), N("app", "app", 300, 90), N("store", "object storage", 420, 300, "db"), N("queue", "events queue", 610, 110, "queue"), N("worker", "thumbnail worker", 690, 300, "worker"), N("cdn", "CDN", 230, 380, "edge")],
  steps: [
    { t: "problem", s: "Through app", h: "Uploads tie up app servers", b: "A 2 GB video streamed through the app server occupies a worker for minutes and needs lots of memory and bandwidth.", k: "App servers should handle requests, not bulk bytes.", f: "client>app:fail", v: "client app store", a: "app" },
    { t: "concept", s: "Presign", h: "Upload directly to storage", b: "The app authorises the upload and returns a presigned URL. The client sends bytes straight to object storage, then tells the app it's done.", k: "Presigned URLs move bytes around your servers, not through them.", f: "client>app:req, app>client:res, client>store:req", v: "client app store", a: "store" },
    { t: "concept", s: "Process", h: "Process asynchronously", b: "Storage emits an event to a queue; workers create thumbnails or transcode, then mark the record ready.", k: "Heavy media work belongs in background workers.", f: "store>queue:sync, queue>worker:req, worker>store:req", a: "queue worker" },
    { t: "recap", s: "Serve", h: "Deliver via CDN", b: "Public media is served from the CDN. Private files use short-lived signed URLs so links can't be shared forever.", k: "Store in object storage, process in workers, serve from the edge.", f: "client>cdn:req, cdn>store:req, cdn>client:res", a: "cdn" },
  ],
});
