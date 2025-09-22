# 🌍 DIG Network Global Deployment Guide

## Complete Solution for Worldwide Peer Discovery

This guide provides everything needed to deploy a global DIG Network with nodes that can discover each other anywhere in the world.

## 🏗️ Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   DIG Node #1   │    │   DIG Node #2   │    │   DIG Node #N   │
│   (Machine A)   │    │   (Machine B)   │    │  (Machine N)    │
│                 │    │                 │    │                 │
│  47 .dig files  │    │  23 .dig files  │    │  15 .dig files  │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          └──────────────────────┼──────────────────────┘
                                 │
                    ┌─────────────▼──────────────┐
                    │     Bootstrap Server       │
                    │   bootstrap.dig.net:3000   │
                    │                            │
                    │  🌍 Global Peer Registry   │
                    │  📊 Network Statistics     │
                    │  🔍 Peer Discovery API     │
                    └────────────────────────────┘
```

## 🚀 Deployment Steps

### Step 1: Deploy Bootstrap Server to AWS

1. **Prerequisites**:
   ```bash
   # Install required tools
   npm install -g aws-cli
   npm install -g terraform
   
   # Configure AWS credentials
   aws configure
   ```

2. **Deploy to AWS**:
   ```bash
   # Clone and build
   git clone <your-repo>
   cd dig-network-node
   npm install
   npm run build
   
   # Deploy to AWS
   ./scripts/deploy.sh
   ```

3. **Verify deployment**:
   ```bash
   curl http://bootstrap.dig.net:3000/health
   curl http://bootstrap.dig.net:3000/stats
   ```

### Step 2: Configure DIG Nodes for Global Discovery

Update your node configurations to use the bootstrap server:

```typescript
const node = new DIGNode({
  port: 4001,
  discoveryServers: ['http://bootstrap.dig.net:3000'],
  enableGlobalDiscovery: true,
  enableMdns: true,
  enableDht: true
});
```

### Step 3: Start Nodes with Global Discovery

```bash
# On each machine worldwide
npm run global
```

## 💰 Cost Optimization

### AWS Costs (Monthly)
- **EC2 t3.nano**: $3.80/month (cheapest option)
- **Elastic Beanstalk**: Free (no additional charges)
- **Route53**: $0.50/month (hosted zone)
- **Data transfer**: ~$0.10/month (minimal)
- **Total**: ~$4.40/month

### Further Cost Reduction
- **Spot instances**: Up to 90% savings (enabled by default)
- **Reserved instances**: 1-year commitment for additional savings
- **Free tier**: t3.micro eligible for first 12 months

## 🔧 Configuration Options

### Bootstrap Server Environment Variables
```bash
export PORT=3000
export NODE_ENV=production
export DIG_LOG_LEVEL=INFO
```

### DIG Node Environment Variables
```bash
export DIG_PORT=4001
export DIG_DISCOVERY_SERVERS="http://bootstrap.dig.net:3000"
export DIG_LOG_LEVEL=INFO
export DIG_PATH="/custom/dig/path"  # Optional
```

## 📊 Monitoring & Health Checks

### Bootstrap Server Endpoints
- **Health**: `GET /health` - Server status and stats
- **Stats**: `GET /stats` - Peer statistics and metrics
- **Topology**: `GET /topology` - Network topology view
- **Peers**: `GET /peers` - List of registered peers

### DIG Node Endpoints (via Gateway)
- **Health**: `GET /health` - Node health and metrics
- **Connections**: `GET /connections` - Peer connection info
- **Metrics**: `GET /metrics` - Detailed node statistics
- **Stores**: `GET /stores` - Available stores

## 🌐 Global Discovery Flow

1. **Node Startup**:
   - Node starts and scans `~/.dig` for files
   - Registers with bootstrap server
   - Starts LibP2P with DHT and mDNS

2. **Peer Discovery**:
   - Queries bootstrap server for peer list
   - Attempts connections to discovered peers
   - Uses DHT for distributed peer finding
   - mDNS for local network peers

3. **Store Synchronization**:
   - Discovers stores from connected peers
   - Downloads missing stores automatically
   - Shares new stores with network
   - Maintains global replication

## 🧪 Testing Global Discovery

### Test Bootstrap Server
```bash
# Health check
curl http://bootstrap.dig.net:3000/health

# Check registered peers
curl http://bootstrap.dig.net:3000/peers

# Network statistics
curl http://bootstrap.dig.net:3000/stats
```

### Test Node Discovery
```bash
# Start node with global discovery
npm run global

# Check connections
curl http://localhost:8080/connections

# Monitor peer discovery
curl http://localhost:8080/metrics
```

### Manual Peer Connection (for testing)
```bash
# Get node address from first machine
npm run global
# Note the address: /ip4/X.X.X.X/tcp/4001/p2p/12D3KooW...

# Connect from second machine
npm run connect-peers "/ip4/X.X.X.X/tcp/4001/p2p/12D3KooW..."
```

## 🔍 Troubleshooting

### Nodes Can't Discover Each Other

1. **Check bootstrap server**:
   ```bash
   curl http://bootstrap.dig.net:3000/health
   ```

2. **Verify node registration**:
   ```bash
   curl http://bootstrap.dig.net:3000/peers
   ```

3. **Check firewall settings**:
   - Bootstrap server: Port 3000 open
   - DIG nodes: P2P port (4001) open
   - Both inbound and outbound

4. **Network connectivity**:
   - Ensure nodes can reach bootstrap.dig.net
   - Check NAT/router configurations
   - Consider port forwarding for home networks

### Bootstrap Server Issues

1. **Check AWS deployment**:
   ```bash
   cd terraform
   terraform output
   aws elasticbeanstalk describe-environments
   ```

2. **Check application logs**:
   - AWS Console → Elastic Beanstalk → Logs
   - CloudWatch Logs

3. **Scale if needed**:
   - Increase instance size if overwhelmed
   - Add more instances for redundancy

## 🚀 Production Checklist

- [ ] Bootstrap server deployed to AWS
- [ ] Domain `bootstrap.dig.net` pointing to server
- [ ] SSL certificate configured (optional)
- [ ] Health checks passing
- [ ] DIG nodes configured with bootstrap server
- [ ] Firewall rules configured
- [ ] Monitoring and alerting set up
- [ ] Backup/disaster recovery plan

## 🎯 Expected Results

After completing this deployment:

1. **Nodes worldwide discover each other automatically**
2. **Store synchronization happens globally**
3. **New nodes join the network seamlessly**
4. **Network grows organically as more nodes join**
5. **Content is replicated across all peers**

## 💡 Advanced Features

### Multiple Bootstrap Servers
Deploy to multiple regions for redundancy:
- `bootstrap1.dig.net` (US East)
- `bootstrap2.dig.net` (Europe)
- `bootstrap3.dig.net` (Asia)

### Load Balancing
Use AWS Application Load Balancer for high availability.

### Monitoring
Set up CloudWatch alarms for:
- Instance health
- Response times
- Error rates
- Peer registration rates

The bootstrap server enables **true global peer discovery** for the DIG Network! 🌟
