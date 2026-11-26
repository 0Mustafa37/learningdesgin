"""Generate lesson narration with Gemini text-to-speech (the voices from Google AI Studio).

Runs in GitHub Actions (.github/workflows/voices.yml) with the GEMINI_API_KEY secret, or locally:

    pip install playwright && python -m playwright install chromium   # ffmpeg must be on PATH
    GEMINI_API_KEY=... python tools/make_voices.py --max 50

The narration text comes from the site itself (window.ATLAS.narrations()), so the audio always matches what the
browser would read. Each file is stored with a hash of its text in assets/voice/manifest.json; the site only plays a
file whose hash matches the current text, and this script regenerates files whose text changed. It is resumable:
run it again (the workflow runs daily) until everything is generated.
"""
import argparse, base64, functools, http.server, json, os, re, subprocess, sys, threading, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VOICE_DIR = os.path.join(ROOT, "assets", "voice")
MANIFEST = os.path.join(VOICE_DIR, "manifest.json")
AR_TEXT = os.path.join(VOICE_DIR, "ar-text.json")  # Arabic narration, translated once and kept in the repo
API = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
STYLE = {
    "en": "Read this aloud as a calm, clear engineering teacher, at a steady pace: ",
    "ar": "Read this aloud in clear Modern Standard Arabic, as a calm teacher. Keep English technical terms in English: ",
}


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
        b.close()
    srv.shutdown()
    return items


TRANSLATE = """Translate each English narration below into clear Modern Standard Arabic that an Egyptian software engineer
would enjoy listening to. Keep technical terms, product names, code, numbers and units in English (e.g. timeout, cache,
PostgreSQL, p95, 2 s). Keep it natural for speech, the same length or shorter. Return only a JSON object mapping each id
to its Arabic text.

"""


def translate(batch, key, model):
    body = {"contents": [{"parts": [{"text": TRANSLATE + json.dumps(dict(batch), ensure_ascii=False)}]}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0.2}}
    req = urllib.request.Request(API.format(model=model), data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-goog-api-key": key})
    with urllib.request.urlopen(req, timeout=180) as r:
        data = json.load(r)
    out = json.loads(data["candidates"][0]["content"]["parts"][0]["text"])
    return {k: v.strip() for k, v in out.items() if isinstance(v, str) and v.strip()}


def tts(text, lang, key, model, voice):
    body = {
        "contents": [{"parts": [{"text": STYLE[lang] + text}]}],
        "generationConfig": {"responseModalities": ["AUDIO"], "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}}},
    }
    req = urllib.request.Request(API.format(model=model), data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-goog-api-key": key})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.load(r)
    part = data["candidates"][0]["content"]["parts"][0]["inlineData"]
    rate = int((re.search(r"rate=(\d+)", part.get("mimeType", "")) or [0, 24000])[1])
    return base64.b64decode(part["data"]), rate


def to_mp3(pcm, rate, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "s16le", "-ar", str(rate), "-ac", "1", "-i", "pipe:0", "-b:a", "40k", path], input=pcm, check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=90, help="files to generate this run (free-tier quotas are small)")
    ap.add_argument("--rpm", type=float, default=8, help="requests per minute")
    ap.add_argument("--model", default=os.environ.get("TTS_MODEL", "gemini-3.1-flash-tts-preview"))
    ap.add_argument("--voice", default=os.environ.get("TTS_VOICE", "Kore"))
    ap.add_argument("--only", default="", help="regex on keys, e.g. '^timeouts-retries/'")
    ap.add_argument("--lang", default="both", choices=["en", "ar", "both"], help="which narration to voice")
    ap.add_argument("--text-model", default=os.environ.get("TEXT_MODEL", "gemini-3.5-flash"), help="model used to translate to Arabic")
    ap.add_argument("--fake", action="store_true", help="write silent files instead of calling the API (for testing)")
    a = ap.parse_args()
    key = os.environ.get("GEMINI_API_KEY", "")
    if not key and not a.fake:
        sys.exit("GEMINI_API_KEY is not set. Create a key at https://aistudio.google.com/apikey and add it as a repository secret.")

    man = json.load(open(MANIFEST)) if os.path.exists(MANIFEST) else {}
    files = man.setdefault("files", {})
    if files and man.get("voice") not in (None, a.voice):
        print(f"Voice changed from {man.get('voice')} to {a.voice}: regenerating everything.")
        files.clear()
    man.update({"model": a.model, "voice": a.voice})
    en = narrations()
    items = []
    if a.lang in ("ar", "both"):
        ar = json.load(open(AR_TEXT)) if os.path.exists(AR_TEXT) else {}
        need = [(k, t) for k, t in en if (not a.only or re.search(a.only, k)) and ar.get(k, {}).get("src") != js_hash(t)]
        print(f"{len(need)} steps need an Arabic translation.")
        for i in range(0, len(need), 12):
            batch = need[i: i + 12]
            try:
                got = {k: f"[ar] {t[:40]}" for k, t in batch} if a.fake else translate(batch, key, a.text_model)
            except (urllib.error.HTTPError, urllib.error.URLError, KeyError, ValueError) as e:
                print(f"translation stopped: {getattr(e, 'code', '')} {e}")
                break
            for k, t in batch:
                if k in got:
                    ar[k] = {"src": js_hash(t), "ar": got[k]}
            json.dump(ar, open(AR_TEXT, "w"), ensure_ascii=False, indent=0, sort_keys=True)
            time.sleep(1 if a.fake else 4)
    for k, t in en:
        if a.lang in ("en", "both"):
            items.append((k, t, "en"))
        if a.lang in ("ar", "both") and ar.get(k, {}).get("src") == js_hash(t):
            items.append((k + "/ar", ar[k]["ar"], "ar"))
    want = {k for k, _, _ in items}
    for k in [k for k in files if k not in want and (a.lang == "both" or k.endswith("/ar") == (a.lang == "ar"))]:  # steps that no longer exist
        files.pop(k)
    todo = [(k, t, lang) for k, t, lang in items if (not a.only or re.search(a.only, k)) and not (k in files and files[k]["h"] == js_hash(t) and os.path.exists(os.path.join(VOICE_DIR, files[k]["f"])))]
    print(f"{len(items)} narrations, {len(todo)} to generate, generating up to {a.max} now.")
    done, gap = 0, 60.0 / a.rpm
    for k, text, lang in todo[: a.max]:
        rel = k.replace("/ar", "-ar") + ".mp3"
        t0 = time.time()
        for attempt in range(5):
            try:
                if a.fake:
                    pcm, rate = b"\x00\x00" * 24000, 24000
                else:
                    pcm, rate = tts(text, lang, key, a.model, a.voice)
                break
            except urllib.error.HTTPError as e:
                msg = e.read().decode(errors="replace")
                if e.code == 429 and ("PerDay" in msg or "per day" in msg.lower()):
                    print("Daily quota reached; the next scheduled run continues from here.")
                    attempt = None
                    break
                if e.code in (429, 500, 503) and attempt < 4:
                    wait = int((re.search(r'"retryDelay":\s*"(\d+)s"', msg) or [0, 30 * (attempt + 1)])[1])
                    print(f"{k}: HTTP {e.code}, retrying in {wait}s")
                    time.sleep(wait)
                    continue
                print(f"{k}: HTTP {e.code}: {msg[:300]}")
                attempt = None
                break
            except (urllib.error.URLError, KeyError, IndexError) as e:
                print(f"{k}: {e}")
                attempt = None
                break
        if attempt is None:
            break
        to_mp3(pcm, rate, os.path.join(VOICE_DIR, rel))
        files[k] = {"f": rel, "h": js_hash(text)}
        done += 1
        json.dump(man, open(MANIFEST, "w"), ensure_ascii=False, indent=0, sort_keys=True)
        print(f"✓ {k}")
        time.sleep(max(0, gap - (time.time() - t0)))
    json.dump(man, open(MANIFEST, "w"), ensure_ascii=False, indent=0, sort_keys=True)
    print(f"generated {done}; {len(todo) - done} left")


if __name__ == "__main__":
    main()
