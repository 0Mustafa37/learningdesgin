import json

from django.conf import settings
from django.db import transaction
from django.http import JsonResponse
from rest_framework import status
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .merge import merge
from .models import SyncSpace, hash_key


def health(request):
    return JsonResponse({"ok": True})


def _key(request):
    auth = request.headers.get("Authorization", "")
    return auth[7:].strip() if auth.startswith("Bearer ") else None


class CreateSpace(APIView):
    """POST /api/spaces -> {key}. Shown once; the browser keeps it and other devices paste it in."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "create"

    def post(self, request):
        space, key = SyncSpace.create_with_key()
        return Response({"key": key, "version": space.version}, status=status.HTTP_201_CREATED)


class ProgressView(APIView):
    """GET returns the stored progress; PUT merges the device's progress into it and returns the result."""

    def _space(self, request, lock=False):
        key = _key(request)
        if not key:
            return None
        qs = SyncSpace.objects.select_for_update() if lock else SyncSpace.objects
        return qs.filter(key_hash=hash_key(key)).first()

    def get(self, request):
        space = self._space(request)
        if not space:
            return Response({"detail": "Unknown or missing sync key."}, status=status.HTTP_401_UNAUTHORIZED)
        return Response({"data": space.data, "version": space.version})

    def put(self, request):
        if len(request.body) > settings.ATLAS_MAX_BYTES:
            return Response({"detail": "Progress too large."}, status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
        try:
            incoming = json.loads(request.body or b"{}").get("data")
        except (ValueError, AttributeError):
            incoming = None
        if not isinstance(incoming, dict):
            return Response({"detail": "Send {\"data\": {...}}."}, status=status.HTTP_400_BAD_REQUEST)
        # Two devices can sync at the same moment: lock the row so neither merge is lost.
        with transaction.atomic():
            space = self._space(request, lock=True)
            if not space:
                return Response({"detail": "Unknown or missing sync key."}, status=status.HTTP_401_UNAUTHORIZED)
            space.data = merge(space.data, incoming)
            space.version += 1
            space.save(update_fields=["data", "version", "updated_at"])
        return Response({"data": space.data, "version": space.version})
