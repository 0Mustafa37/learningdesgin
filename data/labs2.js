/* More "Try it" labs (format in data/labs.js). */
(() => {
  const LABS = (window.LABS = window.LABS || {});
  const ev = (f, t, k, at, dur, o = {}) => ({ f, t, k, at, dur, ...o });
  const clip = (list, L) => list.filter((e) => e.at < L - 420).map((e) => (e.hold && e.at + e.dur + e.hold > L ? { ...e, hold: Math.max(0, L - e.at - e.dur - 40) } : e));
  const ms = (x) => (x >= 1000 ? `${(x / 1000).toFixed(1)} s` : x >= 10 ? `${Math.round(x)} ms` : `${x.toFixed(2)} ms`);
  const inWin = (list, t, w = 1000) => list.filter((x) => x <= t && x > t - w).length;

  /* ═════════ Load balancing ═════════ */
  LABS["load-balancing"] = {
    h: "Balance the load",
    b: "Thirty requests arrive over six seconds. One server can be made slow (a bad deploy or a noisy neighbour). Pick the algorithm and decide whether the balancer health-checks its servers.",
    controls: [
      { id: "algo", label: "Algorithm", opts: [["Round robin", "rr"], ["Least connections", "lc"]], def: "rr" },
      { id: "slow", label: "app 3", opts: [["Healthy", 0], ["5× slower", 1]], def: 1 },
      { id: "hc", label: "Health checks", opts: [["Off", 0], ["Eject slow server", 1]], def: 0 },
    ],
    make(p) {
      const S = ["a1", "a2", "a3"], L = 9000, N = 30, out = [], reqs = [], served = { a1: 0, a2: 0, a3: 0 };
      let rr = 0, ejectedAt = Infinity, slowSeen = 0;
      for (let i = 0; i < N; i++) {
        const a = 100 + i * 200, t = a + 300;
        const live = S.filter((s) => !(s === "a3" && t >= ejectedAt));
        const inflight = (s) => reqs.filter((r) => r.s === s && r.start <= t && t < r.end).length;
        let s;
        if (p.algo === "rr") { s = live[rr % live.length]; rr++; } else s = live.slice().sort((x, y) => inflight(x) - inflight(y) || ((S.indexOf(x) - i + 30) % 3) - ((S.indexOf(y) - i + 30) % 3))[0];
        const svc = s === "a3" && p.slow ? 2000 : 400, start = t + 300, end = start + svc + inflight(s) * 120;
        reqs.push({ s, a, start, end, lat: end + 300 - a }); served[s]++;
        if (s === "a3" && p.slow && p.hc && ++slowSeen >= 1 && ejectedAt === Infinity) ejectedAt = start + 600;
        out.push(ev("users", "lb", "req", a, 300, { log: "GET /api/cart" }), ev("lb", s, "req", t, 300, { log: `→ ${s.replace("a", "app ")}` }), ev(s, "lb", "res", end, 300, { log: `200 in ${ms((end + 300 - a) / 10)}`, tone: end + 300 - a > 1500 ? "warn" : "ok" }));
      }
      const lats = reqs.map((r) => r.lat).sort((x, y) => x - y), p95 = lats[Math.floor(lats.length * 0.95) - 1], p50 = lats[Math.floor(lats.length / 2)];
      const verdict = !p.slow ? "With healthy, identical servers both algorithms spread the load evenly."
        : p.hc ? "Health checks pull the slow server out of rotation, so the tail latency comes back down."
        : p.algo === "lc" ? "Least connections notices app 3 is busy and sends it less, but it still gets traffic and its users still wait."
        : "Round robin keeps sending a third of all requests to the slow server, so a third of users get a slow page: p95 explodes.";
      return {
        t: "lab", s: "Try it", lang: "text", f: "users>lb:req, lb>a1:req, lb>a2:req, lb>a3:req", a: "lb", L, ev: clip(out, L), k: verdict,
        setup: [["requests", `app 1: ${served.a1} · app 2: ${served.a2} · app 3: ${served.a3}`], ["p50 latency", ms(p50 / 10)], ["p95 latency", ms(p95 / 10), p95 > 1500 ? "bad" : "hi"], ["app 3", ejectedAt < Infinity ? "ejected by health check" : p.slow ? "slow, still in rotation" : "healthy", ejectedAt < Infinity ? "hi" : p.slow ? "bad" : ""]],
        code: `upstream app {\n    ${p.algo === "lc" ? "least_conn;\n    " : ""}server app1:8000${p.hc ? " max_fails=2 fail_timeout=30s" : ""};\n    server app2:8000${p.hc ? " max_fails=2 fail_timeout=30s" : ""};\n    server app3:8000${p.hc ? " max_fails=2 fail_timeout=30s" : ""};\n}\n# nginx: round robin is the default${p.hc ? "\n# passive checks shown; active checks need nginx plus, HAProxy or your cloud LB" : ""}`,
        note: "Times are slowed down ×10 to watch. The 'health check' here ejects a server once it answers far slower than the others (an outlier detector, like Envoy's). Plain up/down checks wouldn't catch a slow but alive server.",
        fx(t, S2) {
          S.forEach((s) => {
            const n = reqs.filter((r) => r.s === s && r.start <= t && t < r.end).length, gone = s === "a3" && t >= ejectedAt;
            S2.tag(s, gone ? "ejected" : `${n} in flight · ${reqs.filter((r) => r.s === s && r.end <= t).length} done`, gone ? "warn" : n >= 3 ? "bad" : "ok", gone ? "x" : "server");
          });
          const done = reqs.filter((r) => r.end + 300 <= t).map((r) => r.lat);
          S2.metric("check", "Served", String(done.length), "ok");
          S2.metric("timer", "Slowest so far", done.length ? ms(Math.max(...done) / 10) : "—", done.some((x) => x > 1500) ? "bad" : "ok");
          S2.tag("lb", p.algo === "rr" ? "round robin" : "least connections", "", "split");
        },
      };
    },
  };

  /* ═════════ Sharding: choose the key ═════════ */
  LABS["sharding"] = {
    h: "Pick the shard key",
    b: "An order service writes 36 orders in six seconds across three shards. Each shard comfortably takes about 3 writes per second. Choose what you shard by, and whether to split the hottest key.",
    controls: [
      { id: "key", label: "Shard key", opts: [["hash(order_id)", "hash"], ["created_at (range)", "date"], ["tenant_id", "tenant"]], def: "tenant" },
      { id: "salt", label: "Hot tenant", opts: [["As is", 0], ["Split over 3 shards", 1]], def: 0 },
    ],
    make(p) {
      const L = 8600, CAP = 3, out = [], writes = [], per = { s1: [], s2: [], s3: [] };
      for (let i = 0; i < 36; i++) {
        const a = 100 + i * 170, t = a + 600, tenant = i % 5 < 3 ? "acme" : ["beta", "corp"][i % 2];
        let s = p.key === "hash" ? ["s1", "s2", "s3"][(i * 7 + 3) % 3] : p.key === "date" ? "s3" : tenant === "acme" ? "s2" : tenant === "beta" ? "s1" : "s3";
        if (p.salt && (p.key === "tenant" || p.key === "date")) s = ["s1", "s2", "s3"][i % 3];
        const over = inWin(per[s], t) >= CAP;
        if (!over) per[s].push(t);
        writes.push({ s, t, over, tenant });
        out.push(ev("app", "router", "req", a, 300, { log: `INSERT order #${1000 + i} (${p.key === "tenant" ? `tenant=${tenant}` : p.key === "date" ? "today" : "id hash"})` }));
        out.push(ev("router", s, "req", a + 300, 300, over ? { endAt: 0.86, end: "pop", popKind: "fail", log: `→ shard ${s.slice(1)}`, done: "timeout · shard overloaded" } : { log: `→ shard ${"ABC"[s[1] - 1]}` }));
      }
      const cnt = (s) => writes.filter((w) => w.s === s).length, fails = writes.filter((w) => w.over).length;
      const verdict = p.salt && p.key === "hash" ? "Hashing already spreads writes evenly; splitting only adds complexity here."
        : p.key === "hash" ? "Hashing a high-cardinality key spreads writes evenly, but 'all orders for one tenant' now hits every shard."
        : p.key === "date" && !p.salt ? "Range by date sends every new write to the newest shard: one hot shard, two idle ones."
        : p.key === "tenant" && !p.salt ? "One big tenant makes 60% of writes, so its shard melts while the others idle. A classic hot partition."
        : "Splitting the hot key (key + suffix 0–2) spreads its writes; reads for that tenant now fan out to 3 shards.";
      return {
        t: "lab", s: "Try it", f: "app>router:req, router>s1:req, router>s2:req, router>s3:req", a: "router", L, ev: clip(out, L), k: verdict,
        setup: [["writes per shard", `A ${cnt("s1")} · B ${cnt("s2")} · C ${cnt("s3")}`], ["skew", `${Math.round((Math.max(cnt("s1"), cnt("s2"), cnt("s3")) / 12) * 100)}% of fair share`, Math.max(cnt("s1"), cnt("s2"), cnt("s3")) > 16 ? "bad" : "hi"], ["failed writes", String(fails), fails ? "bad" : ""]],
        code: p.key === "hash" ? "shard = int(hashlib.md5(str(order_id).encode()).hexdigest(), 16) % N_SHARDS" : p.key === "date" ? "shard = shard_for_range(order.created_at)   # newest range = hottest shard" + (p.salt ? "\n# split: shard = (day_bucket + order_id % 3) % N_SHARDS" : "") : `key = f"{tenant_id}"${p.salt ? "\nif tenant_id in HOT_TENANTS:\n    key = f\"{tenant_id}:{order_id % 3}\"   # write anywhere, read all 3" : ""}\nshard = crc32(key.encode()) % N_SHARDS`,
        note: "Each shard is modelled to take about 3 writes per second; writes over that time out.",
        fx(t, S2) {
          ["s1", "s2", "s3"].forEach((s) => { const n = inWin(writes.filter((w) => w.s === s).map((w) => w.t), t); S2.tag(s, `${n} writes/s`, n > CAP ? "bad" : n >= CAP ? "warn" : "ok", "db", Math.min(1, n / (CAP * 2))); });
          S2.metric("x", "Failed writes", String(writes.filter((w) => w.over && w.t <= t).length), writes.some((w) => w.over && w.t <= t) ? "bad" : "");
          S2.metric("check", "Written", String(writes.filter((w) => !w.over && w.t <= t).length), "ok");
        },
      };
    },
  };

  /* ═════════ Message queues: workers vs backlog ═════════ */
  LABS["message-queues"] = {
    h: "Size the workers",
    b: "The web app enqueues PDF jobs and answers in 40 ms. Choose how fast jobs arrive, how long each takes and how many worker processes you run. Watch the queue depth and how long the oldest job waits.",
    controls: [
      { id: "rate", label: "Jobs arrive", opts: [["2 / s", 2], ["Spike 6 / s", 6]], def: 6 },
      { id: "dur", label: "Each job", opts: [["0.5 s", 500], ["1.5 s", 1500]], def: 1500 },
      { id: "n", label: "Worker processes", opts: [["2", 2], ["4", 4], ["8", 8]], def: 2 },
    ],
    make(p) {
      const L = 9000, out = [], jobs = [], free = Array.from({ length: p.n }, () => 0);
      const gap = 1000 / p.rate, count = Math.floor(5200 / gap);
      for (let i = 0; i < count; i++) {
        const a = 150 + i * gap, q = a + 300;
        out.push(ev("web", "queue", "req", a, 300, { log: `enqueue render_pdf(#${500 + i})` }));
        const slot = free.indexOf(Math.min(...free)), start = Math.max(q + 50, free[slot]), w = slot % 2 ? "w2" : "w1";
        free[slot] = start + 300 + p.dur;
        jobs.push({ q, start, end: start + 300 + p.dur, w, slot });
        out.push(ev("queue", w, "req", start, 300, { log: `worker ${slot + 1} picks #${500 + i} (waited ${ms(start - q)})`, tone: start - q > 2000 ? "warn" : "" }));
      }
      const maxWait = Math.max(...jobs.map((j) => j.start - j.q)), depthAt = (t) => jobs.filter((j) => j.q <= t && j.start > t).length;
      let peak = 0; for (let t = 0; t < L; t += 100) peak = Math.max(peak, depthAt(t));
      const capacity = (p.n * 1000) / (p.dur + 300), keeps = capacity >= p.rate;
      const verdict = keeps ? `Capacity ≈ ${capacity.toFixed(1)} jobs/s ≥ ${p.rate} arriving: the queue stays short.`
        : `Capacity ≈ ${capacity.toFixed(1)} jobs/s < ${p.rate} arriving: the backlog grows for as long as the spike lasts. Add workers or make jobs cheaper.`;
      const half = Math.ceil(p.n / 2);
      return {
        t: "lab", s: "Try it", f: "web>queue:req, queue>w1:req, queue>w2:req", a: keeps ? "w1 w2" : "queue", L, ev: clip(out, L), k: verdict,
        setup: [["arrival", `${p.rate} jobs/s for 5 s`], ["capacity", `${p.n} × 1 / ${ms(p.dur + 300)} ≈ ${capacity.toFixed(1)} jobs/s`, keeps ? "hi" : "bad"], ["peak queue depth", String(peak), peak > 6 ? "bad" : ""], ["longest wait", ms(maxWait), maxWait > 3000 ? "bad" : ""], ["web response", "40 ms, whatever the backlog", "hi"]],
        code: `# celery: one queue, ${p.n} worker processes\ncelery -A app worker -Q pdf --concurrency=${p.n} --prefetch-multiplier=1\n\n@shared_task(acks_late=True)\ndef render_pdf(order_id):\n    ...   # ~${ms(p.dur)} of work`,
        note: "Little's law: jobs in the system = arrival rate × time each spends there. If arrivals beat capacity, the queue grows without limit.",
        fx(t, S2) {
          const d = depthAt(t), oldest = jobs.filter((j) => j.q <= t && j.start > t).map((j) => t - j.q);
          S2.tag("queue", `depth ${d}`, d > 6 ? "bad" : d > 2 ? "warn" : "ok", "steps", Math.min(1, d / 12));
          S2.metric("steps", "Queue depth", String(d), d > 6 ? "bad" : d > 2 ? "warn" : "ok");
          S2.metric("hourglass", "Oldest job waiting", oldest.length ? ms(Math.max(...oldest)) : "—", oldest.some((x) => x > 3000) ? "bad" : "");
          S2.metric("check", "Done", String(jobs.filter((j) => j.end <= t).length), "ok");
          const busy = (w) => jobs.filter((j) => j.w === w && j.start <= t && t < j.end).length;
          S2.pool("w1", Array.from({ length: half }, (_, i) => (i < busy("w1") ? "busy" : "idle")));
          S2.tag("w2", `${busy("w2")} / ${p.n - half} busy`, "", "cog");
          S2.tag("web", "responds in 40 ms", "ok", "check");
        },
      };
    },
  };

  /* ═════════ Retry storms ═════════ */
  LABS["retry-storms"] = {
    h: "Start (and stop) a retry storm",
    b: "The database is overloaded for the first two and a half seconds. Eight user requests pass through three layers. Choose which layers retry and how. Count how many calls actually reach the database.",
    controls: [
      { id: "where", label: "Who retries", opts: [["Every layer (3×)", "all"], ["Only the edge (3×)", "edge"], ["Nobody", "none"]], def: "all" },
      { id: "backoff", label: "Backoff", opts: [["None", 0], ["Exponential + jitter", 1]], def: 0 },
      { id: "budget", label: "Retry budget", opts: [["Off", 0], ["20% of calls", 1]], def: 0 },
    ],
    make(p) {
      const L = 9200, out = [], dbCalls = [], OVER_UNTIL = 2600, CAP = 5;
      let first = 0, retried = 0;
      const tries = (layer) => (p.where === "none" ? 1 : p.where === "edge" ? (layer === 0 ? 3 : 1) : 3);
      const hops = [["client", "api"], ["api", "svc"], ["svc", "db"]];
      const call = (layer, t, rid, salt) => {
        const [f, to] = hops[layer]; let at = t;
        for (let k = 0; k < tries(layer); k++) {
          if (k > 0) {
            if (p.budget && retried >= Math.max(1, first * 0.2)) break;
            retried++; at += p.backoff ? 150 * 2 ** k + ((rid * 97 + k * 31 + salt) % 200) : 40;
          } else first++;
          if (at > L - 800) break;
          out.push(ev(f, to, "req", at, 260, { log: `${layer === 0 ? `request ${rid + 1}` : layer === 1 ? "api → service" : "service → db"}${k ? ` retry ${k}` : ""}` }));
          if (layer === 2) {
            const load = inWin(dbCalls, at + 260), ok = at + 260 >= OVER_UNTIL && load < CAP;
            dbCalls.push(at + 260);
            if (ok) { out.push(ev(to, f, "res", at + 360, 260, { log: "row", tone: "ok" })); return { ok: true, end: at + 620 }; }
            out[out.length - 1] = { ...out[out.length - 1], endAt: 0.86, end: "pop", popKind: "fail", done: load >= CAP ? "too many connections" : "timeout (overloaded)" };
            at += 300; continue;
          }
          const r = call(layer + 1, at + 260, rid, salt + k * 13);
          if (r.ok) { out.push(ev(to, f, "res", r.end, 260, { log: "200", tone: "ok" })); return { ok: true, end: r.end + 260 }; }
          at = r.end;
        }
        out.push(ev(to, f, "fail", at, 260, { log: "503", tone: "bad" }));
        return { ok: false, end: at + 260 };
      };
      const results = Array.from({ length: 8 }, (_, i) => call(0, 100 + i * 220, i, i * 7));
      const okN = results.filter((r) => r.ok).length, amp = (dbCalls.length / 8).toFixed(1);
      const verdict = p.where === "all" && !p.backoff ? `Each layer multiplies the others: up to 3 × 3 × 3 = 27 calls per request. Here ${dbCalls.length} calls hit a database that was already drowning (${amp}× the real traffic). That extra load is what stops it recovering.`
        : p.where === "all" && p.budget ? "A retry budget caps retries at a share of real traffic: the database isn't hammered, at the price of a few more errors while it's down."
        : p.where === "all" ? "Backoff spreads the retries out, but every layer still multiplies them. Retry in one place."
        : p.where === "edge" && p.backoff ? "Retrying once, at the edge, with backoff and jitter: the database gets room to recover and most users still succeed."
        : p.where === "none" ? "No retries: no storm, but every request that hit the bad two seconds simply fails." : "Retrying only at the edge keeps amplification at 3×; add backoff so the retries don't arrive together.";
      return {
        t: "lab", s: "Try it", f: "client>api:req, api>svc:req, svc>db:req, db>svc:res, svc>api:res, api>client:res", a: "db", L, ev: clip(out, L), k: verdict,
        setup: [["user requests", "8"], ["database calls", `${dbCalls.length} (${amp}× amplification)`, dbCalls.length > 24 ? "bad" : "hi"], ["succeeded", `${okN} of 8`, okN === 8 ? "hi" : okN < 4 ? "bad" : ""]],
        code: `# retry at ONE layer (the edge), with backoff, jitter and a budget\n@retry(stop=stop_after_attempt(${p.where === "none" ? 1 : 3}),\n       wait=wait_random_exponential(multiplier=0.15, max=2)${p.budget ? ",\n       before=check_retry_budget   # e.g. allow retries ≤ 20% of calls" : ""})\ndef call_service(...): ...\n\n# inner layers: fail fast, no retries\nrequests.get(SERVICE_URL, timeout=1)`,
        note: "The database is modelled as failing for the first 2.6 s and rejecting more than 5 calls per second after that.",
        fx(t, S2) {
          const n = dbCalls.filter((x) => x <= t).length, load = inWin(dbCalls, t);
          S2.metric("db", "DB calls", String(n), n > 24 ? "bad" : "");
          S2.metric("activity", "DB load", `${load} / s`, load >= CAP ? "bad" : "ok");
          S2.tag("db", t < OVER_UNTIL ? "overloaded" : load >= CAP ? `${load} calls/s: still drowning` : "recovered", t < OVER_UNTIL || load >= CAP ? "bad" : "ok", "db");
          S2.tag("api", tries(0) > 1 ? "retries ×3" : "no retries", tries(0) > 1 ? "warn" : "", "repeat");
          S2.tag("svc", tries(1) > 1 ? "retries ×3" : "no retries", tries(1) > 1 ? "warn" : "", "repeat");
        },
      };
    },
  };

  /* ═════════ Postgres: read the query plan ═════════ */
  LABS["indexes"] = {
    h: "Read the query plan",
    b: "Change the table size, the query and the index, and read the EXPLAIN ANALYZE output the planner would give you. Watch whether the query walks the index or reads the whole table.",
    controls: [
      { id: "rows", label: "orders table", opts: [["50 k rows", 5e4], ["50 M rows", 5e7]], def: 5e7 },
      { id: "q", label: "Query", opts: [["One customer", "cust"], ["Their latest 20", "latest"], ["status = 'paid' (70%)", "paid"]], def: "latest" },
      { id: "idx", label: "Index", opts: [["None", "none"], ["(customer_id)", "c"], ["(customer_id, created_at)", "cc"]], def: "none" },
    ],
    make(p) {
      const big = p.rows > 1e6, perCust = big ? 1200 : 8, matches = p.q === "paid" ? Math.round(p.rows * 0.7) : perCust, ret = p.q === "latest" ? Math.min(20, matches) : matches;
      const sql = p.q === "paid" ? "SELECT * FROM orders WHERE status = 'paid';" : p.q === "cust" ? "SELECT * FROM orders WHERE customer_id = 42;" : "SELECT * FROM orders WHERE customer_id = 42\nORDER BY created_at DESC LIMIT 20;";
      const fmt = (n) => n.toLocaleString("en-US");
      const seqMs = big ? (p.q === "paid" ? 6900 : 1450) : (p.q === "paid" ? 9.8 : 3.1);
      const useIdx = p.q !== "paid" && p.idx !== "none";
      let plan, t, kind;
      if (!useIdx) {
        kind = "seq"; t = seqMs + (p.q === "latest" ? (big ? 2.4 : 0.05) : 0);
        const scan = big && p.q !== "paid" ? `Gather  (actual time=${(t * 0.98).toFixed(1)}..${t.toFixed(1)} rows=${fmt(matches)})\n  Workers Planned: 2\n  ->  Parallel Seq Scan on orders  (actual rows=${fmt(Math.round(matches / 3))} loops=3)\n        Filter: (customer_id = 42)\n        Rows Removed by Filter: ${fmt(Math.round((p.rows - matches) / 3))}` : `Seq Scan on orders  (actual time=0.01..${t.toFixed(1)} rows=${fmt(matches)})\n  Filter: ${p.q === "paid" ? "(status = 'paid'::text)" : "(customer_id = 42)"}\n  Rows Removed by Filter: ${fmt(p.rows - matches)}`;
        plan = p.q === "latest" ? `Limit  (actual rows=20)\n  ->  Sort  (actual rows=20)\n        Sort Key: created_at DESC\n        Sort Method: top-N heapsort  Memory: 30kB\n        ->  ${scan.split("\n").join("\n        ")}` : scan;
        if (p.q === "paid" && p.idx !== "none") plan += "\n-- the index on customer_id can't help a filter on status;\n-- and at 70% of rows a seq scan beats any index anyway";
      } else if (p.q === "latest" && p.idx === "cc") {
        kind = "idx"; t = 0.06;
        plan = `Limit  (actual time=0.03..0.06 rows=20)\n  ->  Index Scan Backward using orders_customer_created_idx on orders  (actual rows=20)\n        Index Cond: (customer_id = 42)\n-- rows come out of the index already in created_at order: no sort, stops after 20`;
      } else {
        kind = "bitmap"; t = big ? 4.8 : 0.08;
        const scan = big ? `Bitmap Heap Scan on orders  (actual time=0.4..${(t - 0.3).toFixed(1)} rows=${fmt(perCust)})\n  Recheck Cond: (customer_id = 42)\n  Heap Blocks: exact=${fmt(Math.round(perCust * 0.9))}\n  ->  Bitmap Index Scan on orders_customer_idx  (actual rows=${fmt(perCust)})\n        Index Cond: (customer_id = 42)` : `Index Scan using orders_customer_idx on orders  (actual time=0.02..0.07 rows=${perCust})\n  Index Cond: (customer_id = 42)`;
        plan = p.q === "latest" ? `Limit  (actual rows=20)\n  ->  Sort  (actual rows=20)\n        Sort Key: created_at DESC\n        Sort Method: top-N heapsort  Memory: 30kB\n        ->  ${scan.split("\n").join("\n        ")}` : scan;
      }
      plan += `\nPlanning Time: 0.12 ms\nExecution Time: ${ms(t)}`;
      const L = kind === "seq" ? 6200 : 3800, out = [ev("app", "db", "req", 100, 500, { log: sql.split("\n").join(" ") })];
      if (kind !== "seq") out.push(ev("app", "idx", "sync", 650, 400, { log: kind === "idx" ? "walk index backwards, stop at 20" : `index lookup customer_id = 42 → ${fmt(perCust)} row pointers` }), ev("idx", "db", "sync", 1100, 450, { log: kind === "idx" ? "fetch 20 rows" : `fetch ${fmt(perCust)} rows from ${fmt(Math.round(perCust * 0.9))} pages` }), ev("db", "app", "res", 1700, 500, { log: `${fmt(ret)} rows in ${ms(t)}`, tone: "ok" }));
      else out.push(ev("db", "app", "res", 3900, 500, { log: `${fmt(ret)} rows in ${ms(t)}`, tone: t > 500 ? "warn" : "ok" }));
      const verdict = p.q === "paid" ? "A filter that matches most of the table is cheapest as a sequential scan. Indexes help selective predicates."
        : kind === "seq" && big ? `No usable index: Postgres reads all 50 M rows to find ${fmt(perCust)}. That's the ${ms(t)} you see in the slow-query log.`
        : kind === "seq" ? "On 50 k rows a sequential scan is only a few ms. Indexes matter as the table grows."
        : kind === "idx" ? "The composite index matches both the filter and the sort: Postgres reads 20 index entries and stops. Fastest possible plan."
        : p.q === "latest" ? "The index finds the customer's rows, but they still have to be sorted to get the latest 20. Add created_at to the index."
        : "The index finds the customer's rows directly. At this many matches Postgres uses a bitmap scan to read heap pages in order.";
      return {
        t: "lab", s: "Try it", lang: "text", f: kind === "seq" ? "app>db:req, db>app:res" : "app>db:req, app>idx:sync, idx>db:sync, db>app:res", a: kind === "seq" ? "db" : "idx db", L, ev: out, k: verdict,
        setup: [["rows in table", fmt(p.rows)], ["rows returned", fmt(ret)], ["plan", kind === "seq" ? (big && p.q !== "paid" ? "Parallel Seq Scan" : "Seq Scan") : kind === "idx" ? "Index Scan Backward" : big ? "Bitmap Index + Heap Scan" : "Index Scan", kind === "seq" && big ? "bad" : "hi"], ["execution time", ms(t), t > 500 ? "bad" : "hi"]],
        code: `EXPLAIN ANALYZE\n${sql}\n\n${plan}${p.idx !== "none" ? `\n\n-- ${p.idx === "cc" ? "CREATE INDEX CONCURRENTLY orders_customer_created_idx\n--     ON orders (customer_id, created_at DESC);" : "CREATE INDEX CONCURRENTLY orders_customer_idx ON orders (customer_id);"}` : ""}`,
        note: "Plans and timings are illustrative, shaped like real PostgreSQL 16 output. In Django: print(qs.explain(analyze=True)).",
        fx(tt, S2) {
          const scanning = kind === "seq" && tt > 600 && tt < 3900, f = Math.min(1, Math.max(0, (tt - 600) / 3300));
          S2.tag("db", scanning ? `scanning ${fmt(Math.round(p.rows * f))} rows…` : kind === "seq" ? `read ${fmt(p.rows)} rows` : `read ${fmt(ret)} rows`, kind === "seq" && big ? "bad" : "ok", "db", scanning ? f : null);
          S2.tag("idx", p.idx === "none" ? "no index" : kind === "seq" ? "not used" : "used", p.idx === "none" || kind === "seq" ? "warn" : "ok", "zap");
          S2.metric("timer", "Execution", tt > (kind === "seq" ? 3900 : 1700) ? ms(t) : "…", t > 500 ? "bad" : "ok");
          S2.metric("db", "Rows read", fmt(kind === "seq" ? Math.round(p.rows * (tt > 600 ? f : 0)) : tt > 1100 ? ret : 0), kind === "seq" && big ? "bad" : "");
        },
      };
    },
  };

  /* ═════════ Django: N+1 ═════════ */
  LABS["dj-n-plus-one"] = {
    h: "Count the queries",
    b: "An order list shows each order's customer and its items. Pick how the queryset loads related objects and how many orders are on the page, then count the queries.",
    controls: [
      { id: "mode", label: "Queryset", opts: [["Order.objects.all()", "naive"], ["+ select_related", "sr"], ["+ prefetch_related too", "pf"]], def: "naive" },
      { id: "n", label: "Orders on page", opts: [["10", 10], ["50", 50]], def: 10 },
    ],
    make(p) {
      const q = p.mode === "naive" ? 1 + 2 * p.n : p.mode === "sr" ? 1 + p.n : 2, show = Math.min(q, 24), out = [];
      const label = (i) => (i === 0 ? (p.mode === "naive" ? "SELECT … FROM order LIMIT " + p.n : p.mode === "sr" ? "SELECT … FROM order JOIN customer … LIMIT " + p.n : "SELECT … FROM order JOIN customer …") : p.mode === "pf" ? `SELECT … FROM item WHERE order_id IN (${p.n} ids)` : p.mode === "sr" ? `SELECT … FROM item WHERE order_id = ${100 + i}` : i % 2 ? `SELECT … FROM customer WHERE id = ${7 + i}` : `SELECT … FROM item WHERE order_id = ${100 + i / 2}`);
      for (let i = 0; i < show; i++) { const a = 200 + i * 260; out.push(ev("orm", "db", "req", a, 240, { log: label(i) }), ev("db", "orm", "res", a + 260, 200, { log: "rows", tone: "ok" })); }
      out.unshift(ev("view", "orm", "req", 0, 200, { log: "render order_list.html" }));
      const timeMs = q * 1.6 + 4;
      const verdict = p.mode === "naive" ? `Every {{ order.customer.name }} and {{ order.items.all }} in the template fires its own query: ${q} queries for ${p.n} orders. That's N+1 (twice).`
        : p.mode === "sr" ? "select_related joins the customer into the first query, but the items (a reverse FK) still cost one query per order."
        : "select_related for the FK, prefetch_related for the reverse relation: 2 queries whatever the page size.";
      return {
        t: "lab", s: "Try it", f: "view>orm:req, orm>db:req, db>orm:res", a: "db", L: Math.max(4500, 400 + show * 260 + 900), ev: out, k: verdict,
        setup: [["queries", String(q), q > 5 ? "bad" : "hi"], ["DB time (≈1.6 ms each)", ms(timeMs), q > 20 ? "bad" : ""], ["scales with page size", p.mode === "pf" ? "no" : "yes", p.mode === "pf" ? "hi" : "bad"]],
        code: `qs = Order.objects.all()${p.mode !== "naive" ? '.select_related("customer")' : ""}${p.mode === "pf" ? '.prefetch_related("items")' : ""}\n\n# guard it in a test\ndef test_order_list_queries(self):\n    with self.assertNumQueries(${q}):\n        self.client.get("/orders/")`,
        note: "Find these with django-debug-toolbar locally, or assertNumQueries in tests so a regression fails CI.",
        fx(t, S2) {
          const n = out.filter((e) => e.f === "orm" && e.t === "db" && e.at <= t).length, shown = Math.round((n / show) * q);
          S2.metric("db", "Queries", String(Math.min(q, shown)), q > 5 ? "bad" : "ok");
          S2.tag("orm", p.mode === "naive" ? "lazy loads in the template" : p.mode === "sr" ? "JOIN customer" : "JOIN + 1 prefetch", p.mode === "pf" ? "ok" : "warn", "db");
          S2.tag("db", `${Math.min(q, shown)} queries`, q > 5 ? "bad" : "ok", "db", Math.min(1, shown / q));
        },
      };
    },
  };
})();
