import hashlib
import secrets

from django.db import models


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


class SyncSpace(models.Model):
    """One person's progress, shared by every device that knows the sync key.

    The key itself is never stored, only its SHA-256, so a database leak doesn't hand out keys.
    """

    key_hash = models.CharField(max_length=64, unique=True)
    data = models.JSONField(default=dict)
    version = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    @classmethod
    def create_with_key(cls):
        key = "atlas_" + secrets.token_urlsafe(24)
        return cls.objects.create(key_hash=hash_key(key)), key
