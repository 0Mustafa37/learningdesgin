/* Draw it yourself: sketch a design on a board, then check it against a rubric.
   window.DRAW.render(mainEl, asideEl, problemId) is called by the router for #/draw[/id]. */
(() => {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const KINDS = {
    client: ["Client", "laptop"], lb: ["Load balancer", "split"], server: ["API server", "server"], worker: ["Worker", "cog"],
    db: ["Database", "db"], cache: ["Cache", "zap"], queue: ["Queue", "steps"], edge: ["CDN", "globe"], blob: ["Object storage", "disk"], ext: ["3rd-party API", "cloud"],
  };
  const P = {
    laptop: "M4 6h16v10H4zM2 19h20", split: "M12 3v6M12 9l-7 7M12 9l7 7M5 16v5M19 16v5", server: "M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01",
    cog: "M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3", db: "M4 6c0-2 16-2 16 0v12c0 2-16 2-16 0zM4 6c0 2 16 2 16 0M4 12c0 2 16 2 16 0",
    zap: "M13 2L4 14h7l-1 8 9-12h-7z", steps: "M4 6h16M4 12h16M4 18h16", globe: "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20zM2 12h20M12 2c3 3 3 17 0 20M12 2c-3 3-3 17 0 20",
    disk: "M4 4h16v16H4zM8 4v6h8V4", cloud: "M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19 10a4 4 0 0 1 0 8z",
  };
  const ic = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="${P[n]}"/></svg>`;

  /* rubric: need = a unit of that kind; link = a connection between kinds (either direction); alt = other links that also count */
  const GENERAL = [{ no: ["client", "db"], why: "Clients never talk to the database directly: put an API in between for auth, validation and pooling." }];
  const PROBLEMS = [
    { id: "url-shortener", title: "URL shortener", lesson: "url-shortener", prompt: "Design bit.ly: create short links and redirect 4,000 reads per second for every 40 writes. Track clicks for analytics.",
      rules: [
        { need: "server", why: "An API turns short codes into redirects and creates new links." },
        { need: "db", why: "Mappings must be durable: code → long URL." },
        { link: ["client", "lb"], alt: [["client", "server"]], why: "Clients reach the API, ideally through a load balancer." },
        { need: "cache", why: "Reads outnumber writes 100:1, so hot codes belong in a cache." },
        { link: ["server", "cache"], why: "The API checks the cache before the database (cache-aside)." },
        { link: ["server", "db"], why: "Misses and new links go to the database." },
        { need: "queue", bonus: true, why: "Click events go on a queue so analytics never slows a redirect." },
      ] },
    { id: "news-feed", title: "News feed", lesson: "news-feed", prompt: "Design a social feed: users post, followers see new posts in their feed within seconds. Reads dominate.",
      rules: [
        { need: "lb", why: "Many stateless API servers behind a load balancer." },
        { need: "server", why: "API servers handle posts and feed reads." },
        { need: "db", why: "Posts and the follow graph need durable storage." },
        { need: "queue", why: "Fan-out to followers is slow work: enqueue it instead of doing it in the request." },
        { need: "worker", why: "Workers consume the fan-out jobs." },
        { link: ["queue", "worker"], why: "Workers read from the queue." },
        { need: "cache", why: "Precomputed feeds live in a cache (e.g. Redis lists) for fast reads." },
        { link: ["worker", "cache"], why: "Workers push new post ids into each follower's cached feed." },
        { need: "edge", bonus: true, why: "Images and video come from a CDN, not your servers." },
      ] },
    { id: "chat-system", title: "Chat system", lesson: "chat-system", prompt: "Design 1:1 and group chat with online delivery in under a second and history that survives restarts.",
      rules: [
        { need: "lb", why: "A load balancer that supports long-lived WebSocket connections." },
        { need: "server", why: "Gateway servers hold the WebSocket connections." },
        { need: "queue", why: "Servers need pub/sub to reach users connected to a different server." },
        { link: ["server", "queue"], why: "Each gateway publishes and subscribes to message channels." },
        { need: "db", why: "Messages are stored for history and offline delivery." },
        { link: ["server", "db"], alt: [["worker", "db"]], why: "Messages are written to storage (directly or by a worker)." },
        { need: "cache", bonus: true, why: "Presence (who is online, on which server) usually lives in Redis." },
      ] },
    { id: "receipts", title: "Send receipt emails", lesson: "message-queues", prompt: "After checkout, email a PDF receipt. Rendering takes 3–6 s and the email provider sometimes fails.",
      rules: [
        { need: "server", why: "The checkout API." },
        { need: "queue", why: "The request enqueues a job and returns at once instead of rendering for 6 s." },
        { link: ["server", "queue"], why: "Checkout puts the job on the queue." },
        { need: "worker", why: "A worker renders the PDF and sends the email." },
        { link: ["queue", "worker"], why: "Workers consume jobs and retry on failure." },
        { need: "ext", why: "The email provider is a third-party API." },
        { link: ["worker", "ext"], why: "Only the worker calls the email provider, with a timeout and retries." },
        { no: ["server", "ext"], why: "Calling the email provider inside the checkout request makes checkout as slow and flaky as the provider." },
      ] },
    { id: "photo-upload", title: "Photo uploads", lesson: "files-media", prompt: "Users upload photos up to 20 MB and view thumbnails worldwide.",
      rules: [
        { need: "server", why: "The API authorises uploads and stores metadata." },
        { need: "blob", why: "Files go to object storage (S3/GCS), not the database or the API disk." },
        { link: ["client", "blob"], why: "Clients upload straight to object storage with a presigned URL, so 20 MB doesn't pass through your API." },
        { need: "db", why: "Metadata (owner, key, size, status) lives in the database." },
        { need: "edge", why: "A CDN serves images close to the viewer." },
        { link: ["edge", "blob"], why: "The CDN pulls from object storage." },
        { need: "worker", bonus: true, why: "A worker makes thumbnails when an upload finishes (triggered by a queue/event)." },
      ] },
    { id: "rate-limiter", title: "API rate limiter", lesson: "rate-limiting", prompt: "Limit each API key to 100 requests per minute across 20 API servers, and tell clients when to retry.",
      rules: [
        { need: "lb", why: "Limit at the edge (API gateway / load balancer) so rejected traffic never reaches your app servers." },
        { need: "cache", why: "Counters live in a shared, fast store (Redis) so all 20 servers see the same count." },
        { link: ["lb", "cache"], alt: [["server", "cache"]], why: "Whoever enforces the limit does an atomic INCR (or token-bucket Lua script) per request." },
        { link: ["lb", "server"], why: "Allowed requests continue to the API servers." },
        { no: ["client", "server"], why: "A path from clients straight to the servers bypasses the limiter." },
        { need: "server", why: "The API itself." },
      ] },
    { id: "notifications", title: "Notification service", lesson: "pub-sub", prompt: "Send push, email and SMS for events from many services. Respect user preferences, retry failures, never double-send.",
      rules: [
        { need: "server", why: "A notification API that other services call (or that consumes their events)." },
        { need: "queue", why: "Every notification goes through a queue so spikes and provider outages don't block callers." },
        { link: ["server", "queue"], why: "The API validates, applies preferences, then enqueues." },
        { need: "worker", why: "Channel workers (push, email, SMS) drain the queue." },
        { link: ["queue", "worker"], why: "Workers consume, retry with backoff and dead-letter poison messages." },
        { need: "ext", why: "APNs/FCM, an email provider and an SMS gateway are third parties." },
        { link: ["worker", "ext"], why: "Only workers talk to providers." },
        { need: "db", why: "Preferences, templates and a sent-log (idempotency keys) so retries never double-send." },
        { need: "cache", bonus: true, why: "Per-user rate limits and dedupe keys in Redis." },
        { no: ["server", "ext"], why: "Calling providers inline makes every caller wait for (and fail with) the slowest provider." },
      ] },
    { id: "ride-tracking", title: "Live ride tracking", lesson: "live-tracking-design", prompt: "Drivers send GPS every 4 s; riders watch the car move live. 200k active drivers at peak.",
      rules: [
        { need: "lb", why: "Many ingest servers behind a balancer that supports WebSockets." },
        { need: "server", why: "Ingest/gateway servers receive locations and push updates to riders." },
        { need: "cache", why: "The latest position per driver (and a geo index) lives in memory, e.g. Redis GEO." },
        { link: ["server", "cache"], why: "Each update overwrites the driver's latest position; riders read from there." },
        { need: "queue", why: "A stream (Kafka) carries every point for history, ETA models and analytics." },
        { link: ["server", "queue"], why: "Ingest publishes every point once." },
        { need: "db", why: "Trip history in durable storage, written in batches." },
        { link: ["worker", "db"], alt: [["queue", "db"]], why: "Consumers batch-write points; the hot path never waits on the database." },
        { no: ["server", "db"], why: "Writing 50k points/s straight to the database from the request path is the classic bottleneck." },
      ] },
    { id: "file-sync", title: "File sync (Dropbox)", lesson: "files-media", prompt: "Sync folders across a user's devices. Files up to 10 GB; only changed parts should upload.",
      rules: [
        { need: "client", why: "Desktop/mobile clients that chunk files and hash chunks." },
        { need: "blob", why: "Chunks live in object storage, addressed by their hash (dedupe for free)." },
        { link: ["client", "blob"], why: "Clients upload changed chunks directly with presigned URLs." },
        { need: "server", why: "A metadata service: files, versions, which chunks make each version." },
        { need: "db", why: "Metadata in a transactional database." },
        { link: ["server", "db"], why: "Commits a new version only after all its chunks exist." },
        { need: "queue", why: "Change notifications (or long-poll) tell other devices to pull." },
        { link: ["server", "queue"], why: "Each committed version emits an event." },
        { no: ["client", "db"], why: "Clients never write metadata directly." },
      ] },
  ];
  const MODELS = {    "url-shortener": { units: [["client", 10, 230], ["lb", 190, 230], ["server", 370, 230], ["cache", 600, 90], ["db", 600, 230], ["queue", 600, 380], ["worker", 740, 460]], links: [[0, 1], [1, 2], [2, 3], [2, 4], [2, 5], [5, 6]] },
    "news-feed": { units: [["client", 10, 230], ["edge", 10, 60], ["lb", 190, 230], ["server", 370, 230], ["db", 600, 100], ["cache", 600, 230], ["queue", 370, 400], ["worker", 600, 400]], links: [[0, 1], [0, 2], [2, 3], [3, 4], [3, 5], [3, 6], [6, 7], [7, 5], [7, 4]] },
    "chat-system": { units: [["client", 10, 230], ["lb", 190, 230], ["server", 380, 120], ["server", 380, 340], ["queue", 620, 230], ["db", 620, 420], ["cache", 620, 40]], links: [[0, 1], [1, 2], [1, 3], [2, 4], [3, 4], [2, 5], [3, 5], [2, 6], [3, 6]] },
    "receipts": { units: [["client", 10, 230], ["server", 210, 230], ["db", 210, 400], ["queue", 420, 230], ["worker", 620, 230], ["ext", 620, 400], ["blob", 620, 60]], links: [[0, 1], [1, 2], [1, 3], [3, 4], [4, 5], [4, 6]] },
    "photo-upload": { units: [["client", 10, 230], ["server", 240, 100], ["db", 480, 40], ["blob", 300, 330], ["edge", 40, 440], ["queue", 540, 330], ["worker", 720, 200]], links: [[0, 1], [1, 2], [0, 3], [4, 3], [0, 4], [3, 5], [5, 6], [6, 3], [6, 2]] },
    "rate-limiter": { units: [["client", 10, 230], ["lb", 230, 230], ["cache", 230, 420], ["server", 470, 120], ["server", 470, 340]], links: [[0, 1], [1, 2], [1, 3], [1, 4]] },
    "notifications": { units: [["server", 10, 230], ["db", 10, 420], ["queue", 230, 230], ["worker", 450, 120], ["worker", 450, 340], ["ext", 700, 230], ["cache", 450, 470]], links: [[0, 1], [0, 2], [2, 3], [2, 4], [3, 5], [4, 5], [3, 6], [4, 6]] },
    "ride-tracking": { units: [["client", 10, 230], ["lb", 190, 230], ["server", 370, 230], ["cache", 600, 90], ["queue", 600, 260], ["worker", 600, 430], ["db", 280, 430]], links: [[0, 1], [1, 2], [2, 3], [2, 4], [4, 5], [5, 6]] },
    "file-sync": { units: [["client", 10, 120], ["client", 10, 360], ["server", 300, 230], ["db", 560, 120], ["blob", 300, 440], ["queue", 560, 340]], links: [[0, 2], [1, 2], [2, 3], [0, 4], [1, 4], [2, 5], [5, 1]] }
  };

  const KEY = "atlas-draw-v1";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (_) { return {}; } };
  let saved = load(), cur = null, board = null, sel = null, drag = null, linking = null, result = null, showModel = false;
  const save = () => { saved[cur.id] = board; try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (_) {} };
  const W = 900, H = 520, UW = 156, UH = 54;
  /* phones get a tall board: positions are stored landscape and transposed for display */
  let tall = false;
  const VW = () => (tall ? 430 : W), VH = () => (tall ? 760 : H);
  const scr = (u) => (tall ? [(u.y / (H - UH)) * (VW() - UW), (u.x / (W - UW)) * (VH() - UH)] : [u.x, u.y]);
  const fromScr = (sx, sy) => (tall ? [(sy / (VH() - UH)) * (W - UW), (sx / (VW() - UW)) * (H - UH)] : [sx, sy]);

  const has = (k) => board.units.some((u) => u.k === k);
  const linked = ([a, b]) => board.links.some(([x, y]) => { const ka = unit(x)?.k, kb = unit(y)?.k; return (ka === a && kb === b) || (ka === b && kb === a); });
  const unit = (id) => board.units.find((u) => u.id === id);
  const grade = () => {
    const rows = cur.rules.concat(GENERAL).map((r) => {
      if (r.need) return { ok: has(r.need), bonus: r.bonus, text: `${KINDS[r.need][0]}`, why: r.why };
      if (r.link) return { ok: linked(r.link) || (r.alt || []).some(linked), text: `${KINDS[r.link[0]][0]} ↔ ${KINDS[r.link[1]][0]}`, why: r.why };
      return { ok: !linked(r.no), avoid: true, text: `no ${KINDS[r.no[0]][0]} ↔ ${KINDS[r.no[1]][0]}`, why: r.why };
    });
    const core = rows.filter((r) => !r.bonus && !r.avoid), got = core.filter((r) => r.ok).length;
    return { rows, got, total: core.length, bad: rows.filter((r) => r.avoid && !r.ok).length };
  };

  const modelBoard = () => { const m = MODELS[cur.id]; return m ? { units: m.units.map(([k, x, y], i) => ({ id: "m" + i, k, x, y })), links: m.links.map(([a, b]) => ["m" + a, "m" + b]) } : null; };
  const svgBoard = () => {
    if (showModel && modelBoard()) { const mine = board; board = modelBoard(); const html = svgBoardInner(true); board = mine; return html; }
    return svgBoardInner(false);
  };
  const svgBoardInner = (model) => {
    const pos = (id) => { const u = unit(id); if (!u) return null; const [x, y] = scr(u); return [x + UW / 2, y + UH / 2]; };
    const links = board.links.map(([a, b], i) => { const p = pos(a), q = pos(b); if (!p || !q) return ""; return `<g class="dl ${sel === "l" + i ? "sel" : ""}" data-l="${i}"><line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" class="dl-hit"/><line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" class="dl-pipe"/></g>`; }).join("");
    const units = board.units.map((u) => `<g class="du k-${u.k} ${sel === u.id ? "sel" : ""} ${linking && linking.from === u.id ? "src" : ""}" data-u="${u.id}" transform="translate(${scr(u).join(",")})" tabindex="0" role="button" aria-label="${esc(KINDS[u.k][0])}">
        <rect width="${UW}" height="${UH}" rx="12" class="du-body"/><g transform="translate(12,15) scale(1)">${ic(KINDS[u.k][1]).replace('<svg class="i"', '<svg width="24" height="24"')}</g>
        <text x="44" y="${UH / 2 + 5}">${esc(KINDS[u.k][0])}</text><circle class="du-port" cx="${UW}" cy="${UH / 2}" r="7" data-port="${u.id}"/></g>`).join("");
    const ghost = linking && linking.x != null ? (() => { const p = pos(linking.from); return `<line class="dl-ghost" x1="${p[0]}" y1="${p[1]}" x2="${linking.x}" y2="${linking.y}"/>`; })() : "";
    return `<svg class="draw-svg ${model ? "is-model" : ""}" viewBox="0 0 ${VW()} ${VH()}" preserveAspectRatio="xMidYMid meet">${links}${ghost}${units}${board.units.length ? "" : `<text x="${VW() / 2}" y="${VH() / 2}" class="draw-empty">${tall ? "Add parts below, then drag from a dot to connect." : "Add parts from the palette, then drag from a unit's dot to connect it."}</text>`}</svg>`;
  };

  let mainEl, asideEl;
  const paint = () => { const b = mainEl.querySelector(".draw-board"); if (b) b.innerHTML = svgBoard(); };
  const toSvg = (e) => { const s = mainEl.querySelector(".draw-svg"), r = s.getBoundingClientRect(), k = Math.min(r.width / VW(), r.height / VH()), ox = (r.width - VW() * k) / 2, oy = (r.height - VH() * k) / 2; return [(e.clientX - r.left - ox) / k, (e.clientY - r.top - oy) / k]; };
  const hitUnit = (x, y) => board.units.slice().reverse().find((u) => { const [ux, uy] = scr(u); return x >= ux && x <= ux + UW && y >= uy && y <= uy + UH; });

  const add = (k) => {
    const n = board.units.length, cols = tall ? 2 : 5, gx = tall ? VW() - UW - 20 : 172, gy = tall ? 92 : 110;
    let x = 10 + (n % cols) * gx, y = 24 + Math.floor(n / cols) * gy;
    while (board.units.some((u) => { const [ux, uy] = scr(u); return Math.abs(ux - x) < 70 && Math.abs(uy - y) < 44; })) { x += 22; y += 30; }
    const [bx, by] = fromScr(Math.min(VW() - UW - 6, x), Math.min(VH() - UH - 6, y));
    board.units.push({ id: "u" + Date.now().toString(36) + n, k, x: bx, y: by });
    result = null; save(); renderAll();
  };
  const remove = () => {
    if (!sel) return;
    if (sel[0] === "l") board.links.splice(Number(sel.slice(1)), 1);
    else { board.units = board.units.filter((u) => u.id !== sel); board.links = board.links.filter(([a, b]) => a !== sel && b !== sel); }
    sel = null; result = null; save(); renderAll();
  };

  const asideHtml = () => {
    const r = result;
    return `<section class="card panel draw-panel">
      <div class="panel-top"><span>DRAW IT YOURSELF</span><span class="tag case">${esc(cur.title)}</span></div>
      <h2>${esc(cur.title)}</h2><p>${esc(cur.prompt)}</p>
      <div class="sec">PARTS</div>
      <div class="palette">${Object.entries(KINDS).map(([k, [lbl, i]]) => `<button class="btn pal k-${k}" data-add="${k}">${ic(i)}${esc(lbl)}</button>`).join("")}</div>
      <p class="hint">Drag a unit to move it. Drag from its dot to another unit to connect them. Select and press <kbd>Delete</kbd> to remove.</p>
      <div class="nav-row"><button class="btn" id="drClear">Clear board</button><button class="btn btn-primary" id="drCheck">Check my design</button></div>
      ${r ? `<div class="sec">REVIEW · ${r.got} / ${r.total} core points${r.bad ? ` · ${r.bad} red flag` : ""}</div>
        <ul class="draw-review">${r.rows.map((x) => `<li class="${x.ok ? "ok" : x.avoid ? "bad" : x.bonus ? "bonus" : "miss"}"><b>${x.ok ? "✓" : x.avoid ? "✕" : x.bonus ? "+" : "○"} ${esc(x.text)}${x.bonus ? " (bonus)" : ""}</b><span>${esc(x.why)}</span></li>`).join("")}</ul>
        <div class="nav-row"><button class="btn" id="drModel">${showModel ? "Hide" : "Show"} model answer</button><a class="btn" href="#/lesson/${cur.lesson}">Open the lesson →</a></div>` : `<button class="btn link-btn" id="drModel">${showModel ? "Hide" : "Peek at"} model answer</button>`}
    </section>
    <section class="card panel"><div class="panel-top"><span>OTHER PROBLEMS</span></div>
      <ul class="draw-list">${PROBLEMS.map((p) => `<li><a class="${p.id === cur.id ? "on" : ""}" href="#/draw/${p.id}">${esc(p.title)}</a>${saved[p.id] && saved[p.id].units.length ? `<small>${saved[p.id].units.length} parts</small>` : ""}</li>`).join("")}</ul></section>`;
  };

  const renderAll = () => {
    mainEl.innerHTML = `<section class="card stage draw-stage">
        <div class="crumbs">Practice / Draw it yourself</div>
        <div class="title-row"><h1>${esc(cur.title)}</h1><div class="badges"><a class="badge b-violet" href="#/practice">Timed practice</a></div></div>
        <p class="subtitle">${esc(cur.prompt)}</p>
        ${showModel ? `<p class="model-note">Model answer. One good design, not the only one. <button class="btn" id="drMine">Back to my design</button></p>` : ""}
        <div class="draw-board" tabindex="0" aria-label="Design board" style="aspect-ratio:${VW()} / ${VH()}">${svgBoard()}</div>
      </section>`;
    asideEl.innerHTML = asideHtml();
    asideEl.querySelectorAll("[data-add]").forEach((b) => (b.onclick = () => add(b.dataset.add)));
    asideEl.querySelector("#drClear").onclick = () => { board = { units: [], links: [] }; sel = null; result = null; save(); renderAll(); };
    asideEl.querySelector("#drCheck").onclick = () => { result = grade(); renderAll(); asideEl.querySelector(".draw-review")?.scrollIntoView({ block: "nearest", behavior: "smooth" }); };
    asideEl.querySelector("#drModel")?.addEventListener("click", () => { showModel = !showModel; sel = null; renderAll(); });
    mainEl.querySelector("#drMine")?.addEventListener("click", () => { showModel = false; renderAll(); });
    const bd = mainEl.querySelector(".draw-board");
    if (showModel) return;
    bd.onpointerdown = (e) => {
      const [x, y] = toSvg(e), port = e.target.closest("[data-port]");
      if (port) { linking = { from: port.dataset.port, x, y }; bd.setPointerCapture(e.pointerId); return; }
      const lg = e.target.closest("[data-l]");
      if (lg) { sel = "l" + lg.dataset.l; paint(); return; }
      const u = hitUnit(x, y);
      sel = u ? u.id : null;
      if (u) { const [ux, uy] = scr(u); drag = { u, dx: x - ux, dy: y - uy, moved: false }; bd.setPointerCapture(e.pointerId); }
      paint();
    };
    bd.onpointermove = (e) => {
      const [x, y] = toSvg(e);
      if (linking) { linking.x = x; linking.y = y; paint(); return; }
      if (drag) { const [bx, by] = fromScr(Math.max(0, Math.min(VW() - UW, x - drag.dx)), Math.max(0, Math.min(VH() - UH, y - drag.dy))); drag.u.x = bx; drag.u.y = by; drag.moved = true; paint(); }
    };
    bd.onpointerup = (e) => {
      if (linking) {
        const [x, y] = toSvg(e), u = hitUnit(x, y);
        if (u && u.id !== linking.from && !board.links.some(([a, b]) => (a === linking.from && b === u.id) || (b === linking.from && a === u.id))) { board.links.push([linking.from, u.id]); result = null; }
        linking = null; save(); renderAll(); return;
      }
      if (drag) { if (drag.moved) save(); drag = null; }
    };
  };

  window.DRAW = {
    problems: PROBLEMS,
    /* used by tests: grade the model answer against its own rubric */
    checkModel(id) { cur = PROBLEMS.find((p) => p.id === id); const keep = board; board = modelBoard(); const r = grade(); board = keep; return r; },
    render(main, aside, id) {
      mainEl = main; asideEl = aside; tall = innerWidth < 640;
      cur = PROBLEMS.find((p) => p.id === id) || PROBLEMS[0];
      saved = load(); board = saved[cur.id] || { units: [], links: [] }; sel = null; result = null; linking = null; showModel = false;
      renderAll();
    },
  };
  document.addEventListener("keydown", (e) => { if (!mainEl || !location.hash.startsWith("#/draw") || !sel) return; if ((e.key === "Delete" || e.key === "Backspace") && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) { e.preventDefault(); remove(); } });
})();
