L({
  id: "monolith-microservices",
  title: "Monolith vs Microservices",
  sub: "Split systems along team and domain boundaries, and only when it pays.",
  level: "Intermediate", min: 8,
  learn: ["Strengths of a (modular) monolith", "What microservices actually buy", "The hidden costs of distribution"],
  deep: [
    "A modular monolith keeps one deployable but enforces module boundaries (separate packages, explicit interfaces, no cross-module table access).",
    "Microservices give independent deploys, scaling and ownership. Each service owns its data, so cross-service consistency needs events or sagas.",
    "Costs: network failures, latency, distributed tracing, versioned APIs, platform tooling, and much harder local development.",
  ],
  iv: ["Start with a modular monolith; extract a service when a clear driver exists (team autonomy, very different scaling, isolation).", "Never share a database between microservices."],
  refs: [["Martin Fowler: MonolithFirst", "https://martinfowler.com/bliki/MonolithFirst.html"], ["Martin Fowler: Microservices", "https://martinfowler.com/articles/microservices.html"]],
  nodes: [N("client", "client", 100, 220, "client"), N("mono", "modular monolith", 340, 220), N("db", "one database", 340, 390, "db"), N("s1", "catalog svc", 600, 80), N("s2", "orders svc", 650, 220), N("s3", "payments svc", 600, 360)],
  steps: [
    { t: "concept", s: "Monolith", h: "One deployable, clear modules", b: "Function calls instead of network calls, one transaction across modules, one thing to deploy and debug. For most teams this is the fastest way to ship.", k: "A well-structured monolith is a great default.", f: "client>mono:req, mono>db:req, mono>client:res", v: "client mono db", a: "mono" },
    { t: "concept", s: "Services", h: "Microservices: independent units", b: "Each service is deployed, scaled and owned separately, with its own datastore. Teams can move without coordinating releases.", k: "Microservices optimise for team autonomy.", f: "client>s2:req, s2>s1:sync, s2>s3:sync", v: "client s1 s2 s3", a: "s1 s2 s3" },
    { t: "problem", s: "Costs", h: "Distribution has a price", b: "A request now crosses the network several times. Any call can fail or be slow, data is eventually consistent, and debugging needs tracing.", k: "You trade in-process simplicity for network complexity.", f: "client>s2:req, s2>s3:fail", v: "client s1 s2 s3", a: "s3" },
    { t: "recap", s: "Choose", h: "Extract when there's a driver", b: "Split out a service when a boundary is stable and something concrete demands it: a team bottleneck, a component with very different scaling, or an isolation requirement.", k: "Architecture follows team structure and real pressure.", f: "client>mono:req, mono>s3:sync", v: "client mono db s3", a: "mono s3" },
  ],
});

L({
  id: "service-discovery",
  title: "Service Discovery",
  sub: "Find healthy instances whose addresses keep changing.",
  level: "Intermediate", min: 6,
  learn: ["Why static addresses don't work", "Registry, health checks and lookup", "Client-side vs server-side discovery", "How Kubernetes does it"],
  deep: [
    "Instances come and go with autoscaling and deploys, so IPs change constantly.",
    "Client-side discovery: the caller queries a registry and load-balances itself. Server-side: the caller hits a stable address (load balancer or proxy) that knows the instances.",
    "In Kubernetes, a Service gets a stable DNS name and virtual IP; endpoints are updated from Pod readiness probes. Service meshes add mTLS, retries and telemetry in sidecars or node proxies.",
  ],
  iv: ["In a Kubernetes-based design, just say “Services + DNS, readiness probes for health”.", "Mention that health checks must reflect real readiness (DB reachable), not just “process alive”."],
  refs: [["Kubernetes: Service", "https://kubernetes.io/docs/concepts/services-networking/service/"]],
  nodes: [N("caller", "checkout", 110, 220), N("reg", "registry / DNS", 370, 220, "lb"), N("i1", "payments #1", 640, 90), N("i2", "payments #2", 640, 220), N("i3", "payments #3", 640, 350)],
  steps: [
    { t: "problem", s: "Moving IPs", h: "Addresses change constantly", b: "Autoscaling and deploys create and destroy instances every few minutes. Hard-coded IPs break immediately.", k: "Dynamic infrastructure needs dynamic lookup.", f: "caller>i1:fail", v: "caller i1 i2 i3", a: "caller" },
    { t: "concept", s: "Register", h: "Instances register and report health", b: "Each instance registers itself (or the platform does it) and passes health checks. Unhealthy ones are removed.", k: "The registry is the source of truth for live instances.", f: "i1>reg:sync, i2>reg:sync, i3>reg:sync", a: "reg" },
    { t: "concept", s: "Lookup", h: "Callers resolve a name", b: "Checkout asks for “payments” and gets healthy instances, then picks one (client-side), or simply calls a stable virtual IP (server-side).", k: "Call services by name, not by address.", f: "caller>reg:req, reg>caller:res, caller>i2:req", a: "reg i2" },
    { t: "case", s: "Unhealthy", h: "An instance fails its probe", b: "#3's readiness probe fails because it lost its DB connection. It's removed from rotation until it recovers.", k: "Readiness, not liveness, decides who gets traffic.", f: "i3>reg:fail, caller>i1:req, caller>i2:req", a: "i3" },
  ],
});

L({
  id: "sagas",
  title: "Sagas & Distributed Transactions",
  sub: "Keep data consistent across services without a global lock.",
  level: "Advanced", min: 9,
  learn: ["Why 2PC is rarely used across services", "Sagas as local transactions + compensations", "Orchestration vs choreography"],
  deep: [
    "Two-phase commit needs all participants to support it, holds locks while waiting, and blocks if the coordinator fails, so it's rare between microservices.",
    "A saga is a sequence of local transactions; if a step fails, compensating transactions undo earlier steps semantically (refund, release stock).",
    "Steps and compensations must be idempotent and retryable. Intermediate states (PENDING) are visible, so design the UX for them.",
  ],
  iv: ["Draw the happy path, then the failure at step N and its compensations.", "Combine with the outbox pattern so each step reliably emits its event."],
  refs: [["microservices.io: Saga pattern", "https://microservices.io/patterns/data/saga.html"]],
  nodes: [N("orch", "order saga", 140, 220, "worker"), N("pay", "payments", 420, 80), N("inv", "inventory", 520, 220), N("ship", "shipping", 420, 360)],
  steps: [
    { t: "problem", s: "No global tx", h: "Three services, three databases", b: "Placing an order must charge payment, reserve stock and book shipping. There's no single transaction spanning all three databases.", k: "Distributed data needs a different consistency tool.", a: "orch" },
    { t: "concept", s: "Steps", h: "A chain of local transactions", b: "The saga runs: charge payment → reserve stock → book shipping. Each step commits locally and reports back.", k: "Each step is a normal ACID transaction in one service.", f: "orch>pay:req, pay>orch:res, orch>inv:req, inv>orch:res, orch>ship:req", a: "pay inv" },
    { t: "case", s: "Compensate", h: "Shipping fails", b: "No courier is available. The saga runs compensations in reverse: release the reserved stock, then refund the payment. The order ends as CANCELLED.", k: "Failure → compensating actions, not rollback.", f: "orch>ship:fail, orch>inv:sync, orch>pay:sync", a: "ship" },
    { t: "recap", s: "Styles", h: "Orchestration vs choreography", b: "Orchestration: a coordinator tells each service what to do (easy to follow). Choreography: services react to each other's events (looser, but harder to trace).", k: "Few steps → choreography; complex flows → orchestration.", f: "orch>pay:req, orch>inv:req, orch>ship:req", a: "orch" },
  ],
});

L({
  id: "batch-stream",
  title: "Batch & Stream Processing",
  sub: "Process data in big scheduled chunks or continuously as it arrives.",
  level: "Intermediate", min: 7,
  learn: ["Batch: bounded data, high throughput", "Stream: unbounded data, low latency", "Event time, windows and late data"],
  deep: [
    "Batch jobs (Spark, SQL in a warehouse) read a bounded dataset, are easy to rerun, and produce results with hours of delay.",
    "Stream processors (Flink, Kafka Streams, Spark Structured Streaming) process events continuously, using windows (tumbling, sliding, session) for aggregations.",
    "Event time vs processing time: events arrive late or out of order; watermarks decide when a window is complete enough to emit.",
  ],
  iv: ["Ask how fresh the result must be. Daily reports → batch; fraud detection → stream.", "Mention reprocessing: keep the raw event log so you can recompute after bugs."],
  refs: [["Tyler Akidau: The world beyond batch, Streaming 101", "https://www.oreilly.com/radar/the-world-beyond-batch-streaming-101/"], ["Apache Flink: concepts", "https://nightlies.apache.org/flink/flink-docs-stable/docs/concepts/overview/"]],
  nodes: [N("src", "event log", 130, 220, "queue"), N("batch", "nightly batch", 400, 90, "worker"), N("stream", "stream processor", 400, 350, "worker"), N("wh", "warehouse", 660, 90, "db"), N("dash", "live dashboard", 660, 350, "client")],
  steps: [
    { t: "concept", s: "Batch", h: "Batch: process a day at a time", b: "Every night a job reads yesterday's events and writes aggregates to the warehouse. Simple, cheap and easy to rerun, but results are hours old.", k: "Batch = throughput and simplicity.", f: "src>batch:req, batch>wh:req", a: "batch wh" },
    { t: "concept", s: "Stream", h: "Stream: process as events arrive", b: "A stream processor consumes events continuously, updating per-minute aggregates and pushing them to a live dashboard.", k: "Stream = freshness.", f: "src>stream:req, stream>dash:res", a: "stream dash" },
    { t: "case", s: "Late data", h: "Late and out-of-order events", b: "A phone offline for 10 minutes sends old events. Windows are keyed by event time, and a watermark decides how long to wait before finalising a window.", k: "Use event time + watermarks for correct streaming results.", f: "src>stream:fail, src>stream:req", a: "stream" },
    { t: "recap", s: "Both", h: "Most systems use both", b: "Streams for real-time views, batch for exact historical reports and reprocessing. Keep the raw log as the source of truth.", k: "Keep raw events; derive everything else.", f: "src>batch:req, src>stream:req, batch>wh:req, stream>dash:res", a: "src" },
  ],
});

L({
  id: "authentication",
  title: "Authentication",
  sub: "Prove who the user is: sessions, tokens and single sign-on.",
  level: "Intermediate", min: 8,
  learn: ["Server-side sessions and secure cookies", "JWT access + refresh tokens", "OAuth 2.0 / OpenID Connect with PKCE", "Storing passwords safely"],
  deep: [
    "Session cookies should be HttpOnly, Secure and SameSite. Server-side sessions are easy to revoke.",
    "JWTs are signed (not encrypted by default) and verified without a lookup, so keep them short-lived and pair them with refresh tokens. Revocation needs extra machinery.",
    "OpenID Connect adds identity (ID tokens) on top of OAuth 2.0. Public clients (SPAs, mobile) should use the authorization code flow with PKCE.",
    "Hash passwords with a slow, salted algorithm: Argon2id, scrypt, bcrypt or PBKDF2.",
  ],
  iv: ["Separate authentication (who) from authorization (what they can do).", "Mention MFA, rate limiting on login, and secure password reset flows."],
  refs: [["OWASP Authentication Cheat Sheet", "https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html"], ["OWASP Password Storage Cheat Sheet", "https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html"], ["RFC 7636: PKCE", "https://www.rfc-editor.org/rfc/rfc7636"]],
  nodes: [N("user", "browser", 110, 220, "client"), N("app", "app", 380, 220), N("sess", "session store", 380, 390, "cache"), N("idp", "identity provider", 650, 110, "ext")],
  steps: [
    { t: "concept", s: "Sessions", h: "Server-side sessions", b: "After login the server stores a session and sends a random session ID in an HttpOnly, Secure cookie. Logout or revocation is just deleting the session.", k: "Sessions are simple and revocable.", f: "user>app:req, app>sess:sync, app>user:res", v: "user app sess", a: "sess" },
    { t: "concept", s: "Tokens", h: "Signed tokens (JWT)", b: "The server issues a short-lived signed access token (minutes) and a longer refresh token. Any service can verify the signature without a database call.", k: "JWTs scale verification but complicate revocation.", f: "user>app:req, app>user:res", v: "user app sess", a: "app" },
    { t: "concept", s: "OIDC", h: "Single sign-on with OIDC", b: "The app redirects to the identity provider; after login it receives an authorization code and exchanges it (with PKCE) for tokens, including an ID token describing the user.", k: "Delegate login to an IdP with code flow + PKCE.", f: "user>idp:req, idp>user:res, user>app:req, app>idp:sync", a: "idp" },
    { t: "recap", s: "Passwords", h: "If you store passwords", b: "Use Argon2id (or bcrypt/scrypt/PBKDF2) with per-user salts, rate-limit login, support MFA, and never reveal whether the email or the password was wrong.", k: "Slow hashes + MFA + rate limits.", f: "user>app:req, app>sess:sync", a: "app" },
  ],
});

L({
  id: "authorization",
  title: "Authorization",
  sub: "Decide what an authenticated user may do, on every object.",
  level: "Intermediate", min: 7,
  learn: ["RBAC, ABAC and relationship-based access", "Object-level checks against IDOR", "Deny by default and central policy"],
  deep: [
    "RBAC: permissions attached to roles. ABAC: rules over attributes (department, time, resource owner). ReBAC: permissions follow relationships (Google Zanzibar-style).",
    "Broken Object Level Authorization (BOLA/IDOR) is #1 in the OWASP API Security Top 10 (2023): changing /invoices/41 to /invoices/42 must not reveal someone else's invoice.",
    "Enforce on the server for every request; UI hiding is not security.",
  ],
  iv: ["Scope every query by tenant/owner, not just the endpoint.", "Centralise policy (a policy module or engine such as OPA) and test denials explicitly."],
  refs: [["OWASP API Security Top 10 (2023)", "https://owasp.org/API-Security/editions/2023/en/0x11-t10/"], ["OWASP Authorization Cheat Sheet", "https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html"]],
  nodes: [N("user", "user (tenant A)", 110, 220, "client"), N("api", "API", 350, 220), N("policy", "policy check", 350, 390, "lb"), N("db", "invoices", 620, 220, "db")],
  steps: [
    { t: "problem", s: "IDOR", h: "Guessing another tenant's ID", b: "The user changes <code>/invoices/41</code> to <code>/invoices/42</code>. The endpoint checks they're logged in but not that the invoice is theirs.", k: "Authentication isn't authorization.", f: "user>api:req, api>db:req, db>user:fail", v: "user api db", a: "db" },
    { t: "concept", s: "Models", h: "Roles, attributes, relationships", b: "Roles (admin, editor), attributes (owner_id, tenant_id, region), or relationships (member of project X) decide access.", k: "Pick the simplest model that expresses your rules.", f: "api>policy:req, policy>api:res", a: "policy" },
    { t: "concept", s: "Object check", h: "Check every object", b: "Query with the tenant in the filter (<code>WHERE id = 42 AND tenant_id = :me</code>) so other tenants' rows are simply not found (404).", k: "Scope data access by owner/tenant in the query itself.", f: "user>api:req, api>policy:req, api>db:req, db>api:res", a: "api db" },
    { t: "recap", s: "Default deny", h: "Deny by default, test denials", b: "New endpoints start locked. Automated tests try cross-tenant access and expect 403/404.", k: "Secure defaults + tests for the forbidden path.", f: "user>api:fail", a: "api" },
  ],
});

L({
  id: "encryption-secrets",
  title: "Encryption & Secrets",
  sub: "Protect data in transit and at rest, and keep credentials out of code.",
  level: "Intermediate", min: 7,
  learn: ["TLS everywhere, including internal traffic", "Envelope encryption with a KMS", "Managing and rotating secrets", "Hashing vs encryption"],
  deep: [
    "TLS protects data in transit; mutual TLS (mTLS) also authenticates services to each other.",
    "Envelope encryption: data is encrypted with a data key; the data key is encrypted by a master key held in a KMS/HSM that never leaves it.",
    "Secrets belong in a secret manager (Vault, AWS Secrets Manager, GCP Secret Manager), injected at runtime, with access audited and rotation automated.",
    "Hash (one-way) passwords; encrypt (reversible) data you need to read back.",
  ],
  iv: ["Say where keys live and who can use them, not just “we encrypt it”.", "Mention rotation and what happens if a secret leaks."],
  refs: [["OWASP Secrets Management Cheat Sheet", "https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html"], ["AWS KMS: envelope encryption", "https://docs.aws.amazon.com/kms/latest/developerguide/kms-cryptography.html#enveloping"]],
  nodes: [N("client", "client", 100, 220, "client"), N("lb", "TLS termination", 320, 220, "lb"), N("app", "app", 540, 220), N("db", "encrypted DB", 540, 390, "db"), N("kms", "KMS / secret manager", 720, 90, "ext")],
  steps: [
    { t: "concept", s: "In transit", h: "TLS on every hop", b: "HTTPS from the client to the edge, and TLS (or mTLS) from the edge to services and databases. Internal networks aren't automatically trusted.", k: "Encrypt every network hop.", f: "client>lb:req, lb>app:req, app>db:req", a: "lb" },
    { t: "concept", s: "At rest", h: "Envelope encryption", b: "Data is encrypted with a data key. The data key is stored encrypted under a master key in the KMS; decrypting it requires an audited KMS call.", k: "Master keys never leave the KMS.", f: "app>kms:sync, kms>app:res, app>db:req", a: "kms db" },
    { t: "concept", s: "Secrets", h: "Secrets out of code", b: "Database passwords and API keys are fetched from a secret manager at startup, never committed to git. Access is limited per service.", k: "Secrets live in a manager, not in repos or images.", f: "app>kms:req, kms>app:res", a: "kms" },
    { t: "case", s: "Rotate", h: "A key leaks", b: "Rotate the secret in the manager, roll services to pick it up, revoke the old one, and review audit logs for misuse. Automating this makes leaks routine instead of a crisis.", k: "Plan rotation before you need it.", f: "kms>app:sync, app>db:req", a: "kms app" },
  ],
});

L({
  id: "testing",
  title: "Testing",
  sub: "A fast, layered safety net that catches what matters.",
  level: "Beginner", min: 6,
  learn: ["The test pyramid", "Contract tests between services", "Load tests and testing in production"],
  deep: [
    "Many fast unit tests, fewer integration tests against real dependencies (DB, broker in containers), and a small number of end-to-end tests.",
    "Consumer-driven contract tests (e.g. Pact) let services verify they still satisfy what consumers expect, without full end-to-end environments.",
    "Load tests verify capacity and find bottlenecks; canaries and feature flags test changes on real traffic safely.",
  ],
  iv: ["Mention how you'd test failure paths: timeouts, retries, duplicate messages.", "Tie tests to deployment: CI blocks merges, canaries guard production."],
  refs: [["Martin Fowler: The Practical Test Pyramid", "https://martinfowler.com/articles/practical-test-pyramid.html"], ["Pact: contract testing", "https://docs.pact.io/"]],
  nodes: [N("dev", "commit", 100, 220, "user"), N("unit", "unit tests", 330, 90, "worker"), N("integ", "integration", 400, 220, "worker"), N("e2e", "end-to-end", 330, 350, "worker"), N("prod", "production (canary)", 660, 220)],
  steps: [
    { t: "concept", s: "Unit", h: "Lots of fast unit tests", b: "Thousands of tests run in seconds, covering business rules and edge cases in isolation.", k: "Fast feedback on logic.", f: "dev>unit:req, unit>dev:res", a: "unit" },
    { t: "concept", s: "Integration", h: "Integration with real dependencies", b: "Run the code against a real database and broker in containers to catch query, migration and serialisation bugs.", k: "Test the seams with real components.", f: "dev>integ:req, integ>dev:res", a: "integ" },
    { t: "concept", s: "E2E", h: "A few end-to-end journeys", b: "Signup, checkout, payment: the critical paths only. E2E tests are slow and flaky, so keep them few.", k: "E2E for critical journeys only.", f: "dev>e2e:req, e2e>dev:res", a: "e2e" },
    { t: "recap", s: "Production", h: "Test safely in production", b: "Canary releases to 1% of traffic and feature flags catch what tests can't, while watching error rates and latency.", k: "Production is the final test environment, so make it safe.", f: "dev>prod:req, prod>dev:res", a: "prod" },
  ],
});

L({
  id: "ci-cd",
  title: "CI/CD & Deployments",
  sub: "Ship small changes often, safely and reversibly.",
  level: "Intermediate", min: 7,
  learn: ["Build once, promote the same artifact", "Rolling, blue-green and canary deploys", "Backward-compatible migrations and rollbacks"],
  deep: [
    "CI runs tests, linters and security scans on every change. CD promotes one immutable artifact (e.g. container image digest) through environments.",
    "Rolling: replace instances gradually. Blue-green: switch traffic between two full environments. Canary: send a small percentage of traffic to the new version and watch metrics.",
    "Database changes must work with both old and new code during a deploy (expand → migrate → contract).",
  ],
  iv: ["Describe automated rollback triggered by error-rate or latency regressions.", "Decouple deploy from release with feature flags."],
  refs: [["Google SRE workbook: Canarying releases", "https://sre.google/workbook/canarying-releases/"], ["Martin Fowler: BlueGreenDeployment", "https://martinfowler.com/bliki/BlueGreenDeployment.html"]],
  nodes: [N("dev", "git push", 90, 220, "user"), N("ci", "CI pipeline", 300, 220, "worker"), N("reg", "image registry", 300, 390, "db"), N("stg", "staging", 540, 100), N("prod", "production", 700, 260)],
  steps: [
    { t: "concept", s: "CI", h: "Every push is verified", b: "Tests, type checks, linters and dependency scans run automatically. Main stays releasable.", k: "CI keeps the main branch green.", f: "dev>ci:req, ci>dev:res", a: "ci" },
    { t: "concept", s: "Artifact", h: "Build once, promote everywhere", b: "CI builds one container image, tagged by digest, and pushes it to a registry. Staging and production run the exact same artifact.", k: "Same artifact in every environment.", f: "ci>reg:req, reg>stg:req", a: "reg stg" },
    { t: "concept", s: "Canary", h: "Canary to production", b: "5% of traffic goes to the new version. If error rate and latency stay within bounds, it ramps to 100%; otherwise it rolls back automatically.", k: "Expose risk gradually and measure.", f: "reg>prod:req, prod>reg:res", a: "prod" },
    { t: "case", s: "Rollback", h: "Make rollback boring", b: "Rollback = redeploy the previous image. That only works if migrations were backward-compatible, so schema changes ship in expand/contract steps.", k: "Reversible deploys need compatible schemas.", f: "prod>reg:fail, reg>prod:req", a: "prod reg" },
  ],
});
