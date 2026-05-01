from django.urls import path
from . import views

urlpatterns = [
    path("", views.CalculatorView.as_view(), name="calculator"),
    path("bom/", views.BomApiView.as_view(),     name="bom-api"),
    path("layout/",   views.LayoutApiView.as_view(),  name="layout-api"),
]
