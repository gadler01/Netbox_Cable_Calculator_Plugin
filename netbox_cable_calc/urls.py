from django.urls import path
from django.views.decorators.csrf import csrf_exempt

def _get_views():
    from . import views
    return views

urlpatterns = [
    path("", lambda req, **kw: _get_views().CalculatorView.as_view()(req, **kw), name="calculator"),
    path("bom/", csrf_exempt(lambda req, **kw: _get_views().BomApiView.as_view()(req, **kw)), name="bom-api"),
    path("layout/", csrf_exempt(lambda req, **kw: _get_views().LayoutApiView.as_view()(req, **kw)), name="layout-api"),
]
