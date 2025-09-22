# DIG Network Node

A peer-to-peer file sharing system that enables decentralized distribution of .dig archive files with URN-based content resolution following DIP-0001 specifications.

## Features

- **P2P File Sharing**: Share existing .dig files from `~/.dig` directory
- **URN Resolution**: Support DIP-0001 compliant URNs (`urn:dig:chia:{storeID}:{optional roothash}/{optional resource key}`)
- **Cryptographic IPv6 Addressing**: Generate crypto IPv6 addresses from public keys
- **Permissionless Network**: Nodes can join network without central authorization
- **Load Balancing**: Service worker provides automatic peer discovery and failover
- **Web Integration**: Service worker intercepts URN requests for seamless browser integration

## Quick Start

### Installation

```bash
# Clone or create project directory
npm install

# Install dependencies
npm install libp2p @libp2p/tcp @libp2p/noise @libp2p/yamux @libp2p/kad-dht @libp2p/bootstrap @libp2p/mdns it-pipe uint8arrays jszip express cors

# Install dev dependencies
npm install -D typescript @types/node tsx http-server
```

### Build

```bash
# Build TypeScript
npm run build

# Build service worker
npm run build-sw

# Build everything
npm run build-all
```

### Run

```bash
# Run basic node
npm run dev

# Start gateway server
npm start

# Serve demo page
npm run serve
```

## Usage

### Basic Node

```typescript
import { DIGNode } from 'dig-network-node';

const node = new DIGNode({ port: 4001 });
await node.start();

console.log('Available stores:', node.getAvailableStores());
console.log('Crypto IPv6:', node.getCryptoIPv6());
```

### Gateway Server

```typescript
import { DIGGateway } from 'dig-network-node';

const gateway = new DIGGateway(8080);
await gateway.start();
```

### Client API

```typescript
import { DIGNetworkClient } from 'dig-network-node';

const client = new DIGNetworkClient('http://localhost:8080');

// Test content availability
const available = await client.testContent('urn:dig:chia:abc123.../index.html');

// Download content
const data = await client.downloadContent('dig://abc123.../image.png');
```

### Browser Integration

```html
<!-- Service worker automatically resolves these -->
<img src="urn:dig:chia:17f89f9af15a046431342694fd2c6df41be8736287e97f6af8327945e59054fb/photo.jpg">
<video src="dig://abc123def456.../video.mp4" controls></video>
<link rel="stylesheet" href="urn:dig:chia:styles123.../css/main.css">
```

## Configuration

### Node Configuration

```typescript
const config = {
  digPath: '~/.dig',                    // Directory containing .dig files
  port: 4001,                          // LibP2P port
  publicKey: 'hex-encoded-key',        // Optional: for consistent IPv6
  privateKey: 'hex-encoded-key',       // Optional: for consistent identity
  bootstrapPeers: [                    // Bootstrap nodes
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN'
  ]
};
```

## API Endpoints

When running the gateway server:

- `/health` - Node health and status
- `/stores` - List available stores
- `/store/{storeId}` - Store information
- `/discover/{storeId}` - Find peers for a store
- `/resolve?urn={urn}` - Resolve URN to content

## URN Format

DIG Network uses URNs following the DIP-0001 specification:

```
urn:dig:chia:{storeID}/index.html
urn:dig:chia:{storeID}:{rootHash}/path/to/file
dig://{storeID}/path/to/file
```

## Development

### Project Structure

```
dig-node/
├── src/
│   ├── node/           # Core P2P node implementation
│   ├── service-worker/ # Browser service worker
│   ├── client/         # Client API and utilities
│   └── gateway/        # HTTP gateway server
├── examples/           # Example implementations
├── public/             # Demo files and compiled assets
└── README.md
```

### Testing

1. Create `~/.dig` directory
2. Add test .dig files (ZIP archives with web content)
3. Start gateway: `npm start`
4. Open demo: `npm run serve`
5. Test URN resolution in browser

### Debug Mode

```bash
DEBUG=libp2p:*,dig:* npm run dev
```

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Support

For issues and questions, please use the GitHub issue tracker.
# dig-node-libp2p-test
