import sys
try:
    from netbox.plugins import PluginConfig
except (ImportError, ModuleNotFoundError):
    netbox_src = "/opt/netbox/netbox"
    if netbox_src not in sys.path:
        sys.path.insert(0, netbox_src)
    from netbox.plugins import PluginConfig

class CableCalcConfig(PluginConfig):
    name = "netbox_cable_calc"
    verbose_name = "Cable Length Calculator"
    description = "Calculate cable lengths for datacenter migrations"
    version = "1.0.0"
    author = "Graham Adler"
    author_email = "gadler@vsolpro.com"
    base_url = "cable-calc"
    required_settings = []
    default_settings = {}
    min_version = "4.0"
    max_version = "4.99"

config = CableCalcConfig
