"""Open every step of every lesson (plus the extra pages) in headless Chrome and fail on any console error.

    pip install playwright && playwright install --with-deps chromium
    python tests/sweep.py            # all steps
    python tests/sweep.py --quick    # first and last step of each lesson
"""
import asyncio, functools, http.server, os, sys, threading
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8799
QUICK = "--quick" in sys.argv
CHROME = os.environ.get("CHROME_PATH")  # optional: use an installed Chrome


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


async def main():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    errors = []
    async with async_playwright() as p:
        kw = {"args": ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]}
        if CHROME:
            kw["executable_path"] = CHROME
        browser = await p.chromium.launch(**kw)
        page = await browser.new_page(viewport={"width": 1440, "height": 1000})
        where = {"route": "start"}
        page.on("pageerror", lambda e: errors.append(f"{where['route']}: pageerror: {e}"))
        page.on("console", lambda m: errors.append(f"{where['route']}: {m.text}") if m.type == "error" else None)
        await page.goto(f"http://127.0.0.1:{PORT}/index.html#/")
        await page.wait_for_timeout(1500)
        lessons = await page.evaluate("window.ATLAS.lessons()")
        routes = []
        for lid, n in lessons:
            steps = sorted({0, n - 1}) if QUICK else range(n)
            routes += [f"#/lesson/{lid}/{i}" for i in steps]
        routes += ["#/", "#/practice", "#/today", "#/django"] + [f"#/draw/{d}" for d in await page.evaluate("window.DRAW.problems.map(p => p.id)")]
        for r in routes:
            where["route"] = r
            await page.evaluate(f"location.hash = {r!r}")
            await page.wait_for_timeout(350)
            # a lesson step must actually have mounted the 3D stage
            if r.startswith("#/lesson/") and not await page.query_selector("#stageSlot .s3-fig, #stageSlot .s3-nogl"):
                await page.wait_for_timeout(800)
                if not await page.query_selector("#stageSlot .s3-fig, #stageSlot .s3-nogl"):
                    errors.append(f"{r}: 3D stage did not mount")
        await browser.close()
    srv.shutdown()
    print(f"checked {len(routes)} routes across {len(lessons)} lessons")
    if errors:
        print("\n".join(errors[:50]))
        sys.exit(1)
    print("no errors")


asyncio.run(main())
