# 🌍 DIG Network Bootstrap Server Deployment Guide

## Overview

To enable global peer discovery for DIG Network nodes running worldwide, you need to deploy bootstrap servers that help nodes find each other across different networks.

## 🚀 Quick Deployment

### 1. Deploy Bootstrap Server

Deploy the bootstrap server to `bootstrap1.dig.net`:

```bash
# On your server (bootstrap1.dig.net)
git clone <your-repo>
cd dig-network-node
npm install
npm run build

# Start bootstrap server
PORT=3000 npm run bootstrap
```

### 2. Configure DIG Nodes for Global Discovery

Update your DIG nodes to use the bootstrap server:

```typescript
const node = new DIGNode({
  port: 4001,
  discoveryServers: [
    'http://bootstrap1.dig.net:3000'
  ],
  enableGlobalDiscovery: true,
  enableMdns: true,  // Still useful for local networks
  enableDht: true    // DHT for distributed discovery
});
```

## 🔧 Production Bootstrap Server Setup

### Environment Variables

```bash
export PORT=3000                    # Bootstrap server port
export NODE_ENV=production          # Production mode
export DIG_LOG_LEVEL=INFO           # Logging level
```

### Docker Deployment

```dockerfile
FROM node:22-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "bootstrap"]
```

### Nginx Configuration (for SSL/HTTPS)

```nginx
server {
    listen 80;
    listen 443 ssl;
    server_name bootstrap1.dig.net;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 🌐 Multiple Bootstrap Servers

For redundancy, deploy multiple bootstrap servers:

1. **bootstrap1.dig.net** - Primary server (US/Europe)
2. **bootstrap2.dig.net** - Secondary server (Asia)
3. **bootstrap3.dig.net** - Tertiary server (Other regions)

Each server runs independently and nodes will try all of them.

## 📊 Bootstrap Server API

The bootstrap server provides these endpoints:

### Registration
```bash
POST /register
{
  "peerId": "12D3KooW...",
  "addresses": ["/ip4/1.2.3.4/tcp/4001/p2p/12D3KooW..."],
  "cryptoIPv6": "fd00:...",
  "stores": ["abc123...", "def456..."],
  "version": "1.0.0"
}
```

### Discovery
```bash
GET /peers
GET /peers?limit=100&includeStores=true
GET /peers/store/{storeId}
```

### Monitoring
```bash
GET /health      # Server health
GET /stats       # Peer statistics
GET /topology    # Network topology
```

## 🔧 Node Configuration Examples

### Basic Global Discovery
```typescript
const node = new DIGNode({
  port: 4001,
  discoveryServers: ['http://bootstrap1.dig.net:3000']
});
```

### Advanced Configuration
```typescript
const node = new DIGNode({
  port: 4001,
  
  // Global discovery
  discoveryServers: [
    'http://bootstrap1.dig.net:3000',
    'http://bootstrap2.dig.net:3000'
  ],
  enableGlobalDiscovery: true,
  
  // Local discovery
  enableMdns: true,
  enableDht: true,
  
  // Manual connections (for testing)
  connectToPeers: [
    '/ip4/192.168.1.100/tcp/4001/p2p/12D3KooW...'
  ],
  
  // LibP2P bootstrap (optional)
  bootstrapPeers: [
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN'
  ]
});
```

## 🧪 Testing Global Discovery

### 1. Start Bootstrap Server
```bash
npm run bootstrap
```

### 2. Start Node with Global Discovery
```bash
npm run global
```

### 3. Check Connection Status
```bash
curl http://localhost:8080/connections
curl http://localhost:8080/metrics
```

### 4. Monitor Bootstrap Server
```bash
curl http://bootstrap1.dig.net:3000/stats
curl http://bootstrap1.dig.net:3000/topology
```

## 🔍 Troubleshooting

### Nodes Can't Discover Each Other

1. **Check bootstrap server accessibility**:
   ```bash
   curl http://bootstrap1.dig.net:3000/health
   ```

2. **Verify node registration**:
   ```bash
   curl http://bootstrap1.dig.net:3000/peers
   ```

3. **Check firewall settings**:
   - Bootstrap server: Port 3000 open
   - DIG nodes: P2P port (4001) open
   - Both TCP and UDP if possible

4. **Network connectivity**:
   - Ensure nodes can reach the internet
   - Check NAT/firewall configurations
   - Consider using UPnP or manual port forwarding

### Bootstrap Server Issues

1. **Check server logs**:
   ```bash
   DIG_LOG_LEVEL=DEBUG npm run bootstrap
   ```

2. **Monitor resource usage**:
   ```bash
   curl http://bootstrap1.dig.net:3000/stats
   ```

3. **Verify peer cleanup**:
   - Stale peers are cleaned up every 5 minutes
   - Peers timeout after 10 minutes of inactivity

## 🌟 Production Deployment Checklist

- [ ] Deploy bootstrap server to `bootstrap1.dig.net:3000`
- [ ] Configure SSL/HTTPS with proper certificates
- [ ] Set up monitoring and logging
- [ ] Configure firewall rules (port 3000)
- [ ] Set up health checks and alerting
- [ ] Configure auto-restart on failure
- [ ] Set up backup/redundant bootstrap servers
- [ ] Update DIG node configurations to use new bootstrap servers
- [ ] Test connectivity from different networks/regions

## 🎯 Expected Results

After deploying the bootstrap server:

1. **Nodes worldwide can discover each other**
2. **Automatic store synchronization** across all peers
3. **Resilient network** with multiple discovery mechanisms
4. **Global content distribution** without manual configuration

The bootstrap server acts as a **meeting point** for nodes to find each other, after which they communicate directly via P2P protocols.
