/* Optional progress sync with the Django API in sync-api/. Off unless <meta name="atlas-sync" content="https://…"> is set. */
(() => {
  const URL_ = (document.querySelector('meta[name="atlas-sync"]')?.content || "").replace(/\/$/, "");
  const KEY = "backend-atlas:sync-key";
  const A = window.ATLAS;
  if (!A) return;
  let key = localStorage.getItem(KEY) || "", status = "", timer = 0, busy = false;

  const call = async (method, path, body) => {
    const r = await fetch(URL_ + path, { method, headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error(r.status === 401 ? "That sync key isn't recognised." : `Sync failed (${r.status}).`);
    return r.json();
  };
  const apply = (data) => {
    const d = A.store.data, before = JSON.stringify([d.lessons, d.q, d.practice]);
    ["lessons", "q", "practice"].forEach((k) => { if (data[k]) d[k] = data[k]; });
    if (data.last && !d.last) d.last = data.last;
    origSave(); if (JSON.stringify([d.lessons, d.q, d.practice]) !== before) A.rerender();
  };
  const push = async () => {
    if (!key || busy) return; busy = true;
    try { const { theme, openModules, ...rest } = A.store.data; const r = await call("PUT", "/api/progress", { data: rest }); apply(r.data); status = `Synced · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`; }
    catch (e) { status = e.message; }
    busy = false; paint();
  };
  const origSave = A.store.save.bind(A.store);
  A.store.save = () => { origSave(); if (key) { clearTimeout(timer); timer = setTimeout(push, 2500); } };

  let slot = null;
  const paint = () => {
    if (!slot || !slot.isConnected) return;
    slot.innerHTML = key
      ? `<div class="sync"><small>SYNC</small><p>On. Use this key on your other devices:</p><code class="sync-key">${key}</code>
         <div class="nav-row"><button class="btn" id="syCopy">Copy key</button><button class="btn" id="syOff">Turn off here</button></div><p class="muted-s">${status}</p></div>`
      : `<div class="sync"><small>SYNC ACROSS DEVICES</small><div class="nav-row"><button class="btn btn-primary" id="syNew">Turn on sync</button></div>
         <label class="sync-link">or link this device <input id="syKey" placeholder="atlas_…" autocomplete="off" spellcheck="false" /></label><p class="muted-s">${status}</p></div>`;
    slot.querySelector("#syNew")?.addEventListener("click", async () => { try { key = (await call("POST", "/api/spaces")).key; localStorage.setItem(KEY, key); await push(); } catch (e) { status = e.message; paint(); } });
    slot.querySelector("#syKey")?.addEventListener("change", async (e) => { key = e.target.value.trim(); if (!key) return; try { apply((await call("GET", "/api/progress")).data); localStorage.setItem(KEY, key); await push(); } catch (err) { key = ""; status = err.message; paint(); } });
    slot.querySelector("#syCopy")?.addEventListener("click", async (e) => { try { await navigator.clipboard.writeText(key); e.target.textContent = "Copied"; } catch (_) {} });
    slot.querySelector("#syOff")?.addEventListener("click", () => { key = ""; localStorage.removeItem(KEY); status = "Sync is off on this device. Your progress here is kept."; paint(); });
  };
  window.SYNC = { mount(el) { if (!URL_ || !el) return; slot = el; paint(); } };
  window.SYNC.mount(document.getElementById("syncSlot")); // home may have rendered before this script ran
  if (URL_ && key) push();
})();
