(() => {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const strip = (s) => String(s).replace(/<[^>]+>/g, "");

  /* ───────── data normalisation ───────── */
  const CATS = window.DJANGO_CATEGORIES;
  const QS = window.DJANGO_QUESTIONS;
  const SCENES = window.DJANGO_SCENES || {};
  const DJ_REFS = window.DJANGO_REFS || {};

  const guessKind = (id) => {
    if (/^(users?|clients|prod|dev|oncall)$/.test(id)) return "user";
    if (/browser|client|user|alice|bob|poster|reader|dash/.test(id)) return "client";
    if (/db|primary|replica|^r\d$|^s\d$|shard|store|sql|doc|wide|idx|btree|lsm|blob/.test(id)) return "db";
    if (/cache|redis|kv/.test(id)) return "cache";
    if (/queue|bus|topic|broker|wal|log|src|dlq|buf/.test(id)) return "queue";
    if (/^lb$|router|gateway|api$|limiter|lim|reg$|policy/.test(id)) return "lb";
    if (/cdn|edge/.test(id)) return "edge";
    if (/dns|ext|psp|idp|kms|email|third/.test(id)) return "ext";
    if (/worker|^w\d$|^c\d$|consumer|job|relay|fan|batch|stream|unit|integ|e2e|ci/.test(id)) return "worker";
    return "server";
  };
  const parseFlows = (s) => s.split(",").map((t) => t.trim()).filter(Boolean).map((t) => {
    const [ab, kind = "req"] = t.split(":");
    const [a, b] = ab.split(">");
    return [a.trim(), b.trim(), kind.trim()];
  });
  const words = (s) => (typeof s === "string" ? s.split(/\s+/).filter(Boolean) : s);
  const normStep = (s) => ({
    tag: s.t || s.tag || "concept",
    short: s.s || s.short,
    title: s.h || s.title,
    body: Array.isArray(s.body) ? s.body : String(s.b || "").split(/\n\n/),
    key: s.k || s.key || "",
    flows: typeof s.f === "string" ? parseFlows(s.f) : s.flows || [],
    active: words(s.a ?? s.active ?? []),
    show: s.v || s.show ? words(s.v || s.show) : null,
    metrics: s.m || s.metrics || {},
  });
  const normLesson = (l, extra = {}) => ({
    id: l.id,
    title: l.title,
    subtitle: l.sub || l.subtitle || "",
    level: l.level || "Intermediate",
    minutes: l.min || l.minutes || 6,
    learn: l.learn || [],
    deep: l.deep || [],
    iv: l.iv || [],
    refs: l.refs || [],
    metricKeys: l.mk || l.metricKeys || [],
    nodes: l.nodes.map((n) => ({ ...n, kind: n.kind || guessKind(n.id) })),
    steps: l.steps.map(normStep),
    ...extra,
  });

  const djGreens = ["#0c4b33", "#2f6f4f", "#44805c", "#1f5e46", "#3d7a5a", "#2a6650", "#4f8a68", "#185440", "#36704f", "#24604a"];
  const TRACKS = [
    ...window.TRACKS,
    {
      id: "dj",
      title: "Senior Django",
      modules: CATS.map((c, i) => ({ id: "dj-" + c.id, title: c.title, color: djGreens[i % djGreens.length], lessons: QS.filter((q) => q.cat === c.id && SCENES[q.id]).map((q) => "dj-" + q.id) })),
    },
  ];
  const LESSON = {};
  Object.values(window.LESSONS).forEach((l) => (LESSON[l.id] = normLesson(l)));
  QS.forEach((q) => {
    const sc = SCENES[q.id];
    if (!sc) return;
    LESSON["dj-" + q.id] = normLesson({ id: "dj-" + q.id, title: sc.t, sub: q.q, level: q.level, min: 5, mk: sc.mk, nodes: sc.nodes, steps: sc.steps, refs: DJ_REFS[q.cat] || [] }, { qa: q });
  });
  const ORDER = [];
  TRACKS.forEach((t) => t.modules.forEach((m, mi) => m.lessons.forEach((id, li) => {
    if (!LESSON[id]) { console.warn("missing lesson", id); return; }
    Object.assign(LESSON[id], { track: t, module: m, mi, li });
    ORDER.push(id);
  })));
  TRACKS.forEach((t) => t.modules.forEach((m) => (m.lessons = m.lessons.filter((id) => LESSON[id]))));

  /* ───────── persistence (per-browser, best effort) ───────── */
  const STORE_KEY = "backend-atlas:v1";
  const store = (() => {
    const data = { lessons: {}, q: {}, theme: null, openModules: {} };
    try { Object.assign(data, JSON.parse(localStorage.getItem(STORE_KEY) || "{}")); } catch (_) {}
    return { data, save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (_) {} } };
  })();

  /* ───────── theme (light by default) ───────── */
  const applyTheme = () => { document.documentElement.dataset.theme = store.data.theme === "dark" ? "dark" : "light"; };
  applyTheme();
  $("#themeBtn").addEventListener("click", () => {
    store.data.theme = store.data.theme === "dark" ? "light" : "dark";
    store.save(); applyTheme();
  });

  /* ───────── state ───────── */
  const DEFAULT_VIEW = { spin: -38, tilt: 56 };
  const state = {
    route: { name: null },
    step: 0,
    paused: false,
    view: { ...DEFAULT_VIEW },
    dj: { cat: "all", level: "all", status: "all", text: "" },
    openQ: new Set(),
    drillId: null,
    drillRevealed: false,
  };

  const parseRoute = () => {
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    if (parts[0] === "django") return { name: "django", q: parts[1] === "q" ? parts[2] : null };
    if (parts[0] === "lesson" && LESSON[parts[1]]) return { name: "lesson", id: parts[1], step: Number(parts[2]) || 0 };
    return { name: "lesson", id: ORDER[0], step: 0 };
  };

  /* ───────── sidebar ───────── */
  const isDone = (id) => !!store.data.lessons[id];
  const renderSidebar = () => {
    const current = state.route.name === "lesson" ? LESSON[state.route.id] : null;
    const done = ORDER.filter(isDone).length;
    const known = QS.filter((q) => store.data.q[q.id] === "known").length;
    let n = 0;
    const html = TRACKS.map((t) => {
      const tDone = t.modules.reduce((a, m) => a + m.lessons.filter(isDone).length, 0);
      const tTotal = t.modules.reduce((a, m) => a + m.lessons.length, 0);
      return `<div class="track">
        <div class="side-head"><span>${esc(t.title)}</span><small>${tDone}/${tTotal}</small></div>
        ${t.id === "dj" ? `<a class="dj-entry ${state.route.name === "django" ? "active" : ""}" href="#/django"><b>All questions (Q&amp;A list)</b><span>${QS.length} questions · ${known} known</span></a>` : ""}
        ${t.modules.map((m) => {
          n++;
          const isOpen = store.data.openModules[m.id] ?? (current ? current.module.id === m.id : false);
          return `<div class="module ${isOpen ? "open" : ""}" data-module="${m.id}">
            <button class="module-btn" aria-expanded="${isOpen}">
              <span class="chev">›</span><span class="folder" style="background:${m.color}"></span>
              <span class="mod-title">${t.id === "sd" ? String(n).padStart(2, "0") + ". " : ""}${esc(m.title)}</span>
              <span class="count">${m.lessons.filter(isDone).length}/${m.lessons.length}</span>
            </button>
            <ul class="lesson-list">
              ${m.lessons.map((id) => `<li><a class="lesson-link ${current && current.id === id ? "active" : ""} ${isDone(id) ? "done" : ""}" href="#/lesson/${id}">
                <span class="tick">${isDone(id) ? "✓" : ""}</span><span>${esc(LESSON[id].title)}</span></a></li>`).join("")}
            </ul>
          </div>`;
        }).join("")}
      </div>`;
    }).join(`<hr class="side-divider" />`);
    $("#sidebar").innerHTML = html + `
      <div class="card progress-card"><div style="flex:1">PROGRESS
        <div class="bar"><i style="width:${(done / ORDER.length) * 100}%"></i></div></div>
        <span style="margin-left:12px">${done} / ${ORDER.length}</span></div>`;
    $$(".module-btn", $("#sidebar")).forEach((b) => b.addEventListener("click", () => {
      const mod = b.closest(".module");
      const open = !mod.classList.contains("open");
      mod.classList.toggle("open", open);
      b.setAttribute("aria-expanded", open);
      store.data.openModules[mod.dataset.module] = open;
      store.save();
    }));
    const act = $(".lesson-link.active", $("#sidebar"));
    if (act && act.scrollIntoViewIfNeeded) act.scrollIntoViewIfNeeded(false);
  };

  /* ───────── 3D stage ───────── */
  const KIND = {
    client: { w: 104, d: 72, h: 12, icon: "", laptop: true },
    user: { w: 64, d: 64, h: 26, icon: "☺" },
    server: { w: 96, d: 84, h: 66, icon: "▤", rack: true },
    worker: { w: 86, d: 76, h: 52, icon: "⚙", rack: true },
    db: { w: 92, d: 92, h: 58, icon: "◫", disks: true },
    cache: { w: 86, d: 86, h: 36, icon: "⚡" },
    queue: { w: 150, d: 60, h: 26, icon: "≡", slots: true },
    lb: { w: 106, d: 80, h: 28, icon: "⇄" },
    edge: { w: 86, d: 86, h: 44, icon: "◇" },
    ext: { w: 90, d: 82, h: 40, icon: "☁" },
  };
  const spec = (n) => KIND[n.kind] || KIND.server;

  const quad = (g, t) => {
    const u = 1 - t;
    return { x: u * u * g.x0 + 2 * u * t * g.cx + t * t * g.x1, y: u * u * g.y0 + 2 * u * t * g.cy + t * t * g.y1 };
  };

  const flowGeometry = (lesson, step) => {
    const byId = Object.fromEntries(lesson.nodes.map((n) => [n.id, n]));
    const pairCount = {};
    return step.flows.map(([from, to, kind], i) => {
      const a = byId[from], b = byId[to];
      if (!a || !b || from === to) return null;
      const key = [from, to].sort().join("|");
      pairCount[key] = (pairCount[key] || 0) + 1;
      const reverse = step.flows.some(([f, t]) => f === to && t === from);
      const dir = from < to ? 1 : -1;
      const bend = (reverse || pairCount[key] > 1 ? 30 : 10) * dir + (pairCount[key] - 1) * 22;
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const trim = (n) => { const s = spec(n); return Math.min(Math.abs((s.w / 2 + 10) / (ux || 1e-9)), Math.abs((s.d / 2 + 10) / (uy || 1e-9))); };
      const ta = trim(a), tb = trim(b);
      const x0 = a.x + ux * ta, y0 = a.y + uy * ta, x1 = b.x - ux * tb, y1 = b.y - uy * tb;
      const cx = (x0 + x1) / 2 - uy * bend, cy = (y0 + y1) / 2 + ux * bend;
      return { i, kind, x0, y0, x1, y1, cx, cy, ha: spec(a).h, hb: spec(b).h };
    }).filter(Boolean);
  };

  const renderStage = (lesson, step) => {
    const show = new Set(step.show || lesson.nodes.map((n) => n.id));
    const active = new Set(step.active);
    const self = {};
    step.flows.forEach(([a, b, k]) => { if (a === b) self[a] = k; });
    const geo = flowGeometry(lesson, step);

    const wires = geo.map((g) => `<path class="wire ${g.kind}" d="M${g.x0.toFixed(1)},${g.y0.toFixed(1)} Q${g.cx.toFixed(1)},${g.cy.toFixed(1)} ${g.x1.toFixed(1)},${g.y1.toFixed(1)}"/>`).join("");
    const failMarks = geo.filter((g) => g.kind === "fail").map((g) => {
      const p = quad(g, 0.5);
      return `<div class="bb fail-mark" style="left:${p.x}px;top:${p.y}px;--z:34px">✕</div>`;
    }).join("");

    const boxes = lesson.nodes.map((n) => {
      const s = spec(n);
      const cls = ["box", "k-" + n.kind, show.has(n.id) ? "" : "hidden", active.size && !active.has(n.id) ? "dim" : "", active.has(n.id) ? "active" : "", self[n.id] ? "busy busy-" + self[n.id] : ""].join(" ");
      const extra = s.laptop ? `<div class="face screen"></div>` : "";
      return `<div class="${cls}" style="left:${n.x - s.w / 2}px;top:${n.y - s.d / 2}px;width:${s.w}px;height:${s.d}px;--h:${s.h}px">
        <div class="ring"></div>
        <div class="face s"></div><div class="face e"></div><div class="face n"></div><div class="face w"></div>
        <div class="face top"><span class="ico">${s.icon}</span></div>
        ${extra}
        <div class="bb label" style="left:50%;top:50%;--z:calc(var(--h) + ${s.laptop ? 50 : 6}px)"><b>${esc(n.label)}</b></div>
      </div>`;
    }).join("");

    const pkts = geo.map((g) => `<div class="pkt-shadow" data-i="${g.i}"></div><div class="pkt ${g.kind}" data-i="${g.i}"></div>`).join("");

    return `<div class="stage3d ${state.paused ? "paused" : ""}" id="stage3d" tabindex="0" aria-label="3D diagram: ${esc(step.title)}. Drag to rotate.">
      <div class="cam" id="cam"><div class="world" id="world" style="--spin:${state.view.spin}deg;--tilt:${state.view.tilt}deg">
        <div class="floor"><div class="floor-top"></div><div class="fs fs-n"></div><div class="fs fs-s"></div><div class="fs fs-e"></div><div class="fs fs-w"></div></div>
        <svg class="wires" viewBox="0 0 800 440" width="800" height="440">${wires}</svg>
        ${boxes}
        ${failMarks}
        <div class="pkts">${pkts}</div>
      </div></div>
    </div>`;
  };

  /* packets: animated with rAF so they can arc in 3D and pause/replay */
  const anim = { raf: 0, clock: 0, last: 0, geo: [] };
  const startPackets = (lesson, step) => {
    cancelAnimationFrame(anim.raf);
    anim.geo = flowGeometry(lesson, step);
    anim.clock = 0; anim.last = performance.now();
    const pk = $$(".pkt"), sh = $$(".pkt-shadow");
    const bill = "rotateZ(calc(-1 * var(--spin))) rotateX(calc(-1 * var(--tilt)))";
    const frame = (now) => {
      const dt = Math.min(64, now - anim.last); anim.last = now;
      if (!state.paused) anim.clock += dt;
      anim.geo.forEach((g, k) => {
        const u = ((anim.clock / 1700) + g.i * 0.29) % 1;
        let t = u, op = 1;
        if (g.kind === "fail") { t = Math.min(u / 0.6, 1) * 0.5; op = u < 0.6 ? 1 : Math.max(0, 1 - (u - 0.6) / 0.25); }
        const p = quad(g, t);
        const z = (g.ha * 0.7) * (1 - t) + (g.hb * 0.7) * t + Math.sin(Math.PI * t) * 46;
        if (pk[k]) { pk[k].style.transform = `translate3d(${p.x}px,${p.y}px,${z}px) ${bill}`; pk[k].style.opacity = op; }
        if (sh[k]) { sh[k].style.transform = `translate3d(${p.x}px,${p.y}px,1px)`; sh[k].style.opacity = op * 0.35; }
      });
      anim.raf = requestAnimationFrame(frame);
    };
    anim.raf = requestAnimationFrame(frame);
  };

  const fitStage = () => {
    const st = $("#stage3d");
    if (!st) return;
    const w = st.clientWidth;
    const s = Math.max(0.3, Math.min(1.05, w / 1060));
    st.style.setProperty("--s", s.toFixed(3));
    st.style.height = Math.round(Math.max(250, 540 * s)) + "px";
  };
  window.addEventListener("resize", fitStage);

  const setView = () => {
    const world = $("#world");
    if (!world) return;
    world.style.setProperty("--spin", state.view.spin + "deg");
    world.style.setProperty("--tilt", state.view.tilt + "deg");
  };
  const bindDrag = () => {
    const st = $("#stage3d");
    let drag = null;
    st.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, ...state.view }; st.setPointerCapture(e.pointerId); st.classList.add("grabbing"); });
    st.addEventListener("pointermove", (e) => {
      if (!drag) return;
      state.view.spin = drag.spin + (e.clientX - drag.x) * 0.35;
      state.view.tilt = Math.max(22, Math.min(78, drag.tilt - (e.clientY - drag.y) * 0.25));
      setView();
    });
    const end = () => { drag = null; st.classList.remove("grabbing"); };
    st.addEventListener("pointerup", end);
    st.addEventListener("pointercancel", end);
    st.addEventListener("dblclick", () => { state.view = { ...DEFAULT_VIEW }; setView(); });
    st.addEventListener("keydown", (e) => {
      if (e.key === "a") { state.view.spin -= 8; setView(); }
      if (e.key === "d") { state.view.spin += 8; setView(); }
    });
  };

  /* ───────── tiny Python highlighter ───────── */
  const KW = /^(def|class|return|from|import|with|for|in|if|else|elif|async|await|None|True|False|try|except|raise|as|not|and|or|lambda|yield|pass|is)$/;
  const highlight = (code) => {
    const re = /(#[^\n]*)|("""[\s\S]*?"""|f?"[^"\n]*"|f?'[^'\n]*')|\b([A-Za-z_]+)\b/g;
    let out = "", last = 0, m;
    while ((m = re.exec(code))) {
      out += esc(code.slice(last, m.index));
      if (m[1]) out += `<span class="c">${esc(m[1])}</span>`;
      else if (m[2]) out += `<span class="s">${esc(m[2])}</span>`;
      else out += KW.test(m[3]) ? `<span class="k">${m[3]}</span>` : esc(m[3]);
      last = re.lastIndex;
    }
    return out + esc(code.slice(last));
  };

  const catTitle = (id) => (CATS.find((c) => c.id === id) || {}).title || id;
  const refsHtml = (refs) => refs && refs.length
    ? `<div class="refs"><small>SOURCES &amp; FURTHER READING</small><ul>${refs.map(([t, u]) => `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)} ↗</a></li>`).join("")}</ul></div>` : "";

  const answerHtml = (q) => `
    <div class="tldr">${esc(q.short)}</div>
    ${q.a.map((p) => `<p>${p}</p>`).join("")}
    ${q.code ? `<pre class="code"><code>${highlight(q.code)}</code></pre>` : ""}
    ${q.follow && q.follow.length ? `<div class="follow"><small>LIKELY FOLLOW-UPS</small><ul>${q.follow.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>` : ""}`;

  const markButtons = (q) => {
    const st = store.data.q[q.id];
    return `<div class="q-actions" data-qid="${q.id}">
      <button class="btn ${st === "known" ? "on" : ""}" data-mark="known">✓ I know this</button>
      <button class="btn ${st === "review" ? "on-review" : ""}" data-mark="review">↺ Review later</button>
    </div>`;
  };
  const bindMarks = (root, after) => $$("[data-mark]", root).forEach((b) => (b.onclick = () => {
    const id = b.closest("[data-qid]").dataset.qid;
    const val = b.dataset.mark;
    if (store.data.q[id] === val) delete store.data.q[id]; else store.data.q[id] = val;
    store.save();
    after();
  }));

  /* ───────── lesson view ───────── */
  const renderLesson = () => {
    const lesson = LESSON[state.route.id];
    const stepIdx = Math.min(state.step, lesson.steps.length - 1);
    const step = lesson.steps[stepIdx];
    const prev = lesson.steps[stepIdx - 1];
    const last = stepIdx === lesson.steps.length - 1;
    if (last && !isDone(lesson.id)) { store.data.lessons[lesson.id] = true; store.save(); renderSidebar(); }

    const levelClass = { Beginner: "b-green", Intermediate: "b-sky", Advanced: "b-rose", Senior: "b-sky", Staff: "b-violet" }[lesson.level] || "b-green";
    const metrics = lesson.metricKeys.map((k) => {
      const v = step.metrics[k];
      const changed = v && (!prev || prev.metrics[k] !== v);
      return `<div class="metric ${changed ? "changed" : ""}"><small>${esc(k)}</small><b>${v ? esc(v) : "—"}</b></div>`;
    }).join("");
    const q = lesson.qa;
    const idxNum = ORDER.indexOf(lesson.id);
    const next = lesson.steps[stepIdx + 1];
    const nextLessonId = ORDER[idxNum + 1];

    $("#layout").classList.remove("wide");
    $("#main").innerHTML = `
      <section class="card stage ${q ? "is-dj" : ""}">
        <div class="crumbs">${esc(lesson.track.title)} / ${esc(lesson.module.title)} / ${lesson.li + 1} of ${lesson.module.lessons.length}</div>
        <div class="title-row">
          <h1>${esc(lesson.title)}</h1>
          <div class="badges">
            <span class="badge b-amber">◷ ${lesson.minutes} min</span>
            <span class="badge ${levelClass}">${esc(lesson.level)}</span>
            <span class="badge b-violet">${lesson.steps.length} steps</span>
            ${q ? `<span class="badge b-dj">Django</span>` : ""}
          </div>
        </div>
        <p class="subtitle">${q ? `<span class="q-label">Interview question</span> ` : ""}${esc(lesson.subtitle)}</p>
        <div class="canvas3d">
          <div class="canvas-top">
            <div class="metrics">${metrics}</div>
            <div class="controls">
              <button class="btn" id="replayBtn" title="Replay (R)">↻ Replay</button>
              <button class="btn" id="pauseBtn" title="Pause (Space)">${state.paused ? "▶ Play" : "❚❚ Pause"}</button>
              <button class="btn" id="viewBtn" title="Reset camera">⌖ View</button>
            </div>
          </div>
          ${renderStage(lesson, step)}
          <div class="legend"><span><i style="background:var(--req)"></i>request</span><span><i style="background:var(--res)"></i>response</span><span><i style="background:var(--sync)"></i>sync / replication</span><span><i style="background:var(--fail)"></i>failure / miss</span><span class="drag-hint">⟲ drag to rotate · double-click to reset</span></div>
        </div>
        <div class="card steps-card">
          <div class="steps-head">IN THIS ${q ? "WALKTHROUGH" : "LESSON"} <span>Step ${stepIdx + 1} of ${lesson.steps.length}</span></div>
          <div class="step-strip">
            ${lesson.steps.map((s, i) => `<button class="step-dot ${i === stepIdx ? "current" : ""} ${i < stepIdx ? "seen" : ""}" data-step="${i}"><i>${i + 1}</i>${esc(s.short)}</button>`).join("")}
          </div>
        </div>
        ${q ? `
        <div class="card detail-card">
          <div class="detail-head"><h3>Model answer</h3>${markButtons(q)}</div>
          ${answerHtml(q)}
          ${refsHtml(lesson.refs)}
        </div>` : `
        <div class="detail-grid">
          ${lesson.deep.length ? `<div class="card detail-card"><h3>Deep dive</h3><ul class="deep">${lesson.deep.map((d) => `<li>${d}</li>`).join("")}</ul></div>` : ""}
          ${lesson.iv.length ? `<div class="card detail-card iv"><h3>In the interview</h3><ul class="deep">${lesson.iv.map((d) => `<li>${d}</li>`).join("")}</ul></div>` : ""}
        </div>
        ${lesson.refs.length ? `<div class="card detail-card">${refsHtml(lesson.refs)}</div>` : ""}`}
      </section>`;

    const nextLabel = next ? `Next: ${esc(next.short)} →` : nextLessonId ? `Next: ${esc(LESSON[nextLessonId].title)} →` : `Django Q&amp;A →`;
    $("#aside").innerHTML = `
      <section class="card panel">
        <div class="panel-top"><span>STEP ${stepIdx + 1} / ${lesson.steps.length}</span><span class="tag ${step.tag}">${step.tag}</span></div>
        <h2>${esc(step.title)}</h2>
        ${step.body.map((p) => `<p>${p}</p>`).join("")}
        ${step.key ? `<div class="key-idea"><small>KEY IDEA</small>${esc(step.key)}</div>` : ""}
        <div class="nav-row">
          <button class="btn" id="backBtn" ${stepIdx === 0 ? "disabled" : ""}>← Back</button>
          <button class="btn btn-primary" id="nextBtn">${nextLabel}</button>
        </div>
        <div class="hint"><kbd>←</kbd><kbd>→</kbd> step · <kbd>R</kbd> replay · <kbd>Space</kbd> pause</div>
      </section>
      ${q ? `<section class="card panel">
        <div class="panel-top"><span>SAY IT IN ONE LINE</span></div>
        <p class="one-liner">${esc(q.short)}</p>
        <div class="panel-top" style="margin-top:12px"><span>KEY IDEAS</span></div>
        <ul class="learn-list">${lesson.steps.map((s, i) => `<li class="${i <= stepIdx ? "got" : ""}">${esc(s.key)}</li>`).join("")}</ul>
      </section>` : `<section class="card panel">
        <div class="panel-top"><span>YOU'LL LEARN</span></div>
        <ul class="learn-list">${lesson.learn.map((t, i) => `<li class="${(i + 1) / lesson.learn.length <= (stepIdx + 1) / lesson.steps.length ? "got" : ""}">${esc(t)}</li>`).join("")}</ul>
      </section>`}`;

    fitStage();
    bindDrag();
    startPackets(lesson, step);
    $("#replayBtn").onclick = () => { anim.clock = 0; };
    $("#pauseBtn").onclick = togglePause;
    $("#viewBtn").onclick = () => { state.view = { ...DEFAULT_VIEW }; setView(); };
    $("#backBtn").onclick = () => goStep(stepIdx - 1);
    $("#nextBtn").onclick = () => {
      if (next) goStep(stepIdx + 1);
      else location.hash = nextLessonId ? `#/lesson/${nextLessonId}` : "#/django";
    };
    $$(".step-dot").forEach((b) => (b.onclick = () => goStep(Number(b.dataset.step))));
    if (q) bindMarks($("#main"), () => { renderLesson(); renderSidebar(); });
  };

  const goStep = (i) => {
    const lesson = LESSON[state.route.id];
    state.step = Math.max(0, Math.min(lesson.steps.length - 1, i));
    history.replaceState(null, "", `#/lesson/${lesson.id}/${state.step}`);
    renderLesson();
  };

  const togglePause = () => {
    state.paused = !state.paused;
    $("#stage3d")?.classList.toggle("paused", state.paused);
    const b = $("#pauseBtn");
    if (b) b.textContent = state.paused ? "▶ Play" : "❚❚ Pause";
  };

  /* ───────── Django Q&A list ───────── */
  const qNumber = (q) => QS.indexOf(q) + 1;
  const filteredQs = () => {
    const { cat, level, status, text } = state.dj;
    const t = text.trim().toLowerCase();
    return QS.filter((q) => {
      if (cat !== "all" && q.cat !== cat) return false;
      if (level !== "all" && q.level !== level) return false;
      const st = store.data.q[q.id] || "new";
      if (status !== "all" && st !== status) return false;
      if (t) {
        const hay = (q.q + " " + q.short + " " + strip(q.a.join(" ")) + " " + (q.code || "") + " " + catTitle(q.cat)).toLowerCase();
        return t.split(/\s+/).every((w) => hay.includes(w));
      }
      return true;
    });
  };

  const renderDjango = () => {
    cancelAnimationFrame(anim.raf);
    $("#layout").classList.add("wide");
    const firstDj = ORDER.find((id) => id.startsWith("dj-"));
    $("#main").innerHTML = `
      <section class="card dj-hero">
        <span class="badge b-dj">Backend · Django · Senior</span>
        <h1>Senior Django Interview Questions</h1>
        <p>${QS.length} questions that come up in senior and staff backend interviews. Each one has a 3D walkthrough, a one-line answer, a full explanation with code, likely follow-ups, and links to the official docs.</p>
        <div class="dj-tools">
          <a class="btn btn-dj" href="#/lesson/${firstDj}">▶ Start 3D walkthroughs</a>
          <input type="search" id="djSearch" placeholder="Filter questions (e.g. select_for_update, migrations)…" value="${esc(state.dj.text)}" />
          <select id="djLevel" aria-label="Level"><option value="all">All levels</option><option value="Senior">Senior</option><option value="Staff">Staff</option></select>
          <select id="djStatus" aria-label="Status"><option value="all">Any status</option><option value="new">Not reviewed</option><option value="review">Needs review</option><option value="known">Known</option></select>
          <button class="btn" id="expandAll">Expand all</button>
        </div>
        <div class="chips" id="djChips"></div>
      </section>
      <div class="q-list" id="qList"></div>`;
    $("#djLevel").value = state.dj.level;
    $("#djStatus").value = state.dj.status;
    $("#djSearch").addEventListener("input", (e) => { state.dj.text = e.target.value; renderQList(); });
    $("#djLevel").addEventListener("change", (e) => { state.dj.level = e.target.value; renderQList(); });
    $("#djStatus").addEventListener("change", (e) => { state.dj.status = e.target.value; renderQList(); });
    $("#expandAll").addEventListener("click", () => {
      const list = filteredQs();
      const allOpen = list.every((q) => state.openQ.has(q.id));
      list.forEach((q) => (allOpen ? state.openQ.delete(q.id) : state.openQ.add(q.id)));
      renderQList();
    });
    if (state.route.q) state.openQ.add(state.route.q);
    renderQList();
    renderDjAside();
    if (state.route.q) requestAnimationFrame(() => document.getElementById(`q-${state.route.q}`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };

  const renderQList = () => {
    $("#djChips").innerHTML = [{ id: "all", title: "All" }, ...CATS].map((c) => {
      const n = c.id === "all" ? QS.length : QS.filter((q) => q.cat === c.id).length;
      return `<button class="chip ${state.dj.cat === c.id ? "on" : ""}" data-cat="${c.id}">${esc(c.title)}<small>${n}</small></button>`;
    }).join("");
    $$(".chip", $("#djChips")).forEach((b) => (b.onclick = () => { state.dj.cat = b.dataset.cat; renderQList(); }));
    const list = filteredQs();
    $("#expandAll").textContent = list.length && list.every((q) => state.openQ.has(q.id)) ? "Collapse all" : "Expand all";
    $("#qList").innerHTML = list.length ? list.map(renderQ).join("") : `<div class="card empty">No questions match these filters.</div>`;
    $$(".q-head", $("#qList")).forEach((h) => (h.onclick = () => {
      const id = h.closest(".q").dataset.id;
      state.openQ.has(id) ? state.openQ.delete(id) : state.openQ.add(id);
      h.closest(".q").classList.toggle("open");
      h.setAttribute("aria-expanded", state.openQ.has(id));
    }));
    bindMarks($("#qList"), () => { renderQList(); renderDjAside(); renderSidebar(); });
  };

  const renderQ = (q) => {
    const st = store.data.q[q.id];
    const open = state.openQ.has(q.id);
    return `<article class="card q ${open ? "open" : ""} ${st || ""}" id="q-${q.id}" data-id="${q.id}">
      <button class="q-head" aria-expanded="${open}">
        <span class="q-num">${st === "known" ? "✓" : qNumber(q)}</span>
        <span class="q-title"><b>${esc(q.q)}</b>
          <span class="q-meta"><span class="badge b-dj">${esc(catTitle(q.cat))}</span><span class="badge ${q.level === "Staff" ? "b-violet" : "b-sky"}">${q.level}</span>${st === "review" ? `<span class="badge b-amber">needs review</span>` : ""}</span>
        </span>
        <span class="q-toggle">+</span>
      </button>
      <div class="q-body">
        ${LESSON["dj-" + q.id] ? `<a class="btn btn-dj watch" href="#/lesson/dj-${q.id}">▶ Watch the 3D walkthrough</a>` : ""}
        ${answerHtml(q)}
        ${refsHtml(DJ_REFS[q.cat])}
        ${markButtons(q)}
      </div>
    </article>`;
  };

  const pickDrill = () => {
    const pool = QS.filter((q) => store.data.q[q.id] !== "known" && q.id !== state.drillId);
    const from = pool.length ? pool : QS;
    state.drillId = from[Math.floor(Math.random() * from.length)].id;
    state.drillRevealed = false;
  };

  const renderDjAside = () => {
    if (!state.drillId) pickDrill();
    const drill = QS.find((q) => q.id === state.drillId);
    const known = QS.filter((q) => store.data.q[q.id] === "known").length;
    const review = QS.filter((q) => store.data.q[q.id] === "review").length;
    $("#aside").innerHTML = `
      <section class="card panel">
        <div class="panel-top"><span>YOUR PROGRESS</span></div>
        <div class="stat-grid"><div class="stat"><b>${known}</b><small>known</small></div><div class="stat"><b>${review}</b><small>to review</small></div></div>
        <div class="bar" style="margin-top:12px"><i style="width:${(known / QS.length) * 100}%;background:var(--dj)"></i></div>
      </section>
      <section class="card panel drill">
        <div class="panel-top"><span>MOCK INTERVIEW</span><span class="tag concept">${esc(catTitle(drill.cat))}</span></div>
        <h2>${esc(drill.q)}</h2>
        ${state.drillRevealed ? `<div class="tldr">${esc(drill.short)}</div><p><a href="#/lesson/dj-${drill.id}">Open the 3D walkthrough →</a></p>` : `<p>Answer out loud first, then check yourself.</p>`}
        <div class="nav-row">
          ${state.drillRevealed ? "" : `<button class="btn btn-dj" id="revealBtn">Reveal</button>`}
          <button class="btn" id="nextDrill">Next →</button>
        </div>
      </section>
      <section class="card panel">
        <div class="panel-top"><span>BY TOPIC</span></div>
        <div class="cat-bars">${CATS.map((c) => {
          const qs = QS.filter((q) => q.cat === c.id);
          const k = qs.filter((q) => store.data.q[q.id] === "known").length;
          return `<div>${esc(c.title)} <span style="float:right;color:var(--muted)">${k}/${qs.length}</span><div class="bar"><i style="width:${(k / qs.length) * 100}%"></i></div></div>`;
        }).join("")}</div>
      </section>`;
    $("#revealBtn")?.addEventListener("click", () => { state.drillRevealed = true; renderDjAside(); });
    $("#nextDrill").addEventListener("click", () => { pickDrill(); renderDjAside(); });
  };

  /* ───────── search ───────── */
  const searchIndex = ORDER.map((id) => {
    const l = LESSON[id];
    const qa = l.qa ? " " + l.qa.short + " " + strip(l.qa.a.join(" ")) + " " + (l.qa.code || "") : "";
    return { title: l.qa ? l.qa.q : l.title, sub: `${l.track.title} · ${l.module.title}`, href: `#/lesson/${id}`, hay: (l.title + " " + l.subtitle + " " + l.steps.map((s) => s.title + " " + strip(s.body.join(" "))).join(" ") + " " + strip(l.deep.join(" ")) + qa).toLowerCase() };
  });
  let searchSel = 0;
  const openSearch = () => { $("#searchModal").hidden = false; $("#searchInput").value = ""; searchSel = 0; runSearch(); $("#searchInput").focus(); };
  const closeSearch = () => { $("#searchModal").hidden = true; };
  const runSearch = () => {
    const t = $("#searchInput").value.trim().toLowerCase();
    const res = (t ? searchIndex.filter((i) => t.split(/\s+/).every((w) => i.hay.includes(w) || i.title.toLowerCase().includes(w))) : searchIndex).slice(0, 14);
    searchSel = Math.min(searchSel, Math.max(0, res.length - 1));
    $("#searchResults").innerHTML = res.length
      ? res.map((r, i) => `<li><a href="${r.href}" class="${i === searchSel ? "sel" : ""}">${esc(r.title)}<small>${esc(r.sub)}</small></a></li>`).join("")
      : `<li class="empty">Nothing found.</li>`;
  };
  $("#searchBtn").addEventListener("click", openSearch);
  $("#searchInput").addEventListener("input", () => { searchSel = 0; runSearch(); });
  $("#searchInput").addEventListener("keydown", (e) => {
    const links = $$("#searchResults a");
    if (e.key === "ArrowDown") { searchSel = Math.min(links.length - 1, searchSel + 1); runSearch(); e.preventDefault(); }
    if (e.key === "ArrowUp") { searchSel = Math.max(0, searchSel - 1); runSearch(); e.preventDefault(); }
    if (e.key === "Enter" && links[searchSel]) { location.hash = links[searchSel].getAttribute("href"); closeSearch(); }
  });
  $("#searchResults").addEventListener("click", (e) => { if (e.target.closest("a")) closeSearch(); });
  $("#searchModal").addEventListener("click", (e) => { if (e.target.id === "searchModal") closeSearch(); });

  /* ───────── keyboard + mobile nav ───────── */
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openSearch(); return; }
    if (e.key === "Escape") { closeSearch(); document.body.classList.remove("nav-open"); return; }
    if (e.target.matches("input, select, textarea") || !$("#searchModal").hidden) return;
    if (state.route.name !== "lesson") return;
    if (e.key === "ArrowRight") goStep(state.step + 1);
    else if (e.key === "ArrowLeft") goStep(state.step - 1);
    else if (e.key.toLowerCase() === "r") anim.clock = 0;
    else if (e.key === " ") { e.preventDefault(); togglePause(); }
  });
  $("#menuBtn").addEventListener("click", () => document.body.classList.toggle("nav-open"));
  $("#scrim").addEventListener("click", () => document.body.classList.remove("nav-open"));

  /* ───────── router ───────── */
  const render = () => {
    const r = parseRoute();
    const changed = r.name !== state.route.name || r.id !== state.route.id;
    state.route = r;
    if (r.name === "lesson") {
      state.step = r.step;
      renderSidebar();
      renderLesson();
      document.title = `${LESSON[r.id].title} · Backend Atlas`;
    } else {
      renderSidebar();
      renderDjango();
      document.title = "Senior Django Questions · Backend Atlas";
    }
    document.body.classList.remove("nav-open");
    if (changed) window.scrollTo(0, 0);
  };
  window.addEventListener("hashchange", render);
  render();
})();
