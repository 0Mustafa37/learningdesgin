/* Opening steps that used to start on a near-empty stage: show the whole system and play the problem. */
(() => {
  const open = (id, patch) => { const l = window.LESSONS[id]; if (!l) return; const s = l.steps[0]; ["flows", "show", "active"].forEach((k) => delete s[k]); Object.assign(s, patch); };
  const ev = (f, t, k, at, dur, o = {}) => ({ f, t, k, at, dur, ...o });
  const sec = (ms) => `${(ms / 1000).toFixed(1)} s`;

  /* Anatomy of a request: one slow page load, every hop in sequence */
  const hops = [["browser", "dns", "req", "DNS lookup app.example", 0, 500], ["dns", "browser", "res", "A 203.0.113.7", 600, 450], ["browser", "server", "req", "TCP + TLS handshake", 1150, 600], ["browser", "server", "req", "GET /dashboard", 1850, 550], ["server", "db", "req", "SELECT … (12 queries)", 2450, 500], ["db", "server", "res", "rows", 3500, 450], ["server", "browser", "res", "200 OK  HTML", 4050, 600], ["browser", "cdn", "req", "GET app.js, styles.css", 4750, 450], ["cdn", "browser", "res", "assets", 5300, 500]];
  open("anatomy-of-a-request", {
    f: "browser>dns:req, dns>browser:res, browser>server:req, server>db:req, db>server:res, server>browser:res, browser>cdn:req, cdn>browser:res",
    a: "browser", L: 7000,
    ev: hops.map(([f, t, k, log, at, dur]) => ev(f, t, k, at, dur, { log })),
    fx(t, S) {
      const ms = Math.min(t, 5800) / 5800 * 1900, done = t >= 5800;
      S.metric("timer", "Page ready", done ? "1.9 s" : sec(ms), done ? "bad" : "warn");
      S.metric("activity", "Hops", String(hops.filter((h) => h[4] <= t).length), "");
      S.tag("browser", done ? "usable after 1.9 s" : `waiting… ${sec(ms)}`, done ? "bad" : "warn", "hourglass");
      S.tag("server", "where does the time go?", "", "clock");
    },
  });

  /* Message queues: a 6 s PDF render inside the request holds the web worker */
  open("message-queues", {
    v: "web queue w1 w2", a: "web", f: "web>web:fail", L: 6800,
    fx(t, S) {
      const ms = Math.min(t, 6200);
      S.metric("timer", "Response", sec(ms), ms > 2000 ? "bad" : "warn");
      S.metric("cpu", "Web workers busy", `${Math.min(4, 1 + Math.floor(t / 1500))} / 4`, t > 4500 ? "bad" : "warn");
      S.pool("web", Array.from({ length: 4 }, (_, i) => (i <= Math.floor(t / 1500) ? "busy" : "idle")));
      S.tag("web", `rendering PDF… ${sec(ms)}`, "bad", "hourglass", ms / 6200);
      S.tag("queue", "unused", "", "steps");
    },
  });

  /* Sagas: no shared transaction, so one failure leaves the others half-done */
  open("sagas", {
    f: "orch>pay:req, pay>orch:res, orch>inv:req, inv>orch:res, orch>ship:req", a: "orch ship", L: 6200,
    ev: [ev("orch", "pay", "req", 0, 600, { log: "charge card  $40" }), ev("pay", "orch", "res", 750, 600, { log: "charged ✓", tone: "ok" }),
      ev("orch", "inv", "req", 1500, 600, { log: "reserve 1 × SKU-12" }), ev("inv", "orch", "res", 2250, 600, { log: "reserved ✓", tone: "ok" }),
      ev("orch", "ship", "fail", 3000, 600, { endAt: 0.86, end: "pop", log: "book courier", done: "500 courier API down" })],
    fx(t, S) {
      S.tag("pay", t > 1350 ? "card charged" : "", "ok", "check");
      S.tag("inv", t > 2850 ? "stock reserved" : "", "ok", "check");
      S.tag("ship", t > 3600 ? "failed" : "", "bad", "x");
      S.tag("orch", t > 3600 ? "half done: now what?" : "3 services, 3 databases", t > 3600 ? "bad" : "", t > 3600 ? "alert" : "db");
      S.metric("db", "Shared transaction", "none", "bad");
      S.metric("check", "Steps done", `${t > 2850 ? 2 : t > 1350 ? 1 : 0} / 3`, t > 3600 ? "bad" : "");
    },
  });

  /* HLD: before drawing, every box has an open question */
  open("hld-lld", {
    v: "client lb app cache db queue", a: "client", L: 5200,
    fx(t, S) {
      const q = [["client", "who? how many? which features?", "user"], ["db", "how much data? growth?", "db"], ["cache", "read : write ratio?", "zap"], ["queue", "what can be async?", "steps"]];
      q.forEach(([id, txt, ic], i) => S.tag(id, t > i * 650 ? txt : "", "warn", ic));
      S.metric("list", "Open questions", String(q.filter((_, i) => t > i * 650).length), "warn");
    },
  });

  /* URL shortener: show the read/write imbalance from the first second */
  open("url-shortener", {
    f: "client>app:req, app>db:req, db>app:res, app>client:res", L: 6000,
    ev: Array.from({ length: 10 }, (_, i) => i).flatMap((i) => i === 4
      ? [ev("client", "app", "sync", i * 480, 420, { log: "POST /shorten  (write)" }), ev("app", "db", "sync", i * 480 + 450, 420, { log: "INSERT mapping" })]
      : [ev("client", "app", "req", i * 480, 420, { log: "GET /aZ3kQ9  (read)" }), ev("app", "db", "req", i * 480 + 450, 420, { log: "SELECT long_url" }), ev("db", "app", "res", i * 480 + 900, 400, { log: "→ 301 redirect", tone: "ok" })]),
    fx(t, S) {
      const n = Math.min(10, Math.floor(t / 480) + 1);
      S.tag("app", `${n - (n > 4 ? 1 : 0)} reads · ${n > 4 ? 1 : 0} write`, "", "activity");
      S.tag("db", "every read hits the DB", "warn", "db");
    },
  });
})();
