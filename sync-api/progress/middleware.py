from django.conf import settings
from django.http import HttpResponse


class CorsMiddleware:
    """Just enough CORS for one static site: allow the configured origins, answer preflights."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        origin = request.headers.get("Origin")
        allowed = origin in settings.ATLAS_ORIGINS
        if request.method == "OPTIONS" and allowed:
            response = HttpResponse(status=204)
        else:
            response = self.get_response(request)
        if allowed:
            response["Access-Control-Allow-Origin"] = origin
            response["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
            response["Access-Control-Allow-Methods"] = "GET, PUT, POST, OPTIONS"
            response["Access-Control-Max-Age"] = "86400"
            response["Vary"] = "Origin"
        return response
