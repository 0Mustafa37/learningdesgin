"""Generate lesson narration with Gemini text-to-speech (the voices from Google AI Studio).

Runs in GitHub Actions (.github/workflows/voices.yml) with the GEMINI_API_KEY secret, or locally:

    pip install playwright && python -m playwright install chromium   # ffmpeg must be on PATH
    GEMINI_API_KEY=... python tools/make_voices.py --max 50

The narration text comes from the site itself (window.ATLAS.narrations()). For every step a narration script is
written first (Gemini text model, guided by the hand-written lesson in data/scripts-gold.js) in English and Egyptian
Arabic, kept in assets/voice/scripts.json, then voiced. Each file is stored with a hash of its text in assets/voice/manifest.json; the site only plays a
file whose hash matches the current text, and this script regenerates files whose text changed. It is resumable:
run it again (the workflow runs daily) until everything is generated.
"""
import argparse, base64, functools, http.server, json, os, re, subprocess, sys, threading, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VOICE_DIR = os.path.join(ROOT, "assets", "voice")
MANIFEST = os.path.join(VOICE_DIR, "manifest.json")
SCRIPTS = os.path.join(VOICE_DIR, "scripts.json")  # narration scripts {key: {src, en, ar}}, written once and kept in the repo
API = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
STYLE = {
    "en": "Read this aloud as a calm, clear engineering teacher, at a steady pace: ",
    "ar": ("Speak this in natural Egyptian Arabic with a Cairo accent, warm and relaxed, like an Egyptian senior engineer "
           "explaining to a friend over coffee. Conversational rhythm and real intonation, never robotic or news-anchor style. "
           "Pronounce the English technical terms the way Egyptian developers say them: "),
}
LANG_CODE = {"en": "en-US", "ar": "ar-EG"}


def js_hash(s):
    """Same djb2 hash as voice.js (over UTF-16 code units)."""
    h = 5381
    b = s.encode("utf-16-le")
    for i in range(0, len(b), 2):
        h = ((h << 5) + h + (b[i] | (b[i + 1] << 8))) & 0xFFFFFFFF
    return format(h, "x")


def narrations():
    from playwright.sync_api import sync_playwright

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8798), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        kw = {"executable_path": os.environ["CHROME_PATH"]} if os.environ.get("CHROME_PATH") else {}
        b = p.chromium.launch(**kw)
        pg = b.new_page()
        pg.goto("http://127.0.0.1:8798/index.html#/")
        pg.wait_for_function("window.ATLAS && window.ATLAS.narrations")
        items = pg.evaluate("ATLAS.narrations()")
        lessons = {}
        for k, _ in items:
            lid = k.rsplit("/", 1)[0]
            if lid not in lessons:
                lessons[lid] = pg.evaluate("(id) => ATLAS.lessonContext(id)", lid)
        gold = pg.evaluate("window.SCRIPTS_GOLD || {}")
        b.close()
    srv.shutdown()
    return items, lessons, gold


WRITE = """You are writing the voice-over for "Backend Atlas", an animated 3D course that prepares backend engineers for
system-design and senior interviews. The learner watches a 3D diagram of the step (units, pipes, packets moving) while
your narration plays. Write one narration script per step of the lesson below, in two versions:

"en": natural spoken English.
"ar": Egyptian colloquial Arabic (عامية مصرية), the way a friendly Egyptian senior engineer explains to a colleague.
      Not Modern Standard Arabic and not a literal translation. Keep technical terms in English as Egyptian developers
      say them (الـ cache، الـ timeout، retry، worker، query، index، deploy…). Keep numbers, units, code names in English.

Each script must be EXCELLENT teaching, 45 to 75 seconds when spoken (about 110 to 170 English words):
1. Open with what is happening in the diagram right now ("Look at…", "Watch the…" / "بُص على…").
2. Explain WHY it happens: the mechanism, not just the fact.
3. Make it concrete with the step's real numbers, code or setup (use only facts given below; do not invent figures).
4. Add the practical edge: a common mistake, a trade-off, or how to say it in an interview.
5. End with exactly "Key idea: …" / "الفكرة الأساسية: …" restating the step's key idea.
Spoken style only: short sentences, no lists, no markdown, no emojis, no headings. Each step builds on the previous one.

Here is the quality and tone to match (a hand-written lesson):
{gold}

Return only JSON: {{"<step key>": {{"en": "...", "ar": "..."}}, ...}} with one entry for every step key listed.

LESSON:
{lesson}
"""
TEXT_MODELS = ["gemini-3.5-flash", "gemini-3-flash-preview", "gemini-2.5-flash"]


def write_scripts(lesson, gold, key, model):
    """Try the requested model, then fall back; retry busy (429/503) responses with backoff."""
    last = None
    for m in [model] + [x for x in TEXT_MODELS if x != model]:
        for attempt in range(4):
            try:
                return _write(lesson, gold, key, m)
            except urllib.error.HTTPError as e:
                last = e
                if e.code in (429, 500, 503):
                    time.sleep(10 * (attempt + 1))
                    continue
                break  # 404 (model not available) etc.: try the next model
            except (TimeoutError, OSError, ValueError, KeyError) as e:  # slow/dropped response or half-written JSON
                last = e
                print(f"  {lesson['id']} with {m}: {type(e).__name__}, retrying")
                time.sleep(5 * (attempt + 1))
    raise last


def _write(lesson, gold, key, model):
    prompt = WRITE.format(gold=json.dumps(gold, ensure_ascii=False, indent=1), lesson=json.dumps(lesson, ensure_ascii=False, indent=1))
    body = {"contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0.6}}
    req = urllib.request.Request(API.format(model=model), data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-goog-api-key": key})
    with urllib.request.urlopen(req, timeout=300) as r:
        data = json.load(r)
    out = json.loads(data["candidates"][0]["content"]["parts"][0]["text"])
    return {k: {"en": v["en"].strip(), "ar": v["ar"].strip()} for k, v in out.items() if isinstance(v, dict) and v.get("en") and v.get("ar")}


def tts(text, lang, key, model, voice):
    body = {
        "contents": [{"parts": [{"text": STYLE[lang] + text}]}],
        "generationConfig": {"responseModalities": ["AUDIO"], "speechConfig": {"languageCode": LANG_CODE[lang], "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}}},
    }
    req = urllib.request.Request(API.format(model=model), data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-goog-api-key": key})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.load(r)
    part = data["candidates"][0]["content"]["parts"][0]["inlineData"]
    rate = int((re.search(r"rate=(\d+)", part.get("mimeType", "")) or [0, 24000])[1])
    return base64.b64decode(part["data"]), rate


EDGE_DEFAULT = {"en": "en-US-AndrewMultilingualNeural", "ar": "ar-EG-ShakirNeural"}


def edge_tts_file(text, voice, path):
    """Microsoft neural voices (the 'Read aloud' voices in Edge). No key and no daily quota; ar-EG voices speak Egyptian."""
    import asyncio, edge_tts
    os.makedirs(os.path.dirname(path), exist_ok=True)
    asyncio.run(edge_tts.Communicate(text, voice, rate="-4%").save(path))


def duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], capture_output=True, text=True).stdout
    try:
        return float(out)
    except ValueError:
        return 0.0


def sane(path, text, lang):
    """Reject truncated, silent or runaway audio (e.g. a model that also read its instructions aloud)."""
    words = len(text.split())
    expect = words / (2.2 if lang == "ar" else 2.5)
    d = duration(path)
    return 0.5 * expect <= d <= 1.9 * expect + 3, d, expect


def to_mp3(pcm, rate, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "s16le", "-ar", str(rate), "-ac", "1", "-i", "pipe:0", "-b:a", "40k", path], input=pcm, check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=90, help="files to generate this run (free-tier quotas are small)")
    ap.add_argument("--rpm", type=float, default=8, help="requests per minute")
    ap.add_argument("--model", default=os.environ.get("TTS_MODEL", "gemini-3.1-flash-tts-preview"))
    ap.add_argument("--engine", default=os.environ.get("TTS_ENGINE", "edge"), choices=["edge", "gemini"], help="edge = Microsoft neural voices (free, no quota); gemini = Gemini TTS (needs billing for volume)")
    ap.add_argument("--voice", default=os.environ.get("TTS_VOICE", ""), help="English voice (default: en-US-AndrewMultilingualNeural / Kore)")
    ap.add_argument("--ar-voice", default=os.environ.get("TTS_AR_VOICE", ""), help="Egyptian voice (default: ar-EG-ShakirNeural / Sulafat; ar-EG-SalmaNeural is the female edge voice)")
    ap.add_argument("--only", default="", help="regex on keys, e.g. '^timeouts-retries/'")
    ap.add_argument("--lang", default="both", choices=["en", "ar", "both"], help="which narration to voice")
    ap.add_argument("--text-model", default=os.environ.get("TEXT_MODEL", "gemini-3.5-flash"), help="model that writes the narration scripts")
    ap.add_argument("--scripts-max", type=int, default=120, help="lessons to write scripts for this run")
    ap.add_argument("--fake", action="store_true", help="write silent files instead of calling the API (for testing)")
    a = ap.parse_args()
    if a.engine == "edge":
        a.voice, a.ar_voice = a.voice or EDGE_DEFAULT["en"], a.ar_voice or EDGE_DEFAULT["ar"]
        a.rpm = max(a.rpm, 60)
        a.max = max(a.max, 2000)
    else:
        a.voice, a.ar_voice = a.voice or "Kore", a.ar_voice or "Sulafat"
    key = os.environ.get("GEMINI_API_KEY", "")
    if not key and not a.fake and a.engine == "gemini":
        sys.exit("GEMINI_API_KEY is not set. Create a key at https://aistudio.google.com/apikey and add it as a repository secret.")

    man = json.load(open(MANIFEST)) if os.path.exists(MANIFEST) else {}
    files = man.setdefault("files", {})
    man.update({"engine": a.engine, "model": a.model if a.engine == "gemini" else "edge-tts", "voice": a.voice, "ar_voice": a.ar_voice})
    voice_for = lambda lang: (a.ar_voice if lang == "ar" else a.voice) if a.engine == "gemini" else f"edge:{a.ar_voice if lang == 'ar' else a.voice}"
    en, lessons, gold = narrations()
    scripts = json.load(open(SCRIPTS)) if os.path.exists(SCRIPTS) else {}
    base = dict(en)
    for k, v in gold.items():  # hand-written scripts always win
        if k in base:
            scripts[k] = {"src": js_hash(base[k]), "en": v["en"], "ar": v["ar"], "by": "hand"}
    stale = lambda k: scripts.get(k, {}).get("src") != js_hash(base[k])
    need = [lid for lid, ctx in lessons.items() if (not a.only or any(re.search(a.only, st["key"]) for st in ctx["steps"])) and any(stale(st["key"]) for st in ctx["steps"])]
    print(f"{len(need)} lessons need narration scripts; writing up to {a.scripts_max} now.")
    for lid in need[: a.scripts_max]:
        try:
            got = {st["key"]: {"en": "[script] " + st["title"], "ar": "[سكريبت] " + st["title"]} for st in lessons[lid]["steps"]} if a.fake else write_scripts(lessons[lid], gold, key, a.text_model)
        except Exception as e:  # never lose the lessons already written
            print(f"scripts: skipped {lid} ({type(e).__name__}: {getattr(e, 'code', '')} {e}); continuing")
            continue
        for k, v in got.items():
            if k in base and scripts.get(k, {}).get("by") != "hand":
                scripts[k] = {"src": js_hash(base[k]), **v}
        print(f"✎ {lid}: {len(got)} scripts")
        json.dump(scripts, open(SCRIPTS, "w"), ensure_ascii=False, indent=0, sort_keys=True)
        time.sleep(0 if a.fake else 6)
    json.dump(scripts, open(SCRIPTS, "w"), ensure_ascii=False, indent=0, sort_keys=True)
    ok = lambda k: not stale(k)
    items = []
    # Egyptian Arabic first, then English; English falls back to the on-screen text until a script exists
    if a.lang in ("ar", "both"):
        items += [(k + "/ar", scripts[k]["ar"], "ar") for k, t in en if ok(k)]
    if a.lang in ("en", "both"):
        items += [(k, scripts[k]["en"] if ok(k) else t, "en") for k, t in en]
    want = {k for k, _, _ in items}
    for k in [k for k in files if k not in want and (a.lang == "both" or k.endswith("/ar") == (a.lang == "ar"))]:  # steps that no longer exist
        files.pop(k)
    fresh = lambda k, t, lang: k in files and files[k]["h"] == js_hash(t) and files[k].get("v") == voice_for(lang) and os.path.exists(os.path.join(VOICE_DIR, files[k]["f"]))
    todo = [(k, t, lang) for k, t, lang in items if (not a.only or re.search(a.only, k)) and not fresh(k, t, lang)]
    print(f"{len(items)} narrations, {len(todo)} to generate, generating up to {a.max} now.")
    done, rejected, gap = 0, 0, 60.0 / a.rpm
    for k, text, lang in todo[: a.max]:
        rel = k.replace("/ar", "-ar") + ".mp3"
        path = os.path.join(VOICE_DIR, rel)
        t0, ok, stop = time.time(), False, False
        for attempt in range(3):
            try:
                if a.fake:
                    to_mp3(b"\x00\x00" * 24000 * max(1, int(len(text.split()) / 2.4)), 24000, path)
                elif a.engine == "edge":
                    edge_tts_file(text, voice_for(lang).split(":", 1)[1], path)
                else:
                    pcm, rate = tts(text, lang, key, a.model, voice_for(lang))
                    to_mp3(pcm, rate, path)
            except urllib.error.HTTPError as e:
                msg = e.read().decode(errors="replace")
                if e.code == 429 and ("PerDay" in msg or "per day" in msg.lower()):
                    print("Daily quota reached; the next scheduled run continues from here.")
                    stop = True
                    break
                wait = int((re.search(r'"retryDelay":\s*"(\d+)s"', msg) or [0, 30 * (attempt + 1)])[1])
                print(f"{k}: HTTP {e.code}, retrying in {wait}s")
                time.sleep(wait)
                continue
            except Exception as e:  # network blips, edge-tts hiccups
                print(f"{k}: {type(e).__name__} {e}, retrying")
                time.sleep(10 * (attempt + 1))
                continue
            good, d, expect = sane(path, text, lang)
            if good or a.fake:
                ok = True
                break
            print(f"{k}: audio looks wrong ({d:.0f}s for ~{expect:.0f}s of text), retrying")
        if stop:
            break
        if not ok:
            rejected += 1
            if os.path.exists(path):
                os.remove(path)
            files.pop(k, None)
            print(f"✗ {k}: skipped (the site falls back for this step)")
            continue
        files[k] = {"f": rel, "h": js_hash(text), "v": voice_for(lang)}
        done += 1
        if done % 10 == 0:
            json.dump(man, open(MANIFEST, "w"), ensure_ascii=False, indent=0, sort_keys=True)
        print(f"✓ {k}")
        time.sleep(max(0, gap - (time.time() - t0)))
    json.dump(man, open(MANIFEST, "w"), ensure_ascii=False, indent=0, sort_keys=True)
    print(f"generated {done}, rejected {rejected}; {len(todo) - done} left")


if __name__ == "__main__":
    main()
