#!/bin/bash
# Installs netbox-cable-calc into an existing NetBox virtualenv.
#
# Usage:
#   ./install_plugin.sh [path-to-netbox-venv]
#
# Defaults to /opt/netbox/venv if no path is given. Run this from the
# repo root (where setup.py lives) after cloning into NetBox's plugins
# directory, e.g.:
#   cd /opt/netbox/netbox/plugins
#   git clone https://github.com/gadler01/Netbox_Cable_Calculator_Plugin.git netbox_cable_calc
#   cd netbox_cable_calc
#   ./install_plugin.sh
set -euo pipefail

VENV="${1:-/opt/netbox/venv}"
PIP="$VENV/bin/pip"

if [ ! -x "$PIP" ]; then
    echo "error: no pip found at $PIP" >&2
    echo "usage: $0 [path-to-netbox-venv]" >&2
    exit 1
fi

if [ ! -f "setup.py" ]; then
    echo "error: run this from the repo root (setup.py not found here)" >&2
    exit 1
fi

if [ ! -f "netbox_cable_calc/static/netbox_cable_calc/calculator.bundle.js" ]; then
    echo "error: calculator.bundle.js is missing." >&2
    echo "  If you edited ui/src, rebuild it first: cd ui && npm install && npm run build" >&2
    exit 1
fi

echo "=== Installing netbox-cable-calc into $VENV ==="
"$PIP" install . --no-deps

echo
echo "=== Installed ==="
"$PIP" show netbox-cable-calc

cat <<'EOF'

Next steps:
1. Add to configuration.py:

   PLUGINS = [
       'netbox_cable_calc',
   ]
   PLUGINS_CONFIG = {
       'netbox_cable_calc': {
           'aisle_width': 60,
           'rack_depth': 48,
           'port_depth': 4,
           'fiber_overhead': 18,
           'copper_overhead': 12,
           'default_slack_pct': 10,
       }
   }

2. Restart NetBox:
   sudo systemctl restart netbox netbox-rq
EOF
