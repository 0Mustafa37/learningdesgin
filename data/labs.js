/* "Try it" labs: an extra last step whose setup you change with controls in the side panel.
   LABS[lessonId] = { h, b, controls: [{ id, label, opts: [[label, value]], def }], make(params) => raw step }
   make() runs a small simulation and returns ev / fx / setup / code / note like any other step. */
window.LABS = window.LABS || {};
(() => {
  const LABS = window.LABS;
  const ev = (f, t, k, at, dur, o = {}) => ({ f, t, k, at, dur, ...o });
  const fmtS = (ms) => (ms >= 10000 ? `${Math.round(ms / 1000)} s` : `${(ms / 1000).toFixed(1)} s`);
  /* tiny discrete-event queue */
  const runQueue = (seed) => { const q = [...seed]; const out = []; while (q.length) { q.sort((a, b) => a.t - b.t); const a = q.shift(); out.push(a); (a.run(a.t) || []).forEach((x) => q.push(x)); } return out; };
  const clip = (list, L) => list.filter((e) => e.at < L - 420).map((e) => (e.hold && e.at + e.dur + e.hold > L ? { ...e, hold: Math.max(0, L - e.at - e.dur - 40) } : e));

  /* ═════════ Timeouts & Retries ═════════ */
  LABS["timeouts-retries"] = {
    h: "Break it yourself",
    b: "Pick how the payment API misbehaves, then choose your defences. Fourteen checkouts arrive over seven seconds and share 8 worker threads. Watch the pool, the error count and how many calls hit the payment API.",
    controls: [
      { id: "api", label: "Payment API", opts: [["Hangs", "hang"], ["Slow (4.5 s)", "slow"], ["Flaky (503s)", "flaky"]], def: "hang" },
      { id: "timeout", label: "Read timeout", opts: [["None", 0], ["5 s", 5000], ["1 s", 1000]], def: 0 },
      { id: "retries", label: "Retries", opts: [["0", 0], ["2, with backoff", 2]], def: 0 },
      { id: "breaker", label: "Circuit breaker", opts: [["Off", 0], ["On", 1]], def: 0 },
    ],
    make(p) {
      const W = 8, L = 9200, N = 14, GAP = 520, out = [], reqs = [], states = [{ t: 0, st: "CLOSED" }];
      let fails = [], openUntil = -1, half = false, trialBusy = false, calls = 0;
      const busy = (t) => reqs.filter((r) => r.ws != null && r.ws <= t && (r.we == null || t < r.we)).length;
      const brState = (t) => (!p.breaker ? null : t < openUntil ? "OPEN" : half ? "HALF-OPEN" : "CLOSED");
      const setSt = (t, st) => { if (states[states.length - 1].st !== st) states.push({ t, st }); };
      const finish = (r, t, ok, msg) => {
        r.we = t; r.ok = ok; r.end = t + 400;
        out.push(ev("a", "client", ok ? "res" : "fail", t, 400, { log: msg, tone: ok ? "ok" : "warn" }));
      };
      const failed = (r, n, t, why) => {
        if (p.breaker) {
          fails = fails.filter((x) => x > t - 3000).concat(t);
          if (half || fails.length >= 3) { openUntil = t + 2600; half = false; trialBusy = false; setSt(t, "OPEN"); }
        }
        if (n < p.retries && brState(t) !== "OPEN") { const wait = 200 * 2 ** n + ((r.i * 37 + n * 53) % 90); r.waits.push([t, t + wait]); return [{ t: t + wait, run: (tt) => attempt(r, n + 1, tt) }]; }
        finish(r, t, false, `502 payment failed (${why})`); return [];
      };
      const attempt = (r, n, t) => {
        if (p.breaker && t >= openUntil && openUntil > 0 && !half && brState(t) === "CLOSED" && states[states.length - 1].st === "OPEN") { half = true; setSt(t, "HALF-OPEN"); }
        const st = brState(t);
        if (st === "OPEN" || (st === "HALF-OPEN" && trialBusy)) { finish(r, t, false, "503 CircuitBreakerError (instant)"); return []; }
        if (st === "HALF-OPEN") trialBusy = true;
        calls++; r.calls++;
        const tag = `POST /v1/charges${n ? `  retry ${n}` : ""}${p.timeout ? `  timeout=${p.timeout / 1000}` : ""}`;
        const arrive = t + 400;
        if (p.api === "hang" || (p.api === "slow" && p.timeout && p.timeout < 4500)) {
          if (!p.timeout) { out.push(ev("a", "b", "req", t, 400, { endAt: 0.9 - (r.i % 8) * 0.06, hold: L, end: "fade", log: tag })); r.we = Infinity; return []; }
          const h = t + p.timeout;
          out.push(ev("a", "b", "req", t, 400, { endAt: 0.86, hold: Math.max(0, h - arrive), end: "pop", popKind: "fail", log: tag, done: `ReadTimeout after ${fmtS(p.timeout)}` }));
          return [{ t: h, run: (tt) => failed(r, n, tt, "timeout") }];
        }
        const bad = p.api === "flaky" && (r.i * 7 + n * 3) % 10 < 6, o = p.api === "slow" ? t + 4500 : arrive + 120;
        out.push(ev("a", "b", "req", t, 400, { log: tag }));
        out.push(ev("b", "a", bad ? "fail" : "res", o, 400, { log: bad ? "503 Service Unavailable" : "200 OK", tone: bad ? "bad" : "ok" }));
        return [{ t: o + 400, run: (tt) => {
          if (bad) return failed(r, n, tt, "503");
          if (p.breaker && half) { half = false; trialBusy = false; fails = []; openUntil = -1; setSt(tt, "CLOSED"); }
          finish(r, tt, true, "201 Created"); return [];
        } }];
      };
      const seed = Array.from({ length: N }, (_, i) => {
        const r = { i, arr: i * GAP, ws: null, we: null, ok: null, calls: 0, waits: [] }; reqs.push(r);
        const e = ev("client", "a", "req", r.arr, 400, { log: "POST /checkout" }); out.push(e);
        return { t: r.arr + 400, run: (t) => {
          if (busy(t) >= W) { Object.assign(e, { k: "fail", endAt: 0.9, end: "pop", done: "503 · no free worker" }); r.ok = false; r.end = t; return []; }
          r.ws = t; return attempt(r, 0, t);
        } };
      });
      runQueue(seed);
      if (p.breaker && openUntil > 0 && states[states.length - 1].st === "OPEN") states.push({ t: openUntil, st: "HALF-OPEN" });
      const evs = clip(out, L);
      const done = reqs.filter((r) => r.ok !== null), okN = done.filter((r) => r.ok).length, errN = done.filter((r) => !r.ok).length, stuck = reqs.filter((r) => r.we === Infinity).length;
      const worst = Math.max(0, ...done.map((r) => r.end - r.arr)), peak = Math.max(...reqs.map((r) => (r.ws == null ? 0 : busy(r.ws + 1))));
      const verdict = stuck >= W ? "Every worker is stuck waiting. One hung dependency has taken checkout down: add a timeout."
        : p.breaker && p.api === "flaky" ? "The breaker keeps tripping on a dependency that is flaky but up. Breakers suit outages; for flakiness, tune the threshold and lean on retries."
        : p.api === "slow" && (!p.timeout || p.timeout >= 4500) && errN ? "Each checkout holds a worker for 4.5 s, so the pool fills and late shoppers get 503s even though nothing is broken."
        : p.retries && !p.breaker && p.api !== "slow" && errN > N / 2 ? "Retries tripled the calls to a dependency that is already failing. That is how retry storms start."
        : p.breaker && states.some((s) => s.st === "OPEN") ? "The breaker opens after repeated failures: callers fail fast and the payment API gets room to recover."
        : p.timeout && p.timeout < 4500 && p.api === "slow" ? "A timeout shorter than the dependency's normal latency fails every call. Base it on its p99."
        : errN === 0 ? "Healthy: every checkout succeeded." : "Timeouts keep the pool free; failures are fast and visible instead of hanging.";
      const stAt = (t) => states.filter((s) => s.t <= t).pop().st;
      return {
        t: "lab", s: "Try it", f: "client>a:req, a>b:req, b>a:res, a>client:res", a: "a b", L, ev: evs, gate: p.breaker ? "a>b" : undefined,
        k: verdict,
        setup: [["served", `${okN} of ${N} checkouts`, okN === N ? "hi" : ""], ["errors", `${errN}${stuck ? ` · ${stuck} still hanging` : ""}`, errN || stuck ? "bad" : ""], ["worst wait", stuck ? "forever" : fmtS(worst), stuck || worst > 5000 ? "bad" : ""], ["payment calls", `${calls} for ${N} checkouts`, calls > N * 1.5 ? "bad" : ""], ["workers used", `${Math.min(W, peak)} of ${W}`, peak >= W ? "bad" : ""]],
        code: `${p.breaker ? "breaker = pybreaker.CircuitBreaker(fail_max=3, reset_timeout=30)\n\n@breaker\n" : ""}${p.retries ? `@retry(stop=stop_after_attempt(${p.retries + 1}),\n       wait=wait_random_exponential(multiplier=0.2, max=2),\n       retry=retry_if_exception_type(TRANSIENT))\n` : ""}def charge(payload, key):\n    return requests.post(PAYMENT_URL, json=payload,${p.timeout ? ` timeout=(0.5, ${p.timeout / 1000}),` : "  # no timeout!"}\n                         headers={"Idempotency-Key": key})`,
        note: "The simulation runs your exact settings: 14 checkouts, 520 ms apart, 8 threads. Change one control at a time and compare the table.",
        fx(t, S) {
          const b = busy(t), okT = reqs.filter((r) => r.ok && r.end <= t).length, errT = reqs.filter((r) => r.ok === false && r.end <= t).length;
          const callsT = evs.filter((e) => e.f === "a" && e.t === "b" && e.at <= t).length;
          const hanging = reqs.filter((r) => r.we === Infinity && r.ws <= t).length;
          S.pool("a", Array.from({ length: W }, (_, i) => (i < hanging ? "stuck" : i < b ? "busy" : "idle")));
          S.metric("cpu", "Workers busy", `${b} / ${W}`, b >= W ? "bad" : b > W / 2 ? "warn" : "ok");
          S.metric("check", "Served", String(okT), okT ? "ok" : "");
          S.metric("x", "Errors", String(errT), errT ? "bad" : "");
          S.metric("repeat", "Payment calls", String(callsT), callsT > (t / GAP + 1) * 1.4 ? "warn" : "");
          if (p.breaker) { const st = stAt(t); S.gate(st); S.tag("mid", `breaker ${st}`, st === "OPEN" ? "bad" : st === "HALF-OPEN" ? "warn" : "ok", "shield"); }
          const w = reqs.find((r) => r.waits.some(([a, z]) => t >= a && t < z));
          S.tag("a", b >= W ? `pool exhausted ${b}/${W}` : w ? "backing off…" : `${b}/${W} workers busy`, b >= W ? "bad" : w ? "warn" : b ? "" : "ok", w ? "timer" : "cpu");
          S.tag("b", { hang: "hangs, never replies", slow: "replies in 4.5 s", flaky: "60% 503s" }[p.api], p.api === "slow" ? "warn" : "bad", p.api === "flaky" ? "x" : "hourglass");
          S.tag("client", errT ? `${errT} failed · ${okT} ok` : okT ? `${okT} ok` : "", errT ? "bad" : "ok", errT ? "x" : "check");
        },
      };
    },
  };

  /* ═════════ Rate limiting ═════════ */
  LABS["rate-limiting"] = {
    h: "Tune the limiter",
    b: "Choose how the client behaves and which algorithm guards the API. The API itself copes with about 5 requests per second; beyond that it starts failing for everyone.",
    controls: [
      { id: "client", label: "Client", opts: [["Steady 3/s", "steady"], ["Bursty", "burst"], ["Abusive 8/s", "abuse"]], def: "abuse" },
      { id: "algo", label: "Limiter", opts: [["Off", "off"], ["Fixed window", "fixed"], ["Token bucket", "bucket"]], def: "off" },
      { id: "rate", label: "Limit", opts: [["2 / s", 2], ["4 / s", 4]], def: 4 },
      { id: "burst", label: "Bucket size", opts: [["1", 1], ["4", 4]], def: 4 },
    ],
    make(p) {
      const L = 8400, CAP = 5;
      const arr = p.client === "steady" ? Array.from({ length: 22 }, (_, i) => 200 + i * 333)
        : p.client === "burst" ? [...Array.from({ length: 8 }, (_, i) => 700 + i * 70), ...Array.from({ length: 8 }, (_, i) => 3550 + i * 70)]
        : Array.from({ length: 52 }, (_, i) => 150 + i * 125);
      const out = [], dec = []; let tokens = p.burst, lastT = 0; const win = {}; const passed = [];
      arr.forEach((a) => {
        const t = a + 400; let ok = true, level = null;
        if (p.algo === "bucket") { tokens = Math.min(p.burst, tokens + ((t - lastT) / 1000) * p.rate); lastT = t; ok = tokens >= 1; if (ok) tokens -= 1; level = tokens; }
        else if (p.algo === "fixed") { const w = Math.floor(t / 1000); win[w] = win[w] || 0; ok = win[w] < p.rate; if (ok) win[w]++; level = win[w]; }
        const load = passed.filter((x) => x > t - 1000).length, over = ok && load >= CAP;
        if (ok) passed.push(t);
        dec.push({ t, ok, over, level });
        out.push(ev("client", "lim", "req", a, 400, { log: "GET /api/orders" }));
        if (!ok) out.push(ev("lim", "client", "fail", t, 420, { log: "429 Too Many Requests · Retry-After: 1", tone: "warn" }));
        else if (over) out.push(ev("lim", "api", "req", t, 400, { endAt: 0.86, end: "pop", popKind: "fail", log: "GET /api/orders", done: "500 · API overloaded" }));
        else { out.push(ev("lim", "api", "req", t, 400, { log: "GET /api/orders" })); out.push(ev("api", "client", "res", t + 500, 550, { log: "200 OK", tone: "ok" })); }
      });
      const evs = clip(out, L);
      const allowed = dec.filter((d) => d.ok && !d.over).length, rej = dec.filter((d) => !d.ok).length, broke = dec.filter((d) => d.over).length;
      const verdict = p.algo === "off" && broke ? "No limiter: one noisy client pushes the API past its capacity and real requests fail with 500s."
        : p.algo === "off" ? "Without a limiter this works only because the client is well behaved."
        : p.algo === "fixed" && p.client === "burst" ? "Fixed windows reset on the second boundary, so a burst can get up to 2× the limit through around it."
        : p.algo === "bucket" && p.burst > 1 && p.client === "burst" ? "The bucket absorbs a short burst up to its size, then holds the client to the refill rate."
        : rej ? "Excess requests get a cheap 429 with Retry-After; the API stays inside its capacity for everyone." : "Within the limit: nothing is rejected.";
      const levelAt = (t) => { const d = dec.filter((x) => x.t <= t).pop(); if (p.algo === "bucket") { const base = d ? d.level : p.burst, from = d ? d.t : 0; return Math.min(p.burst, base + ((t - from) / 1000) * p.rate); } if (p.algo === "fixed") { const w = Math.floor(t / 1000); return dec.filter((x) => Math.floor(x.t / 1000) === w && x.t <= t && x.ok).length; } return 0; };
      return {
        t: "lab", s: "Try it", f: "client>lim:req, lim>api:req, api>client:res, lim>client:fail, lim>redis:sync", a: "lim api", L, ev: evs, k: verdict,
        setup: [["requests sent", String(dec.length)], ["served", String(allowed), "hi"], ["rejected (429)", String(rej), rej ? "" : ""], ["broke the API (500)", String(broke), broke ? "bad" : ""]],
        code: p.algo === "bucket" ? `-- token bucket in Redis (atomic Lua)\nlocal tokens = tonumber(redis.call("HGET", KEYS[1], "t") or ${p.burst})\nlocal last   = tonumber(redis.call("HGET", KEYS[1], "ts") or ARGV[1])\ntokens = math.min(${p.burst}, tokens + (ARGV[1] - last) * ${p.rate} / 1000)\nif tokens < 1 then return 0 end\nredis.call("HSET", KEYS[1], "t", tokens - 1, "ts", ARGV[1])\nreturn 1`
          : p.algo === "fixed" ? `key = f"rl:{user_id}:{int(time.time())}"   # one counter per second\nn = r.incr(key)\nif n == 1:\n    r.expire(key, 2)\nif n > ${p.rate}:\n    return HttpResponse(status=429, headers={"Retry-After": "1"})` : "# no limiter: every request reaches the API",
        note: "The API is modelled with a capacity of 5 requests per second. Steady = 3/s, Bursty = two bursts of 8, Abusive = 8/s.",
        fx(t, S) {
          const done = dec.filter((d) => d.t <= t), lv = levelAt(t);
          S.metric("check", "Served", String(done.filter((d) => d.ok && !d.over).length), "ok");
          S.metric("x", "429s", String(done.filter((d) => !d.ok).length), done.some((d) => !d.ok) ? "warn" : "");
          S.metric("alert", "API errors", String(done.filter((d) => d.over).length), done.some((d) => d.over) ? "bad" : "");
          const load = passed.filter((x) => x <= t && x > t - 1000).length;
          S.metric("activity", "API load", `${load} / s`, load >= CAP ? "bad" : load >= CAP - 1 ? "warn" : "ok");
          if (p.algo === "bucket") S.tag("redis", `tokens ${lv.toFixed(1)} / ${p.burst}`, lv < 1 ? "bad" : "", "key", lv / p.burst);
          else if (p.algo === "fixed") S.tag("redis", `window ${Math.floor(t / 1000)}s: ${lv} / ${p.rate}`, lv >= p.rate ? "bad" : "", "timer", (t % 1000) / 1000);
          else S.tag("redis", "unused", "", "key");
          S.tag("api", load >= CAP ? `overloaded ${load}/s` : `${load} / s of ${CAP}`, load >= CAP ? "bad" : "ok", "activity");
          S.tag("lim", p.algo === "off" ? "pass-through" : p.algo === "fixed" ? `${p.rate} per second window` : `${p.rate}/s, burst ${p.burst}`, "", "shield");
        },
      };
    },
  };

  /* ═════════ Caching ═════════ */
  LABS["caching"] = {
    h: "Run the cache",
    b: "Reads for one hot product arrive every 350 ms and the query takes about 110 ms (slowed down ×10). At 4 s an admin changes the price. The cache starts warm. Turn the cache on, pick a TTL, and decide what happens on write and on expiry.",
    controls: [
      { id: "cache", label: "Cache", opts: [["Off", 0], ["Cache-aside", 1]], def: 1 },
      { id: "ttl", label: "TTL", opts: [["1.5 s", 1500], ["10 s", 10000]], def: 1500 },
      { id: "write", label: "On write", opts: [["Delete key", "del"], ["Do nothing", "none"]], def: "del" },
      { id: "lock", label: "On miss", opts: [["Everyone queries", 0], ["One fills (lock)", 1]], def: 0 },
    ],
    make(p) {
      const L = 9000, GAP = 350, DB = 1100, out = [], reads = [];
      let cached = null, filling = null, dbQ = 0; const dbIntervals = [], sets = p.cache ? [{ v: 1, set: -1, exp: p.ttl }] : [];
      const WRITE = 4000;
      out.push(ev("app", "db", "sync", WRITE, 400, { log: "UPDATE product SET price = 99 WHERE id = 42", tone: "warn" }));
      if (p.cache && p.write === "del") out.push(ev("app", "cache", "sync", WRITE + 500, 350, { log: "DEL product:42 (on_commit)" }));
      const invAt = WRITE + 850;
      for (let a = 150, i = 0; a < L - 1200; a += GAP, i++) {
        const r = { a, hit: false, stale: false, end: 0 }; reads.push(r);
        const vAt = (x) => (x >= WRITE + 400 ? 2 : 1);
        if (!p.cache) {
          out.push(ev("app", "db", "req", a, 400, { log: "SELECT … FROM product WHERE id = 42" })); dbQ++; dbIntervals.push([a + 400, a + 400 + DB]);
          out.push(ev("db", "app", "res", a + 400 + DB - 400, 400, { tone: "ok", log: `row v${vAt(a + 400)}` })); r.end = a + 400 + DB; continue;
        }
        const t = a + 350;
        cached = sets.filter((x) => x.set <= t && t < x.exp && !(p.cache && p.write === "del" && invAt > x.set && t >= invAt)).pop() || null;
        const valid = !!cached;
        out.push(ev("app", "cache", "req", a, 350, { log: "GET product:42" }));
        if (valid) {
          r.hit = true; r.stale = cached.v < vAt(t); r.end = t + 350;
          out.push(ev("cache", "app", "res", t, 350, { log: r.stale ? `HIT v${cached.v}  (stale, DB has v2)` : "HIT", tone: r.stale ? "bad" : "ok" }));
          continue;
        }
        out.push(ev("cache", "app", "sync", t, 350, { log: "MISS", tone: "warn" }));
        if (p.lock && filling && filling.start <= t && filling.done > t + 350) { r.end = filling.done; r.waited = true; continue; }
        const s = t + 350; dbQ++; dbIntervals.push([s + 400, s + 400 + DB]);
        out.push(ev("app", "db", "req", s, 400, { log: "SELECT … FROM product WHERE id = 42" }));
        out.push(ev("db", "app", "res", s + DB, 400, { log: `row v${vAt(s + 400)}`, tone: "ok" }));
        const done = s + DB + 400; r.end = done;
        out.push(ev("app", "cache", "sync", done, 350, { log: `SET product:42 ex=${p.ttl / 1000}` }));
        sets.push({ v: vAt(s + 400), set: done + 350, exp: done + 350 + p.ttl }); filling = { start: t, done: done + 350 };
      }
      const evs = clip(out, L);
      const hits = reads.filter((r) => r.hit).length, stale = reads.filter((r) => r.stale).length;
      const peakDb = Math.max(0, ...dbIntervals.map(([s]) => dbIntervals.filter(([x, y]) => x <= s && s < y).length));
      const avg = reads.reduce((s, r) => s + (r.end - r.a), 0) / reads.length;
      const verdict = !p.cache ? "Every read hits Postgres. Fine at this rate, but the database does the same work over and over."
        : stale && p.write === "none" ? "The write never reached the cache, so readers see the old price until the TTL runs out."
        : stale && p.ttl > 5000 ? "Deleting after the write still leaves a tiny window where a read sees the old row. That's why short TTLs back up invalidation."
        : peakDb >= 3 ? "When the key expires, every reader that misses queries the database at once: a small cache stampede."
        : p.lock && p.ttl < 2000 ? "With a lock, one request refills the key and the others wait a moment for it, so the DB sees one query per expiry."
        : p.ttl > 5000 ? "A long TTL gives a high hit ratio. Deleting on write keeps it correct." : "Short TTL: more misses, but stale data can't live long.";
      return {
        t: "lab", s: "Try it", f: p.cache ? "app>cache:req, cache>app:res, app>db:req, db>app:res" : "app>db:req, db>app:res", a: p.cache ? "cache db" : "db", L, ev: evs, k: verdict,
        setup: [["hit ratio", p.cache ? `${Math.round((hits / reads.length) * 100)}%` : "—", hits / reads.length > 0.7 ? "hi" : ""], ["DB queries", `${dbQ} for ${reads.length} reads`], ["peak parallel DB queries", String(peakDb), peakDb >= 3 ? "bad" : ""], ["stale reads", String(stale), stale ? "bad" : ""], ["avg read", `${Math.round(avg / 10)} ms (sim)`]],
        code: !p.cache ? "product = Product.objects.get(id=42)   # every request" : `def get_product(pid):\n    key = f"product:{pid}"\n    if (p := cache.get(key)) is not None:\n        return p\n${p.lock ? `    with cache.lock(f"lock:{key}", timeout=5):    # django-redis\n        if (p := cache.get(key)) is not None:\n            return p                          # someone else filled it\n        p = Product.objects.get(id=pid)\n` : "    p = Product.objects.get(id=pid)\n"}    cache.set(key, p, timeout=${Math.round(p.ttl / 1000) || 1})\n    return p${p.write === "del" ? "\n\ndef update_price(pid, price):\n    Product.objects.filter(id=pid).update(price=price)\n    transaction.on_commit(lambda: cache.delete(f\"product:{pid}\"))" : ""}`,
        note: "Times are slowed down ×10 so you can watch them; the 'avg read' number divides it back.",
        fx(t, S) {
          const done = reads.filter((r) => r.end <= t), h = done.filter((r) => r.hit).length;
          S.metric("zap", "Hit ratio", done.length && p.cache ? `${Math.round((h / done.length) * 100)}%` : "—", h / Math.max(1, done.length) > 0.6 ? "ok" : "warn");
          const q = dbIntervals.filter(([a]) => a <= t).length, now = dbIntervals.filter(([a, z]) => a <= t && t < z).length;
          S.metric("db", "DB queries", String(q), "");
          S.metric("alert", "Stale reads", String(done.filter((r) => r.stale).length), done.some((r) => r.stale) ? "bad" : "");
          S.tag("db", now >= 3 ? `${now} identical queries!` : now ? "querying…" : t > WRITE + 400 ? "price = 99 (v2)" : "price = 79 (v1)", now >= 3 ? "bad" : now ? "warn" : "", "db");
          if (p.cache) {
            const live = sets.filter((x) => x.set <= t).pop(), exp = live ? live.exp : 0, v = live ? live.v : 0;
            const deleted = live && p.write === "del" && invAt > live.set && t >= invAt;
            const has = live && !deleted && t < exp, st = has && v < (t > WRITE + 400 ? 2 : 1);
            S.tag("cache", !has ? "empty" : st ? `stale v${v} · ttl ${((exp - t) / 1000).toFixed(1)}s` : `v${v} · ttl ${((exp - t) / 1000).toFixed(1)}s`, !has ? "warn" : st ? "bad" : "ok", "zap", has ? (exp - t) / p.ttl : null);
          }
        },
      };
    },
  };

  /* ═════════ Django: connection pooling ═════════ */
  LABS["dj-conn-pooling"] = {
    h: "Do the connection maths",
    b: "Scale the deployment and see how many Postgres connections you need. Each connection costs Postgres roughly 10 MB and a process.",
    controls: [
      { id: "pods", label: "Pods", opts: [["2", 2], ["10", 10], ["20", 20]], def: 20 },
      { id: "per", label: "Workers × threads", opts: [["4 × 2", 8], ["9 × 4", 36]], def: 36 },
      { id: "pool", label: "Pooler", opts: [["None", 0], ["PgBouncer (40)", 40]], def: 0 },
      { id: "max", label: "max_connections", opts: [["100", 100], ["300", 300]], def: 100 },
    ],
    make(p) {
      const want = p.pods * p.per, server = p.pool ? Math.min(p.pool, p.max) : Math.min(want, p.max), rejected = p.pool ? 0 : Math.max(0, want - p.max);
      const L = 6800, K = 12, out = [], failFrac = rejected / want;
      for (let i = 0; i < K; i++) {
        const a = 200 + i * 420, bad = !p.pool && i >= Math.round(K * (1 - failFrac)) && failFrac > 0;
        if (p.pool) {
          out.push(ev("w", "pool", "req", a, 420, { log: `client conn #${Math.round(((i + 1) / K) * want)}` }));
          if (i % Math.max(1, Math.round(K * (p.pool / want) > 1 ? 1 : 3)) === 0) out.push(ev("pool", "db", "req", a + 450, 420, { log: "reuse server conn", tone: "ok" }));
        } else out.push(bad ? ev("w", "db", "fail", a, 650, { endAt: 0.86, end: "pop", log: "connect()", done: "FATAL: sorry, too many clients already" }) : ev("w", "db", "req", a, 650, { log: "connect()" }));
      }
      const mem = (server * 10) / 1000;
      const verdict = rejected ? `${want} threads each want a connection but Postgres allows ${p.max}: ${rejected} get "too many clients".`
        : p.pool ? `PgBouncer multiplexes ${want} client connections onto ${server} server connections. Keep transactions short so they are shared.`
        : `${want} connections fit, but Postgres pays for each one. Scale the pods and this breaks first.`;
      return {
        t: "lab", s: "Try it", f: p.pool ? "w>pool:req, pool>db:req" : "w>db:req", v: p.pool ? "w pool db" : "w db", a: rejected ? "db" : p.pool ? "pool" : "db", L, ev: out, k: verdict,
        setup: [["threads wanting a conn", `${p.pods} × ${p.per} = ${want}`], ["Postgres connections", `${server} of ${p.max}`, server >= p.max ? "bad" : "hi"], ["refused", String(rejected), rejected ? "bad" : ""], ["Postgres memory", `≈ ${mem.toFixed(1)} GB`]],
        code: p.pool ? `# settings.py — talk to PgBouncer (transaction mode)\nDATABASES["default"].update({\n    "HOST": "pgbouncer", "PORT": 6432,\n    "CONN_MAX_AGE": 0,\n    "DISABLE_SERVER_SIDE_CURSORS": True,\n})\n\n# pgbouncer.ini\npool_mode = transaction\ndefault_pool_size = ${p.pool}\nmax_client_conn = ${Math.max(1000, want)}` : `DATABASES["default"].update({\n    "CONN_MAX_AGE": 60,          # one persistent conn per thread\n    "CONN_HEALTH_CHECKS": True,\n})\n# ${p.pods} pods × ${p.per} threads = ${want} connections`,
        note: "Napkin rule: total connections = pods × processes × threads. Compare it with max_connections before you scale.",
        fx(t, S) {
          const f = Math.min(1, t / (L - 1200)), shown = Math.round(want * f), srv = Math.min(server, p.pool ? Math.max(1, Math.round(server * Math.min(1, f * 2))) : shown);
          S.metric("server", "Client conns", String(shown), "");
          S.metric("db", "Postgres conns", `${Math.min(srv, p.max)} / ${p.max}`, srv >= p.max ? "bad" : srv > p.max * 0.8 ? "warn" : "ok");
          S.metric("x", "Refused", String(Math.max(0, shown - p.max) * (p.pool ? 0 : 1)), !p.pool && shown > p.max ? "bad" : "");
          S.tag("db", `${Math.min(srv, p.max)} / ${p.max} connections`, srv >= p.max ? "bad" : "ok", "db", Math.min(1, srv / p.max));
          S.tag("w", `${p.pods} pods × ${p.per}`, "", "server");
          if (p.pool) S.tag("pool", `${shown} clients → ${srv} server`, "ok", "shield");
        },
      };
    },
  };
})();
