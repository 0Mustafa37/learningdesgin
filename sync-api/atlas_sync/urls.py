from django.urls import path

from progress import views

urlpatterns = [
    path("api/health", views.health),
    path("api/spaces", views.CreateSpace.as_view()),
    path("api/progress", views.ProgressView.as_view()),
]
