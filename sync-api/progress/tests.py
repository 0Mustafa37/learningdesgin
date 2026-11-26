import json

from django.test import TestCase, override_settings

from .merge import merge
from .models import SyncSpace, hash_key


class MergeTests(TestCase):
    def test_lessons_are_unioned(self):
        out = merge({"lessons": {"a": True}}, {"lessons": {"b": True}})
        self.assertEqual(out["lessons"], {"a": True, "b": True})

    def test_incoming_question_marks_win(self):
        out = merge({"q": {"x": "review", "y": "known"}}, {"q": {"x": "known"}})
        self.assertEqual(out["q"], {"x": "known", "y": "known"})

    def test_newer_practice_entry_wins(self):
        old, new = {"grade": "weak", "at": 1}, {"grade": "strong", "at": 2}
        self.assertEqual(merge({"practice": {"p": new}}, {"practice": {"p": old}})["practice"]["p"], new)
        self.assertEqual(merge({"practice": {"p": old}}, {"practice": {"p": new}})["practice"]["p"], new)

    def test_session_lists_are_unioned_by_time(self):
        out = merge({"practice": {"_s": [{"at": 1}, {"at": 3}]}}, {"practice": {"_s": [{"at": 2}, {"at": 3}]}})
        self.assertEqual([s["at"] for s in out["practice"]["_s"]], [1, 2, 3])

    def test_ui_only_keys_are_dropped(self):
        self.assertNotIn("theme", merge({}, {"theme": "dark", "openModules": {"x": 1}}))


class ApiTests(TestCase):
    def setUp(self):
        self.key = self.client.post("/api/spaces").json()["key"]
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {self.key}"}

    def put(self, data, **extra):
        return self.client.put("/api/progress", json.dumps({"data": data}), content_type="application/json", **{**self.auth, **extra})

    def test_key_is_stored_hashed(self):
        self.assertTrue(SyncSpace.objects.filter(key_hash=hash_key(self.key)).exists())
        self.assertFalse(SyncSpace.objects.filter(key_hash=self.key).exists())

    def test_two_devices_merge(self):
        self.put({"lessons": {"caching": True}})
        r = self.put({"lessons": {"sharding": True}, "q": {"orm-1": "known"}})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["version"], 2)
        got = self.client.get("/api/progress", **self.auth).json()["data"]
        self.assertEqual(set(got["lessons"]), {"caching", "sharding"})

    def test_wrong_key_is_rejected(self):
        r = self.client.get("/api/progress", HTTP_AUTHORIZATION="Bearer nope")
        self.assertEqual(r.status_code, 401)
        self.assertEqual(self.client.get("/api/progress").status_code, 401)

    def test_bad_body_is_rejected(self):
        r = self.client.put("/api/progress", "[1,2]", content_type="application/json", **self.auth)
        self.assertEqual(r.status_code, 400)

    @override_settings(ATLAS_MAX_BYTES=100)
    def test_size_limit(self):
        self.assertEqual(self.put({"q": {str(i): "known" for i in range(50)}}).status_code, 413)

    def test_cors_preflight_for_allowed_origin_only(self):
        ok = self.client.options("/api/progress", HTTP_ORIGIN="https://0mustafa37.github.io")
        self.assertEqual(ok.status_code, 204)
        self.assertEqual(ok["Access-Control-Allow-Origin"], "https://0mustafa37.github.io")
        bad = self.client.get("/api/health", HTTP_ORIGIN="https://evil.example")
        self.assertNotIn("Access-Control-Allow-Origin", bad)
