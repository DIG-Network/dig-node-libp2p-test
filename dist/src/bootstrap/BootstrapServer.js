import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { Logger } from '../node/logger.js';
export class BootstrapServer {
    constructor(port = 3000) {
        this.port = port;
        this.app = express();
        this.server = createServer(this.app);
        this.io = new SocketIOServer(this.server, {
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            }
        });
        this.logger = new Logger('Bootstrap');
        this.peers = new Map();
        this.cleanupInterval = null;
        this.PEER_TIMEOUT = 10 * 60 * 1000; // 10 minutes
        this.MAX_PEERS = 10000; // Limit for scalability
        this.relayConnections = new Map(); // Active relay connections
        this.setupRoutes();
        this.setupRelayServer();
        this.startCleanupTask();
    }
    setupRoutes() {
        this.app.use(cors({
            origin: '*',
            methods: ['GET', 'POST', 'DELETE'],
            allowedHeaders: ['Content-Type', 'Authorization']
        }));
        this.app.use(express.json({ limit: '1mb' }));
        // Add request logging middleware
        this.app.use((req, res, next) => {
            const start = Date.now();
            res.on('finish', () => {
                const duration = Date.now() - start;
                this.logger.debug(`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
            });
            next();
        });
        // Health check
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'ok',
                service: 'DIG Network Bootstrap Server',
                version: '1.0.0',
                peers: this.peers.size,
                uptime: process.uptime(),
                timestamp: new Date().toISOString()
            });
        });
        // Get bootstrap server stats
        this.app.get('/stats', (req, res) => {
            const now = Date.now();
            const activePeers = Array.from(this.peers.values()).filter(peer => now - peer.lastSeen < this.PEER_TIMEOUT);
            const totalStores = new Set();
            activePeers.forEach(peer => {
                peer.stores.forEach(store => totalStores.add(store));
            });
            res.json({
                totalPeers: this.peers.size,
                activePeers: activePeers.length,
                totalStores: totalStores.size,
                averageStoresPerPeer: activePeers.length > 0 ?
                    activePeers.reduce((sum, peer) => sum + peer.stores.length, 0) / activePeers.length : 0,
                uptimeSeconds: process.uptime(),
                memoryUsage: process.memoryUsage(),
                timestamp: new Date().toISOString()
            });
        });
        // Register a peer
        this.app.post('/register', (req, res) => {
            try {
                const { peerId, addresses, cryptoIPv6, stores = [], version = '1.0.0' } = req.body;
                // Validate required fields
                if (!peerId || !addresses || !Array.isArray(addresses)) {
                    res.status(400).json({
                        error: 'Missing required fields: peerId, addresses',
                        required: ['peerId', 'addresses'],
                        optional: ['cryptoIPv6', 'stores', 'version']
                    });
                    return;
                }
                // Validate peerId format
                if (typeof peerId !== 'string' || peerId.length < 10) {
                    res.status(400).json({
                        error: 'Invalid peerId format'
                    });
                    return;
                }
                // Validate addresses
                if (!addresses.every((addr) => typeof addr === 'string' && addr.includes('/p2p/'))) {
                    res.status(400).json({
                        error: 'Invalid address format. Addresses must be multiaddrs with /p2p/ component'
                    });
                    return;
                }
                // Check peer limit
                if (this.peers.size >= this.MAX_PEERS && !this.peers.has(peerId)) {
                    res.status(503).json({
                        error: 'Bootstrap server at capacity',
                        maxPeers: this.MAX_PEERS,
                        currentPeers: this.peers.size
                    });
                    return;
                }
                const now = Date.now();
                const isNewPeer = !this.peers.has(peerId);
                // Register/update peer
                this.peers.set(peerId, {
                    peerId,
                    addresses,
                    cryptoIPv6: cryptoIPv6 || '',
                    stores: Array.isArray(stores) ? stores : [],
                    timestamp: isNewPeer ? now : (this.peers.get(peerId)?.timestamp || now),
                    lastSeen: now,
                    version,
                    userAgent: req.headers['user-agent']
                });
                if (isNewPeer) {
                    this.logger.info(`➕ New peer registered: ${peerId} (${addresses.length} addresses, ${stores.length} stores)`);
                }
                else {
                    this.logger.debug(`🔄 Peer updated: ${peerId}`);
                }
                res.json({
                    success: true,
                    message: isNewPeer ? 'Peer registered' : 'Peer updated',
                    peerId,
                    totalPeers: this.peers.size
                });
            }
            catch (error) {
                this.logger.error('Registration error:', error);
                res.status(500).json({
                    error: 'Registration failed',
                    message: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        });
        // Get list of peers for discovery
        this.app.get('/peers', (req, res) => {
            try {
                const now = Date.now();
                const limit = Math.min(parseInt(req.query.limit) || 50, 200);
                const includeStores = req.query.includeStores === 'true';
                // Get active peers only
                const activePeers = Array.from(this.peers.values())
                    .filter(peer => now - peer.lastSeen < this.PEER_TIMEOUT)
                    .sort((a, b) => b.lastSeen - a.lastSeen) // Most recent first
                    .slice(0, limit);
                const peerList = activePeers.map(peer => ({
                    peerId: peer.peerId,
                    addresses: peer.addresses,
                    cryptoIPv6: peer.cryptoIPv6,
                    stores: includeStores ? peer.stores : undefined,
                    lastSeen: peer.lastSeen,
                    version: peer.version
                }));
                res.json({
                    peers: peerList,
                    total: activePeers.length,
                    timestamp: new Date().toISOString()
                });
            }
            catch (error) {
                this.logger.error('Peer discovery error:', error);
                res.status(500).json({
                    error: 'Peer discovery failed',
                    message: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        });
        // Find peers with specific store
        this.app.get('/peers/store/:storeId', (req, res) => {
            try {
                const { storeId } = req.params;
                const now = Date.now();
                if (!storeId || !/^[a-fA-F0-9]{32,}$/.test(storeId)) {
                    res.status(400).json({
                        error: 'Invalid storeId format'
                    });
                    return;
                }
                const peersWithStore = Array.from(this.peers.values())
                    .filter(peer => now - peer.lastSeen < this.PEER_TIMEOUT &&
                    peer.stores.includes(storeId))
                    .map(peer => ({
                    peerId: peer.peerId,
                    addresses: peer.addresses,
                    cryptoIPv6: peer.cryptoIPv6,
                    lastSeen: peer.lastSeen
                }));
                res.json({
                    storeId,
                    peers: peersWithStore,
                    count: peersWithStore.length,
                    timestamp: new Date().toISOString()
                });
            }
            catch (error) {
                this.logger.error('Store peer discovery error:', error);
                res.status(500).json({
                    error: 'Store peer discovery failed'
                });
            }
        });
        // Unregister a peer
        this.app.post('/unregister', (req, res) => {
            try {
                const { peerId } = req.body;
                if (!peerId) {
                    res.status(400).json({
                        error: 'peerId is required'
                    });
                    return;
                }
                const existed = this.peers.delete(peerId);
                if (existed) {
                    this.logger.info(`➖ Peer unregistered: ${peerId}`);
                }
                res.json({
                    success: true,
                    message: existed ? 'Peer unregistered' : 'Peer was not registered',
                    totalPeers: this.peers.size
                });
            }
            catch (error) {
                this.logger.error('Unregistration error:', error);
                res.status(500).json({
                    error: 'Unregistration failed'
                });
            }
        });
        // Get network topology (for debugging)
        this.app.get('/topology', (req, res) => {
            try {
                const now = Date.now();
                const activePeers = Array.from(this.peers.values())
                    .filter(peer => now - peer.lastSeen < this.PEER_TIMEOUT);
                const topology = {
                    totalActivePeers: activePeers.length,
                    peersByVersion: this.groupBy(activePeers, 'version'),
                    storeDistribution: this.calculateStoreDistribution(activePeers),
                    networkHealth: {
                        averageStoresPerPeer: activePeers.length > 0 ?
                            activePeers.reduce((sum, peer) => sum + peer.stores.length, 0) / activePeers.length : 0,
                        peersWithStores: activePeers.filter(peer => peer.stores.length > 0).length,
                        uniqueStores: new Set(activePeers.flatMap(peer => peer.stores)).size
                    },
                    timestamp: new Date().toISOString()
                };
                res.json(topology);
            }
            catch (error) {
                this.logger.error('Topology error:', error);
                res.status(500).json({
                    error: 'Topology calculation failed'
                });
            }
        });
        // Get relay server information
        this.app.get('/relay-info', (req, res) => {
            try {
                res.json({
                    relayEnabled: true,
                    activeRelayConnections: this.relayConnections.size,
                    websocketUrl: `ws://${req.get('host')}/socket.io/`,
                    stunServers: [
                        'stun:stun.l.google.com:19302',
                        'stun:stun1.l.google.com:19302',
                        'stun:global.stun.twilio.com:3478'
                    ],
                    turnServer: `turn:${req.get('host')}:3478`,
                    relaySupport: {
                        webrtc: true,
                        websocket: true,
                        circuitRelay: true
                    }
                });
            }
            catch (error) {
                res.status(500).json({
                    error: 'Failed to get relay info'
                });
            }
        });
        // Initiate relay connection between peers
        this.app.post('/initiate-relay', (req, res) => {
            try {
                const { fromPeerId, toPeerId } = req.body;
                if (!fromPeerId || !toPeerId) {
                    res.status(400).json({
                        error: 'fromPeerId and toPeerId are required'
                    });
                    return;
                }
                const fromSocket = this.relayConnections.get(fromPeerId);
                const toSocket = this.relayConnections.get(toPeerId);
                if (!fromSocket || !toSocket) {
                    res.status(404).json({
                        error: 'One or both peers not available for relay',
                        fromPeerAvailable: !!fromSocket,
                        toPeerAvailable: !!toSocket
                    });
                    return;
                }
                // Notify both peers to start relay negotiation
                fromSocket.emit('relay-initiate', { targetPeerId: toPeerId });
                toSocket.emit('relay-initiate', { targetPeerId: fromPeerId });
                res.json({
                    success: true,
                    message: 'Relay initiation sent to both peers',
                    fromPeerId,
                    toPeerId
                });
            }
            catch (error) {
                res.status(500).json({
                    error: 'Failed to initiate relay'
                });
            }
        });
        // Relay store content between peers
        this.app.post('/relay-store', async (req, res) => {
            try {
                const { fromPeerId, toPeerId, storeId } = req.body;
                if (!fromPeerId || !toPeerId || !storeId) {
                    res.status(400).json({
                        error: 'fromPeerId, toPeerId, and storeId are required'
                    });
                    return;
                }
                // Find the source peer
                const sourcePeer = this.peers.get(fromPeerId);
                if (!sourcePeer) {
                    res.status(404).json({
                        error: 'Source peer not found',
                        fromPeerId
                    });
                    return;
                }
                // Check if source peer has the requested store
                if (!sourcePeer.stores.includes(storeId)) {
                    res.status(404).json({
                        error: 'Store not found on source peer',
                        storeId,
                        fromPeerId
                    });
                    return;
                }
                // Request the actual store content from the source peer via WebSocket
                this.logger.info(`🔄 Requesting store ${storeId} from source peer ${fromPeerId} via WebSocket`);
                const sourceSocket = this.relayConnections.get(fromPeerId);
                if (!sourceSocket) {
                    res.status(404).json({
                        error: 'Source peer not connected to relay server',
                        fromPeerId
                    });
                    return;
                }
                // Request store content from source peer via WebSocket
                const requestId = `store-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                // Set up response handler
                const responsePromise = new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        reject(new Error('Store request timeout'));
                    }, 30000);
                    const responseHandler = (data) => {
                        if (data.requestId === requestId) {
                            clearTimeout(timeout);
                            sourceSocket.off('store-response', responseHandler);
                            if (data.success && data.content) {
                                const storeBuffer = Buffer.from(data.content, 'base64');
                                resolve(storeBuffer);
                            }
                            else {
                                reject(new Error(data.error || 'Store request failed'));
                            }
                        }
                    };
                    sourceSocket.on('store-response', responseHandler);
                });
                // Send store request to source peer
                sourceSocket.emit('store-request', {
                    requestId,
                    storeId,
                    fromPeerId: toPeerId // Who is requesting
                });
                try {
                    const storeContent = await responsePromise;
                    res.setHeader('Content-Type', 'application/x-dig-archive');
                    res.setHeader('Content-Length', storeContent.length.toString());
                    res.setHeader('X-Source-Peer', fromPeerId);
                    res.setHeader('X-Store-Id', storeId);
                    res.setHeader('X-Relay-Type', 'content');
                    res.send(storeContent);
                    this.logger.info(`✅ Successfully relayed store ${storeId} from ${fromPeerId} to ${toPeerId} (${storeContent.length} bytes)`);
                }
                catch (requestError) {
                    this.logger.error(`Failed to get store ${storeId} from source peer:`, requestError);
                    res.status(500).json({
                        error: 'Failed to retrieve store from source peer',
                        message: requestError instanceof Error ? requestError.message : 'Unknown error',
                        storeId,
                        fromPeerId
                    });
                }
            }
            catch (error) {
                this.logger.error('Store relay error:', error);
                res.status(500).json({
                    error: 'Failed to relay store'
                });
            }
        });
    }
    groupBy(array, key) {
        return array.reduce((groups, item) => {
            const value = item[key] || 'unknown';
            groups[value] = (groups[value] || 0) + 1;
            return groups;
        }, {});
    }
    calculateStoreDistribution(peers) {
        const storeCount = new Map();
        peers.forEach(peer => {
            peer.stores.forEach(store => {
                storeCount.set(store, (storeCount.get(store) || 0) + 1);
            });
        });
        const distribution = Array.from(storeCount.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20); // Top 20 most replicated stores
        return {
            totalStores: storeCount.size,
            topReplicated: distribution.map(([store, count]) => ({ store, replicas: count })),
            averageReplication: storeCount.size > 0 ?
                Array.from(storeCount.values()).reduce((sum, count) => sum + count, 0) / storeCount.size : 0
        };
    }
    startCleanupTask() {
        // Clean up stale peers every 5 minutes
        this.cleanupInterval = setInterval(() => {
            const now = Date.now();
            const initialSize = this.peers.size;
            for (const [peerId, peer] of this.peers) {
                if (now - peer.lastSeen > this.PEER_TIMEOUT) {
                    this.peers.delete(peerId);
                    this.logger.debug(`🧹 Cleaned up stale peer: ${peerId}`);
                }
            }
            const cleaned = initialSize - this.peers.size;
            if (cleaned > 0) {
                this.logger.info(`🧹 Cleaned up ${cleaned} stale peers (${this.peers.size} remaining)`);
            }
        }, 5 * 60 * 1000);
    }
    // Setup WebSocket relay server for NAT traversal
    setupRelayServer() {
        this.io.on('connection', (socket) => {
            this.logger.debug(`🔗 Relay connection from: ${socket.id}`);
            socket.on('register-relay', (data) => {
                const { peerId } = data;
                if (peerId) {
                    this.relayConnections.set(peerId, socket);
                    socket.peerId = peerId;
                    this.logger.info(`📡 Relay registered for peer: ${peerId}`);
                    socket.emit('relay-registered', { success: true });
                }
            });
            socket.on('relay-offer', (data) => {
                const { targetPeerId, offer, fromPeerId } = data;
                const targetSocket = this.relayConnections.get(targetPeerId);
                if (targetSocket) {
                    targetSocket.emit('relay-offer', { offer, fromPeerId });
                    this.logger.debug(`🔄 Relaying offer from ${fromPeerId} to ${targetPeerId}`);
                }
                else {
                    socket.emit('relay-error', { error: 'Target peer not available for relay' });
                }
            });
            socket.on('relay-answer', (data) => {
                const { targetPeerId, answer, fromPeerId } = data;
                const targetSocket = this.relayConnections.get(targetPeerId);
                if (targetSocket) {
                    targetSocket.emit('relay-answer', { answer, fromPeerId });
                    this.logger.debug(`🔄 Relaying answer from ${fromPeerId} to ${targetPeerId}`);
                }
            });
            socket.on('relay-ice-candidate', (data) => {
                const { targetPeerId, candidate, fromPeerId } = data;
                const targetSocket = this.relayConnections.get(targetPeerId);
                if (targetSocket) {
                    targetSocket.emit('relay-ice-candidate', { candidate, fromPeerId });
                    this.logger.debug(`🧊 Relaying ICE candidate from ${fromPeerId} to ${targetPeerId}`);
                }
            });
            socket.on('disconnect', () => {
                const socketPeerId = socket.peerId;
                if (socketPeerId) {
                    this.relayConnections.delete(socketPeerId);
                    this.logger.debug(`📡 Relay disconnected for peer: ${socketPeerId}`);
                }
            });
        });
    }
    async start() {
        return new Promise((resolve, reject) => {
            this.server.listen(this.port, '0.0.0.0', () => {
                this.logger.info(`🌍 DIG Bootstrap Server with TURN relay started on port ${this.port}`);
                this.logger.info(`📡 Registration endpoint: http://0.0.0.0:${this.port}/register`);
                this.logger.info(`🔍 Discovery endpoint: http://0.0.0.0:${this.port}/peers`);
                this.logger.info(`📊 Stats endpoint: http://0.0.0.0:${this.port}/stats`);
                this.logger.info(`🔄 WebSocket relay server: ws://0.0.0.0:${this.port}/socket.io/`);
                resolve();
            });
            this.server.on('error', (error) => {
                this.logger.error('Failed to start bootstrap server:', error);
                reject(error);
            });
            // Graceful shutdown
            process.on('SIGINT', () => this.shutdown());
            process.on('SIGTERM', () => this.shutdown());
        });
    }
    shutdown() {
        this.logger.info('🛑 Shutting down bootstrap server...');
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        this.logger.info(`📊 Final stats: ${this.peers.size} registered peers`);
        process.exit(0);
    }
    // Get server statistics
    getStats() {
        const now = Date.now();
        const activePeers = Array.from(this.peers.values()).filter(peer => now - peer.lastSeen < this.PEER_TIMEOUT);
        return {
            totalPeers: this.peers.size,
            activePeers: activePeers.length,
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage(),
            port: this.port
        };
    }
}
//# sourceMappingURL=BootstrapServer.js.map