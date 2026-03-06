#!/bin/bash
set -e

echo "Installing TinyProxy..."
apt-get update -qq > /dev/null
apt-get install -y tinyproxy > /dev/null

echo "Configuring TinyProxy..."
# Backup original config
cp /etc/tinyproxy/tinyproxy.conf /etc/tinyproxy/tinyproxy.conf.bak

# 1. Comment out "Allow 127.0.0.1" to allow external connections
# (We will rely on Basic Auth for security)
sed -i 's/^Allow 127.0.0.1/#Allow 127.0.0.1/' /etc/tinyproxy/tinyproxy.conf

# 2. Add Basic Authentication
# Check if Auth already exists to avoid duplicates
if ! grep -q "BasicAuth" /etc/tinyproxy/tinyproxy.conf; then
    echo "" >> /etc/tinyproxy/tinyproxy.conf
    echo "# Authentication" >> /etc/tinyproxy/tinyproxy.conf
    echo "BasicAuth revolut proxy2024" >> /etc/tinyproxy/tinyproxy.conf
fi

# 3. Restart Service
systemctl restart tinyproxy

echo "✅ Proxy Setup Complete!"
echo "Port: 8888"
echo "Creds: revolut:proxy2024"
echo ""
echo "--- IP WHITELISTING ---"
echo "To allow a specific IP, add this line to /etc/tinyproxy/tinyproxy.conf:"
echo "Allow <YOUR_IP>"
echo "Then run: systemctl restart tinyproxy"
