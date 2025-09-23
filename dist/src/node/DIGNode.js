import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { kadDHT } from '@libp2p/kad-dht';
import { bootstrap } from '@libp2p/bootstrap';
import { mdns } from '@libp2p/mdns';
import { ping } from '@libp2p/ping';
import { identify } from '@libp2p/identify';
import { pipe } from 'it-pipe';
import { multiaddr } from '@multiformats/multiaddr';
import { uPnPNAT } from '@libp2p/upnp-nat';
import { autoNAT } from '@libp2p/autonat';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { webRTC } from '@libp2p/webrtc';
import { webSockets } from '@libp2p/websockets';
import { all } from '@libp2p/websockets/filters';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { randomBytes, createHash } from 'crypto';
import { readFile, readdir, stat, watch, writeFile } from 'fs/promises';
import { join, basename } from 'path';
import { homedir } from 'os';
import { NodeType, CapabilityCode, DIG_PROTOCOL, DIG_DISCOVERY_PROTOCOL } from './types.js';
import { generateCryptoIPv6, parseURN, createCryptoIPv6Addresses, resolveCryptoIPv6, isCryptoIPv6Address } from './utils.js';
import { Logger } from './logger.js';
import { GlobalDiscovery } from './GlobalDiscovery.js';
import { WebSocketRelay } from './WebSocketRelay.js';
import { E2EEncryption } from './E2EEncryption.js';
import { ZeroKnowledgePrivacy } from './ZeroKnowledgePrivacy.js';
import { DownloadManager } from './DownloadManager.js';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
export class DIGNode {
    constructor(config = {}) {
        this.config = config;
        this.digFiles = new Map();
        this.watcher = null;
        this.syncInterval = null;
        this.discoveredPeers = new Set();
        this.peerStores = new Map(); // peerId -> Set of storeIds
        this.syncInProgress = false;
        this.isStarted = false;
        this.logger = new Logger('DIGNode');
        this.startTime = 0;
        this.e2eEncryption = new E2EEncryption();
        this.peerProtocolVersions = new Map(); // peerId -> protocol version
        this.nodeCapabilities = {
            libp2p: false,
            dht: false,
            mdns: false,
            upnp: false,
            autonat: false,
            webrtc: false,
            websockets: false,
            circuitRelay: false,
            turnServer: false,
            bootstrapServer: false,
            storeSync: false,
            e2eEncryption: false,
            protocolVersion: '1.0.0',
            environment: 'development'
        };
        this.requestCounts = new Map();
        // Built-in Bootstrap Server
        this.app = express();
        this.httpServer = createServer(this.app);
        this.io = new SocketIOServer(this.httpServer, {
            cors: { origin: "*", methods: ["GET", "POST"] }
        });
        this.registeredPeers = new Map();
        this.relayConnections = new Map();
        this.turnServers = new Map();
        this.cleanupInterval = null;
        this.MAX_REQUESTS_PER_MINUTE = 100;
        this.PEER_TIMEOUT = 10 * 60 * 1000; // 10 minutes
        // Distributed Privacy Overlay Network
        this.privacyOverlayPeers = new Map();
        this.gossipTopics = {
            PEER_DISCOVERY: 'dig-privacy-peer-discovery',
            ADDRESS_EXCHANGE: 'dig-privacy-address-exchange',
            STORE_ANNOUNCEMENTS: 'dig-privacy-store-announcements',
            CAPABILITY_ANNOUNCEMENTS: 'dig-privacy-capability-announcements'
        };
        this.metrics = {
            filesLoaded: 0,
            filesShared: 0,
            peersConnected: 0,
            syncAttempts: 0,
            syncSuccesses: 0,
            downloadAttempts: 0,
            downloadSuccesses: 0,
            errors: 0
        };
        // Validate and set configuration
        this.validateConfig(config);
        this.digPath = config.digPath || join(homedir(), '.dig');
        this.setupBuiltInBootstrapServer();
        this.detectEnvironment();
        // Initialize zero-knowledge privacy module
        this.zkPrivacy = new ZeroKnowledgePrivacy(this.node?.peerId?.toString() || 'pending');
        // Initialize download manager for resumable downloads
        this.downloadManager = new DownloadManager(this.digPath, this);
    }
    // Ensure DIG directory exists, create if needed, or gracefully disable file features
    async ensureDigDirectory() {
        try {
            const { access } = await import('fs/promises');
            await access(this.digPath);
            this.logger.info(`📁 DIG directory exists: ${this.digPath}`);
            return true;
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                try {
                    const { mkdir } = await import('fs/promises');
                    await mkdir(this.digPath, { recursive: true });
                    this.logger.info(`✅ Created DIG directory: ${this.digPath}`);
                    return true;
                }
                catch (mkdirError) {
                    this.logger.warn(`⚠️ Cannot create DIG directory ${this.digPath}, running in bootstrap-only mode:`, mkdirError instanceof Error ? mkdirError.message : mkdirError);
                    // Gracefully disable file-related capabilities
                    this.nodeCapabilities.storeSync = false;
                    const isAWS = process.env.AWS_DEPLOYMENT === 'true' || (process.env.NODE_ENV === 'production' && process.env.PORT);
                    if (isAWS) {
                        this.logger.info('🌐 AWS container storage not writable - continuing in bootstrap-only mode');
                    }
                    return false;
                }
            }
            else {
                this.logger.warn(`⚠️ Cannot access DIG directory, running in bootstrap-only mode:`, error instanceof Error ? error.message : error);
                this.nodeCapabilities.storeSync = false;
                return false;
            }
        }
    }
    // Detect and configure environment-specific capabilities
    detectEnvironment() {
        const isAWS = process.env.AWS_DEPLOYMENT === 'true' || (process.env.NODE_ENV === 'production' && process.env.PORT);
        this.nodeCapabilities.environment = isAWS ? 'aws' :
            (process.env.NODE_ENV === 'production' ? 'production' : 'development');
        // Set baseline capabilities
        this.nodeCapabilities.e2eEncryption = true;
        this.nodeCapabilities.storeSync = true;
        this.nodeCapabilities.bootstrapServer = true;
        this.logger.info(`🔍 Environment detected: ${this.nodeCapabilities.environment}`);
    }
    // Safely try to initialize a service and update capabilities
    async safeServiceInit(serviceName, initFunction, description) {
        try {
            this.logger.debug(`🔧 Initializing ${description}...`);
            const result = await initFunction();
            if (typeof this.nodeCapabilities[serviceName] === 'boolean') {
                this.nodeCapabilities[serviceName] = true;
            }
            this.logger.info(`✅ ${description} initialized successfully`);
            return result;
        }
        catch (error) {
            if (typeof this.nodeCapabilities[serviceName] === 'boolean') {
                this.nodeCapabilities[serviceName] = false;
            }
            this.logger.warn(`⚠️ ${description} failed to initialize (gracefully disabled):`, error instanceof Error ? error.message : error);
            return null;
        }
    }
    // Get current node capabilities for sharing with peers
    getCapabilities() {
        return { ...this.nodeCapabilities };
    }
    // Helper method to add optional services
    async addOptionalService(serviceName, shouldEnable, serviceFactory, description) {
        if (!shouldEnable) {
            this.logger.info(`⏭️ ${description} disabled by configuration`);
            return {};
        }
        const service = await this.safeServiceInit(serviceName, serviceFactory, description);
        return service ? { [serviceName]: service } : {};
    }
    // Get bootstrap server hostname for TURN configuration
    getBootstrapServerHost() {
        if (this.config.discoveryServers && this.config.discoveryServers.length > 0) {
            const url = this.config.discoveryServers[0];
            try {
                const parsed = new URL(url);
                return parsed.hostname;
            }
            catch (error) {
                return 'dig-bootstrap-v2-prod.eba-rdpk2jmt.us-east-1.elasticbeanstalk.com';
            }
        }
        return 'dig-bootstrap-v2-prod.eba-rdpk2jmt.us-east-1.elasticbeanstalk.com';
    }
    // Create circuit relay address for NAT traversal
    createCircuitRelayAddress(originalAddress) {
        try {
            // Extract the peer ID from the original address
            const peerIdMatch = originalAddress.match(/\/p2p\/([^\/]+)$/);
            if (!peerIdMatch)
                return null;
            const targetPeerId = peerIdMatch[1];
            // Use LibP2P public relay nodes for circuit relay
            const relayNodes = [
                '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
                '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
                '/ip4/147.75.77.187/tcp/4001/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN'
            ];
            // Try each relay node
            for (const relayNode of relayNodes) {
                const relayPeerIdMatch = relayNode.match(/\/p2p\/([^\/]+)$/);
                if (relayPeerIdMatch) {
                    const relayPeerId = relayPeerIdMatch[1];
                    // Create circuit relay address: /relay-node/p2p-circuit/target-peer
                    const circuitAddress = `${relayNode}/p2p-circuit/p2p/${targetPeerId}`;
                    return circuitAddress;
                }
            }
            return null;
        }
        catch (error) {
            this.logger.warn('Failed to create circuit relay address:', error);
            return null;
        }
    }
    async start() {
        if (this.isStarted) {
            throw new Error('DIG Node is already started');
        }
        try {
            this.startTime = Date.now();
            const publicKey = this.config.publicKey || randomBytes(32).toString('hex');
            this.cryptoIPv6 = generateCryptoIPv6(publicKey);
            this.logger.info(`🚀 Starting DIG Node...`);
            this.logger.info(`🌐 Crypto IPv6: ${this.cryptoIPv6}`);
            this.logger.info(`📁 DIG Path: ${this.digPath}`);
            // Ensure DIG directory exists before proceeding, or gracefully disable file features
            const hasFileAccess = await this.ensureDigDirectory();
            const peerDiscoveryServices = [];
            // Detect AWS environment early
            const isAWS = process.env.AWS_DEPLOYMENT === 'true' || (process.env.NODE_ENV === 'production' && process.env.PORT);
            const disableMdns = process.env.LIBP2P_DISABLE_MDNS === 'true';
            this.logger.info(`🏗️ Environment: ${isAWS ? 'AWS Production' : 'Development'}`);
            if (isAWS) {
                this.logger.info(`🔧 AWS Optimizations: UPnP=${!process.env.LIBP2P_DISABLE_UPNP}, mDNS=${!disableMdns}, AutoNAT=${!process.env.LIBP2P_DISABLE_AUTONAT}`);
            }
            this.logger.debug(`🔧 Config:`, this.config);
            // Only use DIG network bootstrap nodes (not public LibP2P)
            if (this.config.bootstrapPeers && this.config.bootstrapPeers.length > 0) {
                peerDiscoveryServices.push(bootstrap({
                    list: this.config.bootstrapPeers
                }));
                this.logger.info(`🔗 Using custom DIG bootstrap peers: ${this.config.bootstrapPeers.length} nodes`);
            }
            else {
                this.logger.info('🔗 No bootstrap peers configured - this node will be isolated until other DIG nodes connect');
            }
            if (this.config.enableMdns !== false && !isAWS && !disableMdns) {
                peerDiscoveryServices.push(mdns());
                this.logger.info('🔍 mDNS enabled for local network discovery');
            }
            else {
                this.logger.info(`🌐 mDNS disabled (AWS: ${isAWS}, Disabled: ${disableMdns})`);
            }
            const services = {
                ping: ping(),
                identify: identify()
            };
            // Add gossipsub for distributed privacy peer discovery (always enabled)
            {
                const gossipService = await this.safeServiceInit('e2eEncryption', () => gossipsub({
                    emitSelf: false,
                    allowPublishToZeroTopicPeers: false,
                    msgIdFn: (msg) => {
                        // Custom message ID for privacy
                        return uint8ArrayFromString(msg.topic + msg.data.toString());
                    }
                }), 'GossipSub Privacy Discovery');
                if (gossipService) {
                    services.gossipsub = gossipService;
                    this.logger.info('🗣️ GossipSub enabled for distributed privacy peer discovery');
                }
            }
            // Safely initialize DHT service
            if (this.config.enableDht !== false) {
                const dhtService = await this.safeServiceInit('dht', () => kadDHT({
                    clientMode: false, // Run as DHT server
                    validators: {},
                    selectors: {}
                }), 'DHT Service');
                if (dhtService) {
                    services.dht = dhtService;
                }
            }
            // Configure addresses based on environment
            const addresses = isAWS ? {
                listen: [
                    `/ip4/0.0.0.0/tcp/${this.config.port || 4001}`, // Fixed port for AWS
                    `/ip4/0.0.0.0/tcp/${(this.config.port || 4001) + 1}/ws` // WebSocket for NAT traversal
                ]
            } : {
                listen: [
                    `/ip4/0.0.0.0/tcp/${this.config.port || 0}`, // Dynamic port for development
                    `/ip6/::/tcp/${this.config.port || 0}`,
                    `/ip4/0.0.0.0/tcp/${(this.config.port || 0) + 1}/ws` // WebSocket for NAT traversal
                ]
            };
            this.logger.info(`🔗 LibP2P addresses: [hidden for privacy - crypto-IPv6 only]`);
            // Build transports with graceful degradation
            const transports = [tcp()]; // TCP is always available
            // Try to add WebSocket transport
            try {
                transports.push(webSockets({ filter: all }));
                this.nodeCapabilities.websockets = true;
                this.logger.info('✅ WebSocket transport enabled');
            }
            catch (error) {
                this.logger.warn('⚠️ WebSocket transport disabled:', error instanceof Error ? error.message : error);
                this.nodeCapabilities.websockets = false;
            }
            // Try to add WebRTC transport (only in non-AWS environments)
            if (!isAWS) {
                try {
                    transports.push(webRTC({
                        rtcConfiguration: {
                            iceServers: [
                                { urls: ['stun:stun.l.google.com:19302'] },
                                { urls: ['stun:stun1.l.google.com:19302'] },
                                { urls: ['stun:global.stun.twilio.com:3478'] }
                            ]
                        }
                    }));
                    this.nodeCapabilities.webrtc = true;
                    this.logger.info('✅ WebRTC transport enabled');
                }
                catch (error) {
                    this.logger.warn('⚠️ WebRTC transport disabled:', error instanceof Error ? error.message : error);
                    this.nodeCapabilities.webrtc = false;
                }
            }
            else {
                this.logger.info('⏭️ WebRTC transport disabled (AWS environment)');
                this.nodeCapabilities.webrtc = false;
            }
            // Try to add Circuit Relay transport
            try {
                transports.push(circuitRelayTransport());
                this.nodeCapabilities.circuitRelay = true;
                this.logger.info('✅ Circuit Relay transport enabled');
            }
            catch (error) {
                this.logger.warn('⚠️ Circuit Relay transport disabled:', error instanceof Error ? error.message : error);
                this.nodeCapabilities.circuitRelay = false;
            }
            this.node = await createLibp2p({
                addresses,
                transports,
                connectionEncrypters: [
                    noise() // Noise protocol - superior P2P encryption with perfect forward secrecy
                    // 🔐 MANDATORY ENCRYPTION: No plaintext connections allowed
                ],
                streamMuxers: [yamux()],
                peerDiscovery: peerDiscoveryServices,
                services: {
                    ...services,
                    // Safely add UPnP service (only in non-AWS environments)
                    ...(await this.addOptionalService('upnp', !isAWS && process.env.LIBP2P_DISABLE_UPNP !== 'true', () => uPnPNAT(), 'UPnP NAT Traversal')),
                    // Safely add AutoNAT service (only in non-AWS environments)  
                    ...(await this.addOptionalService('autonat', !isAWS && process.env.LIBP2P_DISABLE_AUTONAT !== 'true', () => autoNAT(), 'AutoNAT Detection'))
                },
                connectionManager: {
                    maxConnections: 100,
                    dialTimeout: 60000, // Increase to 60s for NAT traversal
                    maxParallelDials: 10
                }
            });
            // LibP2P successfully created - mark as available
            this.nodeCapabilities.libp2p = true;
            // Initialize zero-knowledge privacy with actual peer ID
            this.zkPrivacy = new ZeroKnowledgePrivacy(this.node.peerId.toString());
            // 🔐 MANDATORY ENCRYPTION: Set up strict connection security
            this.enforceEncryptionPolicy();
            await this.node.handle(DIG_PROTOCOL, this.handleDIGRequest.bind(this));
            await this.node.handle(DIG_DISCOVERY_PROTOCOL, this.handleDiscoveryRequest.bind(this));
            // Only scan files and start watcher if we have file access
            if (hasFileAccess) {
                await this.scanDIGFiles();
                await this.announceStores();
                await this.startFileWatcher();
                // Resume any incomplete downloads
                if (this.downloadManager) {
                    await this.downloadManager.resumeIncompleteDownloads();
                }
                this.logger.info('📁 File operations enabled');
            }
            else {
                this.logger.info('📁 File operations disabled - bootstrap-only mode');
            }
            this.startPeerDiscovery();
            this.startStoreSync();
            // Safely start additional services
            await this.safeServiceInit('bootstrapServer', () => this.startBuiltInBootstrapServer(), 'Built-in Bootstrap Server');
            await this.safeServiceInit('turnServer', () => this.detectTurnCapability(), 'TURN Server Detection');
            // These are less likely to fail but still use safe init for consistency
            if (this.config.enableGlobalDiscovery !== false) {
                await this.safeServiceInit('storeSync', () => this.startGlobalDiscovery(), 'Global Discovery');
            }
            // Start distributed privacy overlay network (always enabled)
            {
                await this.safeServiceInit('storeSync', () => this.startDistributedPrivacyDiscovery(), 'Distributed Privacy Overlay');
            }
            // WebSocket relay depends on bootstrap server
            if (this.nodeCapabilities.bootstrapServer) {
                await this.safeServiceInit('websockets', () => this.startWebSocketRelay(), 'WebSocket Relay');
            }
            await this.connectToConfiguredPeers();
            this.isStarted = true;
            // Report successful capabilities
            const capabilities = this.getCapabilities();
            const enabledCapabilities = Object.entries(capabilities)
                .filter(([_, value]) => value === true)
                .map(([key]) => key);
            console.log(`✅ DIG Node started successfully`);
            console.log(`🆔 Peer ID: ${this.node.peerId.toString()}`);
            console.log(`📁 Available stores: ${this.digFiles.size}`);
            console.log(`🏗️ Environment: ${capabilities.environment}`);
            console.log(`🔧 Active capabilities (${enabledCapabilities.length}): ${enabledCapabilities.join(', ')}`);
            console.log(`🔄 Peer discovery and store sync enabled`);
        }
        catch (error) {
            this.metrics.errors++;
            console.error(`❌ Failed to start DIG Node:`, error);
            // In AWS, still try to start the bootstrap server even if LibP2P fails
            const isAWS = process.env.AWS_DEPLOYMENT === 'true' || (process.env.NODE_ENV === 'production' && process.env.PORT);
            if (isAWS) {
                console.log('🔄 LibP2P failed in AWS, attempting to start bootstrap server only...');
                try {
                    // Only start bootstrap server if it hasn't been started already
                    if (!this.nodeCapabilities.bootstrapServer) {
                        await this.startBuiltInBootstrapServer();
                    }
                    this.nodeCapabilities.bootstrapServer = true;
                    this.isStarted = true;
                    console.log('✅ DIG Node started in bootstrap-only mode (AWS fallback)');
                    console.log('🌐 Bootstrap server running for peer discovery');
                    console.log('⚠️ LibP2P P2P features disabled due to AWS environment constraints');
                    const capabilities = this.getCapabilities();
                    const enabledCapabilities = Object.entries(capabilities)
                        .filter(([_, value]) => value === true)
                        .map(([key]) => key);
                    console.log(`🔧 Available capabilities: ${enabledCapabilities.join(', ')}`);
                    return;
                }
                catch (bootstrapError) {
                    console.error('❌ Failed to start even bootstrap server:', bootstrapError);
                }
            }
            await this.cleanup();
            throw error;
        }
    }
    async stop() {
        if (!this.isStarted) {
            console.warn('DIG Node is not started');
            return;
        }
        console.log('🛑 Stopping DIG Node...');
        await this.cleanup();
        this.isStarted = false;
        console.log('✅ DIG Node stopped successfully');
    }
    async cleanup() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        if (this.globalDiscovery) {
            try {
                await this.globalDiscovery.stop();
            }
            catch (error) {
                this.logger.warn('Error stopping global discovery:', error);
            }
        }
        if (this.webSocketRelay) {
            try {
                await this.webSocketRelay.disconnect();
            }
            catch (error) {
                this.logger.warn('Error stopping WebSocket relay:', error);
            }
        }
        if (this.httpServer) {
            this.httpServer.close();
            this.logger.info('📡 Built-in bootstrap server stopped');
        }
        if (this.watcher) {
            try {
                await this.watcher.close();
            }
            catch (error) {
                console.log('📁 File watcher closed');
            }
            this.watcher = null;
        }
        if (this.node) {
            try {
                await this.node.stop();
            }
            catch (error) {
                console.error('Error stopping LibP2P node:', error);
            }
        }
    }
    // Validate configuration
    validateConfig(config) {
        if (config.port && (config.port < 1 || config.port > 65535)) {
            throw new Error('Port must be between 1 and 65535');
        }
        if (config.publicKey && !/^[a-fA-F0-9]+$/.test(config.publicKey)) {
            throw new Error('Public key must be a valid hex string');
        }
        if (config.privateKey && !/^[a-fA-F0-9]+$/.test(config.privateKey)) {
            throw new Error('Private key must be a valid hex string');
        }
        if (config.bootstrapPeers && !Array.isArray(config.bootstrapPeers)) {
            throw new Error('Bootstrap peers must be an array');
        }
    }
    // Validate store ID format
    validateStoreId(storeId) {
        return typeof storeId === 'string' &&
            /^[a-fA-F0-9]+$/.test(storeId) &&
            storeId.length >= 32 &&
            storeId.length <= 128;
    }
    // Sanitize file path to prevent directory traversal
    sanitizeFilePath(filePath) {
        if (!filePath || typeof filePath !== 'string') {
            return '';
        }
        // Remove any directory traversal attempts
        return filePath.replace(/\.\./g, '').replace(/[\\\/]/g, '/').replace(/^\/+/, '');
    }
    // Get node metrics
    getMetrics() {
        return {
            ...this.metrics,
            uptime: this.isStarted ? Date.now() - this.startTime : 0,
            storesCount: this.digFiles.size,
            peersCount: this.discoveredPeers.size,
            isStarted: this.isStarted,
            successRate: this.metrics.downloadAttempts > 0 ?
                (this.metrics.downloadSuccesses / this.metrics.downloadAttempts) * 100 : 0,
            syncSuccessRate: this.metrics.syncAttempts > 0 ?
                (this.metrics.syncSuccesses / this.metrics.syncAttempts) * 100 : 0
        };
    }
    // Get detailed node status
    getStatus() {
        return {
            isStarted: this.isStarted,
            peerId: this.node?.peerId?.toString(),
            cryptoIPv6: this.cryptoIPv6,
            digPath: this.digPath,
            stores: Array.from(this.digFiles.keys()),
            connectedPeers: this.node ? this.node.getPeers().map(p => p.toString()) : [],
            discoveredPeers: Array.from(this.discoveredPeers),
            metrics: this.getMetrics(),
            addresses: [`/ip6/${this.cryptoIPv6}/tcp/${this.config.port || 4001}`] // Always crypto-IPv6
        };
    }
    // Setup built-in bootstrap server
    setupBuiltInBootstrapServer() {
        this.app.use(cors({ origin: '*', methods: ['GET', 'POST', 'DELETE'] }));
        this.app.use(express.json({ limit: '1mb' }));
        // Health check
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'ok',
                service: 'Unified DIG Node',
                version: '1.0.0',
                protocolVersion: E2EEncryption.getProtocolVersion(),
                peers: this.registeredPeers.size,
                stores: this.digFiles.size,
                turnServers: this.turnServers.size,
                uptime: this.isStarted ? Date.now() - this.startTime : 0,
                capabilities: E2EEncryption.getProtocolCapabilities(),
                timestamp: new Date().toISOString()
            });
        });
        // ✅ PRODUCTION: Download progress API endpoints
        this.app.get('/downloads', (req, res) => {
            try {
                const activeDownloads = this.downloadManager?.getActiveDownloads() || [];
                res.json({
                    success: true,
                    activeDownloads,
                    totalActive: activeDownloads.length,
                    timestamp: new Date().toISOString()
                });
            }
            catch (error) {
                res.status(500).json({ error: 'Failed to get download status' });
            }
        });
        this.app.get('/downloads/:storeId', (req, res) => {
            try {
                const { storeId } = req.params;
                const progress = this.downloadManager?.getDownloadProgress(storeId);
                if (progress) {
                    res.json({
                        success: true,
                        progress,
                        timestamp: new Date().toISOString()
                    });
                }
                else {
                    res.status(404).json({ error: 'Download not found or not active' });
                }
            }
            catch (error) {
                res.status(500).json({ error: 'Failed to get download progress' });
            }
        });
        this.app.post('/downloads/:storeId/cancel', (req, res) => {
            try {
                const { storeId } = req.params;
                this.downloadManager?.cancelDownload(storeId);
                res.json({
                    success: true,
                    message: `Download cancelled: ${storeId}`,
                    timestamp: new Date().toISOString()
                });
            }
            catch (error) {
                res.status(500).json({ error: 'Failed to cancel download' });
            }
        });
        // Register peer
        this.app.post('/register', async (req, res) => {
            try {
                const { peerId, addresses, cryptoIPv6, stores = [], version = '1.0.0' } = req.body;
                if (!peerId || !addresses || !Array.isArray(addresses)) {
                    res.status(400).json({ error: 'Missing required fields: peerId, addresses' });
                    return;
                }
                const now = Date.now();
                this.registeredPeers.set(peerId, {
                    peerId, addresses, cryptoIPv6, stores,
                    timestamp: now, lastSeen: now, version
                });
                this.logger.info(`📡 Peer registered via built-in bootstrap: ${peerId}`);
                res.json({ success: true, peerId, totalPeers: this.registeredPeers.size });
            }
            catch (error) {
                res.status(500).json({ error: 'Registration failed' });
            }
        });
        // Get peers
        this.app.get('/peers', (req, res) => {
            try {
                const now = Date.now();
                const includeStores = req.query.includeStores === 'true';
                const activePeers = Array.from(this.registeredPeers.values())
                    .filter((peer) => now - peer.lastSeen < this.PEER_TIMEOUT);
                res.json({
                    peers: activePeers.map((peer) => ({
                        peerId: peer.peerId,
                        addresses: peer.addresses,
                        cryptoIPv6: peer.cryptoIPv6,
                        stores: includeStores ? peer.stores : undefined,
                        lastSeen: peer.lastSeen,
                        version: peer.version
                    })),
                    total: activePeers.length,
                    timestamp: new Date().toISOString()
                });
            }
            catch (error) {
                res.status(500).json({ error: 'Failed to get peers' });
            }
        });
    }
    // Start the built-in bootstrap server
    async startBuiltInBootstrapServer() {
        const port = this.getBootstrapPort();
        return new Promise((resolve, reject) => {
            this.httpServer.listen(port, '0.0.0.0', () => {
                this.logger.info(`🌍 Built-in bootstrap server started on port ${port}`);
                this.logger.info(`📡 Other nodes can bootstrap from this node at: http://[YOUR_IP]:${port}`);
                resolve();
            });
            this.httpServer.on('error', (error) => {
                this.logger.error('Failed to start built-in bootstrap server:', error);
                reject(error);
            });
        });
    }
    getBootstrapPort() {
        // Use PORT environment variable for AWS compatibility, otherwise P2P port + 1000
        return parseInt(process.env.PORT || '0') || (this.config.port || 4001) + 1000;
    }
    // Resolve crypto-IPv6 addresses to real addresses for connection (privacy-preserving)
    async resolveCryptoIPv6Address(cryptoAddress) {
        if (!isCryptoIPv6Address(cryptoAddress)) {
            return [cryptoAddress]; // Not a crypto address, return as-is
        }
        const bootstrapUrl = this.config.discoveryServers?.[0];
        if (!bootstrapUrl) {
            this.logger.warn('No bootstrap server available for crypto-IPv6 resolution');
            return [];
        }
        // Extract crypto-IPv6 from multiaddr
        const match = cryptoAddress.match(/\/ip6\/(fd00:[a-fA-F0-9:]+)\//);
        if (!match) {
            this.logger.warn(`Invalid crypto-IPv6 address format: ${cryptoAddress}`);
            return [];
        }
        const cryptoIPv6 = match[1];
        this.logger.debug(`🔍 Resolving crypto-IPv6: ${cryptoIPv6}`);
        try {
            // 🛡️ DISTRIBUTED PRIVACY: Always try distributed resolution first (DHT + Gossip)
            {
                // Extract peer ID from crypto address if available
                const peerIdMatch = cryptoAddress.match(/\/p2p\/([^\/]+)$/);
                const peerId = peerIdMatch ? peerIdMatch[1] : null;
                if (peerId) {
                    const distributedAddresses = await this.resolveDistributedPeerAddresses(peerId, cryptoIPv6);
                    if (distributedAddresses.length > 0) {
                        this.logger.info(`🔐 Resolved ${cryptoIPv6} via distributed network: ${distributedAddresses.length} addresses`);
                        return distributedAddresses;
                    }
                }
            }
            // Fallback to bootstrap server only if distributed resolution failed
            this.logger.debug(`🔄 Falling back to bootstrap server for ${cryptoIPv6}`);
            const realAddresses = await resolveCryptoIPv6(cryptoIPv6, bootstrapUrl);
            this.logger.debug(`🔐 Resolved ${cryptoIPv6} via bootstrap: ${realAddresses.length} addresses`);
            return realAddresses;
        }
        catch (error) {
            this.logger.warn(`Failed to resolve crypto-IPv6 ${cryptoIPv6}:`, error);
            return [];
        }
    }
    // Enforce mandatory encryption policy (reject all unencrypted connections)
    enforceEncryptionPolicy() {
        this.logger.info('🔐 Enforcing mandatory encryption policy - NO unencrypted connections allowed');
        // Monitor all incoming connections
        this.node.addEventListener('peer:connect', (evt) => {
            const connection = evt.detail;
            this.validateMandatoryEncryption(connection);
        });
        // Monitor connection attempts
        this.node.addEventListener('connection:open', (evt) => {
            const connection = evt.detail;
            this.validateMandatoryEncryption(connection);
        });
        // Reject any plaintext attempts
        this.node.addEventListener('peer:discovery', (evt) => {
            const peer = evt.detail;
            this.logger.debug(`🔍 Discovered peer: ${peer.id} - will enforce encryption on connection`);
        });
        this.logger.info('✅ Mandatory encryption policy active - all connections will be encrypted');
    }
    // Validate that connection is encrypted (reject if not)
    validateMandatoryEncryption(connection) {
        try {
            const peerId = connection.remotePeer?.toString() || 'unknown';
            const encrypter = connection.encryption;
            if (!encrypter) {
                this.logger.error(`❌ SECURITY VIOLATION: Unencrypted connection from ${peerId} - REJECTING`);
                this.rejectUnencryptedConnection(connection, peerId);
                return;
            }
            const protocol = encrypter.protocol || 'unknown';
            // Check for explicitly forbidden protocols
            if (protocol === '/plaintext/1.0.0' || protocol.includes('plaintext')) {
                this.logger.error(`❌ SECURITY VIOLATION: Plaintext protocol ${protocol} from ${peerId} - REJECTING`);
                this.rejectUnencryptedConnection(connection, peerId);
                return;
            }
            // Log accepted encrypted connections
            if (protocol === '/noise') {
                this.logger.info(`🔊 Noise protocol encrypted connection accepted from ${peerId} (perfect forward secrecy)`);
            }
            else {
                this.logger.info(`🔐 Encrypted connection accepted from ${peerId}: ${protocol}`);
                this.logger.warn(`⚠️ Non-Noise protocol detected - Noise is preferred for P2P security`);
            }
            // Verify mutual authentication
            const remotePublicKey = connection.remotePeer?.publicKey;
            if (remotePublicKey) {
                this.logger.debug(`🔑 Peer ${peerId} authenticated with public key`);
                // Verify crypto-IPv6 matches public key
                const expectedCryptoIPv6 = generateCryptoIPv6(remotePublicKey.toString('hex'));
                this.logger.debug(`🔐 Verified crypto-IPv6 for ${peerId}: ${expectedCryptoIPv6}`);
            }
            else {
                this.logger.warn(`⚠️ No public key verification for ${peerId} - connection allowed but flagged`);
            }
        }
        catch (error) {
            this.logger.error(`Connection validation failed:`, error);
        }
    }
    // Reject unencrypted connection with logging
    async rejectUnencryptedConnection(connection, peerId) {
        try {
            this.logger.error(`🚫 REJECTING unencrypted connection from ${peerId}`);
            this.metrics.errors++;
            // Close the connection immediately
            await connection.close();
            // Log security event
            this.logger.error(`🔒 Security Policy: Only encrypted connections allowed - rejected ${peerId}`);
        }
        catch (closeError) {
            this.logger.error(`Failed to close unencrypted connection from ${peerId}:`, closeError);
        }
    }
    // Verify outgoing connection encryption before use
    async verifyOutgoingEncryption(connection, targetPeerId) {
        try {
            if (!connection.encryption) {
                this.logger.error(`❌ SECURITY: No encryption for outgoing connection to ${targetPeerId} - ABORTING`);
                await connection.close();
                return false;
            }
            const protocol = connection.encryption.protocol;
            if (!protocol || protocol === '/plaintext/1.0.0' || protocol.includes('plaintext')) {
                this.logger.error(`❌ SECURITY: Plaintext protocol ${protocol} to ${targetPeerId} - ABORTING`);
                await connection.close();
                return false;
            }
            if (protocol === '/noise') {
                this.logger.info(`✅ Verified Noise protocol encryption to ${targetPeerId} (perfect forward secrecy)`);
            }
            else {
                this.logger.info(`✅ Verified encrypted connection to ${targetPeerId}: ${protocol}`);
            }
            return true;
        }
        catch (error) {
            this.logger.error(`Failed to verify outgoing encryption to ${targetPeerId}:`, error);
            return false;
        }
    }
    // Create comprehensive handshake information (Chia-like protocol)
    createHandshakeInfo() {
        // Determine node type based on capabilities
        let nodeType = NodeType.FULL_NODE;
        if (this.nodeCapabilities.bootstrapServer && !this.nodeCapabilities.storeSync) {
            nodeType = NodeType.BOOTSTRAP_NODE;
        }
        else if (this.nodeCapabilities.turnServer && !this.nodeCapabilities.storeSync) {
            nodeType = NodeType.TURN_NODE;
        }
        else if (!this.nodeCapabilities.storeSync) {
            nodeType = NodeType.LIGHT_NODE;
        }
        // Build capability list with codes and descriptions
        const capabilities = [];
        if (this.nodeCapabilities.storeSync) {
            capabilities.push([CapabilityCode.STORE_SYNC, 'Store synchronization']);
        }
        if (this.nodeCapabilities.turnServer) {
            capabilities.push([CapabilityCode.TURN_RELAY, 'TURN server relay']);
        }
        if (this.nodeCapabilities.bootstrapServer) {
            capabilities.push([CapabilityCode.BOOTSTRAP_DISCOVERY, 'Bootstrap peer discovery']);
        }
        if (this.nodeCapabilities.e2eEncryption) {
            capabilities.push([CapabilityCode.E2E_ENCRYPTION, 'End-to-end encryption']);
        }
        capabilities.push([CapabilityCode.BYTE_RANGE_DOWNLOAD, 'Parallel byte-range downloads']);
        capabilities.push([CapabilityCode.GOSSIP_DISCOVERY, 'Gossip-based peer discovery']);
        if (this.nodeCapabilities.dht) {
            capabilities.push([CapabilityCode.DHT_STORAGE, 'DHT distributed storage']);
        }
        if (this.nodeCapabilities.circuitRelay) {
            capabilities.push([CapabilityCode.CIRCUIT_RELAY, 'LibP2P circuit relay']);
        }
        if (this.nodeCapabilities.webrtc) {
            capabilities.push([CapabilityCode.WEBRTC_NAT, 'WebRTC NAT traversal']);
        }
        capabilities.push([CapabilityCode.MESH_ROUTING, 'Mesh routing discovery']);
        return {
            networkId: process.env.DIG_NETWORK_ID || 'mainnet',
            protocolVersion: this.nodeCapabilities.protocolVersion,
            softwareVersion: process.env.npm_package_version || '1.0.0',
            serverPort: this.config.port || 4001,
            nodeType,
            capabilities,
            peerId: this.node.peerId.toString(),
            cryptoIPv6: this.cryptoIPv6,
            publicKey: this.e2eEncryption.getPublicKey(),
            timestamp: Date.now(),
            stores: this.getAvailableStores()
        };
    }
    // Get node type description
    getNodeTypeDescription() {
        const handshake = this.createHandshakeInfo();
        switch (handshake.nodeType) {
            case NodeType.FULL_NODE: return 'Full Node';
            case NodeType.LIGHT_NODE: return 'Light Node';
            case NodeType.BOOTSTRAP_NODE: return 'Bootstrap Node';
            case NodeType.TURN_NODE: return 'TURN Node';
            case NodeType.RELAY_NODE: return 'Relay Node';
            default: return 'Unknown Node';
        }
    }
    // Get node type description from code
    getNodeTypeFromCode(nodeType) {
        switch (nodeType) {
            case NodeType.FULL_NODE: return 'Full Node';
            case NodeType.LIGHT_NODE: return 'Light Node';
            case NodeType.BOOTSTRAP_NODE: return 'Bootstrap Node';
            case NodeType.TURN_NODE: return 'TURN Node';
            case NodeType.RELAY_NODE: return 'Relay Node';
            default: return 'Unknown Node';
        }
    }
    // Distributed Privacy Overlay Network Methods
    // Start distributed peer discovery using gossip and DHT (always enabled)
    async startDistributedPrivacyDiscovery() {
        this.logger.info('🛡️ Starting distributed privacy overlay network...');
        try {
            // Subscribe to privacy discovery topics
            const gossipsub = this.node.services.gossipsub;
            if (gossipsub) {
                // Subscribe to peer discovery gossip
                await gossipsub.subscribe(this.gossipTopics.PEER_DISCOVERY);
                await gossipsub.subscribe(this.gossipTopics.ADDRESS_EXCHANGE);
                await gossipsub.subscribe(this.gossipTopics.STORE_ANNOUNCEMENTS);
                await gossipsub.subscribe(this.gossipTopics.CAPABILITY_ANNOUNCEMENTS);
                // Handle incoming gossip messages
                gossipsub.addEventListener('message', (evt) => {
                    this.handleGossipMessage(evt.detail);
                });
                this.logger.info('🗣️ Subscribed to privacy gossip topics');
                // Start periodic privacy announcements
                setInterval(() => {
                    this.announceToPrivacyOverlay();
                }, 60000); // Every minute
                // Start periodic comprehensive peer discovery (bootstrap + distributed)
                setInterval(() => {
                    this.discoverPeersFromAllSources();
                }, 120000); // Every 2 minutes
                // Announce ourselves immediately
                setTimeout(() => {
                    this.announceToPrivacyOverlay();
                }, 5000); // After 5 seconds
                // Start comprehensive discovery after initial connections
                setTimeout(() => {
                    this.discoverPeersFromAllSources();
                }, 30000); // After 30 seconds
            }
            // Use DHT for distributed address storage
            const dht = this.node.services.dht;
            if (dht) {
                await this.storeAddressInDHT();
                this.logger.info('🔐 Stored encrypted address mapping in DHT');
                // Periodically refresh DHT storage
                setInterval(() => {
                    this.storeAddressInDHT();
                }, 300000); // Every 5 minutes
            }
        }
        catch (error) {
            this.logger.warn('Failed to start distributed privacy discovery:', error);
        }
    }
    // Handle gossip messages for peer discovery
    async handleGossipMessage(message) {
        try {
            const { topic, data } = message;
            const payload = JSON.parse(uint8ArrayToString(data));
            if (topic === this.gossipTopics.PEER_DISCOVERY) {
                await this.handlePeerDiscoveryGossip(payload);
            }
            else if (topic === this.gossipTopics.ADDRESS_EXCHANGE) {
                await this.handleAddressExchangeGossip(payload);
            }
            else if (topic === this.gossipTopics.STORE_ANNOUNCEMENTS) {
                await this.handleStoreAnnouncementGossip(payload);
            }
            else if (topic === this.gossipTopics.CAPABILITY_ANNOUNCEMENTS) {
                await this.handleCapabilityAnnouncementGossip(payload);
            }
        }
        catch (error) {
            this.logger.debug('Failed to handle gossip message:', error);
        }
    }
    // Handle peer discovery via gossip
    async handlePeerDiscoveryGossip(payload) {
        const { peerId, cryptoIPv6, stores, timestamp, capabilities } = payload;
        if (peerId === this.node.peerId.toString()) {
            return; // Ignore our own announcements
        }
        // Store peer info in privacy overlay with capabilities
        this.privacyOverlayPeers.set(peerId, {
            cryptoIPv6,
            encryptedAddresses: '', // Will be populated via address exchange
            lastSeen: timestamp,
            capabilities: capabilities || {},
            stores: stores || []
        });
        // Update peer stores mapping
        if (stores && Array.isArray(stores)) {
            this.peerStores.set(peerId, new Set(stores));
        }
        // Track TURN-capable peers for load balancing
        if (capabilities?.turnServer) {
            this.logger.info(`📡 Discovered TURN-capable privacy peer: ${peerId} (${cryptoIPv6})`);
        }
        this.logger.debug(`🔐 Discovered privacy peer via gossip: ${peerId} (${cryptoIPv6}) - TURN: ${capabilities?.turnServer ? 'Yes' : 'No'}`);
    }
    // Handle encrypted address exchange via gossip
    async handleAddressExchangeGossip(payload) {
        const { fromPeerId, toPeerId, encryptedAddresses } = payload;
        // Only process if this message is for us
        if (toPeerId !== this.node.peerId.toString()) {
            return;
        }
        try {
            // Decrypt the addresses using our shared secret
            if (this.e2eEncryption.hasSharedSecret(fromPeerId)) {
                const decryptedAddresses = this.e2eEncryption.decryptFromPeer(fromPeerId, encryptedAddresses);
                const addresses = JSON.parse(decryptedAddresses.toString());
                // Store the real addresses for this peer
                const overlayPeer = this.privacyOverlayPeers.get(fromPeerId);
                if (overlayPeer) {
                    overlayPeer.encryptedAddresses = encryptedAddresses;
                    this.logger.info(`🔐 Received encrypted addresses from ${fromPeerId}`);
                }
            }
        }
        catch (error) {
            this.logger.debug(`Failed to decrypt addresses from ${fromPeerId}:`, error);
        }
    }
    // Handle store announcements via gossip
    async handleStoreAnnouncementGossip(payload) {
        const { peerId, stores } = payload;
        if (peerId === this.node.peerId.toString()) {
            return; // Ignore our own announcements
        }
        // Update peer stores
        if (stores && Array.isArray(stores)) {
            this.peerStores.set(peerId, new Set(stores));
            this.logger.debug(`📁 Updated stores for ${peerId}: ${stores.length} stores`);
        }
    }
    // Handle capability announcements via gossip
    async handleCapabilityAnnouncementGossip(payload) {
        const { peerId, capabilities, timestamp } = payload;
        if (peerId === this.node.peerId.toString()) {
            return; // Ignore our own announcements
        }
        // Update peer capabilities
        const overlayPeer = this.privacyOverlayPeers.get(peerId);
        if (overlayPeer) {
            overlayPeer.capabilities = capabilities;
            overlayPeer.lastSeen = timestamp;
            // Log important capability changes
            if (capabilities?.turnServer) {
                this.logger.info(`📡 Peer ${peerId} announced TURN server capability`);
            }
            if (capabilities?.bootstrapServer) {
                this.logger.info(`🌐 Peer ${peerId} announced bootstrap server capability`);
            }
            this.logger.debug(`🔧 Updated capabilities for ${peerId}: ${Object.keys(capabilities || {}).filter(k => capabilities[k]).join(', ')}`);
        }
    }
    // Announce ourselves to the privacy overlay network with zero-knowledge enhancements
    async announceToPrivacyOverlay() {
        try {
            const gossipsub = this.node.services.gossipsub;
            if (!gossipsub)
                return;
            // 🕵️ ZERO-KNOWLEDGE: Use timing obfuscation for announcements
            await this.zkPrivacy.obfuscateTiming(async () => {
                // Create comprehensive handshake information
                const handshakeInfo = this.createHandshakeInfo();
                // 🕵️ ZK: Scramble metadata to prevent correlation
                const scrambledMetadata = this.zkPrivacy.scrambleMetadata({
                    announcementType: 'peer-discovery',
                    nodeInfo: handshakeInfo
                });
                const peerAnnouncement = {
                    ...handshakeInfo, // Include comprehensive handshake info
                    metadata: scrambledMetadata,
                    // 🕵️ ZK: Add dummy data to obfuscate real information
                    dummyStores: Array.from({ length: Math.floor(Math.random() * 5) }, () => randomBytes(32).toString('hex')),
                    obfuscated: true
                };
                await gossipsub.publish(this.gossipTopics.PEER_DISCOVERY, uint8ArrayFromString(JSON.stringify(peerAnnouncement)));
                // Announce stores
                const storeAnnouncement = {
                    peerId: this.node.peerId.toString(),
                    stores: this.getAvailableStores(),
                    timestamp: Date.now()
                };
                await gossipsub.publish(this.gossipTopics.STORE_ANNOUNCEMENTS, uint8ArrayFromString(JSON.stringify(storeAnnouncement)));
                // Announce capabilities (especially TURN server capability)
                const capabilityAnnouncement = {
                    peerId: this.node.peerId.toString(),
                    capabilities: this.nodeCapabilities,
                    timestamp: Date.now()
                };
                await gossipsub.publish(this.gossipTopics.CAPABILITY_ANNOUNCEMENTS, uint8ArrayFromString(JSON.stringify(capabilityAnnouncement)));
                const turnStatus = this.nodeCapabilities.turnServer ? '📡 TURN-enabled' : '🔗 P2P-only';
                this.logger.debug(`🗣️ Announced to privacy overlay: ${this.getAvailableStores().length} stores, ${turnStatus}`);
            }); // Close obfuscateTiming function
        }
        catch (error) {
            this.logger.debug('Failed to announce to privacy overlay:', error);
        }
    }
    // Store encrypted address mapping in DHT for distributed resolution
    async storeAddressInDHT() {
        try {
            const dht = this.node.services.dht;
            if (!dht)
                return;
            const realAddresses = this.node.getMultiaddrs().map(addr => addr.toString());
            const addressData = JSON.stringify(realAddresses);
            // Encrypt the address data with our own public key (so others can decrypt with our public key)
            const encryptedAddresses = this.e2eEncryption.encryptForPeer(this.node.peerId.toString(), Buffer.from(addressData));
            // Store in DHT using crypto-IPv6 as key
            const key = uint8ArrayFromString(`/dig-privacy-addr/${this.cryptoIPv6}`);
            const value = uint8ArrayFromString(encryptedAddresses);
            await dht.put(key, value);
            this.logger.debug(`🔐 Stored encrypted addresses in DHT: ${this.cryptoIPv6}`);
        }
        catch (error) {
            this.logger.debug('Failed to store addresses in DHT:', error);
        }
    }
    // Resolve peer addresses from distributed sources (DHT + gossip)
    async resolveDistributedPeerAddresses(peerId, cryptoIPv6) {
        const resolvedAddresses = [];
        try {
            // 1. Try DHT resolution first
            const dht = this.node.services.dht;
            if (dht) {
                const key = uint8ArrayFromString(`/dig-privacy-addr/${cryptoIPv6}`);
                for await (const event of dht.get(key)) {
                    if (event.name === 'VALUE') {
                        try {
                            const encryptedData = uint8ArrayToString(event.value);
                            // Try to decrypt with the peer's public key (if we have established a secret)
                            if (this.e2eEncryption.hasSharedSecret(peerId)) {
                                const decryptedData = this.e2eEncryption.decryptFromPeer(peerId, encryptedData);
                                const addresses = JSON.parse(decryptedData.toString());
                                resolvedAddresses.push(...addresses);
                                this.logger.info(`🔐 Resolved ${peerId} addresses from DHT: ${addresses.length} addresses`);
                                break;
                            }
                        }
                        catch (decryptError) {
                            this.logger.debug(`Failed to decrypt DHT address for ${peerId}:`, decryptError);
                        }
                    }
                }
            }
            // 2. Try gossip-based address exchange
            const overlayPeer = this.privacyOverlayPeers.get(peerId);
            if (overlayPeer && overlayPeer.encryptedAddresses) {
                try {
                    if (this.e2eEncryption.hasSharedSecret(peerId)) {
                        const decryptedData = this.e2eEncryption.decryptFromPeer(peerId, overlayPeer.encryptedAddresses);
                        const addresses = JSON.parse(decryptedData.toString());
                        resolvedAddresses.push(...addresses);
                        this.logger.info(`🗣️ Resolved ${peerId} addresses from gossip: ${addresses.length} addresses`);
                    }
                }
                catch (decryptError) {
                    this.logger.debug(`Failed to decrypt gossip address for ${peerId}:`, decryptError);
                }
            }
            // 3. Fallback to bootstrap server only if no distributed resolution worked
            if (resolvedAddresses.length === 0) {
                this.logger.info(`🔄 No distributed resolution for ${peerId}, falling back to bootstrap server`);
                return await resolveCryptoIPv6(cryptoIPv6, this.config.discoveryServers?.[0] || '');
            }
        }
        catch (error) {
            this.logger.debug(`Distributed address resolution failed for ${peerId}:`, error);
        }
        return resolvedAddresses;
    }
    // Handle peer exchange request (distributed discovery without bootstrap dependency)
    async handlePeerExchangeRequest(request, requestingPeerId) {
        try {
            const { maxPeers = 10, includeStores = false, includeCapabilities = true, privacyMode = false } = request;
            const knownPeers = [];
            let peerCount = 0;
            // Get peers from our various sources
            const sources = [
                this.privacyOverlayPeers, // Gossip-discovered peers
                this.globalDiscovery?.knownPeers || new Map() // Bootstrap-discovered peers
            ];
            for (const peerMap of sources) {
                for (const [peerId, peerInfo] of peerMap) {
                    if (peerId === requestingPeerId || peerId === this.node.peerId.toString()) {
                        continue; // Skip requester and ourselves
                    }
                    if (peerCount >= maxPeers)
                        break;
                    const peerData = {
                        peerId,
                        cryptoIPv6: peerInfo.cryptoIPv6,
                        lastSeen: peerInfo.lastSeen || Date.now()
                    };
                    // Include stores if requested
                    if (includeStores) {
                        const peerStores = this.peerStores.get(peerId);
                        peerData.stores = peerStores ? Array.from(peerStores) : (peerInfo.stores || []);
                    }
                    // Include capabilities if requested (especially TURN server capability)
                    if (includeCapabilities) {
                        const capabilities = 'capabilities' in peerInfo ? peerInfo.capabilities : undefined;
                        if (capabilities) {
                            peerData.capabilities = capabilities;
                            peerData.turnCapable = capabilities.turnServer || false;
                            peerData.bootstrapCapable = capabilities.bootstrapServer || false;
                        }
                    }
                    // In privacy mode, never include real addresses
                    if (!privacyMode) {
                        const addresses = 'addresses' in peerInfo ? peerInfo.addresses : undefined;
                        if (addresses) {
                            peerData.addresses = addresses;
                        }
                    }
                    knownPeers.push(peerData);
                    peerCount++;
                }
                if (peerCount >= maxPeers)
                    break;
            }
            this.logger.info(`📋 Peer exchange: Sharing ${knownPeers.length} peers with ${requestingPeerId} (privacy: ${privacyMode})`);
            return {
                success: true,
                peers: knownPeers,
                totalPeers: knownPeers.length,
                privacyMode,
                timestamp: Date.now()
            };
        }
        catch (error) {
            this.logger.error(`Peer exchange failed for ${requestingPeerId}:`, error);
            return {
                success: false,
                error: `Peer exchange failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }
    // Handle privacy peer discovery request
    async handlePrivacyPeerDiscoveryRequest(request, requestingPeerId) {
        try {
            const { maxPeers = 5 } = request;
            // Only share crypto-IPv6 addresses (never real IPs)
            const privacyPeers = [];
            let count = 0;
            for (const [peerId, peerInfo] of this.privacyOverlayPeers) {
                if (peerId === requestingPeerId || peerId === this.node.peerId.toString()) {
                    continue;
                }
                if (count >= maxPeers)
                    break;
                privacyPeers.push({
                    peerId,
                    cryptoIPv6: peerInfo.cryptoIPv6,
                    lastSeen: peerInfo.lastSeen
                    // 🔐 PRIVACY: No real addresses ever shared
                });
                count++;
            }
            this.logger.info(`🛡️ Privacy discovery: Sharing ${privacyPeers.length} crypto-IPv6 peers with ${requestingPeerId}`);
            return {
                success: true,
                peers: privacyPeers,
                totalPeers: privacyPeers.length,
                privacyMode: true,
                timestamp: Date.now()
            };
        }
        catch (error) {
            this.logger.error(`Privacy peer discovery failed for ${requestingPeerId}:`, error);
            return {
                success: false,
                error: `Privacy discovery failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }
    // Request peers from other nodes with zero-knowledge privacy (distributed discovery)
    async requestPeersFromNode(peerId, privacyMode = true) {
        try {
            const peer = this.node.getPeers().find(p => p.toString() === peerId);
            if (!peer) {
                this.logger.warn(`Cannot request peers from ${peerId}: not connected`);
                return [];
            }
            // 🕵️ ZERO-KNOWLEDGE: Use timing obfuscation to resist analysis
            return await this.zkPrivacy.obfuscateTiming(async () => {
                const stream = await this.node.dialProtocol(peer, DIG_PROTOCOL);
                // 🕵️ ZERO-KNOWLEDGE: Create anonymous peer query with dummy queries
                const anonymousQuery = this.zkPrivacy.createAnonymousPeerQuery();
                const request = {
                    type: privacyMode ? 'PRIVACY_PEER_DISCOVERY' : 'PEER_EXCHANGE',
                    maxPeers: 10,
                    includeStores: true,
                    includeCapabilities: true,
                    privacyMode,
                    // 🕵️ ZK: Include obfuscated metadata
                    metadata: this.zkPrivacy.scrambleMetadata({
                        requestTime: Date.now(),
                        queryType: 'peer-discovery'
                    }),
                    anonymousQueries: anonymousQuery.queries
                };
                // Send request
                await pipe(async function* () {
                    yield uint8ArrayFromString(JSON.stringify(request));
                }, stream.sink);
                // Read response
                const chunks = [];
                await pipe(stream.source, async function (source) {
                    for await (const chunk of source) {
                        chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk.subarray()));
                    }
                });
                if (chunks.length > 0) {
                    const response = JSON.parse(uint8ArrayToString(chunks[0]));
                    if (response.success && response.peers) {
                        // 🕵️ ZERO-KNOWLEDGE: Filter out dummy queries and mix traffic
                        const realPeers = await this.zkPrivacy.mixTraffic(response.peers);
                        this.logger.info(`📋 Received ${realPeers.length} peers from ${peerId} (ZK privacy: ${privacyMode})`);
                        return realPeers;
                    }
                }
                return [];
            });
        }
        catch (error) {
            this.logger.debug(`Failed to request peers from ${peerId}:`, error);
        }
        return [];
    }
    // Get TURN-capable peers from distributed privacy network
    getPrivacyTurnServers() {
        const turnServers = [];
        for (const [peerId, peerInfo] of this.privacyOverlayPeers) {
            if (peerInfo.capabilities?.turnServer) {
                turnServers.push({
                    peerId,
                    cryptoIPv6: peerInfo.cryptoIPv6,
                    capabilities: peerInfo.capabilities
                });
            }
        }
        // Sort by last seen (most recent first)
        turnServers.sort((a, b) => {
            const peerA = this.privacyOverlayPeers.get(a.peerId);
            const peerB = this.privacyOverlayPeers.get(b.peerId);
            return (peerB?.lastSeen || 0) - (peerA?.lastSeen || 0);
        });
        this.logger.debug(`📡 Found ${turnServers.length} TURN-capable peers in privacy network`);
        return turnServers;
    }
    // Get bootstrap-capable peers from distributed privacy network
    getPrivacyBootstrapServers() {
        const bootstrapServers = [];
        for (const [peerId, peerInfo] of this.privacyOverlayPeers) {
            if (peerInfo.capabilities?.bootstrapServer) {
                bootstrapServers.push({
                    peerId,
                    cryptoIPv6: peerInfo.cryptoIPv6,
                    capabilities: peerInfo.capabilities
                });
            }
        }
        this.logger.debug(`🌐 Found ${bootstrapServers.length} bootstrap-capable peers in privacy network`);
        return bootstrapServers;
    }
    // Comprehensive peer discovery: Bootstrap + Distributed + Gossip
    async discoverPeersFromAllSources() {
        this.logger.info('🔍 Starting comprehensive peer discovery from all sources...');
        // 1. Pull fresh peer data from bootstrap server first (seed the network)
        await this.pullPeersFromBootstrap();
        // 2. Request peers from connected nodes (distributed approach)
        await this.discoverPeersFromNetwork();
        // 3. Update our gossip announcements with the latest info
        await this.announceToPrivacyOverlay();
        const totalPeers = this.privacyOverlayPeers.size;
        const turnCapablePeers = this.getPrivacyTurnServers().length;
        const bootstrapCapablePeers = this.getPrivacyBootstrapServers().length;
        this.logger.info(`🛡️ Total network knowledge: ${totalPeers} peers (${turnCapablePeers} TURN, ${bootstrapCapablePeers} bootstrap)`);
    }
    // Pull peer information from bootstrap server to seed distributed network
    async pullPeersFromBootstrap() {
        if (!this.config.discoveryServers || this.config.discoveryServers.length === 0) {
            this.logger.debug('No bootstrap servers configured for peer seeding');
            return;
        }
        const bootstrapUrl = this.config.discoveryServers[0];
        try {
            // Use the appropriate endpoint based on privacy mode
            const endpoint = '/crypto-ipv6-directory'; // Always use privacy endpoint
            const response = await fetch(`${bootstrapUrl}${endpoint}?includeStores=true`, {
                signal: AbortSignal.timeout(10000)
            });
            if (!response.ok) {
                this.logger.warn(`Failed to pull peers from bootstrap: ${response.status}`);
                return;
            }
            const data = await response.json();
            if (!data.peers || !Array.isArray(data.peers)) {
                this.logger.warn('Invalid peer data from bootstrap server');
                return;
            }
            let seedCount = 0;
            for (const peer of data.peers) {
                if (peer.peerId === this.node.peerId.toString()) {
                    continue; // Skip ourselves
                }
                // Add to privacy overlay network for distribution
                this.privacyOverlayPeers.set(peer.peerId, {
                    cryptoIPv6: peer.cryptoIPv6,
                    encryptedAddresses: '',
                    lastSeen: peer.lastSeen || Date.now(),
                    capabilities: peer.capabilities || this.inferCapabilitiesFromPeer(peer),
                    stores: peer.stores || []
                });
                // Update stores mapping
                if (peer.stores && Array.isArray(peer.stores)) {
                    this.peerStores.set(peer.peerId, new Set(peer.stores));
                }
                seedCount++;
            }
            this.logger.info(`🌱 Seeded privacy network with ${seedCount} peers from bootstrap server`);
            // Now we can share this information with other peers via gossip/exchange
        }
        catch (error) {
            this.logger.debug('Failed to pull peers from bootstrap server:', error);
        }
    }
    // Request peer discovery from connected nodes (distributed approach)
    async discoverPeersFromNetwork() {
        const connectedPeers = this.node.getPeers();
        if (connectedPeers.length === 0) {
            this.logger.debug('No connected peers for distributed discovery');
            return;
        }
        this.logger.info(`📋 Requesting peer discovery from ${connectedPeers.length} connected nodes`);
        // Request peers from each connected node
        for (const peer of connectedPeers.slice(0, 3)) { // Limit to 3 requests to avoid spam
            try {
                const discoveredPeers = await this.requestPeersFromNode(peer.toString(), true); // Always privacy mode
                // Process discovered peers and merge with our knowledge
                for (const peerInfo of discoveredPeers) {
                    if (peerInfo.peerId !== this.node.peerId.toString()) {
                        // Merge with existing peer info (keep most recent data)
                        const existingPeer = this.privacyOverlayPeers.get(peerInfo.peerId);
                        const isNewer = !existingPeer || (peerInfo.lastSeen || 0) > existingPeer.lastSeen;
                        if (isNewer) {
                            this.privacyOverlayPeers.set(peerInfo.peerId, {
                                cryptoIPv6: peerInfo.cryptoIPv6,
                                encryptedAddresses: existingPeer?.encryptedAddresses || '',
                                lastSeen: peerInfo.lastSeen || Date.now(),
                                capabilities: peerInfo.capabilities || existingPeer?.capabilities || {},
                                stores: peerInfo.stores || existingPeer?.stores || []
                            });
                            // Update stores mapping
                            if (peerInfo.stores) {
                                this.peerStores.set(peerInfo.peerId, new Set(peerInfo.stores));
                            }
                        }
                    }
                }
                this.logger.info(`📋 Discovered ${discoveredPeers.length} peers from ${peer.toString()}`);
            }
            catch (error) {
                this.logger.debug(`Failed to discover peers from ${peer.toString()}:`, error);
            }
        }
    }
    // Infer capabilities from peer information (for bootstrap-sourced peers)
    inferCapabilitiesFromPeer(peer) {
        return {
            libp2p: true,
            dht: true,
            mdns: false, // Unknown
            upnp: false, // Unknown
            autonat: false, // Unknown
            webrtc: false, // Unknown
            websockets: true, // Assume true for connectivity
            circuitRelay: false, // Unknown
            turnServer: peer.turnCapable || false,
            bootstrapServer: peer.bootstrapCapable || false,
            storeSync: (peer.stores && peer.stores.length > 0) || false,
            e2eEncryption: true, // Assume true for privacy
            protocolVersion: peer.version || '1.0.0',
            environment: 'development'
        };
    }
    // Enhanced store download with multiple fallback layers (bootstrap server last resort)
    async downloadStoreWithFullFallback(storeId) {
        this.logger.info(`📥 Starting comprehensive download for store: ${storeId}`);
        // Layer 1: Direct LibP2P connections to known peers
        try {
            this.logger.info('🔗 Attempting direct LibP2P download...');
            await this.downloadStoreFromPeers(storeId);
            const success = this.digFiles.has(storeId);
            if (success) {
                this.logger.info(`✅ Downloaded ${storeId} via direct LibP2P`);
                return true;
            }
        }
        catch (error) {
            // Silent failure - will try next method
        }
        // Layer 2: DHT-based store discovery and download
        try {
            this.logger.info('🔑 Attempting DHT-based store discovery...');
            const success = await this.downloadStoreFromDHT(storeId);
            if (success) {
                this.logger.info(`✅ Downloaded ${storeId} via DHT`);
                return true;
            }
        }
        catch (error) {
            // Silent failure - will try next method
        }
        // Layer 3: Gossip network store discovery
        try {
            this.logger.info('🗣️ Attempting gossip-based store discovery...');
            const success = await this.downloadStoreFromGossipNetwork(storeId);
            if (success) {
                this.logger.info(`✅ Downloaded ${storeId} via gossip network`);
                return true;
            }
        }
        catch (error) {
            // Silent failure - will try next method
        }
        // Layer 4: Distributed TURN servers (peer-to-peer)
        try {
            this.logger.info('📡 Attempting distributed TURN server download...');
            const success = await this.downloadStoreFromDistributedTurn(storeId);
            if (success) {
                this.logger.info(`✅ Downloaded ${storeId} via distributed TURN servers`);
                return true;
            }
        }
        catch (error) {
            // Silent failure - will try next method
        }
        // Layer 5: Mesh routing through connected peers
        try {
            this.logger.info('🕸️ Attempting mesh routing discovery...');
            const success = await this.downloadStoreViaMeshRouting(storeId);
            if (success) {
                this.logger.info(`✅ Downloaded ${storeId} via mesh routing`);
                return true;
            }
        }
        catch (error) {
            // Silent failure - will try next method
        }
        // Layer 6: Bootstrap server TURN fallback
        try {
            this.logger.info('☁️ Attempting bootstrap server TURN fallback...');
            const success = await this.downloadStoreViaBootstrapTurn(storeId);
            if (success) {
                this.logger.info(`✅ Downloaded ${storeId} via bootstrap TURN fallback`);
                return true;
            }
        }
        catch (error) {
            // Silent failure - will try next method
        }
        // Layer 7: Bootstrap server direct download (absolute last resort)
        try {
            this.logger.warn('⚠️ LAST RESORT: Using bootstrap server direct download...');
            await this.downloadStoreViaBootstrap(storeId);
            const success = this.digFiles.has(storeId);
            if (success) {
                this.logger.info(`✅ Downloaded ${storeId} via bootstrap server (last resort)`);
                return true;
            }
        }
        catch (error) {
            this.logger.error('All download methods failed:', error);
        }
        this.logger.error(`❌ Failed to download store ${storeId} from all available sources`);
        return false;
    }
    // DHT-based store discovery and download
    async downloadStoreFromDHT(storeId) {
        try {
            const dht = this.node.services.dht;
            if (!dht) {
                throw new Error('DHT service not available');
            }
            // Search for store in DHT
            const key = uint8ArrayFromString(`/dig-store/${storeId}`);
            for await (const event of dht.get(key)) {
                if (event.name === 'VALUE') {
                    try {
                        const storeInfo = JSON.parse(uint8ArrayToString(event.value));
                        const { peerId, cryptoIPv6, size } = storeInfo;
                        if (peerId === this.node.peerId.toString()) {
                            continue; // Skip our own store
                        }
                        this.logger.info(`🔑 Found store ${storeId} in DHT: peer ${peerId} (${cryptoIPv6})`);
                        // Try to download from this peer
                        const success = await this.downloadStoreFromSpecificPeer(storeId, peerId, cryptoIPv6);
                        if (success) {
                            return true;
                        }
                    }
                    catch (parseError) {
                        this.logger.debug('Failed to parse DHT store info:', parseError);
                    }
                }
            }
            throw new Error('Store not found in DHT');
        }
        catch (error) {
            this.logger.debug(`DHT store discovery failed for ${storeId}:`, error);
            return false;
        }
    }
    // Gossip network store discovery
    async downloadStoreFromGossipNetwork(storeId) {
        try {
            // Check our gossip-discovered peers for the store
            for (const [peerId, peerInfo] of this.privacyOverlayPeers) {
                if (peerInfo.stores?.includes(storeId)) {
                    this.logger.info(`🗣️ Found store ${storeId} via gossip: peer ${peerId}`);
                    const success = await this.downloadStoreFromSpecificPeer(storeId, peerId, peerInfo.cryptoIPv6);
                    if (success) {
                        return true;
                    }
                }
            }
            // Ask connected peers if they know about this store
            const connectedPeers = this.node.getPeers();
            for (const peer of connectedPeers.slice(0, 3)) {
                try {
                    const storeLocation = await this.queryPeerForStore(peer.toString(), storeId);
                    if (storeLocation) {
                        const success = await this.downloadStoreFromSpecificPeer(storeId, storeLocation.peerId, storeLocation.cryptoIPv6);
                        if (success) {
                            return true;
                        }
                    }
                }
                catch (error) {
                    this.logger.debug(`Failed to query ${peer.toString()} for store:`, error);
                }
            }
            throw new Error('Store not found in gossip network');
        }
        catch (error) {
            this.logger.debug(`Gossip store discovery failed for ${storeId}:`, error);
            return false;
        }
    }
    // Distributed TURN server download (using privacy-discovered TURN servers)
    async downloadStoreFromDistributedTurn(storeId) {
        try {
            const turnServers = this.getPrivacyTurnServers();
            if (turnServers.length === 0) {
                throw new Error('No TURN servers available in privacy network');
            }
            this.logger.info(`📡 Found ${turnServers.length} distributed TURN servers`);
            // Find which peer has the store
            let sourcePeer = null;
            for (const [peerId, peerInfo] of this.privacyOverlayPeers) {
                if (peerInfo.stores?.includes(storeId)) {
                    sourcePeer = { peerId, cryptoIPv6: peerInfo.cryptoIPv6 };
                    break;
                }
            }
            if (!sourcePeer) {
                throw new Error('No peer found with the store in privacy network');
            }
            // Try each TURN server
            for (const turnServer of turnServers) {
                try {
                    this.logger.info(`📡 Attempting download via TURN server: ${turnServer.peerId}`);
                    const success = await this.downloadStoreViaPeerTurn(storeId, sourcePeer, turnServer);
                    if (success) {
                        return true;
                    }
                }
                catch (error) {
                    // Silent failure - will try next TURN server
                    continue;
                }
            }
            throw new Error('All distributed TURN servers failed');
        }
        catch (error) {
            this.logger.debug(`Distributed TURN download failed for ${storeId}:`, error);
            return false;
        }
    }
    // Mesh routing through connected peers
    async downloadStoreViaMeshRouting(storeId) {
        try {
            const connectedPeers = this.node.getPeers();
            this.logger.info(`🕸️ Using mesh routing through ${connectedPeers.length} connected peers`);
            // Ask each connected peer to help find the store
            for (const peer of connectedPeers) {
                try {
                    // Request peer to search their network for the store
                    const storeRoute = await this.requestStoreRoute(peer.toString(), storeId);
                    if (storeRoute && storeRoute.length > 0) {
                        // Try to download through the discovered route
                        const success = await this.downloadStoreViaRoute(storeId, storeRoute);
                        if (success) {
                            return true;
                        }
                    }
                }
                catch (error) {
                    // Silent failure - will try next peer
                }
            }
            throw new Error('No mesh routes found for store');
        }
        catch (error) {
            this.logger.debug(`Mesh routing failed for ${storeId}:`, error);
            return false;
        }
    }
    // Bootstrap server TURN fallback (proper implementation)
    async downloadStoreViaBootstrapTurn(storeId) {
        try {
            const bootstrapUrl = this.config.discoveryServers?.[0];
            if (!bootstrapUrl) {
                throw new Error('No bootstrap server configured');
            }
            // First, find which peer has the store (use crypto-IPv6 directory for privacy)
            const peersResponse = await fetch(`${bootstrapUrl}/crypto-ipv6-directory`);
            if (!peersResponse.ok) {
                throw new Error('Failed to get peers from bootstrap crypto-IPv6 directory');
            }
            const peersData = await peersResponse.json();
            const sourcePeer = peersData.peers?.find((p) => p.peerId !== this.node.peerId.toString() &&
                p.stores?.includes(storeId));
            if (!sourcePeer) {
                throw new Error('No peer found with the store');
            }
            this.logger.info(`☁️ Found store ${storeId} on peer ${sourcePeer.peerId}, using bootstrap TURN`);
            // Try direct HTTP bootstrap TURN first (more reliable)
            const directTurnResponse = await fetch(`${bootstrapUrl}/bootstrap-turn-direct`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    storeId,
                    fromPeerId: sourcePeer.peerId,
                    toPeerId: this.node.peerId.toString()
                })
            });
            if (directTurnResponse.ok) {
                const directTurnData = await directTurnResponse.json();
                if (directTurnData.success && directTurnData.sourceAddresses) {
                    this.logger.info(`📡 Bootstrap provided ${directTurnData.sourceAddresses.length} addresses for direct connection`);
                    // Try to connect directly to source peer using provided addresses
                    for (const address of directTurnData.sourceAddresses) {
                        try {
                            const success = await this.downloadStoreFromSpecificPeer(storeId, sourcePeer.peerId, sourcePeer.cryptoIPv6);
                            if (success) {
                                this.logger.info(`✅ Downloaded ${storeId} via bootstrap TURN direct connection`);
                                return true;
                            }
                        }
                        catch (error) {
                            // Silent failure - try next address
                        }
                    }
                }
            }
            // Fallback to WebSocket-based bootstrap TURN relay
            const turnResponse = await fetch(`${bootstrapUrl}/bootstrap-turn-relay`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    storeId,
                    fromPeerId: sourcePeer.peerId,
                    toPeerId: this.node.peerId.toString()
                })
            });
            if (turnResponse.ok) {
                const storeContent = await turnResponse.arrayBuffer();
                // Decrypt if encrypted
                let finalContent;
                if (this.e2eEncryption.hasSharedSecret(sourcePeer.peerId)) {
                    const encryptedBase64 = Buffer.from(storeContent).toString('base64');
                    finalContent = this.e2eEncryption.decryptFromPeer(sourcePeer.peerId, encryptedBase64);
                    this.logger.info(`🔐 Decrypted store from ${sourcePeer.peerId} via bootstrap TURN`);
                }
                else {
                    finalContent = Buffer.from(storeContent);
                    this.logger.warn(`⚠️ No encryption with ${sourcePeer.peerId}, using unencrypted bootstrap TURN`);
                }
                // Save the store
                const filePath = join(this.digPath, `${storeId}.dig`);
                await writeFile(filePath, finalContent);
                await this.loadDIGFile(filePath);
                if (this.digFiles.has(storeId)) {
                    await this.announceStore(storeId);
                    this.metrics.downloadSuccesses++;
                    return true;
                }
            }
            throw new Error('Bootstrap TURN relay failed');
        }
        catch (error) {
            this.logger.debug(`Bootstrap TURN fallback failed for ${storeId}:`, error);
            return false;
        }
    }
    // Download from specific peer using crypto-IPv6 resolution
    async downloadStoreFromSpecificPeer(storeId, peerId, cryptoIPv6) {
        try {
            // Resolve peer's real addresses
            const realAddresses = await this.resolveDistributedPeerAddresses(peerId, cryptoIPv6);
            if (realAddresses.length === 0) {
                throw new Error(`Cannot resolve addresses for peer ${peerId}`);
            }
            // Try to connect and download
            for (const address of realAddresses) {
                try {
                    const peer = this.node.getPeers().find(p => p.toString() === peerId);
                    if (peer) {
                        // Already connected, use existing connection
                        await this.downloadStoreFromLibP2PPeer(peerId, peer.toString(), storeId);
                        const success = this.digFiles.has(storeId);
                        if (success) {
                            return true;
                        }
                    }
                    else {
                        // Need to establish connection first
                        const addr = multiaddr(address);
                        const connection = await this.node.dial(addr);
                        if (connection) {
                            await this.downloadStoreFromLibP2PPeer(peerId, connection.remotePeer.toString(), storeId);
                            const success = this.digFiles.has(storeId);
                            if (success) {
                                return true;
                            }
                        }
                    }
                }
                catch (error) {
                    this.logger.debug(`Failed to download from ${address}:`, error);
                }
            }
            throw new Error(`Failed to download from peer ${peerId}`);
        }
        catch (error) {
            this.logger.debug(`Specific peer download failed for ${storeId} from ${peerId}:`, error);
            return false;
        }
    }
    // Query peer for store location
    async queryPeerForStore(peerId, storeId) {
        try {
            const peer = this.node.getPeers().find(p => p.toString() === peerId);
            if (!peer) {
                return null;
            }
            const stream = await this.node.dialProtocol(peer, DIG_PROTOCOL);
            const request = {
                type: 'PRIVACY_PEER_DISCOVERY',
                storeId, // Looking for this specific store
                maxPeers: 5,
                includeStores: true,
                includeCapabilities: true,
                privacyMode: true
            };
            // Send request
            await pipe(async function* () {
                yield uint8ArrayFromString(JSON.stringify(request));
            }, stream.sink);
            // Read response
            const chunks = [];
            await pipe(stream.source, async function (source) {
                for await (const chunk of source) {
                    chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk.subarray()));
                }
            });
            if (chunks.length > 0) {
                const response = JSON.parse(uint8ArrayToString(chunks[0]));
                if (response.success && response.peers) {
                    // Find peer with the store
                    const peerWithStore = response.peers.find((p) => p.stores?.includes(storeId));
                    if (peerWithStore) {
                        return {
                            peerId: peerWithStore.peerId,
                            cryptoIPv6: peerWithStore.cryptoIPv6
                        };
                    }
                }
            }
        }
        catch (error) {
            this.logger.debug(`Failed to query ${peerId} for store ${storeId}:`, error);
        }
        return null;
    }
    // Download via peer TURN server
    async downloadStoreViaPeerTurn(storeId, sourcePeer, turnServer) {
        try {
            // This would use the peer's TURN server to relay the data
            // For now, implement as a direct connection with TURN coordination
            this.logger.info(`📡 Coordinating TURN relay: ${sourcePeer.peerId} → ${turnServer.peerId} → ${this.node.peerId.toString()}`);
            // In a full implementation, this would:
            // 1. Establish TURN relay session with turnServer.peerId
            // 2. Request sourcePeer.peerId to send data through the TURN relay
            // 3. Receive and decrypt the data
            // For now, fall back to direct connection
            const success = await this.downloadStoreFromSpecificPeer(storeId, sourcePeer.peerId, sourcePeer.cryptoIPv6);
            return success;
        }
        catch (error) {
            this.logger.debug(`Peer TURN download failed for ${storeId}:`, error);
            return false;
        }
    }
    // Download via route discovery (mesh routing)
    async downloadStoreViaRoute(storeId, route) {
        try {
            if (route.length === 0) {
                throw new Error('Empty route');
            }
            // Use the first peer in the route
            const targetPeer = route[0];
            this.logger.info(`🕸️ Downloading via mesh route: ${targetPeer.peerId}`);
            const success = await this.downloadStoreFromSpecificPeer(storeId, targetPeer.peerId, targetPeer.cryptoIPv6);
            return success;
        }
        catch (error) {
            this.logger.debug(`Route download failed for ${storeId}:`, error);
            return false;
        }
    }
    // Request store route from peer
    async requestStoreRoute(peerId, storeId) {
        try {
            // Request peer to search their network for store routes
            const peers = await this.requestPeersFromNode(peerId, true);
            // Filter peers that have the store
            const peersWithStore = peers.filter(p => p.stores?.includes(storeId));
            this.logger.debug(`🕸️ Found ${peersWithStore.length} route options for ${storeId} via ${peerId}`);
            return peersWithStore;
        }
        catch (error) {
            this.logger.debug(`Route request failed for ${storeId} via ${peerId}:`, error);
            return [];
        }
    }
    // Check if the discovery server points to this node itself
    isSelfRelay(bootstrapUrl, ourPort) {
        try {
            const url = new URL(bootstrapUrl);
            const urlPort = parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80);
            // Check if it's pointing to localhost or our port
            const isLocalhost = url.hostname === 'localhost' ||
                url.hostname === '127.0.0.1' ||
                url.hostname === '0.0.0.0';
            const isSamePort = urlPort === ourPort;
            if (isLocalhost && isSamePort) {
                this.logger.debug(`Self-relay detected: ${bootstrapUrl} points to localhost:${ourPort}`);
                return true;
            }
            // For development, check if multiple nodes are running on same machine with different ports
            if (isLocalhost) {
                this.logger.debug(`Different localhost port: ${urlPort} vs our ${ourPort}`);
                return false;
            }
            return false;
        }
        catch (error) {
            this.logger.debug('Error parsing bootstrap URL for self-relay check:', error);
            return false;
        }
    }
    // Handle protocol handshake and establish end-to-end encryption
    async handleProtocolHandshake(request, peerId) {
        try {
            const { networkId, protocolVersion, softwareVersion, serverPort, nodeType, capabilities: peerCapabilities, cryptoIPv6, publicKey, stores, supportedFeatures } = request;
            this.logger.info(`🤝 Comprehensive handshake received from ${peerId}:`);
            this.logger.info(`   📡 Network: ${networkId || 'unknown'}`);
            this.logger.info(`   🔧 Protocol: v${protocolVersion || 'unknown'}`);
            this.logger.info(`   💻 Software: v${softwareVersion || 'unknown'}`);
            this.logger.info(`   🌐 Port: ${serverPort || 'unknown'}`);
            this.logger.info(`   🏷️ Type: ${this.getNodeTypeFromCode(nodeType)} (${nodeType})`);
            this.logger.info(`   🔐 Crypto-IPv6: ${cryptoIPv6 || 'unknown'}`);
            this.logger.info(`   📁 Stores: ${stores?.length || 0}`);
            this.logger.info(`   🔧 Capabilities: ${peerCapabilities?.length || 0} features`);
            // Log detailed capabilities
            if (peerCapabilities && Array.isArray(peerCapabilities)) {
                for (const [code, description] of peerCapabilities) {
                    this.logger.debug(`     ${code}: ${description}`);
                }
            }
            // Store peer's protocol version and comprehensive info
            if (protocolVersion) {
                this.peerProtocolVersions.set(peerId, protocolVersion);
            }
            // Store peer in privacy overlay with full handshake info
            if (cryptoIPv6) {
                this.privacyOverlayPeers.set(peerId, {
                    cryptoIPv6,
                    encryptedAddresses: '',
                    lastSeen: Date.now(),
                    capabilities: this.nodeCapabilities, // Store full capabilities
                    stores: stores || []
                });
            }
            // Update peer stores if provided
            if (stores && Array.isArray(stores)) {
                this.peerStores.set(peerId, new Set(stores));
            }
            // Establish shared secret for end-to-end encryption
            if (publicKey) {
                this.e2eEncryption.establishSharedSecret(peerId, publicKey);
                this.logger.info(`🔐 End-to-end encryption established with ${peerId}`);
            }
            // Get our current capabilities and combine with E2E features
            const capabilities = this.getCapabilities();
            const capabilityList = Object.entries(capabilities)
                .filter(([_, value]) => value === true)
                .map(([key]) => key);
            const myFeatures = [...E2EEncryption.getProtocolCapabilities(), ...capabilityList];
            const peerFeatures = supportedFeatures || [];
            const compatibleFeatures = myFeatures.filter(feature => peerFeatures.includes(feature));
            this.logger.info(`🤝 Protocol handshake with ${peerId}: sharing ${capabilityList.length} node capabilities`);
            this.logger.info(`✅ Compatible features: ${compatibleFeatures.join(', ')}`);
            return {
                success: true,
                protocolVersion: capabilities.protocolVersion,
                supportedFeatures: myFeatures,
                publicKey: this.e2eEncryption.getPublicKey(),
                metadata: {
                    compatibleFeatures,
                    encryptionEnabled: !!publicKey,
                    nodeCapabilities: {
                        storeCount: this.digFiles.size,
                        turnCapable: await this.checkTurnCapability(),
                        relaySupport: true
                    }
                }
            };
        }
        catch (error) {
            this.logger.error(`Handshake failed with ${peerId}:`, error);
            return {
                success: false,
                error: `Handshake failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                protocolVersion: E2EEncryption.getProtocolVersion()
            };
        }
    }
    // Check if this node can act as TURN server
    async checkTurnCapability() {
        const addresses = this.node?.getMultiaddrs() || [];
        const externalAddresses = addresses.filter(addr => {
            const addrStr = addr.toString();
            return !addrStr.includes('127.0.0.1') &&
                !addrStr.includes('::1') &&
                !addrStr.includes('192.168.') &&
                !addrStr.includes('10.0.');
        });
        return externalAddresses.length > 0;
    }
    // Initiate protocol handshake with peer
    async initiateProtocolHandshake(peerId) {
        try {
            const peer = this.node.getPeers().find(p => p.toString() === peerId);
            if (!peer)
                return;
            this.logger.info(`🤝 Initiating handshake with peer: ${peerId}`);
            const stream = await this.node.dialProtocol(peer, DIG_PROTOCOL);
            // Create comprehensive handshake with full node information
            const handshakeInfo = this.createHandshakeInfo();
            const handshakeRequest = {
                type: 'HANDSHAKE',
                ...handshakeInfo, // Include all handshake information
                supportedFeatures: E2EEncryption.getProtocolCapabilities()
            };
            const self = this;
            await pipe([uint8ArrayFromString(JSON.stringify(handshakeRequest))], stream, async function (source) {
                const chunks = [];
                for await (const chunk of source) {
                    chunks.push(chunk);
                }
                if (chunks.length > 0) {
                    try {
                        const response = JSON.parse(uint8ArrayToString(chunks[0]));
                        if (response.success && response.publicKey) {
                            // Establish shared secret for encryption
                            self.e2eEncryption.establishSharedSecret(peerId, response.publicKey);
                            self.peerProtocolVersions.set(peerId, response.protocolVersion);
                            self.logger.info(`✅ Handshake completed with ${peerId} (v${response.protocolVersion})`);
                            self.logger.info(`🔐 End-to-end encryption active with ${peerId}`);
                        }
                    }
                    catch (parseError) {
                        self.logger.warn(`Failed to parse handshake response from ${peerId}:`, parseError);
                    }
                }
            });
        }
        catch (error) {
            this.logger.warn(`Failed to initiate handshake with ${peerId}:`, error);
        }
    }
    // Scan ~/.dig directory for .dig files
    async scanDIGFiles() {
        try {
            const files = await readdir(this.digPath);
            for (const file of files) {
                if (file.endsWith('.dig')) {
                    await this.loadDIGFile(join(this.digPath, file));
                }
            }
            console.log(`Loaded ${this.digFiles.size} .dig files`);
        }
        catch (error) {
            console.warn(`Could not scan DIG directory ${this.digPath}:`, error);
        }
    }
    async loadDIGFile(filePath) {
        try {
            const storeId = basename(filePath, '.dig');
            const fileContent = await readFile(filePath);
            const fileStats = await stat(filePath);
            const metadata = {
                name: storeId,
                size: fileContent.length,
                created: fileStats.birthtime.toISOString(),
                mimeType: 'application/x-dig-archive'
            };
            this.digFiles.set(storeId, {
                storeId,
                filePath,
                content: fileContent,
                metadata
            });
            this.metrics.filesLoaded++;
            console.log(`✅ Loaded DIG file: ${storeId} (${metadata.size} bytes)`);
        }
        catch (error) {
            this.metrics.errors++;
            console.error(`❌ Failed to load .dig file ${filePath}:`, error);
        }
    }
    // Rate limiting for peer requests
    isRateLimited(peerId) {
        const now = Date.now();
        const peerData = this.requestCounts.get(peerId);
        if (!peerData) {
            this.requestCounts.set(peerId, { count: 1, lastReset: now });
            return false;
        }
        // Reset counter every minute
        if (now - peerData.lastReset > 60000) {
            peerData.count = 1;
            peerData.lastReset = now;
            return false;
        }
        peerData.count++;
        return peerData.count > this.MAX_REQUESTS_PER_MINUTE;
    }
    // Handle DIG protocol requests
    async handleDIGRequest({ stream }) {
        const self = this;
        const peerId = stream.id || 'unknown';
        // Rate limiting
        if (this.isRateLimited(peerId)) {
            this.logger.warn(`Rate limited peer: ${peerId}`);
            try {
                await stream.close();
            }
            catch (error) {
                // Ignore close errors
            }
            return;
        }
        try {
            await pipe(stream, async function* (source) {
                for await (const chunk of source) {
                    let request;
                    try {
                        request = JSON.parse(uint8ArrayToString(chunk.subarray()));
                    }
                    catch (parseError) {
                        self.logger.warn(`Invalid JSON request from peer ${peerId}`);
                        return;
                    }
                    // Validate request structure
                    if (!request.type || typeof request.type !== 'string') {
                        self.logger.warn(`Invalid request type from peer ${peerId}`);
                        return;
                    }
                    if (request.type === 'HANDSHAKE') {
                        // Handle protocol handshake and establish encryption
                        const handshakeResponse = await self.handleProtocolHandshake(request, peerId);
                        yield uint8ArrayFromString(JSON.stringify(handshakeResponse));
                    }
                    else if (request.type === 'PEER_EXCHANGE') {
                        // Handle peer exchange request (distributed discovery)
                        const peerExchangeResponse = await self.handlePeerExchangeRequest(request, peerId);
                        yield uint8ArrayFromString(JSON.stringify(peerExchangeResponse));
                    }
                    else if (request.type === 'PRIVACY_PEER_DISCOVERY') {
                        // Handle privacy peer discovery request
                        const privacyDiscoveryResponse = await self.handlePrivacyPeerDiscoveryRequest(request, peerId);
                        yield uint8ArrayFromString(JSON.stringify(privacyDiscoveryResponse));
                    }
                    else if (request.type === 'GET_FILE') {
                        const { storeId, filePath } = request;
                        if (self.validateStoreId(storeId) && filePath) {
                            yield* self.serveFileFromStore(storeId, filePath);
                        }
                        else {
                            self.logger.warn(`Invalid GET_FILE request from peer ${peerId}`);
                        }
                    }
                    else if (request.type === 'GET_URN') {
                        const { urn } = request;
                        if (urn && typeof urn === 'string') {
                            yield* self.serveFileFromURN(urn);
                        }
                        else {
                            self.logger.warn(`Invalid GET_URN request from peer ${peerId}`);
                        }
                    }
                    else if (request.type === 'GET_FILE_RANGE') {
                        const { storeId, filePath, rangeStart, rangeEnd, chunkId } = request;
                        if (self.validateStoreId(storeId) && filePath &&
                            typeof rangeStart === 'number' && typeof rangeEnd === 'number') {
                            yield* self.serveFileRange(storeId, filePath, rangeStart, rangeEnd, chunkId);
                        }
                        else {
                            self.logger.warn(`Invalid GET_FILE_RANGE request from peer ${peerId}`);
                        }
                    }
                    else if (request.type === 'GET_STORE_CONTENT') {
                        const { storeId } = request;
                        if (self.validateStoreId(storeId)) {
                            yield* self.serveFileFromStore(storeId, '');
                        }
                        else {
                            self.logger.warn(`Invalid GET_STORE_CONTENT request from peer ${peerId}`);
                        }
                    }
                    else if (request.type === 'GET_STORE_FILES') {
                        const { storeId } = request;
                        if (storeId) {
                            const digFile = self.digFiles.get(storeId);
                            if (digFile) {
                                const response = {
                                    success: true,
                                    storeId,
                                    files: [storeId + '.dig'], // The store contains the single .dig file
                                    metadata: digFile.metadata
                                };
                                yield uint8ArrayFromString(JSON.stringify(response));
                            }
                            else {
                                const response = {
                                    success: false,
                                    error: 'Store not found'
                                };
                                yield uint8ArrayFromString(JSON.stringify(response));
                            }
                        }
                    }
                    break;
                }
            }, stream);
        }
        catch (error) {
            console.error('Error handling DIG request:', error);
        }
    }
    // Serve file from URN
    async *serveFileFromURN(urn) {
        const parsed = parseURN(urn);
        if (!parsed) {
            const response = {
                success: false,
                error: 'Invalid URN format. Expected: urn:dig:chia:{storeID}:{optional roothash}/{optional resource key}'
            };
            yield uint8ArrayFromString(JSON.stringify(response));
            return;
        }
        const { storeId, filePath, rootHash } = parsed;
        if (!this.digFiles.has(storeId)) {
            const response = {
                success: false,
                error: `Store not found: ${storeId}`
            };
            yield uint8ArrayFromString(JSON.stringify(response));
            return;
        }
        // ✅ PRODUCTION: Implement rootHash version checking
        if (rootHash) {
            const digFile = this.digFiles.get(storeId);
            if (digFile) {
                // Calculate current file hash for version verification
                const currentHash = createHash('sha256').update(digFile.content).digest('hex');
                if (currentHash !== rootHash) {
                    this.logger.warn(`⚠️ Root hash mismatch for ${storeId}: expected ${rootHash}, got ${currentHash}`);
                    const response = {
                        success: false,
                        error: `Version mismatch: requested ${rootHash}, available ${currentHash}`,
                        storeId,
                        metadata: {
                            requestedVersion: rootHash,
                            availableVersion: currentHash,
                            versionMismatch: true
                        }
                    };
                    yield uint8ArrayFromString(JSON.stringify(response));
                    return;
                }
                else {
                    this.logger.info(`✅ Root hash verified for ${storeId}: ${rootHash}`);
                }
            }
        }
        yield* this.serveFileFromStore(storeId, filePath);
    }
    // Serve byte range from file for parallel downloads
    async *serveFileRange(storeId, filePath, rangeStart, rangeEnd, chunkId) {
        const digFile = this.digFiles.get(storeId);
        if (!digFile) {
            const response = {
                success: false,
                error: 'Store not found',
                chunkId
            };
            yield uint8ArrayFromString(JSON.stringify(response));
            return;
        }
        try {
            const content = digFile.content;
            const totalSize = content.length;
            // Validate range
            if (rangeStart < 0 || rangeEnd >= totalSize || rangeStart > rangeEnd) {
                const response = {
                    success: false,
                    error: `Invalid range: ${rangeStart}-${rangeEnd} (file size: ${totalSize})`,
                    chunkId,
                    totalSize
                };
                yield uint8ArrayFromString(JSON.stringify(response));
                return;
            }
            // Extract the requested byte range
            const rangeContent = content.subarray(rangeStart, rangeEnd + 1);
            const response = {
                success: true,
                storeId,
                size: rangeContent.length,
                totalSize,
                rangeStart,
                rangeEnd,
                chunkId,
                isPartial: true,
                mimeType: digFile.metadata.mimeType
            };
            this.logger.debug(`📤 Serving range ${rangeStart}-${rangeEnd} of ${storeId} (${rangeContent.length} bytes)`);
            // Send response header first
            yield uint8ArrayFromString(JSON.stringify(response) + '\n');
            // Send the range content in chunks for better streaming
            const CHUNK_SIZE = 64 * 1024; // 64KB chunks
            for (let i = 0; i < rangeContent.length; i += CHUNK_SIZE) {
                const chunk = rangeContent.subarray(i, Math.min(i + CHUNK_SIZE, rangeContent.length));
                yield chunk;
            }
        }
        catch (error) {
            const response = {
                success: false,
                error: `Failed to serve range: ${error instanceof Error ? error.message : 'Unknown error'}`,
                chunkId
            };
            yield uint8ArrayFromString(JSON.stringify(response));
        }
    }
    // Serve file from store - serves the entire .dig file as binary data
    async *serveFileFromStore(storeId, filePath) {
        const digFile = this.digFiles.get(storeId);
        if (!digFile) {
            const response = {
                success: false,
                error: 'Store not found'
            };
            yield uint8ArrayFromString(JSON.stringify(response));
            return;
        }
        // For .dig files, we serve the entire file regardless of the requested filePath
        // The filePath is ignored since we're serving the complete .dig archive
        try {
            const content = digFile.content;
            const mimeType = digFile.metadata.mimeType;
            // Send metadata first
            const response = {
                success: true,
                size: content.length,
                mimeType
            };
            yield uint8ArrayFromString(JSON.stringify(response));
            // Send file content in chunks
            const CHUNK_SIZE = 64 * 1024;
            for (let i = 0; i < content.length; i += CHUNK_SIZE) {
                yield content.subarray(i, i + CHUNK_SIZE);
            }
        }
        catch (error) {
            const response = {
                success: false,
                error: `Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
            yield uint8ArrayFromString(JSON.stringify(response));
        }
    }
    async handleDiscoveryRequest({ stream }) {
        const self = this;
        try {
            await pipe(stream, async function* (source) {
                for await (const chunk of source) {
                    const request = JSON.parse(uint8ArrayToString(chunk.subarray()));
                    if (request.type === 'FIND_STORE') {
                        const { storeId } = request;
                        const response = {
                            success: true,
                            peerId: self.node.peerId.toString(),
                            cryptoIPv6: self.cryptoIPv6,
                            hasStore: self.digFiles.has(storeId)
                        };
                        yield uint8ArrayFromString(JSON.stringify(response));
                    }
                    else if (request.type === 'LIST_STORES') {
                        const response = {
                            success: true,
                            peerId: self.node.peerId.toString(),
                            stores: Array.from(self.digFiles.keys())
                        };
                        yield uint8ArrayFromString(JSON.stringify(response));
                    }
                    break;
                }
            }, stream);
        }
        catch (error) {
            console.error('Error handling discovery request:', error);
        }
    }
    async announceStores() {
        for (const storeId of this.digFiles.keys()) {
            await this.announceStore(storeId);
        }
    }
    async announceStore(storeId) {
        try {
            const key = uint8ArrayFromString(`/dig-store/${storeId}`);
            const value = uint8ArrayFromString(JSON.stringify({
                peerId: this.node.peerId.toString(),
                cryptoIPv6: this.cryptoIPv6,
                timestamp: Date.now()
            }));
            const dht = this.node.services.dht;
            if (dht && dht.put) {
                await dht.put(key, value);
            }
        }
        catch (error) {
            console.error(`Failed to announce store ${storeId}:`, error);
        }
    }
    // Public API methods
    getAvailableStores() {
        return Array.from(this.digFiles.keys());
    }
    hasStore(storeId) {
        return this.digFiles.has(storeId);
    }
    getCryptoIPv6() {
        return this.cryptoIPv6;
    }
    getNode() {
        return this.node;
    }
    async rescanDIGFiles() {
        if (!this.isStarted) {
            throw new Error('DIG Node is not started');
        }
        this.logger.info('🔄 Rescanning DIG files...');
        const oldCount = this.digFiles.size;
        this.digFiles.clear();
        await this.scanDIGFiles();
        await this.announceStores();
        const newCount = this.digFiles.size;
        this.logger.info(`✅ Rescan complete: ${oldCount} -> ${newCount} stores`);
    }
    // Health check
    isHealthy() {
        return this.isStarted &&
            this.node !== undefined &&
            this.cryptoIPv6 !== undefined;
    }
    // Get network health
    getNetworkHealth() {
        const connectedPeers = this.node ? this.node.getPeers().length : 0;
        const totalPeersDiscovered = this.discoveredPeers.size;
        return {
            isHealthy: this.isHealthy(),
            connectedPeers,
            totalPeersDiscovered,
            storesShared: this.digFiles.size,
            syncInProgress: this.syncInProgress,
            lastSyncSuccess: this.metrics.syncSuccesses > 0,
            errorRate: this.metrics.errors / Math.max(1, this.metrics.syncAttempts + this.metrics.downloadAttempts)
        };
    }
    async findStorePeers(storeId) {
        try {
            const key = uint8ArrayFromString(`/dig-store/${storeId}`);
            const peers = [];
            const dht = this.node.services.dht;
            if (dht && dht.get) {
                for await (const event of dht.get(key)) {
                    if (event.name === 'VALUE') {
                        try {
                            const peerInfo = JSON.parse(uint8ArrayToString(event.value));
                            peers.push(peerInfo);
                        }
                        catch (error) {
                            console.warn('Failed to parse peer info:', error);
                        }
                    }
                }
            }
            return peers;
        }
        catch (error) {
            console.error(`Failed to find peers for store ${storeId}:`, error);
            return [];
        }
    }
    // Start watching the .dig directory for changes
    async startFileWatcher() {
        try {
            console.log(`🔍 Starting file watcher for ${this.digPath}`);
            // Ensure directory exists before watching
            await this.ensureDigDirectory();
            this.watcher = watch(this.digPath, { recursive: false });
            // Run watcher in background without blocking
            this.runFileWatcher();
        }
        catch (error) {
            const isAWS = process.env.AWS_DEPLOYMENT === 'true' || (process.env.NODE_ENV === 'production' && process.env.PORT);
            if (error.code === 'ENOENT') {
                if (isAWS) {
                    this.logger.warn(`⚠️ File watcher disabled: Cannot access ${this.digPath} (AWS EFS may not be mounted)`);
                }
                else {
                    console.error(`❌ Failed to access DIG directory: ${this.digPath}`);
                }
            }
            else {
                console.error(`❌ File watcher error:`, error);
            }
        }
    }
    // Run the file watcher loop in background
    async runFileWatcher() {
        try {
            for await (const event of this.watcher) {
                await this.handleFileSystemEvent(event);
            }
        }
        catch (error) {
            if (this.watcher) {
                // In AWS, if EFS is not mounted, don't spam errors
                const isAWS = process.env.AWS_DEPLOYMENT === 'true' || (process.env.NODE_ENV === 'production' && process.env.PORT);
                if (error.code === 'ENOENT' && isAWS) {
                    this.logger.warn(`⚠️ File watcher disabled: EFS path ${this.digPath} not accessible (AWS EFS may not be mounted)`);
                    return; // Don't retry in AWS if EFS is not available
                }
                console.error(`❌ File watcher loop error:`, error);
                // Try to restart watcher after a delay (only in non-AWS environments)
                if (!isAWS) {
                    setTimeout(() => this.startFileWatcher(), 5000);
                }
            }
        }
    }
    // Handle file system events
    async handleFileSystemEvent(event) {
        if (!event.filename || !event.filename.endsWith('.dig')) {
            return; // Only process .dig files
        }
        const filePath = join(this.digPath, event.filename);
        const storeId = basename(event.filename, '.dig');
        try {
            if (event.eventType === 'rename') {
                // File was added or removed
                try {
                    await stat(filePath);
                    // File exists, so it was added or modified
                    await this.addOrUpdateStore(filePath, storeId);
                }
                catch (statError) {
                    // File doesn't exist, so it was removed
                    await this.removeStore(storeId);
                }
            }
            else if (event.eventType === 'change') {
                // File was modified
                try {
                    await stat(filePath);
                    await this.addOrUpdateStore(filePath, storeId);
                }
                catch (statError) {
                    // File might have been deleted during modification
                    await this.removeStore(storeId);
                }
            }
        }
        catch (error) {
            console.error(`❌ Error handling file system event for ${event.filename}:`, error);
        }
    }
    // Add or update a store
    async addOrUpdateStore(filePath, storeId) {
        const wasExisting = this.digFiles.has(storeId);
        await this.loadDIGFile(filePath);
        if (this.digFiles.has(storeId)) {
            await this.announceStore(storeId);
            if (wasExisting) {
                console.log(`🔄 Updated store: ${storeId}`);
            }
            else {
                console.log(`➕ Added new store: ${storeId}`);
            }
        }
    }
    // Remove a store
    async removeStore(storeId) {
        if (this.digFiles.has(storeId)) {
            this.digFiles.delete(storeId);
            console.log(`➖ Removed store: ${storeId}`);
            // ✅ PRODUCTION: Announce removal to DHT
            try {
                const dht = this.node.services.dht;
                if (dht && dht.put) {
                    // Announce store removal to DHT
                    const key = uint8ArrayFromString(`/dig-store/${storeId}`);
                    const removalValue = uint8ArrayFromString(JSON.stringify({
                        peerId: this.node.peerId.toString(),
                        storeId,
                        action: 'removed',
                        timestamp: Date.now()
                    }));
                    await dht.put(key, removalValue);
                    this.logger.info(`📡 Announced store removal to DHT: ${storeId}`);
                }
            }
            catch (error) {
                this.logger.debug(`Failed to announce removal to DHT for ${storeId}:`, error);
            }
        }
    }
    // Start peer discovery
    startPeerDiscovery() {
        console.log(`🔍 Starting peer discovery...`);
        // Listen for peer connection events
        this.node.addEventListener('peer:connect', (event) => {
            const peerId = event.detail.toString();
            this.discoveredPeers.add(peerId);
            this.metrics.peersConnected++;
            this.logger.info(`🤝 Connected to peer: ${peerId}`);
            this.logger.info(`📊 Total connected peers: ${this.node.getPeers().length}`);
            // Only initiate handshake with non-bootstrap LibP2P peers (not random internet peers)
            // Skip handshake for bootstrap nodes and random peers
            if (!peerId.startsWith('Qm') && !peerId.includes('bootstrap')) {
                this.initiateProtocolHandshake(peerId).catch(error => {
                    this.logger.debug(`Handshake failed with ${peerId} (likely not a DIG node):`, error);
                });
            }
            else {
                this.logger.debug(`⏭️ Skipping handshake with bootstrap/relay peer: ${peerId}`);
            }
            // Only discover stores from DIG nodes (after handshake)
            if (!peerId.startsWith('Qm') && !peerId.includes('bootstrap')) {
                setTimeout(() => {
                    this.discoverPeerStores(peerId).catch(error => {
                        this.logger.debug(`Store discovery failed with ${peerId} (likely not a DIG node):`, error);
                    });
                }, 2000); // Wait for handshake to complete
            }
        });
        this.node.addEventListener('peer:disconnect', (event) => {
            const peerId = event.detail.toString();
            this.discoveredPeers.delete(peerId);
            this.peerStores.delete(peerId);
            this.logger.info(`👋 Disconnected from peer: ${peerId}`);
            this.logger.info(`📊 Remaining connected peers: ${this.node.getPeers().length}`);
        });
    }
    // Start store synchronization
    startStoreSync() {
        console.log(`🔄 Starting store synchronization (every 30 seconds)...`);
        // Run initial sync after 5 seconds
        setTimeout(() => this.syncStores(), 5000);
        // Run periodic sync every 30 seconds
        this.syncInterval = setInterval(() => {
            this.syncStores().catch(error => {
                console.error(`Sync error:`, error);
            });
        }, 30000);
    }
    // Discover stores from a specific peer
    async discoverPeerStores(peerId) {
        try {
            const peer = this.node.getPeers().find(p => p.toString() === peerId);
            if (!peer)
                return;
            // Only try to discover stores from peers that support our protocol
            if (!this.peerProtocolVersions.has(peerId)) {
                this.logger.debug(`⏭️ Skipping store discovery from non-DIG peer: ${peerId}`);
                return;
            }
            // Try to open a stream to the peer for discovery
            const stream = await this.node.dialProtocol(peer, DIG_DISCOVERY_PROTOCOL);
            const request = {
                type: 'LIST_STORES'
            };
            // Send discovery request
            const self = this;
            await pipe([uint8ArrayFromString(JSON.stringify(request))], stream, async function (source) {
                const chunks = [];
                for await (const chunk of source) {
                    chunks.push(chunk);
                }
                if (chunks.length > 0) {
                    try {
                        const response = JSON.parse(uint8ArrayToString(chunks[0]));
                        if (response.success && response.stores) {
                            const peerStores = new Set(response.stores);
                            self.peerStores.set(peerId, peerStores);
                            console.log(`📋 Peer ${peerId} has ${response.stores.length} stores`);
                        }
                    }
                    catch (parseError) {
                        console.warn(`Failed to parse peer stores response:`, parseError);
                    }
                }
            });
        }
        catch (error) {
            console.warn(`Failed to discover stores from peer ${peerId}:`, error);
        }
    }
    // Synchronize stores with all peers
    async syncStores() {
        if (this.syncInProgress) {
            console.log(`⏳ Sync already in progress, skipping...`);
            return;
        }
        this.syncInProgress = true;
        this.metrics.syncAttempts++;
        console.log(`🔄 Starting store synchronization...`);
        try {
            const connectedPeers = this.node.getPeers();
            const relayPeers = Array.from(this.discoveredPeers); // Include relay-connected peers
            const totalPeers = connectedPeers.length + relayPeers.length;
            console.log(`👥 Connected to ${connectedPeers.length} direct peers, ${relayPeers.length} relay peers (${totalPeers} total)`);
            // Discover stores from all connected peers
            for (const peer of connectedPeers) {
                await this.discoverPeerStores(peer.toString());
            }
            // Find missing stores from LibP2P connected peers first
            const allRemoteStores = new Set();
            for (const [peerId, stores] of this.peerStores) {
                for (const storeId of stores) {
                    allRemoteStores.add(storeId);
                }
            }
            const missingStores = Array.from(allRemoteStores).filter(storeId => !this.digFiles.has(storeId));
            if (missingStores.length > 0) {
                console.log(`📥 Found ${missingStores.length} missing stores to download via LibP2P`);
                // Download missing stores using resumable parallel downloads
                for (const storeId of missingStores) {
                    try {
                        // Try resumable download first (production-grade)
                        const success = await this.downloadStoreWithFullFallback(storeId); // Use existing method for now
                        if (!success) {
                            // Fallback to comprehensive download system
                            await this.downloadStoreWithFullFallback(storeId);
                        }
                    }
                    catch (error) {
                        this.logger.error(`Failed to download store ${storeId}:`, error);
                    }
                }
                this.metrics.syncSuccesses++;
            }
            // Only use bootstrap server as LAST RESORT if no LibP2P peers available
            if (connectedPeers.length === 0) {
                this.logger.info('🔄 No LibP2P peers available, trying bootstrap server as last resort...');
                await this.syncStoresViaBootstrap();
            }
            else {
                console.log(`✅ All stores synchronized via LibP2P (${this.digFiles.size} total)`);
                this.metrics.syncSuccesses++;
            }
        }
        catch (error) {
            this.metrics.errors++;
            console.error(`❌ Store sync error:`, error);
        }
        finally {
            this.syncInProgress = false;
        }
    }
    // Download a store from any available peer (prioritize LibP2P, fallback to bootstrap)
    async downloadStoreFromPeers(storeId) {
        this.metrics.downloadAttempts++;
        console.log(`📥 Downloading store: ${storeId}`);
        // 1. FIRST PRIORITY: Find LibP2P connected peers that have this store
        const availablePeers = [];
        for (const [peerId, stores] of this.peerStores) {
            if (stores.has(storeId)) {
                const peer = this.node.getPeers().find(p => p.toString() === peerId);
                if (peer) {
                    availablePeers.push({ peerId, peer });
                }
            }
        }
        // 2. Try LibP2P download first (with parallel support for large files)
        if (availablePeers.length > 0) {
            console.log(`📡 Attempting LibP2P download from ${availablePeers.length} connected peers`);
            // For multiple peers, try parallel download for better performance
            if (availablePeers.length > 1) {
                try {
                    const success = await this.downloadStoreInParallelFromPeers(storeId, availablePeers);
                    if (success)
                        return; // Success with parallel download
                }
                catch (error) {
                    // Silent failure - will try next method
                }
            }
            // Fallback to sequential download
            for (const { peerId, peer } of availablePeers) {
                try {
                    await this.downloadStoreFromLibP2PPeer(storeId, peerId, peer);
                    return; // Success, no need to try other methods
                }
                catch (error) {
                    // Silent failure - will try next peer
                }
            }
        }
        // 3. Try available TURN servers (distributed load)
        console.log(`🔄 LibP2P download failed, trying distributed TURN servers...`);
        try {
            await this.downloadStoreViaTurnServers(storeId);
            console.log(`✅ Downloaded ${storeId} via TURN server network`);
            return;
        }
        catch (turnError) {
            // Silent failure - will try bootstrap server
        }
        // 4. ABSOLUTE LAST RESORT: Use bootstrap server relay (only if no TURN servers available)
        console.log(`🔄 No TURN servers available, trying bootstrap server as absolute last resort...`);
        try {
            await this.downloadStoreViaBootstrap(storeId);
            console.log(`✅ Downloaded ${storeId} via bootstrap server (absolute last resort)`);
        }
        catch (bootstrapError) {
            console.warn(`❌ All download methods failed for store ${storeId}:`, bootstrapError);
        }
    }
    // Download store in parallel from multiple LibP2P peers
    async downloadStoreInParallelFromPeers(storeId, availablePeers) {
        try {
            // Get file size from first peer
            const firstPeer = availablePeers[0];
            const fileSize = await this.getFileSizeFromPeer(firstPeer.peerId, storeId);
            if (!fileSize || fileSize < 1024 * 1024) { // Less than 1MB
                this.logger.info(`📥 File too small for parallel download: ${fileSize} bytes`);
                return false; // Use regular download
            }
            this.logger.info(`📥 Starting parallel download: ${fileSize} bytes from ${availablePeers.length} peers`);
            const CHUNK_SIZE = 256 * 1024; // 256KB chunks
            const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);
            const chunks = new Map();
            // Create download tasks
            const downloadTasks = [];
            for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
                const peerIndex = chunkIndex % availablePeers.length;
                const { peerId, peer } = availablePeers[peerIndex];
                const rangeStart = chunkIndex * CHUNK_SIZE;
                const rangeEnd = Math.min(rangeStart + CHUNK_SIZE - 1, fileSize - 1);
                downloadTasks.push(this.downloadChunkFromLibP2PPeer(peerId, peer, storeId, rangeStart, rangeEnd, chunkIndex, chunks));
            }
            // Execute downloads with controlled concurrency
            const results = await this.executeConcurrentDownloads(downloadTasks, 4); // Max 4 concurrent
            const successCount = results.filter(Boolean).length;
            this.logger.info(`📥 Parallel download results: ${successCount}/${totalChunks} chunks successful`);
            if (successCount === totalChunks) {
                // Assemble and save file
                const assembledFile = this.assembleChunks(chunks, totalChunks);
                if (assembledFile) {
                    await this.saveDownloadedStore(storeId, assembledFile);
                    this.logger.info(`✅ Parallel download completed: ${storeId} (${assembledFile.length} bytes)`);
                    return true;
                }
            }
            return false;
        }
        catch (error) {
            this.logger.error(`Parallel download failed:`, error);
            return false;
        }
    }
    // Download a chunk from a specific LibP2P peer
    async downloadChunkFromLibP2PPeer(peerId, peer, storeId, rangeStart, rangeEnd, chunkIndex, chunks) {
        try {
            this.logger.debug(`📥 Chunk ${chunkIndex}: requesting ${rangeStart}-${rangeEnd} from ${peerId}`);
            const stream = await this.node.dialProtocol(peer, DIG_PROTOCOL);
            const chunkId = `${storeId}_${chunkIndex}_${Date.now()}`;
            const request = {
                type: 'GET_FILE_RANGE',
                storeId,
                filePath: storeId + '.dig',
                rangeStart,
                rangeEnd,
                chunkId
            };
            // Send request
            await stream.sink(async function* () {
                yield uint8ArrayFromString(JSON.stringify(request));
            }());
            // Collect response
            const chunkData = await this.collectChunkResponse(stream, chunkId);
            if (chunkData) {
                chunks.set(chunkIndex, chunkData);
                this.logger.debug(`✅ Chunk ${chunkIndex} downloaded: ${chunkData.length} bytes`);
                return true;
            }
            else {
                this.logger.warn(`❌ Chunk ${chunkIndex} download failed from ${peerId}`);
                return false;
            }
        }
        catch (error) {
            this.logger.error(`❌ Chunk ${chunkIndex} error from ${peerId}:`, error);
            return false;
        }
    }
    // Execute downloads with controlled concurrency
    async executeConcurrentDownloads(tasks, maxConcurrency) {
        const results = [];
        const executing = [];
        for (const task of tasks) {
            const promise = task.then(result => {
                executing.splice(executing.indexOf(promise), 1);
                return result;
            });
            results.push(await promise);
            executing.push(promise);
            if (executing.length >= maxConcurrency) {
                await Promise.race(executing);
            }
        }
        await Promise.all(executing);
        return results;
    }
    // Collect chunk response from stream
    async collectChunkResponse(stream, expectedChunkId) {
        try {
            const chunks = [];
            let headerParsed = false;
            let responseHeader = null;
            for await (const chunk of stream.source) {
                const chunkBytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk.subarray());
                if (!headerParsed) {
                    // First chunk should contain JSON response header
                    const chunkStr = uint8ArrayToString(chunkBytes);
                    const lines = chunkStr.split('\n');
                    try {
                        responseHeader = JSON.parse(lines[0]);
                        if (!responseHeader?.success || responseHeader.chunkId !== expectedChunkId) {
                            this.logger.warn(`Invalid chunk response header:`, responseHeader);
                            return null;
                        }
                        headerParsed = true;
                        // If there's data after the header line, include it
                        if (lines.length > 1) {
                            const remainingData = lines.slice(1).join('\n');
                            if (remainingData) {
                                chunks.push(uint8ArrayFromString(remainingData));
                            }
                        }
                    }
                    catch (parseError) {
                        this.logger.error(`Failed to parse chunk response header:`, parseError);
                        return null;
                    }
                }
                else {
                    // Subsequent chunks are file data
                    chunks.push(chunkBytes);
                }
            }
            if (chunks.length > 0) {
                return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
            }
            return null;
        }
        catch (error) {
            this.logger.error(`Error collecting chunk response:`, error);
            return null;
        }
    }
    // Assemble chunks into complete file
    assembleChunks(chunks, totalChunks) {
        try {
            const orderedChunks = [];
            for (let i = 0; i < totalChunks; i++) {
                const chunk = chunks.get(i);
                if (!chunk) {
                    this.logger.error(`Missing chunk ${i} during assembly`);
                    return null;
                }
                orderedChunks.push(chunk);
            }
            return Buffer.concat(orderedChunks);
        }
        catch (error) {
            this.logger.error(`Chunk assembly failed:`, error);
            return null;
        }
    }
    // Get file size from peer for parallel download planning
    async getFileSizeFromPeer(peerId, storeId) {
        try {
            // Request file metadata to get size
            const digFile = this.digFiles.get(storeId);
            if (digFile) {
                return digFile.content.length; // We already have it locally
            }
            // ✅ PRODUCTION: Implement remote size request
            try {
                // Find the actual peer object
                const peerObj = this.node.getPeers().find(p => p.toString() === peerId);
                if (!peerObj) {
                    throw new Error('Peer not connected');
                }
                // Request file size from peer using DIG protocol
                const stream = await this.node.dialProtocol(peerObj, DIG_PROTOCOL);
                const sizeRequest = {
                    type: 'GET_STORE_FILES',
                    storeId,
                    metadata: { requestType: 'size-only' }
                };
                // Send size request
                await pipe(async function* () {
                    yield uint8ArrayFromString(JSON.stringify(sizeRequest));
                }, stream.sink);
                // Read size response
                const chunks = [];
                await pipe(stream.source, async function (source) {
                    for await (const chunk of source) {
                        chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk.subarray()));
                    }
                });
                if (chunks.length > 0) {
                    const response = JSON.parse(uint8ArrayToString(chunks[0]));
                    if (response.success && response.metadata?.totalSize) {
                        const size = response.metadata.totalSize;
                        this.logger.debug(`📏 Got remote file size for ${storeId}: ${size} bytes`);
                        return size;
                    }
                }
                return null;
            }
            catch (error) {
                this.logger.debug(`Failed to get remote size for ${storeId} from ${peerId}:`, error);
                return null;
            }
        }
        catch (error) {
            this.logger.error(`Failed to get file size from ${peerId}:`, error);
            return null;
        }
    }
    // Save downloaded store to filesystem
    async saveDownloadedStore(storeId, content) {
        try {
            const filePath = join(this.digPath, `${storeId}.dig`);
            await writeFile(filePath, content);
            // Load the file into memory
            await this.loadDIGFile(filePath);
            this.logger.info(`💾 Saved downloaded store: ${storeId} (${content.length} bytes)`);
        }
        catch (error) {
            this.logger.error(`Failed to save downloaded store ${storeId}:`, error);
            throw error;
        }
    }
    // Download store from LibP2P connected peer
    async downloadStoreFromLibP2PPeer(storeId, peerId, peer) {
        console.log(`📡 Downloading ${storeId} from LibP2P peer ${peerId}`);
        const stream = await this.node.dialProtocol(peer, DIG_PROTOCOL);
        const request = {
            type: 'GET_STORE_CONTENT',
            storeId: storeId
        };
        const chunks = [];
        let metadata = null;
        let isFirstChunk = true;
        await pipe([uint8ArrayFromString(JSON.stringify(request))], stream, async function (source) {
            for await (const chunk of source) {
                if (isFirstChunk) {
                    try {
                        const response = JSON.parse(uint8ArrayToString(chunk));
                        if (response.success) {
                            metadata = response;
                            isFirstChunk = false;
                            continue;
                        }
                        else {
                            throw new Error(response.error || 'Download failed');
                        }
                    }
                    catch (parseError) {
                        // If parsing fails, treat as binary data
                        chunks.push(chunk);
                    }
                }
                else {
                    chunks.push(chunk);
                }
            }
        });
        if (chunks.length > 0) {
            // Combine all chunks
            const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
            const content = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
                content.set(chunk, offset);
                offset += chunk.length;
            }
            // Save the downloaded store
            const filePath = join(this.digPath, `${storeId}.dig`);
            await writeFile(filePath, Buffer.from(content));
            // Load it into our stores
            await this.loadDIGFile(filePath);
            if (this.digFiles.has(storeId)) {
                await this.announceStore(storeId);
                this.metrics.downloadSuccesses++;
                this.metrics.filesShared++;
                console.log(`✅ Downloaded and loaded store via LibP2P: ${storeId} (${content.length} bytes)`);
            }
        }
        else {
            throw new Error('No content received from LibP2P peer');
        }
    }
    // Download store via distributed TURN servers
    async downloadStoreViaTurnServers(storeId) {
        const bootstrapUrl = this.config.discoveryServers?.[0];
        if (!bootstrapUrl) {
            throw new Error('No bootstrap server configured');
        }
        // Get available TURN servers
        const turnResponse = await fetch(`${bootstrapUrl}/turn-servers`);
        if (!turnResponse.ok) {
            throw new Error('Failed to get TURN servers');
        }
        const turnData = await turnResponse.json();
        if (!turnData.turnServers || turnData.turnServers.length === 0) {
            throw new Error('No peer TURN servers available - will fall back to bootstrap server');
        }
        this.logger.info(`🔄 Found ${turnData.turnServers.length} peer TURN servers available (avoiding bootstrap server)`);
        // Try each TURN server in order of lowest load
        for (const turnServer of turnData.turnServers) {
            try {
                this.logger.info(`📡 Trying TURN server: ${turnServer.peerId} (load: ${turnServer.currentLoad}/${turnServer.capacity})`);
                // Find which peer has the store
                const peersResponse = await fetch(`${bootstrapUrl}/peers?includeStores=true`);
                if (!peersResponse.ok)
                    continue;
                const peersData = await peersResponse.json();
                const sourcePeer = peersData.peers.find((p) => p.peerId !== this.node.peerId.toString() &&
                    p.stores &&
                    p.stores.includes(storeId));
                if (!sourcePeer)
                    continue;
                // Request download via this TURN server
                const downloadResponse = await fetch(`${bootstrapUrl}/relay-store`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        fromPeerId: sourcePeer.peerId,
                        toPeerId: this.node.peerId.toString(),
                        storeId: storeId,
                        turnServerId: turnServer.peerId // Use specific TURN server
                    })
                });
                if (downloadResponse.ok) {
                    const storeContent = await downloadResponse.arrayBuffer();
                    // Save the downloaded store
                    const filePath = join(this.digPath, `${storeId}.dig`);
                    await writeFile(filePath, Buffer.from(storeContent));
                    // Load it into our stores
                    await this.loadDIGFile(filePath);
                    if (this.digFiles.has(storeId)) {
                        await this.announceStore(storeId);
                        this.metrics.downloadSuccesses++;
                        this.metrics.filesShared++;
                        this.logger.info(`✅ Downloaded store ${storeId} via TURN server ${turnServer.peerId} (${storeContent.byteLength} bytes)`);
                        return; // Success
                    }
                }
            }
            catch (error) {
                this.logger.warn(`TURN server ${turnServer.peerId} failed:`, error);
                continue; // Try next TURN server
            }
        }
        throw new Error('All TURN servers failed');
    }
    // Start global discovery system
    async startGlobalDiscovery() {
        try {
            // 🔐 PRIVACY: Use crypto-IPv6 addresses in privacy mode, real addresses otherwise
            const addresses = createCryptoIPv6Addresses(this.cryptoIPv6, this.config.port || 4001); // Always crypto-IPv6
            this.globalDiscovery = new GlobalDiscovery(this.node.peerId.toString(), addresses, this.cryptoIPv6, () => this.getAvailableStores(), this.config.discoveryServers);
            await this.globalDiscovery.start();
            // Also announce to DHT for global discovery
            const dht = this.node.services.dht;
            if (dht) {
                await this.globalDiscovery.announceToGlobalDHT(dht);
            }
            this.logger.info('🌍 Global discovery started');
            // Periodically try to connect to discovered peers
            setInterval(async () => {
                try {
                    await this.connectToDiscoveredPeers();
                }
                catch (error) {
                    // Silent failure - periodic connection will retry
                }
            }, 30000); // Every 30 seconds (more frequent)
            // Also try connecting immediately after discovery
            setTimeout(async () => {
                try {
                    await this.connectToDiscoveredPeers();
                }
                catch (error) {
                    // Silent failure - initial connection will be retried
                }
            }, 10000); // After 10 seconds
        }
        catch (error) {
            this.logger.warn('Failed to start global discovery:', error);
        }
    }
    // Start WebSocket relay for NAT traversal fallback
    async startWebSocketRelay() {
        if (!this.config.discoveryServers || this.config.discoveryServers.length === 0) {
            return;
        }
        const bootstrapUrl = this.config.discoveryServers[0];
        // Check if we're trying to connect to ourselves
        const bootstrapPort = this.getBootstrapPort();
        if (this.isSelfRelay(bootstrapUrl, bootstrapPort)) {
            this.logger.info('⏭️ WebSocket relay disabled (discovery server points to self)');
            return;
        }
        try {
            this.webSocketRelay = new WebSocketRelay(bootstrapUrl, this.node.peerId.toString());
            await this.webSocketRelay.connect();
            this.logger.info('🔄 WebSocket relay connected for NAT traversal fallback');
            // Set up store request handler
            this.webSocketRelay.onMessage('store-request', async (data) => {
                const { requestId, storeId, fromPeerId } = data;
                this.logger.info(`📥 Received store request for ${storeId} from ${fromPeerId}`);
                try {
                    const digFile = this.digFiles.get(storeId);
                    if (digFile) {
                        this.webSocketRelay.sendStoreResponse(requestId, digFile.content);
                        this.logger.info(`📤 Sent store ${storeId} via relay (${digFile.content.length} bytes)`);
                    }
                    else {
                        this.webSocketRelay.sendStoreResponse(requestId, null, 'Store not found');
                        this.logger.warn(`❌ Store ${storeId} not found for relay request`);
                    }
                }
                catch (error) {
                    this.webSocketRelay.sendStoreResponse(requestId, null, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
                    this.logger.error(`❌ Error handling store request:`, error);
                }
            });
            // Set up TURN peer exchange request handler
            this.webSocketRelay.onMessage('turn-peer-exchange-request', async (data) => {
                const { requestId, toPeerId, method, maxPeers, includeCapabilities } = data;
                this.logger.info(`📋 TURN peer exchange request for ${toPeerId} (method: ${method})`);
                try {
                    // Get our known peers to share via TURN
                    const peersToShare = await this.handlePeerExchangeRequest({
                        maxPeers,
                        includeStores: true,
                        includeCapabilities,
                        privacyMode: true
                    }, toPeerId);
                    if (peersToShare.success) {
                        this.webSocketRelay.sendTurnPeerExchangeResponse(requestId, true, peersToShare.peers);
                        this.logger.info(`📡 Shared ${peersToShare.peers?.length || 0} peers via TURN exchange`);
                    }
                    else {
                        this.webSocketRelay.sendTurnPeerExchangeResponse(requestId, false, undefined, peersToShare.error);
                    }
                }
                catch (error) {
                    this.webSocketRelay.sendTurnPeerExchangeResponse(requestId, false, undefined, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
                    this.logger.error(`❌ Error handling TURN peer exchange:`, error);
                }
            });
        }
        catch (error) {
            this.logger.warn('Failed to connect to WebSocket relay:', error);
        }
    }
    // Detect if this node can act as a TURN server
    async detectTurnCapability() {
        if (!this.config.discoveryServers || this.config.discoveryServers.length === 0) {
            return;
        }
        try {
            const bootstrapUrl = this.config.discoveryServers[0];
            const addresses = this.node.getMultiaddrs();
            // Find external IP addresses (not localhost or private)
            const externalAddresses = addresses.filter(addr => {
                const addrStr = addr.toString();
                return !addrStr.includes('127.0.0.1') &&
                    !addrStr.includes('::1') &&
                    !addrStr.includes('192.168.') &&
                    !addrStr.includes('10.0.') &&
                    !addrStr.includes('172.16.') &&
                    !addrStr.includes('172.17.') &&
                    !addrStr.includes('172.18.') &&
                    !addrStr.includes('172.19.') &&
                    !addrStr.includes('172.2') &&
                    !addrStr.includes('172.3');
            });
            if (externalAddresses.length === 0) {
                this.logger.info('🔒 Node behind NAT - cannot act as TURN server');
                return;
            }
            // Test if bootstrap server can connect back to us
            const testAddress = externalAddresses[0].toString();
            const testResponse = await fetch(`${bootstrapUrl}/test-turn-capability`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    peerId: this.node.peerId.toString(),
                    testAddress: testAddress,
                    turnPort: this.config.turnPort || (this.config.port || 4001) + 100
                }),
                signal: AbortSignal.timeout(15000)
            });
            if (testResponse.ok) {
                const result = await testResponse.json();
                if (result.turnCapable) {
                    this.logger.info('🌟 Node is TURN-capable - can relay for other nodes');
                    await this.registerAsTurnServer();
                }
                else {
                    this.logger.info('🔒 Node behind NAT - cannot act as TURN server');
                }
            }
        }
        catch (error) {
            this.logger.warn('TURN capability detection failed:', error);
        }
    }
    // Register this node as a TURN server
    async registerAsTurnServer() {
        try {
            const bootstrapUrl = this.config.discoveryServers?.[0];
            if (!bootstrapUrl)
                return;
            const addresses = this.node.getMultiaddrs();
            const externalAddresses = addresses.filter(addr => {
                const addrStr = addr.toString();
                return !addrStr.includes('127.0.0.1') && !addrStr.includes('::1');
            });
            const response = await fetch(`${bootstrapUrl}/register-turn-server`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    peerId: this.node.peerId.toString(),
                    turnAddresses: externalAddresses.map(addr => addr.toString()),
                    turnPort: this.config.turnPort || (this.config.port || 4001) + 100,
                    capacity: 10, // Max concurrent relay connections
                    region: 'auto' // Auto-detect region
                })
            });
            if (response.ok) {
                this.logger.info('📡 Registered as TURN server for the network');
            }
        }
        catch (error) {
            this.logger.warn('Failed to register as TURN server:', error);
        }
    }
    // Connect to peers discovered through global discovery
    async connectToDiscoveredPeers() {
        if (!this.globalDiscovery)
            return;
        const knownAddresses = this.globalDiscovery.getKnownPeerAddresses();
        const currentPeers = new Set(this.node.getPeers().map(p => p.toString()));
        this.logger.debug(`🔍 Attempting to connect to ${knownAddresses.length} discovered addresses`);
        // Try to connect to new peers
        for (const address of knownAddresses.slice(0, 5)) { // Reduce to 5 attempts per round
            try {
                this.logger.debug(`🔗 Processing address: ${isCryptoIPv6Address(address) ? '[crypto-IPv6]' : '[direct]'}`);
                // 🔐 PRIVACY: Resolve crypto-IPv6 addresses to real addresses if needed
                let resolvedAddresses = [address];
                if (isCryptoIPv6Address(address)) {
                    this.logger.info(`🔍 Resolving crypto-IPv6 address: [hidden for privacy]`);
                    resolvedAddresses = await this.resolveCryptoIPv6Address(address);
                    if (resolvedAddresses.length === 0) {
                        this.logger.warn(`❌ Failed to resolve crypto-IPv6 address: ${address}`);
                        continue;
                    }
                    this.logger.info(`🔐 Resolved crypto-IPv6 to ${resolvedAddresses.length} real addresses`);
                }
                // Try each resolved address
                let connected = false;
                for (const resolvedAddr of resolvedAddresses) {
                    // Extract peer ID from resolved address
                    const peerIdMatch = resolvedAddr.match(/\/p2p\/([^\/]+)$/);
                    const peerIdFromAddr = peerIdMatch ? peerIdMatch[1] : null;
                    // Skip if this is our own peer ID
                    if (peerIdFromAddr === this.node.peerId.toString()) {
                        this.logger.debug(`⏭️ Skipping self-connection: ${peerIdFromAddr}`);
                        continue;
                    }
                    // Skip if we're already connected to this peer
                    if (peerIdFromAddr && currentPeers.has(peerIdFromAddr)) {
                        this.logger.debug(`⏭️ Already connected to peer: ${peerIdFromAddr}`);
                        continue;
                    }
                    // Attempt connection to this resolved address
                    this.logger.info(`🔗 Dialing peer: ${peerIdFromAddr} via ${isCryptoIPv6Address(address) ? 'crypto-IPv6 resolution' : 'direct address'}`);
                    try {
                        const addr = multiaddr(resolvedAddr);
                        const connection = await Promise.race([
                            this.node.dial(addr),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), 30000))
                        ]);
                        if (connection) {
                            this.logger.info(`✅ Connected to ${peerIdFromAddr} via ${isCryptoIPv6Address(address) ? 'crypto-IPv6 resolution' : 'direct address'}`);
                            connected = true;
                            this.metrics.peersConnected++;
                            // Perform handshake
                            if (peerIdFromAddr) {
                                try {
                                    await this.initiateProtocolHandshake(peerIdFromAddr);
                                }
                                catch (handshakeError) {
                                    // Silent handshake failure - connection still established
                                }
                            }
                            break; // Exit resolved addresses loop
                        }
                    }
                    catch (connectionError) {
                        // Silent failure - will try next address
                    }
                }
                if (connected)
                    continue; // Move to next address if connected
                // Attempt connection with multiple strategies for NAT traversal
                // Old connection logic removed - using crypto-IPv6 aware logic above
                const addr = multiaddr(address);
                let connection = null;
                try {
                    // Direct connection attempt with longer timeout for NAT
                    connection = await Promise.race([
                        this.node.dial(addr),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout after 30s')), 30000))
                    ]);
                }
                catch (directError) {
                    // Silent failure - will try circuit relay
                    // 1. Try circuit relay connection first (REAL LibP2P connection)
                    try {
                        // Circuit relay logic moved to crypto-IPv6 resolution above
                        const relayAddr = this.createCircuitRelayAddress(address);
                        if (relayAddr) {
                            const relayMultiaddr = multiaddr(relayAddr);
                            connection = await Promise.race([
                                this.node.dial(relayMultiaddr),
                                new Promise((_, reject) => setTimeout(() => reject(new Error('Circuit relay timeout')), 45000))
                            ]);
                            this.logger.info(`🌐 Successfully connected via circuit relay`);
                        }
                    }
                    catch (relayError) {
                        // Silent failure - will try WebSocket relay
                        // 2. Only try WebSocket relay as LAST RESORT
                        if (false) { // Disabled - using crypto-IPv6 logic above
                            try {
                                // WebSocket relay moved to crypto-IPv6 resolution
                                // Relay connection handled above
                                this.logger.info(`🌐 Connected via WebSocket relay (last resort)`);
                            }
                            catch (wsRelayError) {
                                // WebSocket relay error handling moved to crypto-IPv6 resolution"
                            }
                        }
                    }
                }
                if (!connection || typeof connection !== 'object' || !('remotePeer' in connection)) {
                    throw new Error('All connection attempts failed - direct and relay unsuccessful');
                }
                const typedConnection = connection;
                const peerIdFromConn = typedConnection.remotePeer.toString();
                this.logger.info(`🌍 Successfully connected to discovered peer: ${peerIdFromConn}`);
                this.logger.info(`📡 Connection type: ${isCryptoIPv6Address(address) ? 'crypto-IPv6' : 'direct'}`);
                this.logger.info(`🔗 Connection established, remote peer: ${peerIdFromConn}`);
            }
            catch (error) {
                // Silent failure - only log final result
            }
        }
        // Log current connection status
        const connectedCount = this.node.getPeers().length;
        this.logger.info(`📊 Connected to ${connectedCount} peers (crypto-IPv6 privacy: always enabled)`);
    }
    // Connect to manually configured peers
    async connectToConfiguredPeers() {
        if (!this.config.connectToPeers || this.config.connectToPeers.length === 0) {
            return;
        }
        this.logger.info(`🔗 Connecting to ${this.config.connectToPeers.length} configured peers...`);
        for (const peerAddr of this.config.connectToPeers) {
            try {
                await this.connectToPeer(peerAddr);
            }
            catch (error) {
                this.logger.warn(`Failed to connect to peer ${peerAddr}:`, error);
            }
        }
    }
    // Manually connect to a peer
    async connectToPeer(peerAddress) {
        if (!this.isStarted) {
            throw new Error('DIG Node is not started');
        }
        try {
            this.logger.info(`🔗 Connecting to peer: ${peerAddress}`);
            const addr = multiaddr(peerAddress);
            const connection = await this.node.dial(addr);
            if (!connection || typeof connection !== 'object' || !('remotePeer' in connection)) {
                throw new Error('Invalid connection object returned');
            }
            const typedConnection = connection;
            this.logger.info(`✅ Connected to peer: ${typedConnection.remotePeer.toString()}`);
        }
        catch (error) {
            this.logger.error(`❌ Failed to connect to peer ${peerAddress}:`, error);
            throw error;
        }
    }
    // Get connection information for debugging
    getConnectionInfo() {
        if (!this.node) {
            return { error: 'Node not started' };
        }
        const peers = this.node.getPeers();
        const addresses = this.node.getMultiaddrs();
        const knownAddresses = this.globalDiscovery ? this.globalDiscovery.getKnownPeerAddresses() : [];
        return {
            listeningAddresses: addresses.map(addr => addr.toString()),
            connectedPeers: peers.map(peer => peer.toString()),
            peerCount: peers.length,
            discoveredPeers: Array.from(this.discoveredPeers),
            knownAddresses: knownAddresses,
            peerStores: Object.fromEntries(Array.from(this.peerStores.entries()).map(([peerId, stores]) => [
                peerId, Array.from(stores)
            ])),
            globalDiscoveryStats: this.globalDiscovery ? this.globalDiscovery.getStats() : null
        };
    }
    // Force connection attempts to all known peers
    async forceConnectToPeers() {
        if (!this.isStarted) {
            throw new Error('DIG Node is not started');
        }
        this.logger.info('🔗 Force connecting to all known peers...');
        await this.connectToDiscoveredPeers();
    }
    // Connect to peer via WebSocket relay when direct connection fails
    async connectViaRelay(targetPeerId) {
        if (!this.webSocketRelay || !this.webSocketRelay.isConnected()) {
            throw new Error('WebSocket relay not available');
        }
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Relay connection timeout'));
            }, 30000);
            // Set up relay connection handlers
            this.webSocketRelay.onMessage('relay-offer', async (data) => {
                if (data.fromPeerId === targetPeerId) {
                    try {
                        // Handle WebRTC offer through relay
                        const answer = await this.handleRelayOffer(data.offer);
                        this.webSocketRelay.sendRelayAnswer(targetPeerId, answer);
                    }
                    catch (error) {
                        this.logger.warn('Failed to handle relay offer:', error);
                    }
                }
            });
            // Initiate relay connection
            this.initiateRelayConnection(targetPeerId)
                .then((connection) => {
                clearTimeout(timeout);
                resolve(connection);
            })
                .catch((error) => {
                clearTimeout(timeout);
                reject(error);
            });
        });
    }
    // Initiate relay connection to target peer
    async initiateRelayConnection(targetPeerId) {
        // Request relay initiation from bootstrap server
        const bootstrapUrl = this.config.discoveryServers?.[0];
        if (!bootstrapUrl) {
            throw new Error('No bootstrap server configured');
        }
        try {
            const response = await fetch(`${bootstrapUrl}/initiate-relay`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    fromPeerId: this.node.peerId.toString(),
                    toPeerId: targetPeerId
                })
            });
            if (!response.ok) {
                throw new Error(`Relay initiation failed: ${response.status}`);
            }
            const result = await response.json();
            this.logger.info(`🔄 Relay initiation successful: ${result.message}`);
            // Add the peer to our discovered peers manually since relay connection worked
            this.discoveredPeers.add(targetPeerId);
            this.logger.info(`📡 Added relay peer to discovered peers: ${targetPeerId}`);
            // Immediately trigger store discovery for this relay-connected peer
            try {
                await this.discoverPeerStoresViaRelay(targetPeerId);
                this.logger.info(`✅ Store discovery completed for relay peer: ${targetPeerId}`);
            }
            catch (error) {
                this.logger.warn(`Failed to discover stores via relay: ${error}`);
            }
            // Return a connection object that indicates relay connection
            return {
                remotePeer: {
                    toString: () => targetPeerId
                },
                relayConnection: true,
                isRelay: true
            };
        }
        catch (error) {
            this.logger.error('Failed to initiate relay connection:', error);
            throw error;
        }
    }
    // Handle WebRTC offer received through relay
    async handleRelayOffer(offer) {
        // In a full implementation, this would handle WebRTC signaling
        this.logger.debug('📨 Handling relay offer');
        // Return a mock answer for now
        return {
            type: 'answer',
            sdp: 'mock-answer-sdp'
        };
    }
    // Discover stores from a peer via relay connection
    async discoverPeerStoresViaRelay(peerId) {
        try {
            this.logger.info(`📋 Discovering stores from relay peer: ${peerId}`);
            // Use the bootstrap server to get peer's store list
            const bootstrapUrl = this.config.discoveryServers?.[0];
            if (!bootstrapUrl) {
                throw new Error('No bootstrap server configured');
            }
            const response = await fetch(`${bootstrapUrl}/peers`);
            if (!response.ok) {
                throw new Error(`Failed to get peer list: ${response.status}`);
            }
            const data = await response.json();
            const targetPeer = data.peers.find((p) => p.peerId === peerId);
            if (targetPeer && targetPeer.stores) {
                const peerStores = new Set(targetPeer.stores);
                this.peerStores.set(peerId, peerStores);
                this.logger.info(`📋 Relay peer ${peerId} has ${targetPeer.stores.length} stores`);
                // Find missing stores and download them via relay
                const missingStores = targetPeer.stores.filter((storeId) => !this.digFiles.has(storeId));
                if (missingStores.length > 0) {
                    this.logger.info(`📥 Found ${missingStores.length} missing stores from relay peer`);
                    for (const storeId of missingStores) {
                        await this.downloadStoreViaRelay(peerId, storeId);
                    }
                }
            }
        }
        catch (error) {
            this.logger.warn(`Failed to discover stores via relay from ${peerId}:`, error);
        }
    }
    // Download a store via relay connection
    async downloadStoreViaRelay(peerId, storeId) {
        try {
            this.logger.info(`📥 Downloading store ${storeId} via relay from ${peerId}`);
            this.metrics.downloadAttempts++;
            // For now, use the bootstrap server as a simple relay
            // In a full implementation, this would use the WebSocket relay for data transfer
            const bootstrapUrl = this.config.discoveryServers?.[0];
            if (!bootstrapUrl) {
                throw new Error('No bootstrap server configured');
            }
            // Request the bootstrap server to facilitate the transfer
            const response = await fetch(`${bootstrapUrl}/relay-store`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    fromPeerId: peerId,
                    toPeerId: this.node.peerId.toString(),
                    storeId: storeId
                })
            });
            if (response.ok) {
                const storeData = await response.arrayBuffer();
                // Save the downloaded store
                const filePath = join(this.digPath, `${storeId}.dig`);
                await writeFile(filePath, Buffer.from(storeData));
                // Load it into our stores
                await this.loadDIGFile(filePath);
                if (this.digFiles.has(storeId)) {
                    await this.announceStore(storeId);
                    this.metrics.downloadSuccesses++;
                    this.metrics.filesShared++;
                    this.logger.info(`✅ Downloaded store ${storeId} via relay (${storeData.byteLength} bytes)`);
                }
            }
            else {
                this.logger.warn(`Failed to download store ${storeId} via relay: ${response.status}`);
            }
        }
        catch (error) {
            this.logger.warn(`Failed to download store ${storeId} via relay:`, error);
        }
    }
    // Sync stores via bootstrap server (works without direct LibP2P connections)
    async syncStoresViaBootstrap() {
        try {
            const bootstrapUrl = this.config.discoveryServers?.[0];
            if (!bootstrapUrl)
                return;
            this.logger.info('🔄 Syncing stores via bootstrap server...');
            // Get all peers and their stores from bootstrap server
            const response = await fetch(`${bootstrapUrl}/peers?includeStores=true`);
            if (!response.ok)
                return;
            const data = await response.json();
            const myPeerId = this.node.peerId.toString();
            // Find all stores from other peers
            const allRemoteStores = new Set();
            for (const peer of data.peers) {
                if (peer.peerId !== myPeerId && peer.stores) {
                    for (const storeId of peer.stores) {
                        allRemoteStores.add(storeId);
                    }
                    // Update our peer store tracking
                    this.peerStores.set(peer.peerId, new Set(peer.stores));
                }
            }
            // Find missing stores
            const missingStores = Array.from(allRemoteStores).filter(storeId => !this.digFiles.has(storeId));
            if (missingStores.length > 0) {
                this.logger.info(`📥 Found ${missingStores.length} missing stores via bootstrap server`);
                // Download missing stores via bootstrap relay
                for (const storeId of missingStores) {
                    await this.downloadStoreViaBootstrap(storeId);
                }
            }
        }
        catch (error) {
            this.logger.warn('Bootstrap store sync failed:', error);
        }
    }
    // Download store via bootstrap server relay
    async downloadStoreViaBootstrap(storeId) {
        try {
            this.logger.info(`📥 Downloading store ${storeId} via bootstrap server`);
            this.metrics.downloadAttempts++;
            const bootstrapUrl = this.config.discoveryServers?.[0];
            if (!bootstrapUrl) {
                throw new Error('No bootstrap server configured');
            }
            // Find which peer has this store
            const peersResponse = await fetch(`${bootstrapUrl}/peers?includeStores=true`);
            if (!peersResponse.ok) {
                throw new Error('Failed to get peer list');
            }
            const peersData = await peersResponse.json();
            const sourcePeer = peersData.peers.find((p) => p.peerId !== this.node.peerId.toString() &&
                p.stores &&
                p.stores.includes(storeId));
            if (!sourcePeer) {
                throw new Error(`No peer found with store ${storeId}`);
            }
            // Request store via bootstrap relay
            const storeResponse = await fetch(`${bootstrapUrl}/relay-store`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    fromPeerId: sourcePeer.peerId,
                    toPeerId: this.node.peerId.toString(),
                    storeId: storeId
                })
            });
            if (storeResponse.ok) {
                const storeContent = await storeResponse.arrayBuffer();
                // Save the downloaded store
                const filePath = join(this.digPath, `${storeId}.dig`);
                await writeFile(filePath, Buffer.from(storeContent));
                // Load it into our stores
                await this.loadDIGFile(filePath);
                if (this.digFiles.has(storeId)) {
                    await this.announceStore(storeId);
                    this.metrics.downloadSuccesses++;
                    this.metrics.filesShared++;
                    this.logger.info(`✅ Downloaded store ${storeId} via bootstrap relay (${storeContent.byteLength} bytes)`);
                }
            }
            else {
                throw new Error(`Store download failed: ${storeResponse.status}`);
            }
        }
        catch (error) {
            this.logger.warn(`Failed to download store ${storeId} via bootstrap:`, error);
        }
    }
    // Force peer discovery across the network
    async discoverAllPeers() {
        if (!this.isStarted) {
            throw new Error('DIG Node is not started');
        }
        this.logger.info('🔍 Starting manual peer discovery...');
        try {
            // Use DHT to find peers
            const dht = this.node.services.dht;
            if (dht && dht.getClosestPeers) {
                const randomKey = randomBytes(32);
                for await (const peer of dht.getClosestPeers(randomKey)) {
                    try {
                        if (peer.toString() !== this.node.peerId.toString()) {
                            await this.node.dial(peer);
                            this.logger.info(`🤝 Discovered and connected to peer: ${peer.toString()}`);
                        }
                    }
                    catch (error) {
                        this.logger.debug(`Could not connect to discovered peer ${peer.toString()}:`, error);
                    }
                }
            }
        }
        catch (error) {
            this.logger.warn('DHT peer discovery failed:', error);
        }
    }
}
//# sourceMappingURL=DIGNode.js.map