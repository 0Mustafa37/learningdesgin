/* Course structure. Lesson bodies live in the other data files. The Django track is built from data/django.js. */
(window.MODULES || []).forEach((m) => m.lessons.forEach((l) => window.L(l)));

window.TRACKS = [
  {
    id: "sd",
    title: "System Design",
    modules: [
      { id: "foundations", title: "Foundations", color: "#e0a050", lessons: ["anatomy-of-a-request", "latency-and-throughput", "napkin-math"] },
      { id: "scaling", title: "Scaling", color: "#6aa84f", lessons: ["vertical-vs-horizontal", "load-balancing", "stateless-services", "caching", "content-delivery"] },
      { id: "data", title: "Data & Storage", color: "#8e7cc3", lessons: ["sql-vs-nosql", "indexes", "storage-engines", "read-replicas", "sharding", "consistent-hashing", "unique-ids", "cap-consistency", "consensus-leaders", "transactions-isolation", "files-media"] },
      { id: "communication", title: "Communication", color: "#e07b53", lessons: ["rest-rpc-graphql", "message-queues", "pub-sub", "real-time"] },
      { id: "reliability", title: "Reliability", color: "#3d85c6", lessons: ["redundancy-failover", "rate-limiting", "timeouts-retries", "observability"] },
      { id: "architecture", title: "Architecture", color: "#45818e", lessons: ["monolith-microservices", "service-discovery", "sagas", "batch-stream"] },
      { id: "security", title: "Security", color: "#c27ba0", lessons: ["authentication", "authorization", "encryption-secrets"] },
      { id: "shipping", title: "Shipping", color: "#93a33b", lessons: ["testing", "ci-cd"] },
      { id: "whole-systems", title: "Whole Systems", color: "#5b6d8a", lessons: ["hld-lld", "url-shortener", "news-feed", "chat-system"] },
    ],
  },
  {
    id: "ip",
    title: "Interview Problems",
    modules: [
      { id: "consistency-problems", title: "Duplicates & Consistency", color: "#d06050", lessons: ["dual-write", "duplicate-requests", "lost-update", "exactly-once", "distributed-locks", "stale-reads", "ordering-clocks", "split-brain"] },
      { id: "load-problems", title: "Load & Failure", color: "#e69138", lessons: ["thundering-herd", "hot-partition", "retry-storms", "poison-messages", "backpressure", "pagination-at-scale"] },
      { id: "senior-production", title: "Senior: Production Problems", color: "#3d85c6", lessons: ["zero-downtime-migrations", "rollback-safety", "noisy-neighbour", "tail-latency"] },
      { id: "lead-delivery", title: "Team Lead: Delivery & Incidents", color: "#8e7cc3", lessons: ["incident-response", "progressive-delivery", "error-budgets", "strangler-migration"] },
      { id: "cto-strategy", title: "CTO: Architecture & Strategy", color: "#c27ba0", lessons: ["build-vs-buy", "disaster-recovery", "cell-architecture", "conways-law", "cloud-costs"] },
    ],
  },
];
