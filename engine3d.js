/* Backend Atlas 3D engine (three.js, no build step).
   Renders one lesson at a time into a persistent stage element and animates steps.
   API (window.Stage3D): attach(slot), detach(), show(lesson, stepIndex), replay(), togglePause(), resetView(), recolor().
   Lesson/step format: see data/dsl.js. Optional step fields used here: ev, fx, L, gate, g, setup, code, note. */
import * as THREE from "./vendor/three.module.min.js";
import { RoundedBoxGeometry } from "./vendor/RoundedBoxGeometry.js";

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const C = (v) => new THREE.Color(v.startsWith("--") ? css(v) || "#888888" : v);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const easeOutBack = (x) => { const c1 = 1.55, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const easeInCubic = (x) => x * x * x;
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/* ───────── icons (shared by HTML labels and ground tags) ───────── */
export const IC = {
  server: "M5 3h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM5 14h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2zM7 6.5h.01M7 17.5h.01",
  cog: "M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1",
  db: "M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  zap: "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
  list: "M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01",
  split: "M4 12h6l4-6h6M14 18h6M10 12l4 6M17 3l3 3-3 3M17 15l3 3-3 3",
  globe: "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20",
  cloud: "M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19.5 10 4 4 0 0 1 18 18z",
  laptop: "M4 5h16v10H4zM2 19h20",
  users: "M9 4a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM2 21a7 7 0 0 1 14 0M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-5-6.7",
  user: "M12 3a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM4 21a8 8 0 0 1 16 0",
  card: "M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM2 10h20M6 15h4",
  clock: "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20zM12 6v6l4 2",
  bars: "M4 20v-2M9 20v-6M14 20v-10M19 20V4",
  steps: "M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01",
  replay: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5",
  pause: "M7 4h3v16H7zM14 4h3v16h-3z", play: "M7 4l13 8-13 8z",
  plus: "M12 5v14M5 12h14", minus: "M5 12h14",
  frame: "M3 8V3h5M21 8V3h-5M3 16v5h5M21 16v5h-5M12 9v6M9 12h6",
  cpu: "M6 6h12v12H6zM10 10h4v4h-4zM9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4",
  hourglass: "M6 2h12M6 22h12M7 2c0 6 10 6 10 10S7 16 7 22M17 2c0 6-10 6-10 10s10 4 10 10",
  activity: "M22 12h-4l-3 9L9 3l-3 9H2",
  timer: "M10 2h4M12 14l3-3M12 6a8 8 0 1 0 0 16a8 8 0 1 0 0-16z",
  repeat: "M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3",
  key: "M7.5 11a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9zM10.7 12.3L20 3M16 7l3 3M13.5 9.5l2 2",
  shield: "M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z",
  alert: "M12 3L2 20h20zM12 10v4M12 17h.01",
  check: "M4 12l5 5L20 6", x: "M6 6l12 12M18 6L6 18",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  disk: "M4 4h16v16H4zM8 4v5h8V4M8 20v-6h8v6",
};
export const svg = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="${IC[n] || IC.bars}"/></svg>`;

/* ───────── node kinds ───────── */
const KIND = {
  client: { w: 120, d: 92, h: 12, shape: "laptop", col: "--k-client", icon: "laptop", ground: true, desc: "A browser or app that sends requests." },
  user: { w: 104, d: 96, h: 12, shape: "people", col: "--k-user", icon: "users", ground: true, desc: "People using the system." },
  server: { w: 96, d: 90, h: 72, col: "--k-server", icon: "server", desc: "An application server running your code." },
  worker: { w: 86, d: 80, h: 56, col: "--k-worker", icon: "cog", desc: "A background worker that processes jobs." },
  db: { w: 84, d: 84, h: 60, shape: "cyl", col: "--k-db", icon: "db", desc: "A database: durable storage, and often the bottleneck." },
  cache: { w: 86, d: 86, h: 44, col: "--k-cache", icon: "zap", desc: "An in-memory cache such as Redis." },
  queue: { w: 128, d: 56, h: 26, shape: "queue", col: "--k-queue", icon: "list", desc: "A queue or log that buffers messages between services." },
  lb: { w: 106, d: 80, h: 30, col: "--k-lb", icon: "split", desc: "A load balancer, gateway or router that forwards requests." },
  edge: { w: 86, d: 86, h: 48, col: "--k-edge", icon: "globe", desc: "A CDN edge or other service close to users." },
  ext: { w: 92, d: 84, h: 48, col: "--k-ext", icon: "cloud", desc: "An external or third-party service you don't control." },
};
const kindVar = { req: "--req", res: "--res", sync: "--sync", fail: "--fail" };
const KIND_WORD = { req: "request", res: "response", sync: "sync / replicate", fail: "request" };
const LEGEND = { req: "request", res: "response", sync: "sync / replication", fail: "failure / miss" };
const metricIcon = (k) => {
  const s = k.toLowerCase();
  if (/p\d\d|latenc|time|wait|ms\b|delay|timeout|ttl/.test(s)) return "timer";
  if (/hit|cache/.test(s)) return "zap";
  if (/queue|backlog|lag|messages|pending/.test(s)) return "steps";
  if (/cpu|util|worker|thread|load|conn|pool/.test(s)) return "cpu";
  if (/quer|rows|db|storage|disk|tb|gb|size|writes|reads/.test(s)) return "db";
  if (/error|fail|lost|dup|conflict|wrong/.test(s)) return "alert";
  if (/user|client|session/.test(s)) return "users";
  if (/cost|\$|price/.test(s)) return "card";
  if (/replica|retry|attempt|version|copies/.test(s)) return "repeat";
  if (/req|rps|qps|throughput|calls|traffic|ops/.test(s)) return "activity";
  return "bars";
};

/* ───────── DOM ───────── */
const root = document.createElement("div");
root.className = "s3";
root.innerHTML = `
  <section class="s3-stage">
    <div class="s3-bar"><div class="s3-metrics"></div></div>
    <div class="s3-fig" tabindex="0" aria-label="3D diagram. Drag to rotate, click a component to zoom in."><div class="s3-ov"></div><div class="s3-tip"></div></div>
    <div class="s3-foot"><span class="s3-legend"></span><label class="s3-scrub"><span>timeline</span><input type="range" min="0" max="1000" value="0" aria-label="Animation timeline"></label>
      <div class="s3-btns"><button class="btn" data-a="replay" title="Replay (R)">${svg("replay")}Replay</button><button class="btn" data-a="pause" title="Pause (Space)"></button><button class="btn ic" data-a="zin" aria-label="Zoom in">${svg("plus")}</button><button class="btn ic" data-a="zout" aria-label="Zoom out">${svg("minus")}</button><button class="btn ic" data-a="view" aria-label="Reset camera" title="Reset camera (V)">${svg("frame")}</button></div></div>
  </section>
  <section class="s3-trace"><h3><b>TRACE</b><span>events in order, slowed down to watch</span></h3><div class="s3-log"></div></section>`;
const q = (s) => root.querySelector(s);
const fig = q(".s3-fig"), ov = q(".s3-ov"), tip = q(".s3-tip"), metricsEl = q(".s3-metrics"), logEl = q(".s3-log"), legendEl = q(".s3-legend"), scrub = q(".s3-scrub input"), pauseBtn = q('[data-a="pause"]');

/* ───────── renderer & static scene ───────── */
let renderer = null, scene, camera, ground, gridLines, sun, failed = false;
const themed = []; // [material, cssVar]
let grad;
const toon = (v, o = {}) => { const m = new THREE.MeshToonMaterial({ color: C(v), gradientMap: grad, ...o }); themed.push([m, v]); return m; };
const flat = (v, o = {}) => { const m = new THREE.MeshBasicMaterial({ color: C(v), ...o }); themed.push([m, v]); return m; };
let inkHull;
const OUT = 2.4, PR = 9, PY = 12;

const init = () => {
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch (e) { failed = true; fig.innerHTML = `<p class="s3-nogl">This diagram needs WebGL, which is turned off or unavailable in this browser.</p>`; return; }
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  fig.prepend(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 6000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb3a68f, 1.55));
  sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(-420, 700, 160); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -620, right: 620, top: 520, bottom: -520, near: 10, far: 2000 }); sun.shadow.radius = 8; sun.shadow.blurSamples = 16;
  scene.add(sun);
  grad = new THREE.DataTexture(new Uint8Array([168, 212, 255]), 3, 1, THREE.RedFormat);
  grad.minFilter = grad.magFilter = THREE.NearestFilter; grad.needsUpdate = true;
  inkHull = flat("--ink", { side: THREE.BackSide });
  ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.ShadowMaterial({ opacity: 0.12 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  gridLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true })); scene.add(gridLines); buildGrid();
  buildInstruments();
  new ResizeObserver(() => resize()).observe(fig);
  bindPointer();
};
const buildGrid = () => {
  const pos = [], col = [], g = C("--grid3d"), bg = C("--stage-bg"), R = 900, S = 36;
  const push = (x, z) => { pos.push(x, 0.2, z); const k = Math.min(1, Math.hypot(x, z * 1.3) / R); const c = g.clone().lerp(bg, k * k); col.push(c.r, c.g, c.b); };
  for (let a = -R; a <= R; a += S) for (let b = -R; b < R; b += S) { push(a, b); push(a, b + S); push(b, a); push(b + S, a); }
  gridLines.geometry.dispose(); const gg = new THREE.BufferGeometry();
  gg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); gg.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); gridLines.geometry = gg;
};
const resize = () => { if (renderer && fig.clientWidth) renderer.setSize(fig.clientWidth, fig.clientHeight, false); };

/* ───────── geometry helpers ───────── */
const rbox = (w, h, d, r, mat, parent, outline = true) => {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, Math.min(r, h / 2 - 0.01, w / 2 - 0.01, d / 2 - 0.01)), mat); m.castShadow = m.receiveShadow = true; parent.add(m);
  if (outline) m.add(new THREE.Mesh(new RoundedBoxGeometry(w + OUT * 2, h + OUT * 2, d + OUT * 2, 4, Math.min(r, h / 2) + OUT), inkHull));
  return m;
};
const cyl = (r, h, mat, parent) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 40), mat); m.castShadow = m.receiveShadow = true; parent.add(m);
  m.add(new THREE.Mesh(new THREE.CylinderGeometry(r + OUT, r + OUT, h + OUT * 2, 40), inkHull));
  return m;
};
const canvasTex = (w, h, draw) => { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d")); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };

/* ───────── ground tags: status written on the floor in front of units ───────── */
const tagGeo = new THREE.PlaneGeometry(1, 1);
const TONE = { "": "--panel", ok: "--accent", warn: "--amber", bad: "--rose", info: "--sky", changed: "--amber" };
const LEAN = 0.42, TAGK = 0.27;
const allTags = new Set();
const makeTag = (parent) => {
  const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, depthTest: false });
  const mesh = new THREE.Mesh(tagGeo, mat); mesh.renderOrder = 10; mesh.rotation.x = -Math.PI / 2 + LEAN;
  const holder = new THREE.Group(); holder.add(mesh); parent.add(holder);
  const T = { holder, mesh, mat, key: "", alpha: 0, want: 0, spec: null,
    set(text, tone = "", icon, frac = null) {
      const f = frac == null ? null : Math.round(clamp01(frac) * 40) / 40, key = `${text}|${tone}|${icon}|${f}`;
      T.want = text ? 1 : 0; if (key === T.key) return; T.key = key; T.spec = [text, tone, icon, frac]; if (!text) return;
      const fs = 50, pad = 30, iconW = icon ? fs + 14 : 0, h = f == null ? 100 : 118, font = `800 ${fs}px "JetBrains Mono", ui-monospace, monospace`;
      const m = document.createElement("canvas").getContext("2d"); m.font = font;
      const w = Math.min(2048, Math.ceil(m.measureText(text).width + iconW + pad * 2)), ink = css("--ink") || "#1d1b18";
      const tex = canvasTex(w, h, (x) => {
        x.fillStyle = css(TONE[tone] || "--panel"); x.strokeStyle = ink; x.lineWidth = 7;
        x.beginPath(); x.roundRect(4, 4, w - 8, h - 8, 22); x.fill(); x.stroke();
        if (icon) { x.save(); x.translate(pad, 25); x.scale(fs / 24, fs / 24); x.lineWidth = 2.5; x.lineCap = x.lineJoin = "round"; x.stroke(new Path2D(IC[icon] || IC.bars)); x.restore(); }
        x.fillStyle = ink; x.font = font; x.textBaseline = "middle"; x.fillText(text, pad + iconW, 51);
        if (f != null) { x.globalAlpha = 0.15; x.fillRect(pad, 92, w - pad * 2, 10); x.globalAlpha = 1; x.fillRect(pad, 92, (w - pad * 2) * f, 10); }
      });
      mat.map?.dispose(); mat.map = tex; mat.needsUpdate = true;
      mesh.scale.set(w * TAGK, h * TAGK, 1); mesh.position.y = (h * TAGK / 2) * Math.sin(LEAN) + 0.6;
    },
    redraw() { const s = T.spec; T.key = ""; if (s) T.set(...s); },
    dispose() { mat.map?.dispose(); mat.dispose(); holder.parent?.remove(holder); allTags.delete(T); } };
  allTags.add(T);
  return T;
};

/* ───────── instruments: worker pool, countdown ring, breaker gate, busy spinner ───────── */
let pool = [], cd, cdGeo, cdMat, cdTrack, gate, gateMat, midTag;
const buildInstruments = () => {
  for (let i = 0; i < 12; i++) { const m = rbox(13, 9, 13, 3, toon("--panel"), scene); m.visible = false; m.userData.born = 0; pool.push(m); }
  cdGeo = new THREE.RingGeometry(1, 1.12, 96, 1, Math.PI / 2, -Math.PI * 2);
  cdMat = new THREE.MeshBasicMaterial({ color: C("--req"), side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false });
  cd = new THREE.Mesh(cdGeo, cdMat); cd.rotation.x = -Math.PI / 2; cd.visible = false; scene.add(cd);
  cdTrack = new THREE.Mesh(new THREE.RingGeometry(1, 1.12, 96), flat("--hair", { transparent: true, opacity: 0.8, depthWrite: false })); cdTrack.rotation.x = -Math.PI / 2; cdTrack.visible = false; scene.add(cdTrack);
  gate = new THREE.Group(); scene.add(gate); gateMat = toon("--fail");
  rbox(12, 40, 64, 5, gateMat, gate).position.y = 20; gate.visible = false; gate.userData.target = 0.08;
  midTag = makeTag(scene);
};

/* ───────── lesson state ───────── */
let lesson = null, stepIdx = 0, step = null, clock = 0, paused = false, scrubbing = false, intro = 0, running = false, raf = 0, perf = performance.now();
let nodes = {}, pipes = [], packets = [], events = [], loopL = 3000, trace = [], lastTrace = "", lastMetrics = "", lastLegend = "";
let corners = [];
let poolState = null, ringState = null, gateState = null, storyTags = {}, storyMetrics = null;
const DEF = () => (fig.clientWidth && fig.clientWidth < 600 ? { spin: -68, tilt: 52 } : { spin: -40, tilt: 57 });
const view = { spin: -40, tilt: 57, zoom: 1, focus: null, f: 0, z: 1 };

const W = (n) => new THREE.Vector3(n.x - 400, 0, n.y - 220);

const disposeLesson = () => {
  Object.values(nodes).forEach((o) => { scene.remove(o.g); o.g.traverse((x) => { if (x.geometry && x.geometry !== tagGeo) x.geometry.dispose(); }); o.lab?.remove(); o.tag.dispose(); o.name?.dispose(); });
  nodes = {};
  pipes.forEach((p) => killPipe(p)); pipes = [];
  clearPackets();
};

const PEOPLE = ["--req", "--res", "--sync", "--k-server", "--amber"];
const buildNode = (n, idx) => {
  const s = KIND[n.kind] || KIND.server, g = new THREE.Group(); g.position.copy(W(n)); scene.add(g);
  const o = { n, s, g, idx, act: 0, dim: 0, mats: [], bounce: -1e9, cur: 0, from: 0, target: 1, t0: 0 };
  const body = new THREE.Group(); g.add(body); o.body = body; const hit = [];
  const main = toon(s.col); o.mats.push([main, s.col]);
  if (s.shape === "laptop" || s.shape === "people") {
    hit.push(rbox(s.w, s.h, s.d, 6, main, body)); hit[0].position.y = s.h / 2;
    if (s.shape === "laptop") {
      const dev = toon("--k-dev"), lap = new THREE.Group(); lap.position.set(0, s.h + 5, 6); body.add(lap);
      rbox(72, 6, 48, 2.5, dev, lap);
      const kt = canvasTex(256, 160, (x) => { x.fillStyle = "#ebe5da"; x.fillRect(0, 0, 256, 160); x.fillStyle = "#cdc4b5"; for (let r = 0; r < 4; r++) for (let c = 0; c < 12; c++) x.fillRect(10 + c * 20, 10 + r * 22, 16, 17); x.fillRect(90, 104, 76, 40); });
      const kp = new THREE.Mesh(new THREE.PlaneGeometry(63, 39), new THREE.MeshBasicMaterial({ map: kt })); kp.rotation.x = -Math.PI / 2; kp.position.y = 3.2; lap.add(kp);
      const hinge = new THREE.Group(); hinge.position.set(0, 2, -23); hinge.rotation.x = -0.32; lap.add(hinge);
      rbox(72, 48, 5, 2.5, dev, hinge).position.y = 24;
      const ut = canvasTex(256, 168, (x) => { x.fillStyle = "#f7f3fb"; x.fillRect(0, 0, 256, 168); x.fillStyle = "#e6def4"; x.fillRect(0, 0, 256, 20);
        ["#e8786b", "#f2c464", "#8cc48c"].forEach((c, i) => { x.fillStyle = c; x.beginPath(); x.arc(14 + i * 14, 10, 4, 0, 7); x.fill(); });
        x.fillStyle = "#c9b8f2"; x.fillRect(16, 34, 224, 46); x.fillStyle = "#ddd3ee"; [96, 116, 136].forEach((y, i) => x.fillRect(16, y, [200, 150, 176][i], 10)); });
      const sp = new THREE.Mesh(new THREE.PlaneGeometry(63, 41), new THREE.MeshBasicMaterial({ map: ut })); sp.position.set(0, 24, 2.6); hinge.add(sp);
      o.top = s.h + 58;
    } else {
      const spots = [[-26, -18], [0, -24], [26, -18], [-14, 12], [14, 12]];
      spots.forEach(([x, z], i) => {
        const pm = toon(PEOPLE[(i + idx) % PEOPLE.length]), p = new THREE.Group(); p.position.set(x, s.h, z); body.add(p);
        const b = new THREE.Mesh(new THREE.CapsuleGeometry(6.5, 10, 6, 14), pm); b.position.y = 12; b.castShadow = true; p.add(b); b.add(new THREE.Mesh(new THREE.CapsuleGeometry(6.5 + 1.8, 10, 6, 14), inkHull));
        const hm = toon("--panel"), h = new THREE.Mesh(new THREE.SphereGeometry(5.6, 18, 12), hm); h.position.y = 29; h.castShadow = true; p.add(h); h.add(new THREE.Mesh(new THREE.SphereGeometry(5.6 + 1.7, 18, 12), inkHull));
      });
      o.top = s.h + 36;
    }
  } else if (s.shape === "cyl") {
    const c = cyl(s.w / 2, s.h, main, body); c.position.y = s.h / 2; hit.push(c);
    [0.34, 0.67].forEach((f) => { const t = new THREE.Mesh(new THREE.TorusGeometry(s.w / 2 + 0.4, 1.2, 6, 48), inkHull.clone()); t.material.side = THREE.FrontSide; themed.push([t.material, "--ink"]); t.rotation.x = Math.PI / 2; t.position.y = s.h * f; body.add(t); });
    o.top = s.h;
  } else if (s.shape === "queue") {
    const b = rbox(s.w, s.h, s.d, 8, main, body); b.position.y = s.h / 2; hit.push(b);
    const sm = toon("--panel"); for (let i = 0; i < 4; i++) { const m = rbox(18, 7, 26, 3, sm, body); m.position.set(-36 + i * 24, s.h + OUT + 3.5, 0); }
    o.top = s.h + 14;
  } else {
    const b = rbox(s.w, s.h, s.d, Math.min(13, s.h / 3), main, body); b.position.y = s.h / 2; hit.push(b); o.top = s.h;
  }
  hit.forEach((m) => (m.userData.node = n.id)); o.hit = hit;
  /* pulsing ring for active units, spinner for busy ones */
  o.ringMat = new THREE.MeshBasicMaterial({ color: C("--res"), transparent: true, opacity: 0, depthWrite: false });
  o.ring = new THREE.Mesh(new THREE.RingGeometry(1, 1.07, 72), o.ringMat); o.ring.rotation.x = -Math.PI / 2; o.ring.position.y = 0.6; g.add(o.ring);
  o.rr = Math.max(s.w, s.d) * 0.7 + 8;
  o.spin = new THREE.Group(); o.spin.position.y = 1; g.add(o.spin); o.spinMat = new THREE.MeshBasicMaterial({ color: C("--sync"), transparent: true, opacity: 0, depthWrite: false });
  for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2, d = new THREE.Mesh(new THREE.BoxGeometry(9, 1.5, 3), o.spinMat); d.position.set(Math.cos(a) * (o.rr + 8), 0, Math.sin(a) * (o.rr + 8)); d.rotation.y = -a + Math.PI / 2; o.spin.add(d); }
  if (!s.ground) { o.lab = document.createElement("div"); o.lab.className = "s3-inlab"; o.lab.innerHTML = svg(s.icon) + `<span>${esc(n.label)}</span>`; ov.append(o.lab); }
  o.tag = makeTag(scene); o.name = s.ground ? makeTag(scene) : null; if (o.name) o.name.set(n.label, "", s.icon);
  return o;
};

/* ───────── pipes: open marble-run troughs, packets roll inside ───────── */
const chevGeo = new THREE.CircleGeometry(4.2, 3);
const tint = (k) => C(kindVar[k] || "--req").lerp(C("--stage-bg"), 0.5);
const lineFor = (f, t, off) => {
  const a = nodes[f], b = nodes[t];
  if (!a || !b) return null;
  const pa = a.g.position.clone().setY(0), pb = b.g.position.clone().setY(0), d = pb.clone().sub(pa).normalize(), nrm = new THREE.Vector3(-d.z, 0, d.x);
  const trim = (o) => Math.min(Math.abs((o.s.w / 2 + 12) / (d.x || 1e-9)), Math.abs((o.s.d / 2 + 12) / (d.z || 1e-9)));
  const p0 = pa.addScaledVector(d, trim(a)).addScaledVector(nrm, off), p1 = pb.addScaledVector(d, -trim(b)).addScaledVector(nrm, off);
  return { p0, p1, dir: d, len: Math.max(1, p0.distanceTo(p1)) };
};
const makePipe = (key, f, t, k, off, born) => {
  const L = lineFor(f, t, off); if (!L) return null;
  const grp = new THREE.Group(); grp.position.set(L.p0.x, PY, L.p0.z); grp.rotation.y = Math.atan2(-L.dir.z, L.dir.x); scene.add(grp);
  const half = (r) => { const g = new THREE.CylinderGeometry(r, r, L.len, 24, 1, true, Math.PI / 2, Math.PI); g.rotateZ(-Math.PI / 2); g.translate(L.len / 2, 0, 0); return g; };
  const mat = new THREE.MeshToonMaterial({ color: tint(k), gradientMap: grad, side: THREE.DoubleSide, emissive: tint(k).multiplyScalar(0.45) });
  const tube = new THREE.Mesh(half(PR), mat); tube.castShadow = tube.receiveShadow = true; grp.add(tube);
  tube.add(new THREE.Mesh(half(PR + 1.8), inkHull));
  const portMat = toon("--panel");
  const ports = [0, 1].map((e) => { const p = rbox(8, 22, 26, 3, portMat, grp); p.position.set(e ? L.len - 2 : 2, -2, 0); return p; });
  const chevMat = new THREE.MeshBasicMaterial({ color: C(kindVar[k] || "--req").lerp(C("--ink"), 0.35), transparent: true, opacity: 0.45, depthWrite: false });
  const chev = Array.from({ length: Math.max(2, Math.floor(L.len / 38)) }, () => { const c = new THREE.Mesh(chevGeo, chevMat); c.rotation.x = -Math.PI / 2; c.position.y = -PR + 1.2; grp.add(c); return c; });
  return { key, f, t, k, off, L, grp, mat, chevMat, ports, chev, g: 0, target: 1, born, dead: false };
};
const killPipe = (p) => { scene.remove(p.grp); p.grp.traverse((o) => { if (o.geometry && o.geometry !== chevGeo) o.geometry.dispose(); }); p.mat.dispose(); p.chevMat.dispose(); };
const recolorPipe = (p, k) => { p.k = k; p.mat.color.copy(tint(k)); p.mat.emissive.copy(tint(k).multiplyScalar(0.45)); p.chevMat.color.copy(C(kindVar[k] || "--req").lerp(C("--ink"), 0.35)); };
const wantedPipes = (st) => {
  const out = [], seen = new Set(), flows = st.flows.filter(([a, b]) => a !== b && nodes[a] && nodes[b]);
  flows.forEach(([f, t, k]) => {
    const rev = flows.some(([a, b]) => a === t && b === f), key = `${f}>${t}|${rev ? 15 : 0}`;
    if (seen.has(key)) { if (k === "fail") out.find((x) => x.key === key).k = "fail"; return; }
    seen.add(key); out.push({ key, f, t, k, off: rev ? 15 : 0 });
  });
  return out;
};

/* ───────── packets & trace ───────── */
const pktGeo = new THREE.SphereGeometry(5.2, 22, 16), pktHull = new THREE.SphereGeometry(7, 22, 16), shGeo = new THREE.CircleGeometry(6, 20);
let marks = [];
const clearPackets = () => { packets.forEach((P) => { scene.remove(P.p, P.sh); P.mat.dispose(); P.hull.material.dispose(); P.sh.material.dispose(); }); packets = []; marks.forEach((m) => m.remove()); marks = []; };
const genericEvents = (st) => {
  const out = []; let t = 0;
  st.flows.forEach(([f, to, k]) => { if (f === to || !nodes[f] || !nodes[to]) return; out.push(k === "fail" ? { f, t: to, k, at: t, dur: 620, endAt: 0.55, end: "pop", done: "failed / missed" } : { f, t: to, k, at: t, dur: 650 }); t += 430; });
  return { list: out, L: Math.max(2600, t + 650 + 1000) };
};
const label = (id) => { const l = nodes[id]?.n.label || id; return l.length > 18 ? l.slice(0, 17) + "…" : l; };
const buildTrace = () => {
  trace = [];
  events.forEach((e) => {
    if (e.log === false) return;
    trace.push({ t: e.at, route: `${label(e.f)} → ${label(e.t)}`, m: e.log || KIND_WORD[e.k] || e.k, tone: e.tone || "" });
    if (e.done) trace.push({ t: e.at + e.dur + (e.hold || 0), route: `${label(e.f)} ✕ ${label(e.t)}`, m: e.done, tone: "bad" });
  });
  trace.sort((a, b) => a.t - b.t); trace.forEach((l, i) => (l.n = i + 1)); lastTrace = "";
};
const flushTrace = () => {
  const vis = intro > 0 ? [] : trace.filter((l) => l.t <= clock).slice(-7);
  const html = vis.length ? vis.map((l) => `<div class="${l.tone}"><span class="t">#${String(l.n).padStart(2, "0")}</span><span class="r">${esc(l.route)}</span><span class="m">${esc(l.m)}</span></div>`).join("") : `<span class="empty">${trace.length ? "waiting for the first event…" : "no traffic in this step"}</span>`;
  if (html !== lastTrace) { logEl.innerHTML = html; lastTrace = html; }
};

/* ───────── metrics ───────── */
const flushMetrics = () => {
  let items;
  if (storyMetrics && Object.keys(storyMetrics).length) items = Object.entries(storyMetrics).map(([k, [ic, v, tone]]) => [ic, k, v, tone]);
  else {
    const prev = lesson.steps[stepIdx - 1];
    items = (lesson.metricKeys || []).map((k) => { const v = step.metrics[k]; return [metricIcon(k), k, v ?? "—", v && (!prev || prev.metrics[k] !== v) ? "changed" : ""]; });
  }
  const html = items.map(([ic, k, v, tone]) => `<div class="s3-metric ${tone || ""}"><small>${svg(ic)}${esc(k)}</small><b>${esc(v)}</b></div>`).join("");
  if (html !== lastMetrics) { metricsEl.innerHTML = html; lastMetrics = html; }
};

/* ───────── story API for steps with an fx(t, S) function ───────── */
const S = {
  metric(icon, k, v, tone) { storyMetrics[k] = [icon, v, tone]; },
  tag(id, text, tone, icon, frac) { storyTags[id] = [text, tone, icon, frac]; },
  pool(id, states) { poolState = { id, states }; },
  ring(id, frac, v) { ringState = frac > 0 ? { id, frac, v } : null; },
  gate(st) { gateState = st; },
};

/* ───────── loading lessons and steps ───────── */
const load = (l, idx) => {
  disposeLesson();
  lesson = l; const now = performance.now();
  l.nodes.forEach((n, i) => { nodes[n.id] = buildNode(n, i); });
  const xs = l.nodes.map((n) => n.x - 400), zs = l.nodes.map((n) => n.y - 220);
  corners = [];
  for (const x of [Math.min(...xs) - 110, Math.max(...xs) + 110]) for (const y of [0, 110]) for (const z of [Math.min(...zs) - 90, Math.max(...zs) + 150]) corners.push(new THREE.Vector3(x, y, z));
  Object.assign(view, DEF(), { zoom: 1, focus: null, f: 0, z: 1 });
  stepIdx = -1; setStep(idx, now, true);
};
const setStep = (idx, now = performance.now(), first = false) => {
  stepIdx = idx; step = lesson.steps[idx]; clock = 0; intro = first ? 1500 : 450;
  const show = new Set(step.show || lesson.nodes.map((n) => n.id));
  Object.values(nodes).forEach((o) => {
    const target = show.has(o.n.id) ? 1 : 0, delay = first ? o.idx * 160 : 0;
    if (first) { o.cur = 0; o.from = 0; o.target = target; o.t0 = now + delay; }
    else if (target !== o.target) { o.from = o.cur; o.target = target; o.t0 = now; }
    if (step.active.includes(o.n.id)) o.bounce = now + (first ? 700 + o.idx * 120 : o.idx * 60);
  });
  /* pipes: keep shared, grow new ones (fan out), retract dropped ones (fan in) */
  const want = wantedPipes(step), base = first ? 950 : 80;
  pipes.forEach((p) => { const w = want.find((x) => x.key === p.key); if (!w) { p.target = 0; p.dead = true; } else if (w.k !== p.k) recolorPipe(p, w.k); });
  want.forEach((w, n) => { if (!pipes.some((p) => p.key === w.key && !p.dead)) { const p = makePipe(w.key, w.f, w.t, w.k, w.off, now + base + n * 130); if (p) pipes.push(p); } });
  /* events */
  const gen = step.ev ? { list: step.ev, L: step.L || Math.max(...step.ev.map((e) => e.at + e.dur + (e.hold || 0))) + 900 } : genericEvents(step);
  events = gen.list; loopL = gen.L;
  clearPackets();
  packets = events.map((e) => {
    const pk = want.find((w) => w.f === e.f && w.t === e.t), L = lineFor(e.f, e.t, pk ? pk.off : 0); if (!L) return null;
    const mat = new THREE.MeshToonMaterial({ color: C(kindVar[e.k]), gradientMap: grad, transparent: true });
    const p = new THREE.Mesh(pktGeo, mat); p.castShadow = true; p.visible = false;
    const hull = new THREE.Mesh(pktHull, new THREE.MeshBasicMaterial({ color: C("--ink"), side: THREE.BackSide, transparent: true })); p.add(hull); scene.add(p);
    const sh = new THREE.Mesh(shGeo, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.14, depthWrite: false })); sh.rotation.x = -Math.PI / 2; sh.visible = false; scene.add(sh);
    const xm = document.createElement("div"); xm.className = "s3-x"; xm.innerHTML = svg("x"); xm.style.opacity = 0; ov.append(xm); marks.push(xm);
    return { e, L, p, mat, hull, sh, xm };
  }).filter(Boolean);
  buildTrace();
  /* instruments */
  const base2 = now + (first ? 1300 : 150);
  pool.forEach((m, k) => { m.userData.born = base2 + k * 70; m.material.color.copy(C("--panel")); m.visible = false; });
  poolState = ringState = gateState = null; storyTags = {}; storyMetrics = null; lastMetrics = null;
  if (step.gate) { const [f, t] = step.gate.split(">"), L = lineFor(f, t, 0); if (L) { gate.visible = true; gate.position.copy(L.p0).lerp(L.p1, 0.5).setY(0); gate.rotation.y = Math.atan2(-L.dir.z, L.dir.x); gate.scale.y = 0.01; gate.userData.mid = gate.position.clone(); } } else gate.visible = false;
  const kinds = [...new Set(events.map((e) => e.k).concat(events.filter((e) => e.popKind).map((e) => e.popKind)))];
  const lg = kinds.map((k) => `<span><i style="background:var(${kindVar[k]})"></i>${LEGEND[k]}</span>`).join("");
  if (lg !== lastLegend) { legendEl.innerHTML = lg; lastLegend = lg; }
};

/* ───────── camera ───────── */
const v3 = new THREE.Vector3(), right = new THREE.Vector3(), front = new THREE.Vector3();
const placeCamera = () => {
  const th = THREE.MathUtils.degToRad(view.tilt), ph = THREE.MathUtils.degToRad(view.spin);
  camera.position.set(Math.sin(th) * Math.sin(ph) * 2400, Math.cos(th) * 2400, Math.sin(th) * Math.cos(ph) * 2400);
  camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  corners.forEach((c) => { v3.copy(c).applyMatrix4(camera.matrixWorldInverse); x0 = Math.min(x0, v3.x); x1 = Math.max(x1, v3.x); y0 = Math.min(y0, v3.y); y1 = Math.max(y1, v3.y); });
  const wide = fig.clientWidth > 720, pt = wide ? 0.14 : 0.04, pb = 0.06;
  let cx = (x0 + x1) / 2, hw = (x1 - x0) / 2, hh = (y1 - y0) / 2 / (1 - pt - pb);
  const asp = fig.clientWidth / Math.max(1, fig.clientHeight); if (hw / hh < asp) hw = hh * asp; else hh = hw / asp;
  let cy = (y0 + y1) / 2 + hh * (pt - pb);
  if (view.f > 0.001 && view.focus && nodes[view.focus]) { const o = nodes[view.focus]; v3.set(o.g.position.x, o.s.h / 2, o.g.position.z).applyMatrix4(camera.matrixWorldInverse);
    cx += (v3.x - cx) * view.f; cy += (v3.y - cy) * view.f; const k = 1 + view.f * 1.2; hw /= k; hh /= k; }
  hw /= view.z; hh /= view.z;
  Object.assign(camera, { left: cx - hw, right: cx + hw, top: cy + hh, bottom: cy - hh }); camera.updateProjectionMatrix();
};
const place = (el, p, dy = 0) => { v3.copy(p).project(camera); const x = (v3.x + 1) / 2 * fig.clientWidth, y = (1 - v3.y) / 2 * fig.clientHeight; el.style.transform = `translate(${x.toFixed(1)}px,${(y + dy).toFixed(1)}px) translate(-50%,-50%)`; };

/* ───────── pointer ───────── */
const bindPointer = () => {
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const pick = (e) => { const r = fig.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(Object.values(nodes).filter((o) => o.cur > 0.5).flatMap((o) => o.hit), false)[0]; return hit ? hit.object.userData.node : null; };
  let drag = null;
  fig.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, spin: view.spin, tilt: view.tilt, moved: false }; fig.setPointerCapture(e.pointerId); });
  fig.addEventListener("pointermove", (e) => {
    if (drag) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > 4) { drag.moved = true; fig.classList.add("grab"); tip.classList.remove("show"); }
      if (drag.moved) { view.spin = drag.spin - dx * 0.35; view.tilt = Math.max(25, Math.min(75, drag.tilt - dy * 0.25)); } return; }
    const id = pick(e); fig.classList.toggle("hover", !!id);
    if (id) { const o = nodes[id], r = fig.getBoundingClientRect(); tip.innerHTML = `<b>${esc(o.n.label)}</b>${o.n.info || esc(o.s.desc)}`;
      tip.style.left = Math.max(8, Math.min(r.width - 290, e.clientX - r.left + 14)) + "px"; tip.style.top = (e.clientY - r.top + 16) + "px"; tip.classList.add("show"); }
    else tip.classList.remove("show");
  });
  const endDrag = (e) => { if (drag && !drag.moved && e.type === "pointerup") { const id = pick(e); view.focus = id && id !== view.focus ? id : null; } drag = null; fig.classList.remove("grab"); };
  fig.addEventListener("pointerup", endDrag); fig.addEventListener("pointercancel", endDrag);
  fig.addEventListener("pointerleave", () => { tip.classList.remove("show"); fig.classList.remove("hover"); });
  fig.addEventListener("dblclick", () => E.resetView());
};
q('[data-a="replay"]').onclick = () => E.replay();
pauseBtn.onclick = () => E.togglePause();
q('[data-a="view"]').onclick = () => E.resetView();
q('[data-a="zin"]').onclick = () => (view.zoom = Math.min(2.6, view.zoom * 1.25));
q('[data-a="zout"]').onclick = () => (view.zoom = Math.max(0.7, view.zoom / 1.25));
scrub.addEventListener("input", () => { scrubbing = true; setPaused(true); intro = 0; clock = (scrub.value / 1000) * loopL; });
scrub.addEventListener("change", () => (scrubbing = false));
const setPaused = (p) => { paused = p; pauseBtn.innerHTML = svg(p ? "play" : "pause") + (p ? "Play" : "Pause"); };
setPaused(false);

/* ───────── frame loop ───────── */
let last = performance.now();
const frame = (now) => {
  raf = running ? requestAnimationFrame(frame) : 0;
  if (!lesson || failed) return;
  const dt = Math.min(64, now - last); last = now; perf = now;
  const k = 1 - Math.exp(-dt / 140);
  if (intro > 0) intro -= dt; else if (!paused) clock = (clock + dt * (reduce ? 0.6 : 1)) % loopL;
  if (!scrubbing) scrub.value = Math.round((clock / loopL) * 1000);
  view.f += ((view.focus ? 1 : 0) - view.f) * k; view.z += (view.zoom - view.z) * k;
  placeCamera();
  const ph = THREE.MathUtils.degToRad(view.spin);
  right.set(Math.cos(ph), 0, -Math.sin(ph)); front.set(Math.sin(ph), 0, Math.cos(ph));
  const wpp = (camera.right - camera.left) / Math.max(1, fig.clientWidth), tagScale = Math.max(1, Math.min(1.9, wpp * 1.15));

  /* story first, so this frame's instruments reflect it */
  storyTags = {}; poolState = null; ringState = null; storyMetrics = {};
  if (intro <= 0 && step.fx) { try { step.fx(clock, S); } catch (err) { console.error(err); } }

  /* units: drop in (fan in), shrink away when a step hides them (fan out), bounce when active */
  const act = new Set(step.active), bg = C("--stage-bg"), pulse = reduce ? 0 : Math.sin(now / 280), self = {};
  step.flows.forEach(([a, b, kk]) => { if (a === b) self[a] = kk; });
  Object.values(nodes).forEach((o) => {
    const p = reduce ? 1 : clamp01((now - o.t0) / (o.target ? 650 : 420));
    o.cur = o.target ? o.from + (1 - o.from) * easeOutBack(p) : o.from * (1 - easeInCubic(p));
    const bp = clamp01((now - o.bounce) / 420), bump = bp > 0 && bp < 1 ? Math.sin(bp * Math.PI) * 0.07 : 0, sc = Math.max(0.001, o.cur);
    o.g.scale.set(sc * (1 + bump * 0.5), sc * (1 + bump), sc * (1 + bump * 0.5)); o.g.visible = o.cur > 0.002;
    o.g.position.y = o.target ? (1 - clamp01(p * 1.4)) * 55 : 0;
    o.act += ((act.has(o.n.id) ? 1 : 0) - o.act) * k; o.dim += ((act.size && !act.has(o.n.id) ? 1 : 0) - o.dim) * k;
    o.mats.forEach(([m, v]) => m.color.copy(C(v)).lerp(bg, o.dim * 0.45));
    o.ringMat.opacity = o.act * (0.6 + 0.3 * pulse) * clamp01(o.cur); const rs = o.rr * (1 + 0.03 * pulse); o.ring.scale.set(rs, rs, 1);
    const busy = self[o.n.id]; o.spinMat.opacity += ((busy ? 0.85 : 0) - o.spinMat.opacity) * k; if (busy) o.spinMat.color.copy(C(kindVar[busy])); o.spin.rotation.y += reduce ? 0 : dt * 0.0012;
    if (o.lab) { o.lab.style.opacity = o.cur < 0.7 ? 0 : o.dim > 0.5 ? 0.5 : 1; place(o.lab, v3.set(o.g.position.x, o.s.h * 0.45 * o.cur, o.g.position.z).addScaledVector(front, o.s.d * 0.12)); }
    /* ground tags in front of the unit */
    const r0 = Math.max(o.s.w, o.s.d) * 0.5 + 24, hasPool = poolState && poolState.id === o.n.id;
    if (o.name) { o.name.holder.position.copy(o.g.position).addScaledVector(front, r0).setY(0); o.name.want = o.cur > 0.5 ? 1 : 0; }
    o.tag.holder.position.copy(o.g.position).addScaledVector(front, hasPool ? r0 + 66 : o.name ? r0 + 30 * tagScale : r0 + 4).setY(0);
    const spec = storyTags[o.n.id] || (step.g && step.g[o.n.id]) || null;
    if (spec) o.tag.set(...spec); else o.tag.want = 0;
    if (o.cur < 0.5) o.tag.want = 0;
  });
  if (gate.visible) { const spec = storyTags.mid || (step.g && step.g.mid); if (spec) midTag.set(...spec); else midTag.want = 0; midTag.holder.position.copy(gate.userData.mid).addScaledVector(front, 118).addScaledVector(right, 40).setY(0); }
  else midTag.want = 0;
  allTags.forEach((T) => { T.holder.rotation.y = ph; const w = intro > 0 && !Object.values(nodes).some((o) => o.name === T) ? 0 : T.want; T.alpha += (w - T.alpha) * k * 1.3; T.mat.opacity = T.alpha; T.holder.scale.setScalar(tagScale * (0.85 + 0.15 * T.alpha)); });

  /* worker pool slots, fanning out one by one */
  pool.forEach((m, i) => {
    const ps = poolState, show = ps && i < ps.states.length && nodes[ps.id], bp = clamp01((now - m.userData.born) / 380); m.visible = !!show && bp > 0;
    if (!m.visible) return;
    const o = nodes[ps.id], n = ps.states.length; m.scale.setScalar(Math.max(0.001, easeOutBack(bp)));
    m.position.copy(o.g.position).addScaledVector(front, Math.max(o.s.w, o.s.d) * 0.5 + 30).addScaledVector(right, (i - (n - 1) / 2) * 17).setY(5.5 + OUT); m.rotation.y = ph;
    m.material.color.lerp(C({ idle: "--panel", busy: "--req", stuck: "--fail", free: "--res" }[ps.states[i]] || "--panel"), 0.2);
  });
  /* countdown ring */
  if (ringState && nodes[ringState.id]) { const o = nodes[ringState.id], r = o.rr + 4; [cd, cdTrack].forEach((m) => { m.visible = true; m.position.set(o.g.position.x, 1, o.g.position.z); m.scale.set(r, r, 1); }); cdMat.color.copy(C(ringState.v)); cdGeo.setDrawRange(0, Math.round(clamp01(ringState.frac) * 96) * 6); }
  else cd.visible = cdTrack.visible = false;
  /* breaker gate */
  if (gate.visible) { const t = intro > 0 ? 0.01 : gateState === "OPEN" ? 1 : gateState === "HALF-OPEN" ? 0.5 : 0.08; gate.scale.y += (t - gate.scale.y) * k; gateMat.color.copy(C(gateState === "OPEN" ? "--fail" : gateState === "HALF-OPEN" ? "--req" : "--res")); }

  /* pipes grow from the source and retract when dropped */
  pipes.forEach((p) => {
    if (now < p.born && !p.dead) { p.grp.visible = false; return; } p.grp.visible = true;
    p.g += (p.target - p.g) * (1 - Math.exp(-dt / 110)); const g = Math.max(0.002, p.g);
    p.grp.scale.set(g, 1, 1); p.ports.forEach((x) => x.scale.set(1 / g, 1, 1));
    p.chev.forEach((c, i) => { const u = ((i + now / 1400) % p.chev.length) / p.chev.length; c.position.x = 10 + u * (p.L.len - 20); c.scale.set(1 / g, 1, 1); });
    p.chevMat.opacity = 0.45;
  });
  pipes = pipes.filter((p) => { if (p.dead && p.g < 0.01) { killPipe(p); return false; } return true; });

  /* packets roll through the pipes at a steady height */
  packets.forEach((P) => {
    const e = P.e, end = e.endAt ?? 1, popMs = 320, hold = e.hold || 0;
    const local = intro > 0 ? -1 : clock - e.at, holdEnd = e.dur + hold, popEnd = holdEnd + (e.end ? popMs : 0);
    const vis = local >= 0 && local < popEnd; let t = 0, pop = 0;
    if (vis) { if (local < e.dur) t = easeInOut(local / e.dur) * end; else { t = end; if (local >= holdEnd) pop = (local - holdEnd) / popMs; } }
    const show = vis && !(!e.end && local >= e.dur);
    P.p.visible = P.sh.visible = show;
    const xo = e.end === "pop" && local >= holdEnd && local < holdEnd + 900 ? Math.max(0, 1 - (local - holdEnd) / 900) : 0; P.xm.style.opacity = xo;
    if (!show && !xo) return;
    const pos = P.L.p0.clone().lerp(P.L.p1, t); pos.y = PY - PR + 6.6;
    if (show) {
      P.p.position.copy(pos); P.p.scale.setScalar(e.end === "fade" ? 1 - pop : 1 + pop * 0.9); P.mat.opacity = P.hull.material.opacity = 1 - pop;
      if (e.popKind) P.mat.color.copy(C(kindVar[pop > 0 ? e.popKind : e.k]));
      P.sh.position.set(pos.x, 0.5, pos.z); P.sh.material.opacity = 0.14 * (1 - pop);
    }
    place(P.xm, pos, -16);
  });

  flushMetrics(); flushTrace();
  renderer.render(scene, camera);
};

/* ───────── public API ───────── */
const E = {
  el: root,
  attach(slot) { if (!renderer && !failed) init(); slot.appendChild(root); resize(); if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); } },
  detach() { running = false; cancelAnimationFrame(raf); root.remove(); },
  show(l, idx) { if (failed) return; if (!lesson || lesson.id !== l.id) load(l, idx); else if (idx !== stepIdx) setStep(idx); },
  replay() { clock = 0; intro = 0; setPaused(false); },
  togglePause() { setPaused(!paused); return paused; },
  isPaused: () => paused,
  resetView() { Object.assign(view, DEF(), { focus: null, zoom: 1 }); },
  recolor() {
    if (!renderer) return;
    themed.forEach(([m, v]) => m.color.copy(C(v))); buildGrid();
    pipes.forEach((p) => recolorPipe(p, p.k)); packets.forEach((P) => { P.mat.color.copy(C(kindVar[P.e.k])); P.hull.material.color.copy(C("--ink")); });
    allTags.forEach((T) => T.redraw());
  },
};
window.Stage3D = E;
document.fonts?.ready.then(() => allTags.forEach((T) => T.redraw()));
window.dispatchEvent(new Event("stage3d-ready"));
