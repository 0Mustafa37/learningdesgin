"""Settings for the Backend Atlas progress-sync API. Everything that differs per deploy comes from the environment."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
env = os.environ.get

SECRET_KEY = env("SECRET_KEY", "dev-only-not-secret")
DEBUG = env("DEBUG", "0") == "1"
ALLOWED_HOSTS = [h for h in env("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",") if h]
# Browser origins allowed to call the API (the GitHub Pages site by default).
ATLAS_ORIGINS = [o for o in env("ATLAS_ORIGINS", "https://0mustafa37.github.io").split(",") if o]
ATLAS_MAX_BYTES = int(env("ATLAS_MAX_BYTES", str(256 * 1024)))

INSTALLED_APPS = ["django.contrib.contenttypes", "rest_framework", "progress"]
MIDDLEWARE = [
    "progress.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
]
ROOT_URLCONF = "atlas_sync.urls"
WSGI_APPLICATION = "atlas_sync.wsgi.application"

if env("POSTGRES_DB"):
    DATABASES = {"default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env("POSTGRES_DB"), "USER": env("POSTGRES_USER", "postgres"), "PASSWORD": env("POSTGRES_PASSWORD", ""),
        "HOST": env("POSTGRES_HOST", "localhost"), "PORT": env("POSTGRES_PORT", "5432"),
        "CONN_MAX_AGE": 60, "CONN_HEALTH_CHECKS": True,
    }}
else:
    DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": BASE_DIR / "db.sqlite3"}}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
USE_TZ = True
TIME_ZONE = "UTC"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": [],
    "UNAUTHENTICATED_USER": None,
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.AnonRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {"anon": env("THROTTLE_RATE", "120/min"), "create": "10/hour"},
}
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_CONTENT_TYPE_NOSNIFF = True
