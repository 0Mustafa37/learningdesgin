"""Render short captioned MP4 clips of lessons from the live 3D scene.

    python tools/make_clips.py timeouts-retries caching        # writes assets/clips/<id>.mp4 + .jpg

Time is driven frame by frame (performance.now and requestAnimationFrame are replaced), so the video is smooth even
on a software renderer. When narration audio exists in assets/voice/ for a step, it is mixed in at that step.
"""
import functools, http.server, json, os, re, subprocess, sys, tempfile, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "clips")
FPS, W, H = 24, 1280, 720
FAKE_TIME = """
(() => { let T = 0, q = [];
  performance.now = () => T;
  window.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
  window.cancelAnimationFrame = () => {};
  window.__tick = (ms) => { T += ms; const cbs = q; q = []; cbs.forEach((cb) => { try { cb(T); } catch (e) { console.error(e); } }); };
})();"""
CSS = f"""
#stageSlot {{ position: fixed !important; left: 0; top: 0; width: {W}px; height: {H}px; z-index: 9999; margin: 0; background: var(--paper); }}
.s3-foot, .s3-trace, .s3-sr {{ display: none !important; }}
.s3-stage {{ height: {H}px; border-radius: 0 !important; border: 0 !important; }}
.s3-fig {{ height: {H}px !important; }}
.clip-title {{ position: absolute; left: 24px; bottom: 22px; z-index: 7; font: 700 15px var(--display); color: var(--ink); background: var(--panel); border: 1.5px solid var(--ink); border-radius: 999px; padding: 5px 12px; }}
.clip-card {{ position: absolute; inset: 0; z-index: 8; display: grid; place-content: center; text-align: center; gap: 10px; background: color-mix(in oklab, var(--paper), transparent 6%); }}
.clip-card h1 {{ font: 700 54px/1.05 var(--display); margin: 0; color: var(--ink); }}
.clip-card p {{ font: 500 20px var(--display); margin: 0; color: var(--muted); }}
.clip-card small {{ font: 700 14px "JetBrains Mono", monospace; letter-spacing: .12em; color: var(--muted); }}
.vc-cap {{ bottom: 70px !important; font-size: 20px !important; }}
"""


def sentences(t):
    return [x.strip() for x in re.findall(r'[^.!?]+[.!?]+["”)]?\s*|[^.!?]+$', t) if x.strip()] or [t]


def clip(page, lid, man):
    page.add_style_tag(content=CSS)  # before the lesson mounts, so the camera fits the 16:9 frame
    page.evaluate(f"location.hash = '#/lesson/{lid}/0'")
    for _ in range(5):
        page.evaluate("__tick(1000/24)")
    page.evaluate("Stage3D.resetView()")  # re-pick the camera for the 16:9 frame
    for _ in range(30):
        page.evaluate("__tick(1000/24)")
    title, sub = page.evaluate(f"ATLAS.lessonTitle({lid!r})")
    steps = [i for i, s in enumerate(page.evaluate(f"ATLAS.steps({lid!r})")) if s["tag"] != "lab"]
    tmp = tempfile.mkdtemp()
    frame, audio = 0, []
    stage = page.query_selector("#stageSlot .s3-stage")

    def shot(n):
        nonlocal frame
        for _ in range(n):
            page.evaluate(f"__tick({1000 / FPS})")
            stage.screenshot(path=os.path.join(tmp, f"{frame:05d}.jpg"), type="jpeg", quality=88)
            frame += 1

    for k, i in enumerate(steps):
        if k:
            page.evaluate(f"ATLAS.goStep({i})")
        text = page.evaluate(f"ATLAS.narration({lid!r}, {i})")
        st = page.evaluate(f"ATLAS.steps({lid!r})[{i}]")
        f = man.get(f"{lid}/{i}")
        dur = None
        if f and os.path.exists(os.path.join(ROOT, "assets", "voice", f["f"])):
            p = os.path.join(ROOT, "assets", "voice", f["f"])
            dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p], capture_output=True, text=True).stdout or 0) + 0.8
            audio.append((frame / FPS + (2.6 if k == 0 else 0), p))
        secs = max(6.5, dur or len(text) * 0.058) + (2.6 if k == 0 else 0)
        page.evaluate("""([t, n, total]) => { const fig = document.querySelector('#stageSlot .s3-fig');
            let el = fig.querySelector('.clip-title'); if (!el) { el = document.createElement('div'); el.className = 'clip-title'; fig.appendChild(el); }
            el.textContent = `${n} / ${total} · ${t}`; }""", [st["title"], k + 1, len(steps)])
        parts, total_chars = sentences(text), len(text)
        start = frame
        if k == 0:
            page.evaluate("""([t, s]) => { const fig = document.querySelector('#stageSlot .s3-fig'); const c = document.createElement('div'); c.className = 'clip-card';
                c.innerHTML = `<small>BACKEND ATLAS</small><h1></h1><p></p>`; c.querySelector('h1').textContent = t; c.querySelector('p').textContent = s; fig.appendChild(c); }""", [title, sub])
            shot(int(2.6 * FPS))
            page.evaluate("document.querySelector('.clip-card')?.remove()")
            start = frame
        body = secs - (2.6 if k == 0 else 0)
        n = int(body * FPS)
        for j in range(n):
            at = j / n * total_chars
            acc, cap = 0, parts[-1]
            for ptxt in parts:
                acc += len(ptxt) + 1
                if acc >= at:
                    cap = ptxt
                    break
            page.evaluate("""(t) => { const fig = document.querySelector('#stageSlot .s3-fig'); let c = fig.querySelector('.vc-cap');
                if (!c) { c = document.createElement('div'); c.className = 'vc-cap show'; fig.appendChild(c); } if (c.textContent !== t) c.textContent = t; }""", cap)
            shot(1)
    os.makedirs(OUT, exist_ok=True)
    mp4, jpg = os.path.join(OUT, f"{lid}.mp4"), os.path.join(OUT, f"{lid}.jpg")
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", os.path.join(tmp, "%05d.jpg")]
    for _, p in audio:
        cmd += ["-i", p]
    if audio:
        mix = "".join(f"[{n + 1}:a]adelay={int(t * 1000)}:all=1[a{n}];" for n, (t, _) in enumerate(audio)) + "".join(f"[a{n}]" for n in range(len(audio))) + f"amix=inputs={len(audio)}:normalize=0[aout]"
        cmd += ["-filter_complex", mix, "-map", "0:v", "-map", "[aout]", "-c:a", "aac", "-b:a", "64k"]
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "27", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4]
    subprocess.run(cmd, check=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", os.path.join(tmp, f"{int(FPS * 4.5):05d}.jpg"), "-vf", "scale=640:-2", "-q:v", "4", jpg], check=True)
    print(f"✓ {lid}: {frame / FPS:.0f} s, {os.path.getsize(mp4) // 1024} KB{' with narration' if audio else ''}")
    idx_path = os.path.join(OUT, "index.json")
    idx = json.load(open(idx_path)) if os.path.exists(idx_path) else {}
    idx[lid] = {"secs": round(frame / FPS), "voice": bool(audio)}
    json.dump(idx, open(idx_path, "w"), indent=1, sort_keys=True)


def main():
    ids = sys.argv[1:]

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8797), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    man = json.load(open(os.path.join(ROOT, "assets", "voice", "manifest.json"))).get("files", {})
    with sync_playwright() as p:
        kw = {"args": ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]}
        if os.environ.get("CHROME_PATH"):
            kw["executable_path"] = os.environ["CHROME_PATH"]
        b = p.chromium.launch(**kw)
        for lid in ids:
            page = b.new_page(viewport={"width": W, "height": H})
            page.add_init_script(FAKE_TIME)
            page.goto("http://127.0.0.1:8797/index.html#/practice")
            page.wait_for_function("window.Stage3D && window.ATLAS")
            clip(page, lid, man)
            page.close()
        b.close()
    srv.shutdown()


if __name__ == "__main__":
    main()
