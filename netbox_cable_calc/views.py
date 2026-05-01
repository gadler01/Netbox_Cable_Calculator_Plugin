import os
import re
import json
from decimal import Decimal

from django.shortcuts import render
from django.contrib.auth.mixins import LoginRequiredMixin
from django.views import View
from django.http import JsonResponse
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from netbox.plugins import get_plugin_config
from dcim.models import Rack, Device, Interface, Site, Location

MM_TO_IN = 1 / 25.4
U_HEIGHT  = 1.75

LAYOUT_DIR = os.path.join(os.path.dirname(__file__), "layouts")


# ── JSON encoder ──────────────────────────────────────────────────────────────

class _Encoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        return super().default(obj)

def _dumps(obj):
    return json.dumps(obj, cls=_Encoder)


# ── interface / cable type maps ───────────────────────────────────────────────

IFACE_MAP = {
    "1000base-t":     ("cat6",  "RJ45",    1.0),
    "2.5gbase-t":     ("cat6a", "RJ45",    1.0),
    "5gbase-t":       ("cat6a", "RJ45",    1.0),
    "10gbase-t":      ("cat6a", "RJ45",    1.0),
    "10gbase-cx4":    ("dac",   "CX4",     0.0),
    "10gbase-cr":     ("dac",   "SFP+",    0.0),
    "25gbase-cr":     ("dac",   "SFP28",   0.0),
    "40gbase-cr4":    ("dac",   "QSFP+",   0.0),
    "100gbase-cr4":   ("dac",   "QSFP28",  0.0),
    "400gbase-cr4":   ("dac",   "QSFP-DD", 0.0),
    "10gbase-sr":     ("om3",   "LC",      1.05),
    "25gbase-sr":     ("om4",   "LC",      1.05),
    "40gbase-sr4":    ("om4",   "MPO-12",  1.05),
    "100gbase-sr4":   ("om4",   "MPO-12",  1.05),
    "400gbase-sr8":   ("om4",   "MPO-16",  1.05),
    "1000base-lx":    ("os2",   "LC",      1.05),
    "10gbase-lr":     ("os2",   "LC",      1.05),
    "10gbase-er":     ("os2",   "LC",      1.05),
    "25gbase-lr":     ("os2",   "LC",      1.05),
    "40gbase-lr4":    ("os2",   "LC",      1.05),
    "100gbase-lr4":   ("os2",   "LC",      1.05),
    "400gbase-lr8":   ("os2",   "LC",      1.05),
    "10gbase-sr-aoc": ("aoc",   "SFP+",    0.0),
    "25gbase-sr-aoc": ("aoc",   "SFP28",   0.0),
    "100gbase-sr-aoc":("aoc",   "QSFP28",  0.0),
}

CABLE_TYPE_MAP = {
    "cat3": ("cat6", "RJ45"), "cat5": ("cat6", "RJ45"),
    "cat5e": ("cat6", "RJ45"), "cat6": ("cat6", "RJ45"),
    "cat6a": ("cat6a", "RJ45"), "cat7": ("cat6a", "RJ45"),
    "cat7a": ("cat6a", "RJ45"), "cat8": ("cat6a", "RJ45"),
    "dac-active": ("dac", "SFP+"), "dac-passive": ("dac", "SFP+"),
    "smf": ("os2", "LC"), "smf-os1": ("os2", "LC"), "smf-os2": ("os2", "LC"),
    "mmf": ("om3", "LC"), "mmf-om1": ("om3", "LC"), "mmf-om2": ("om3", "LC"),
    "mmf-om3": ("om3", "LC"), "mmf-om4": ("om4", "LC"), "mmf-om5": ("om4", "LC"),
    "aoc": ("aoc", "SFP+"),
}

PORT_CONNECTOR_MAP = {
    "8p8c": "RJ45", "lc": "LC", "lc-apc": "LC-APC",
    "mpo": "MPO", "mpo-12": "MPO-12", "mpo-16": "MPO-16", "mpo-24": "MPO-24",
    "sc": "SC", "sc-apc": "SC-APC", "st": "ST", "fc": "FC",
    "sfp+": "SFP+", "sfp28": "SFP28", "qsfp+": "QSFP+",
    "qsfp28": "QSFP28", "qsfp-dd": "QSFP-DD",
}

MEDIA_STD = {
    "cat6":  [1, 1.5, 2, 3, 5, 7, 10, 15, 20, 25, 30],
    "cat6a": [1, 1.5, 2, 3, 5, 7, 10, 15, 20, 25, 30],
    "om3":   [1, 2, 3, 5, 7, 10, 15, 20, 30, 50],
    "om4":   [1, 2, 3, 5, 7, 10, 15, 20, 30, 50],
    "os2":   [1, 2, 3, 5, 7, 10, 15, 20, 30, 50, 100],
    "dac":   [0.5, 1, 1.5, 2, 3, 5, 7, 10],
    "aoc":   [1, 2, 3, 5, 7, 10, 15, 20, 30],
}

def _std_len(ft, media):
    lengths = MEDIA_STD.get(media, [1, 2, 3, 5, 7, 10, 15, 20, 30])
    return next((l for l in lengths if l >= ft), round(ft + 1))


# ── rack helpers ──────────────────────────────────────────────────────────────

def _rack_width_in(rack, cfg):
    field   = cfg.get("outer_width_field")
    unit    = cfg.get("outer_width_unit", "mm")
    default = float(cfg.get("rack_spacing_default", 24))
    if field:
        val = rack.custom_field_data.get(field)
        if val:
            try:
                val = float(val)
                return val * MM_TO_IN if unit == "mm" else val
            except (TypeError, ValueError):
                pass
    return default

def _parse_rack_name(name):
    m = re.match(r"^([A-Za-z]+)[^A-Za-z0-9]*(\d+)$", name.strip())
    if m:
        return m.group(1).upper(), int(m.group(2))
    digits = re.sub(r"\D", "", name.strip())
    if len(digits) > 1:
        return digits[0], int(digits[1:])
    return None, None

def _build_rack_index(cfg, site_id=None, location_id=None):
    qs = Rack.objects.select_related("site", "location").order_by("name")
    if site_id:
        qs = qs.filter(site_id=site_id)
    if location_id:
        qs = qs.filter(location_id=location_id)

    rack_list = []
    for rack in qs:
        width_in = _rack_width_in(rack, cfg)
        row, pos = _parse_rack_name(rack.name)
        rack_list.append({
            "id": rack.pk, "name": rack.name,
            "u_height": rack.u_height, "width_in": width_in,
            "row": row, "pos": pos,
            "resolved": row is not None and pos is not None,
            "site_id": rack.site_id,
            "site_name": rack.site.name if rack.site else "",
            "location_id": rack.location_id,
            "location_name": rack.location.name if rack.location else "",
            "center_offset": 0.0, "row_index": 0,
        })

    by_row = {}
    for r in rack_list:
        if r["resolved"]:
            by_row.setdefault(r["row"], []).append(r)

    row_keys = sorted(by_row.keys(), key=lambda x: (len(x), x))
    for idx, row_key in enumerate(row_keys):
        group = sorted(by_row[row_key], key=lambda r: r["pos"])
        offset = 0.0
        for r in group:
            r["center_offset"] = offset + r["width_in"] / 2
            r["row_index"] = idx
            offset += r["width_in"]

    return {r["id"]: r for r in rack_list}

def _build_rack_data(cfg, site_id=None, location_id=None):
    return list(_build_rack_index(cfg, site_id, location_id).values())

def _build_device_data(site_id=None, location_id=None):
    qs = (Device.objects
          .select_related("rack", "rack__site", "rack__location", "device_type")
          .filter(rack__isnull=False)
          .order_by("rack__name", "position"))
    if site_id:
        # Match on device.site_id OR rack.site_id to catch devices
        # that inherit site from their rack
        from django.db.models import Q
        qs = qs.filter(
            Q(site_id=site_id) | Q(rack__site_id=site_id)
        )
    if location_id:
        qs = qs.filter(rack__location_id=location_id)
    result = []
    for dev in qs:
        iface = Interface.objects.filter(device=dev).exclude(type="virtual").first()
        result.append({
            "id": dev.pk, "name": dev.name or f"device-{dev.pk}",
            "rack_id": dev.rack_id, "rack_name": dev.rack.name if dev.rack else "",
            "position": dev.position or 1, "face": dev.face or "rear",
            "iface_type": iface.type if iface else "1000base-t",
        })
    return result

def _build_site_tree():
    sites = []
    for site in Site.objects.order_by("name"):
        locations = list(
            Location.objects.filter(site=site).order_by("name").values("id", "name", "level")
        )
        for loc in locations:
            loc["label"] = ("— " * loc["level"]) + loc["name"]
        sites.append({"id": site.pk, "name": site.name, "locations": locations})
    return sites


# ── cable length calculator ───────────────────────────────────────────────────

def _calc_length(src, dst, rack_index, cfg):
    row_spacing = float(cfg.get("aisle_width", 60))
    rack_depth  = float(cfg.get("rack_depth", 48))
    port_depth  = float(cfg.get("port_depth", 4))
    slack_pct   = float(cfg.get("default_slack_pct", 10))

    # Pick overhead height and bridge length based on media type
    fiber_media = {"om3","om4","os2","aoc"}
    media_key   = src.get("iface_type","") if src.get("iface_type","") in IFACE_MAP else ""
    if media_key in IFACE_MAP:
        cable_media = IFACE_MAP[media_key][0]
    elif src.get("cable_type","") in CABLE_TYPE_MAP:
        cable_media = CABLE_TYPE_MAP[src.get("cable_type","")][0]
    else:
        cable_media = "cat6"

    is_fiber   = cable_media in fiber_media
    overhead   = float(cfg.get("fiber_overhead",  18) if is_fiber else cfg.get("copper_overhead", 12))
    bridge_len = float(cfg.get("fiber_bridge_length", 36) if is_fiber else cfg.get("copper_bridge_length", 36))

    src_rack = rack_index.get(src["rack_id"], {})
    dst_rack = rack_index.get(dst["rack_id"], {})
    src_rack_u = float(src_rack.get("u_height", src.get("rackU", 42)))
    dst_rack_u = float(dst_rack.get("u_height", dst.get("rackU", 42)))

    def ru_from_top(pos, rack_u):
        return (rack_u - float(pos)) * U_HEIGHT

    # Same rack — cable runs inside rack only
    if src["rack_id"] and dst["rack_id"] and src["rack_id"] == dst["rack_id"]:
        vert = abs((float(src["ru"]) - 1) * U_HEIGHT - (float(dst["ru"]) - 1) * U_HEIGHT)
        src_pe = port_depth if src["face"] == "front" else rack_depth
        dst_pe = port_depth if dst["face"] == "front" else rack_depth
        raw_in = vert + src_pe + dst_pe
        raw_ft = raw_in / 12
        iface_key  = src.get("iface_type", "")
        cable_type = src.get("cable_type", "")
        if iface_key in IFACE_MAP:
            media, connector, slack_mult = IFACE_MAP[iface_key]
        elif cable_type in CABLE_TYPE_MAP:
            media, connector = CABLE_TYPE_MAP[cable_type]
            slack_mult = 0.0 if media in ("dac","aoc") else (1.05 if media in ("om3","om4","os2") else 1.0)
        else:
            media, connector, slack_mult = "cat6", "RJ45", 1.0
        port_type = src.get("port_type","") or dst.get("port_type","") or ""
        if port_type in PORT_CONNECTOR_MAP:
            connector = PORT_CONNECTOR_MAP[port_type]
        eff_slack = 0 if slack_mult == 0 else slack_pct * slack_mult
        with_slack = raw_ft * (1 + eff_slack / 100)
        return {
            "raw_ft": round(raw_ft, 2), "with_slack": round(with_slack, 2),
            "stock_ft": _std_len(with_slack, media),
            "media": media, "connector": connector,
            "cross_aisle": False, "fixed": slack_mult == 0,
            "same_rack": True,
            "breakdown": {"in_rack_vertical": round(vert, 2), "port_depth": round(src_pe + dst_pe, 2)},
        }

    # Different racks — route via overhead tray
    if src["face"] == "front":
        src_pe = port_depth;  src_v = ru_from_top(src["ru"], src_rack_u) + overhead
    else:
        src_pe = rack_depth;  src_v = (float(src["ru"]) - 1) * U_HEIGHT + src_rack_u * U_HEIGHT + overhead

    if dst["face"] == "front":
        dst_pe = port_depth;  dst_v = ru_from_top(dst["ru"], dst_rack_u) + overhead
    else:
        dst_pe = rack_depth;  dst_v = dst_rack_u * U_HEIGHT + (float(dst["ru"]) - 1) * U_HEIGHT + overhead

    horiz = abs(float(dst_rack.get("center_offset", 0)) - float(src_rack.get("center_offset", 0)))
    cross_aisle  = src_rack.get("row") != dst_rack.get("row")
    rows_crossed = abs(src_rack.get("row_index", 0) - dst_rack.get("row_index", 0))
    row_travel   = rows_crossed * row_spacing if cross_aisle else 0
    bridge_total = rows_crossed * bridge_len  if cross_aisle else 0

    raw_in = src_v + dst_v + horiz + row_travel + bridge_total + src_pe + dst_pe
    raw_ft = raw_in / 12

    iface_key  = src.get("iface_type", "")
    cable_type = src.get("cable_type", "")
    if iface_key in IFACE_MAP:
        media, connector, slack_mult = IFACE_MAP[iface_key]
    elif cable_type in CABLE_TYPE_MAP:
        media, connector = CABLE_TYPE_MAP[cable_type]
        slack_mult = 0.0 if media in ("dac","aoc") else (1.05 if media in ("om3","om4","os2") else 1.0)
    else:
        media, connector, slack_mult = "cat6", "RJ45", 1.0

    port_type = src.get("port_type","") or dst.get("port_type","") or ""
    if port_type in PORT_CONNECTOR_MAP:
        connector = PORT_CONNECTOR_MAP[port_type]

    eff_slack  = 0 if slack_mult == 0 else slack_pct * slack_mult
    with_slack = raw_ft * (1 + eff_slack / 100)
    stock      = _std_len(with_slack, media)

    return {
        "raw_ft": round(raw_ft, 2), "with_slack": round(with_slack, 2), "stock_ft": stock,
        "media": media, "connector": connector, "cross_aisle": cross_aisle,
        "fixed": slack_mult == 0, "same_rack": False,
        "breakdown": {
            "src_vertical": round(src_v, 2), "dst_vertical": round(dst_v, 2),
            "horizontal": round(horiz, 2), "row_travel": round(row_travel, 2),
            "bridge": round(bridge_total, 2), "port_depth": round(src_pe + dst_pe, 2),
        },
    }


# ── cable termination helpers ─────────────────────────────────────────────────

def _endpoint_info_from_obj(obj):
    if obj is None:
        return None
    dev = getattr(obj, "device", None)
    if dev is None or dev.rack is None:
        return None
    iface_type = getattr(obj, "type", "1000base-t") or "1000base-t"
    iface_name = getattr(obj, "name", "") or ""
    port_type  = getattr(obj, "type", "") or ""
    return {
        "device_id":   dev.pk,
        "device_name": dev.name or f"device-{dev.pk}",
        "rack_id":     dev.rack_id,
        "rack_name":   dev.rack.name if dev.rack else "",
        "ru":          float(dev.position or 1),
        "rackU":       float(dev.rack.u_height) if dev.rack else 42.0,
        "face":        dev.face or "rear",
        "iface_type":  iface_type,
        "iface_name":  iface_name,
        "port_type":   port_type,
    }

def _build_cable_bom(cfg, site_id=None, location_id=None):
    from dcim.models import CableTermination
    rack_index = _build_rack_index(cfg, site_id, location_id)

    from django.db.models import Q
    dev_qs = Device.objects.filter(rack__isnull=False)
    if site_id:
        dev_qs = dev_qs.filter(
            Q(site_id=site_id) | Q(rack__site_id=site_id)
        )
    if location_id:
        dev_qs = dev_qs.filter(rack__location_id=location_id)
    scoped_device_ids = set(dev_qs.values_list("id", flat=True))

    terms = (CableTermination.objects
             .select_related("cable")
             .prefetch_related("termination")
             .order_by("cable_id", "cable_end"))

    cable_ends = {}
    for t in terms:
        cid = t.cable_id
        if cid not in cable_ends:
            cable_ends[cid] = {"A": [], "B": [], "cable": t.cable}
        try:
            obj = t.termination
        except Exception:
            continue
        cable_ends[cid][t.cable_end].append(obj)

    rows = []
    for cid, data in cable_ends.items():
        a_objs = data["A"]; b_objs = data["B"]; cable = data["cable"]
        if not a_objs or not b_objs:
            continue
        src_info = _endpoint_info_from_obj(a_objs[0])
        dst_info = _endpoint_info_from_obj(b_objs[0])
        if src_info is None or dst_info is None:
            continue
        if (src_info["device_id"] not in scoped_device_ids and
                dst_info["device_id"] not in scoped_device_ids):
            continue
        try:
            src_with_cable = {**src_info, "cable_type": cable.type or ""}
            result = _calc_length(src_with_cable, dst_info, rack_index, cfg)
        except Exception as e:
            result = {
                "raw_ft": 0, "with_slack": 0, "stock_ft": 0,
                "media": "unknown", "connector": "unknown",
                "cross_aisle": False, "fixed": False, "same_rack": False,
                "error": str(e), "breakdown": {},
            }
        rows.append({
            "cable_id": cable.pk, "cable_label": cable.label or f"Cable {cable.pk}",
            "cable_type": cable.type or "",
            "cable_color": cable.color or "",
            "src_device": src_info["device_name"], "src_iface": src_info["iface_name"],
            "src_rack": src_info["rack_name"], "src_ru": src_info["ru"], "src_face": src_info["face"],
            "dst_device": dst_info["device_name"], "dst_iface": dst_info["iface_name"],
            "dst_rack": dst_info["rack_name"], "dst_ru": dst_info["ru"], "dst_face": dst_info["face"],
            "iface_type": src_info["iface_type"],
            **result,
        })
    return rows


# ── layout persistence ────────────────────────────────────────────────────────

def _layout_path(site_id, location_id=None):
    os.makedirs(LAYOUT_DIR, exist_ok=True)
    key = f"site_{site_id}"
    if location_id:
        key += f"_loc_{location_id}"
    return os.path.join(LAYOUT_DIR, f"{key}.json")


# ── views ─────────────────────────────────────────────────────────────────────

class CalculatorView(LoginRequiredMixin, View):
    template_name = "netbox_cable_calc/calculator.html"

    def get(self, request):
        from django.conf import settings
        plugin_cfg = settings.PLUGINS_CONFIG.get("netbox_cable_calc", {})
        cfg = {k: plugin_cfg.get(k) for k in [
            "outer_width_field", "outer_width_unit", "rack_spacing_default",
            "fiber_overhead", "fiber_bridge_length",
            "copper_overhead", "copper_bridge_length",
            "aisle_width", "rack_depth", "port_depth", "default_slack_pct",
        ]}
        site_id     = request.GET.get("site_id") or None
        location_id = request.GET.get("location_id") or None
        if site_id:     site_id     = int(site_id)
        if location_id: location_id = int(location_id)

        return render(request, self.template_name, {
            "rack_data_json":       _dumps(_build_rack_data(cfg, site_id, location_id)),
            "device_data_json":     _dumps(_build_device_data(site_id, location_id)),
            "plugin_cfg_json":      _dumps(cfg),
            "site_tree_json":       _dumps(_build_site_tree()),
            "selected_site_id":     site_id,
            "selected_location_id": location_id,
        })


class LayoutApiView(LoginRequiredMixin, View):
    @method_decorator(csrf_exempt)
    def dispatch(self, *args, **kwargs):
        return super().dispatch(*args, **kwargs)

    def get(self, request):
        site_id     = request.GET.get("site_id")
        location_id = request.GET.get("location_id")
        
        if not site_id:
            return JsonResponse({"layout": None, "bridges": []})
        
        try:
            site_id = int(site_id)
            location_id = int(location_id) if location_id else None
        except (ValueError, TypeError):
            return JsonResponse({"error": "Invalid site_id or location_id"}, status=400)
        
        path = _layout_path(site_id, location_id)
        if not os.path.exists(path):
            return JsonResponse({"layout": None, "bridges": []})
        try:
            with open(path, "r") as f:
                data = json.load(f)
            return JsonResponse(data)
        except Exception as e:
            return JsonResponse({"error": str(e)}, status=500)

    def post(self, request):
        site_id     = request.GET.get("site_id")
        location_id = request.GET.get("location_id")
        
        if not site_id:
            return JsonResponse({"error": "site_id required"}, status=400)
        
        try:
            site_id = int(site_id)
            location_id = int(location_id) if location_id else None
            body = json.loads(request.body)
            path = _layout_path(site_id, location_id)
            with open(path, "w") as f:
                json.dump({"layout": body.get("layout", {}), "bridges": body.get("bridges", [])}, f, indent=2)
            return JsonResponse({"saved": True})
        except Exception as e:
            return JsonResponse({"error": str(e)}, status=500)


class BomApiView(LoginRequiredMixin, View):
    @method_decorator(csrf_exempt)
    def dispatch(self, *args, **kwargs):
        return super().dispatch(*args, **kwargs)

    def get(self, request):
        from django.conf import settings
        plugin_cfg = settings.PLUGINS_CONFIG.get("netbox_cable_calc", {})
        cfg = {k: plugin_cfg.get(k) for k in [
            "outer_width_field", "outer_width_unit", "rack_spacing_default",
            "fiber_overhead", "fiber_bridge_length",
            "copper_overhead", "copper_bridge_length",
            "aisle_width", "rack_depth", "port_depth", "default_slack_pct",
        ]}
        site_id     = request.GET.get("site_id") or None
        location_id = request.GET.get("location_id") or None
        if site_id:     site_id     = int(site_id)
        if location_id: location_id = int(location_id)
        rows = _build_cable_bom(cfg, site_id, location_id)
        return JsonResponse({"cables": rows, "count": len(rows)})

    def post(self, request):
        from dcim.models import Cable
        try:
            body    = json.loads(request.body)
            updates = body.get("lengths", {})
            updated = 0; errors = []
            for cable_id_str, length_ft in updates.items():
                try:
                    cable = Cable.objects.get(pk=int(cable_id_str))
                    cable.length = float(length_ft)
                    cable.length_unit = "ft"
                    cable.save()
                    updated += 1
                except Cable.DoesNotExist:
                    errors.append(f"Cable {cable_id_str} not found")
                except Exception as e:
                    errors.append(f"Cable {cable_id_str}: {e}")
            return JsonResponse({"updated": updated, "errors": errors})
        except Exception as e:
            return JsonResponse({"error": str(e)}, status=400)
