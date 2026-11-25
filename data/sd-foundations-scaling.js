L({
  id: "napkin-math",
  title: "Napkin Math",
  sub: "Back-of-the-envelope numbers that tell you which design is even plausible.",
  level: "Beginner", min: 7,
  learn: ["Latency numbers worth memorising", "Turning daily users into requests per second", "Estimating storage growth", "Using estimates to rule designs in or out"],
  deep: [
    "A day has 86,400 seconds; rounding to 10<sup>5</sup> makes mental maths easy. 1M requests/day ≈ 12 requests/s on average.",
    "Peak traffic is usually 2–10× the daily average depending on the product (lunch spikes, sales, time zones).",
    "Remember to multiply storage by the replication factor (often 3) and add room for indexes and backups.",
  ],
  iv: ["State your assumptions out loud, round aggressively, and keep units in every line.", "Use the result to justify a decision (e.g. “7k peak rps fits a handful of app servers; the database is the bottleneck”)."],
  refs: [["Latency numbers every programmer should know (J. Dean / P. Norvig)", "https://gist.github.com/jboner/2841832"]],
  mk: ["Avg rps", "Peak rps", "Storage / yr"],
  nodes: [N("users", "10M users", 110, 220, "user"), N("app", "app tier", 380, 220), N("db", "database", 640, 120), N("blob", "object store", 640, 330, "db")],
  steps: [
    { t: "concept", s: "Latency scale", h: "Know the orders of magnitude",
      b: "Main-memory reference: ~100 ns. SSD random read: ~100 µs. Round trip inside a datacenter: ~0.5 ms. Round trip across a continent or ocean: ~100–150 ms.\n\nEach step is roughly 1,000× slower than the one before, which is why network hops and disk reads dominate designs.",
      k: "Memory ≪ SSD ≪ network in the same DC ≪ network across regions.", f: "app>db:req, db>app:res", a: "app db" },
    { t: "concept", s: "Requests/s", h: "From users to requests per second",
      b: "10M daily active users × 20 requests each = 200M requests/day.\n\n200M ÷ 86,400 s ≈ 2,300 requests/s on average. Assume a 3× peak: ~7,000 requests/s.",
      k: "requests/day ÷ 10⁵ ≈ average rps. Then multiply for peak.", f: "users>app:req, app>users:res", a: "users app", m: { "Avg rps": "≈2,300", "Peak rps": "≈7,000" } },
    { t: "concept", s: "Storage", h: "How much data per year?",
      b: "Each user writes 2 items/day at ~1 KB: 10M × 2 × 1 KB = 20 GB/day ≈ 7.3 TB/year.\n\nWith 3× replication that's ~22 TB/year before indexes. Media files go to object storage and are usually far larger.",
      k: "Daily writes × size × 365 × replication factor.", f: "app>db:req, app>blob:req", a: "db blob", m: { "Avg rps": "≈2,300", "Peak rps": "≈7,000", "Storage / yr": "≈7.3 TB (×3)" } },
    { t: "recap", s: "Decide", h: "Use the numbers to choose",
      b: "7k peak rps is easy for a few stateless app servers behind a load balancer. Tens of TB per year means planning for partitioning or archiving within a couple of years.\n\nThe estimate doesn't have to be exact. It has to be the right order of magnitude.",
      k: "Estimates exist to rule designs in or out, not to be precise.", a: "app db" },
  ],
});

L({
  id: "vertical-vs-horizontal",
  title: "Vertical vs Horizontal",
  sub: "Scale up a bigger box, or scale out with more boxes.",
  level: "Beginner", min: 6,
  learn: ["What vertical scaling buys and where it stops", "What horizontal scaling requires", "Why the data tier is the hard part"],
  deep: [
    "Vertical scaling needs no code changes, but price grows faster than capacity at the top end, and there's still one machine to fail.",
    "Horizontal scaling needs stateless app servers, a load balancer, and a plan for shared state (sessions, files, caches).",
    "Databases are usually scaled vertically first, then with read replicas, and only then by partitioning.",
  ],
  iv: ["Say you'd scale the stateless tier horizontally first, because it's cheap and safe.", "Point out that a single big database is fine for a long time; name the signals that would make you shard."],
  refs: [["The Twelve-Factor App: processes", "https://12factor.net/processes"]],
  mk: ["Servers", "CPU", "SPOF"],
  nodes: [N("users", "users", 100, 220, "user"), N("lb", "load balancer", 320, 220), N("a1", "app 1", 580, 90), N("a2", "app 2", 580, 220), N("a3", "app 3", 580, 350)],
  steps: [
    { t: "problem", s: "One box", h: "One server at 90% CPU", b: "Traffic keeps growing and the only app server is running hot. Latency climbs as it saturates.", k: "A saturated server makes everything slower, not just some requests.", f: "users>a2:fail", v: "users a2", a: "a2", m: { Servers: "1", CPU: "90%", SPOF: "yes" } },
    { t: "concept", s: "Scale up", h: "Vertical: buy a bigger machine", b: "More CPU and RAM on the same box. No code changes, so it's often the right first move.\n\nLimits: there's a biggest machine, the cost per unit rises sharply near the top, and a reboot is still an outage.", k: "Scale up is simple but capped, and it keeps the single point of failure.", f: "users>a2:req, a2>users:res", v: "users a2", a: "a2", m: { Servers: "1 (bigger)", CPU: "45%", SPOF: "yes" } },
    { t: "concept", s: "Scale out", h: "Horizontal: add more machines", b: "Put identical servers behind a load balancer. Capacity grows by adding boxes, and losing one only reduces capacity.\n\nThis requires the app to be stateless, so any server can handle any request.", k: "Scale out adds capacity and redundancy at the same time.", f: "users>lb:req, lb>a1:req, lb>a2:req, lb>a3:req", a: "lb a1 a2 a3", m: { Servers: "3", CPU: "30%", SPOF: "no (app tier)" } },
    { t: "recap", s: "Data tier", h: "The database is the hard part", b: "Stateless servers scale out easily; databases don't, because data must stay consistent. Typical path: bigger DB box → read replicas → caching → partitioning.", k: "Scale stateless tiers out; scale stateful tiers carefully.", a: "a1 a2 a3" },
  ],
});

L({
  id: "stateless-services",
  title: "Stateless Services",
  sub: "Move state out of app servers so any instance can serve any user.",
  level: "Intermediate", min: 6,
  learn: ["Why in-memory sessions break load balancing", "The trade-offs of sticky sessions", "Where state should live instead"],
  deep: [
    "State includes sessions, uploaded files on local disk, in-process caches that must be consistent, and scheduled jobs that should run once.",
    "Store sessions in Redis/DB or signed cookies, files in object storage, and run schedulers as a single dedicated process or with a lock.",
    "Stateless instances can be replaced at any time, which enables autoscaling, rolling deploys and spot instances.",
  ],
  iv: ["When you add a load balancer, immediately say where sessions and files live.", "Mention that sticky sessions are a workaround, not a design."],
  refs: [["The Twelve-Factor App: processes", "https://12factor.net/processes"]],
  nodes: [N("users", "user", 100, 220, "user"), N("lb", "load balancer", 310, 220), N("a1", "app 1", 540, 110), N("a2", "app 2", 540, 330), N("redis", "session store", 730, 220, "cache")],
  steps: [
    { t: "problem", s: "Logged out", h: "Sessions live in server memory", b: "The user logs in on app 1. The next request lands on app 2, which has never heard of them, so they're logged out.", k: "State held in one instance breaks as soon as traffic is balanced.", f: "users>lb:req, lb>a1:req, lb>a2:fail", v: "users lb a1 a2", a: "a2" },
    { t: "concept", s: "Sticky", h: "Sticky sessions: a workaround", b: "The load balancer pins each user to one server with a cookie. It works, but load gets uneven, and when that server dies or is redeployed its users lose their sessions.", k: "Stickiness hides the problem; it doesn't remove it.", f: "users>lb:req, lb>a1:req, a1>users:res", v: "users lb a1 a2", a: "a1" },
    { t: "concept", s: "Externalise", h: "Move state to shared stores", b: "Sessions go to Redis or the database (or a signed cookie). Files go to object storage. Now every instance sees the same state.", k: "App servers hold no state that matters after the request ends.", f: "lb>a1:req, lb>a2:req, a1>redis:sync, a2>redis:sync", a: "redis a1 a2" },
    { t: "recap", s: "Payoff", h: "Instances become disposable", b: "Any server can serve any request, so you can autoscale, do rolling deploys and replace unhealthy instances without users noticing.", k: "Stateless = replaceable = scalable.", f: "users>lb:req, lb>a1:req, lb>a2:req, a1>users:res", a: "a1 a2" },
  ],
});

L({
  id: "content-delivery",
  title: "Content Delivery",
  sub: "Serve bytes from a location close to the user.",
  level: "Intermediate", min: 6,
  learn: ["How a CDN cache hit and miss work", "Cache-Control and fingerprinted assets", "Purging and what not to cache"],
  deep: [
    "CDNs cache at points of presence (PoPs) near users, so a request crosses a short network path instead of reaching your origin.",
    "Use content-hashed filenames (app.3f9a1c.js) with <code>Cache-Control: public, max-age=31536000, immutable</code>; the HTML that references them gets a short TTL.",
    "Never cache responses containing per-user data under a shared cache key. Use <code>Cache-Control: private</code> or <code>no-store</code> for those.",
  ],
  iv: ["Put static assets and media on a CDN in almost every design.", "Explain how you'd invalidate: new filenames for assets, purge or short TTLs for HTML."],
  refs: [["MDN: HTTP caching", "https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching"], ["RFC 9111: HTTP Caching", "https://www.rfc-editor.org/rfc/rfc9111"]],
  mk: ["Round trip", "Origin load"],
  nodes: [N("user", "user (Sydney)", 110, 230, "client"), N("edge", "CDN edge (Sydney)", 350, 120, "edge"), N("origin", "origin (Frankfurt)", 620, 230), N("store", "object storage", 620, 380, "db")],
  steps: [
    { t: "problem", s: "Far away", h: "Every file crosses the planet", b: "The origin is in Frankfurt; the user is in Sydney. Each round trip takes hundreds of milliseconds, and a page needs dozens of files.", k: "Distance is latency you can't optimise away in code.", f: "user>origin:req, origin>user:res", v: "user origin store", a: "origin", m: { "Round trip": "~280 ms", "Origin load": "100%" } },
    { t: "concept", s: "Miss", h: "First request: cache miss", b: "The edge doesn't have the file yet. It fetches it from the origin, stores it according to Cache-Control, and returns it.", k: "A miss costs one trip to the origin; the next users benefit.", f: "user>edge:req, edge>origin:fail, edge>origin:req, origin>edge:res", a: "edge origin" },
    { t: "concept", s: "Hit", h: "Next requests: served locally", b: "Other users in the region get the file straight from the edge in a few milliseconds. The origin never sees those requests.", k: "High hit ratio = low latency + low origin load.", f: "user>edge:req, edge>user:res", a: "edge", m: { "Round trip": "~10 ms", "Origin load": "5%" } },
    { t: "case", s: "Invalidate", h: "Deploying a new version", b: "Fingerprinted asset names change on every build, so new files are fetched automatically and old ones expire. HTML gets a short TTL or an explicit purge.", k: "Immutable, content-hashed assets + short-lived HTML.", f: "origin>edge:sync, edge>user:res", a: "edge origin" },
  ],
});
