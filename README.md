# NetBox Cable Length Calculator Plugin

A NetBox plugin for calculating cable lengths during datacenter migrations, with support for same-rack, cross-rack, and cross-aisle routing.

## Features

- **Same-rack calculations**: Direct cable runs within a rack
- **Cross-rack calculations**: Overhead tray routing between racks
- **Cross-aisle bridges**: Support for crossing between rack rows
- **Media-specific routing**: Different overhead heights for copper vs fiber
- **Floor plan editor**: Drag-and-drop rack positioning
- **BOM generation**: Export cable requirements with proper lengths
- **Layout persistence**: Save floor plan configurations per site/location
- **NetBox integration**: Save calculated lengths back to NetBox cables

## Installation

The compiled frontend (`calculator.bundle.js`) ships committed in the repo, so a
plain install needs only Python — no Node.js required on the NetBox host.

1. Clone into NetBox's plugins directory:
```bash
cd /opt/netbox/netbox/plugins
git clone https://github.com/gadler01/Netbox_Cable_Calculator_Plugin.git netbox_cable_calc
cd netbox_cable_calc
```

2. Run the install script (installs into the NetBox venv; pass a different venv
   path as an argument if yours isn't at `/opt/netbox/venv`):
```bash
./install_plugin.sh
```
   This installs the package and prints the `configuration.py` block and
   restart command below.

3. Add to `configuration.py`:
```python
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
```

4. Restart NetBox:
```bash
sudo systemctl restart netbox netbox-rq
```

## Frontend development

The UI (`ui/src/*.jsx`) is a React app built with webpack into
`netbox_cable_calc/static/netbox_cable_calc/calculator.bundle.js`, which is
what actually ships and gets served. If you change anything under `ui/src`,
rebuild the bundle and commit the result — the running plugin only ever
reads the compiled file, never the JSX source directly:

```bash
cd ui
npm install
npm run build
git add ../netbox_cable_calc/static/netbox_cable_calc/calculator.bundle.js*
```

Requires Node.js 18+. Use `npm run dev` for a watch build while iterating.

## Usage

- Navigate to `/plugins/cable-calc/` in NetBox
- Select a site and location
- View the floor plan editor with rack positions
- Generate BOM with calculated cable lengths
- Save lengths back to NetBox

## Configuration

The plugin supports the following settings in `PLUGINS_CONFIG`:

| Setting | Default | Description |
|---------|---------|-------------|
| `aisle_width` | 60 | Width of aisle between rows (inches) |
| `rack_depth` | 48 | Depth of rack (inches) |
| `port_depth` | 4 | Depth of patch panel ports (inches) |
| `fiber_overhead` | 18 | Overhead tray height for fiber (inches) |
| `copper_overhead` | 12 | Overhead tray height for copper (inches) |
| `default_slack_pct` | 10 | Default slack percentage for copper |

## Requirements

- NetBox 4.x
- Python 3.8+
- Django 3.x+

## License

MIT License - see LICENSE file

## Performance Features

### BOM Caching

Cable calculations are automatically cached per site/location to improve performance:
- First BOM generation calculates and caches results
- Subsequent requests load instantly from cache
- Use the "Recalculate" button or add `?recalculate=true` to force refresh
- Cache invalidates when you update rack positions or cable configurations

Cache files are stored in: `layouts/site_{id}_bom_cache.json`
