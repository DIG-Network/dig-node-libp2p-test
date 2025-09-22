#!/bin/bash

# Script to update DIG node configurations to use the bootstrap server

echo "🔧 Updating DIG Node Configurations"
echo "===================================="

BOOTSTRAP_URL="http://bootstrap.dig.net:3000"

echo "📝 Creating updated node configuration..."

cat > dig-node-config.json << EOF
{
  "port": 4001,
  "discoveryServers": ["$BOOTSTRAP_URL"],
  "enableGlobalDiscovery": true,
  "enableMdns": true,
  "enableDht": true,
  "connectToPeers": []
}
EOF

echo "✅ Configuration file created: dig-node-config.json"

echo ""
echo "📋 To use this configuration in your DIG nodes:"
echo ""
echo "1. Environment variables approach:"
echo "   export DIG_DISCOVERY_SERVERS=\"$BOOTSTRAP_URL\""
echo "   npm run global"
echo ""
echo "2. Programmatic approach:"
echo "   const node = new DIGNode({"
echo "     port: 4001,"
echo "     discoveryServers: ['$BOOTSTRAP_URL'],"
echo "     enableGlobalDiscovery: true"
echo "   });"
echo ""
echo "3. Use the global discovery example:"
echo "   npm run global"
echo ""
echo "🌍 Your nodes will now discover each other globally through:"
echo "   - Bootstrap server: $BOOTSTRAP_URL"
echo "   - DHT network propagation"
echo "   - Local mDNS (same network)"
echo ""
echo "📊 Monitor the network:"
echo "   - Bootstrap stats: curl $BOOTSTRAP_URL/stats"
echo "   - Network topology: curl $BOOTSTRAP_URL/topology"
echo "   - Node connections: curl http://localhost:8080/connections"
