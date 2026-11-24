from django.urls import path

def _get_views():
    from . import views
    return views

urlpatterns = [
    path("", lambda req, **kw: _get_views().CalculatorView.as_view()(req, **kw), name="calculator"),
    path("bom/", lambda req, **kw: _get_views().BomApiView.as_view()(req, **kw), name="bom-api"),
    path("layout/", lambda req, **kw: _get_views().LayoutApiView.as_view()(req, **kw), name="layout-api"),
    path("racks/", lambda req, **kw: _get_views().RacksApiView.as_view()(req, **kw), name="racks-api"),
    path("devices/", lambda req, **kw: _get_views().DevicesApiView.as_view()(req, **kw), name="devices-api"),
]
