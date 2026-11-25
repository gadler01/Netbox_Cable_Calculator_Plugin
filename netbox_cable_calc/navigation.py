from netbox.plugins import PluginMenuItem

# Shows under NetBox's "Plugins" menu. Users who can't view any site would
# only get an empty page, so the link is hidden from them.
menu_items = (
    PluginMenuItem(
        link="plugins:netbox_cable_calc:calculator",
        link_text="Cable Length Calculator",
        permissions=["dcim.view_site"],
    ),
)
