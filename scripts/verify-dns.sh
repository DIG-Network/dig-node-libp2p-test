#!/bin/bash

# DNS Verification Script for DIG Network Bootstrap Server

echo "🔍 Verifying DNS Configuration for bootstrap.dig.net"
echo "===================================================="

DOMAIN="bootstrap.dig.net"
EXPECTED_PORT="3000"

echo "📋 Checking DNS resolution..."

# Check if domain resolves
if nslookup $DOMAIN >/dev/null 2>&1; then
    echo "✅ Domain $DOMAIN resolves successfully"
    
    # Get the resolved IP/CNAME
    RESOLVED=$(nslookup $DOMAIN | grep -A1 "Name:" | tail -1 | awk '{print $2}' || echo "Unknown")
    echo "   → Resolves to: $RESOLVED"
else
    echo "❌ Domain $DOMAIN does not resolve"
    echo "   Check Route53 configuration and DNS propagation"
    exit 1
fi

echo ""
echo "🌐 Checking HTTP connectivity..."

# Check HTTP connectivity
if curl -s --connect-timeout 10 "http://$DOMAIN/health" >/dev/null; then
    echo "✅ HTTP connection successful"
    
    # Get health check response
    HEALTH_RESPONSE=$(curl -s "http://$DOMAIN/health" | jq -r '.status' 2>/dev/null || echo "unknown")
    echo "   → Health status: $HEALTH_RESPONSE"
else
    echo "❌ HTTP connection failed"
    echo "   Check if bootstrap server is running and accessible"
fi

echo ""
echo "📊 Testing bootstrap server endpoints..."

# Test registration endpoint
echo "🔗 Testing registration endpoint..."
TEST_REGISTRATION=$(curl -s -X POST "http://$DOMAIN/register" \
    -H "Content-Type: application/json" \
    -d '{"peerId":"test","addresses":["/ip4/127.0.0.1/tcp/4001/p2p/test"]}' | jq -r '.success' 2>/dev/null || echo "false")

if [ "$TEST_REGISTRATION" = "true" ]; then
    echo "✅ Registration endpoint working"
else
    echo "⚠️  Registration endpoint may have issues"
fi

# Test discovery endpoint
echo "🔍 Testing discovery endpoint..."
PEER_COUNT=$(curl -s "http://$DOMAIN/peers" | jq -r '.total' 2>/dev/null || echo "0")
echo "   → Registered peers: $PEER_COUNT"

# Test stats endpoint
echo "📊 Testing stats endpoint..."
STATS_RESPONSE=$(curl -s "http://$DOMAIN/stats" | jq -r '.activePeers' 2>/dev/null || echo "unknown")
echo "   → Active peers: $STATS_RESPONSE"

echo ""
echo "🔧 DNS Propagation Check..."

# Check DNS propagation from different servers
DNS_SERVERS=("8.8.8.8" "1.1.1.1" "208.67.222.222")

for dns_server in "${DNS_SERVERS[@]}"; do
    echo "   Checking via $dns_server..."
    if nslookup $DOMAIN $dns_server >/dev/null 2>&1; then
        echo "   ✅ Resolves via $dns_server"
    else
        echo "   ❌ Does not resolve via $dns_server"
    fi
done

echo ""
echo "📋 Summary:"
echo "   - Domain: $DOMAIN"
echo "   - Resolution: $(nslookup $DOMAIN | grep -A1 "Name:" | tail -1 | awk '{print $2}' || echo "Failed")"
echo "   - HTTP Status: $(curl -s -o /dev/null -w "%{http_code}" "http://$DOMAIN/health" || echo "Failed")"
echo "   - Registered Peers: $PEER_COUNT"
echo "   - Active Peers: $STATS_RESPONSE"

echo ""
echo "🌍 Bootstrap server configuration for DIG nodes:"
echo "   discoveryServers: ['http://$DOMAIN:$EXPECTED_PORT']"

echo ""
if [ "$HEALTH_RESPONSE" = "ok" ]; then
    echo "🎉 Bootstrap server is ready for global DIG Network!"
else
    echo "⚠️  Bootstrap server needs attention - check logs and configuration"
fi
