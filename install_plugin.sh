bash

cat > /tmp/install_plugin.sh << 'EOF'
#!/bin/bash
set -e

echo "=== Copying setup.py to plugin root ==="
cp /tmp/setup.py /opt/netbox/netbox_cable_calc/

echo "=== Verifying directory structure ==="
ls -la /opt/netbox/netbox_cable_calc/

echo ""
echo "=== Installing plugin as editable ==="
cd /opt/netbox/netbox_cable_calc
sudo -u netbox /opt/netbox/venv/bin/pip install -e .

echo ""
echo "=== Verification ==="
/opt/netbox/venv/bin/pip show netbox-cable-calc
EOF

chmod +x /tmp/install_plugin.sh
cat /tmp/install_plugin.sh
Output

#!/bin/bash
set -e

echo "=== Copying setup.py to plugin root ==="
cp /tmp/setup.py /opt/netbox/netbox_cable_calc/

echo "=== Verifying directory structure ==="
ls -la /opt/netbox/netbox_cable_calc/

echo ""
echo "=== Installing plugin as editable ==="
cd /opt/netbox/netbox_cable_calc
sudo -u netbox /opt/netbox/venv/bin/pip install -e .

echo ""
echo "=== Verification ==="
/opt/netbox/venv/bin/pip show netbox-cable-calc
