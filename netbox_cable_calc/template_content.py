from django.urls import reverse
from django.utils.html import format_html
from netbox.plugins import PluginTemplateExtension


class CableCalcButton(PluginTemplateExtension):
    """
    A "Cable calculator" button on site, location and rack pages that opens
    the plugin scoped to that site (and location). Hidden when the user
    can't view the site, since the plugin would answer "not found".
    """
    models = ["dcim.site", "dcim.location", "dcim.rack"]

    def buttons(self):
        from dcim.models import Location, Site

        obj = self.context.get("object")
        user = self.context["request"].user
        if obj is None:
            return ""
        if obj._meta.model_name == "site":
            site_id, location_id = obj.pk, None
        elif obj._meta.model_name == "location":
            site_id, location_id = obj.site_id, obj.pk
        else:  # rack
            site_id, location_id = obj.site_id, obj.location_id

        if not Site.objects.restrict(user, "view").filter(pk=site_id).exists():
            return ""
        # A location the user can't view would also be "not found"; fall back
        # to the whole site.
        if location_id and not Location.objects.restrict(user, "view").filter(pk=location_id).exists():
            location_id = None

        url = reverse("plugins:netbox_cable_calc:calculator") + f"?site_id={site_id}"
        if location_id:
            url += f"&location_id={location_id}"
        return format_html(
            '<a href="{}" class="btn btn-primary" role="button">'
            '<i class="mdi mdi-cable-data" aria-hidden="true"></i> Cable calculator</a>',
            url,
        )


template_extensions = [CableCalcButton]
