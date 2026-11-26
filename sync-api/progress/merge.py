"""Merging progress from two devices.

The browser keeps {lessons: {id: true}, q: {id: "known"|"review"}, practice: {id: {grade, at, ...}}, last: {id, step}}.
Rules, chosen so that syncing never loses work:
  lessons   union: a lesson finished anywhere stays finished
  q         incoming wins per question (the device you just used is the freshest opinion)
  practice  per entry, the one with the later "at" timestamp wins; lists (session history) are unioned by "at"
  last      incoming wins
Unknown keys are kept as they are, and UI-only keys (theme, openModules) are never stored.
"""

UI_ONLY = {"theme", "openModules"}


def _at(v):
    return v.get("at", 0) if isinstance(v, dict) else 0


def merge(server: dict, incoming: dict) -> dict:
    out = {k: v for k, v in (server or {}).items() if k not in UI_ONLY}
    incoming = {k: v for k, v in (incoming or {}).items() if k not in UI_ONLY}

    lessons = dict(out.get("lessons") or {})
    lessons.update({k: True for k, v in (incoming.get("lessons") or {}).items() if v})
    out["lessons"] = lessons

    q = dict(out.get("q") or {})
    q.update({k: v for k, v in (incoming.get("q") or {}).items() if v in ("known", "review")})
    out["q"] = q

    practice = dict(out.get("practice") or {})
    for k, v in (incoming.get("practice") or {}).items():
        mine = practice.get(k)
        if isinstance(v, list) or isinstance(mine, list):
            seen = {}
            for item in (mine or []) + (v or []):
                seen[_at(item) or id(item)] = item
            practice[k] = sorted(seen.values(), key=_at)
        elif mine is None or _at(v) >= _at(mine):
            practice[k] = v
    out["practice"] = practice

    for k, v in incoming.items():
        if k not in ("lessons", "q", "practice"):
            out[k] = v
    return out
