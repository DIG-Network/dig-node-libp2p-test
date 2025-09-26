/**
 * Consolidated DIG Node Implementation
 *
 * Combines the best of both DIGNode.ts and CleanDIGNode.ts:
 * - Clean architecture from CleanDIGNode
 * - Full functionality from DIGNode
 * - Dual-role peer system (direct + TURN)
 * - Comprehensive NAT traversal
 * - Intelligent download orchestration
 */
import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { kadDHT } from '@libp2p/kad-dht';
import { bootstrap } from '@libp2p/bootstrap';
import { mdns } from '@libp2p/mdns';
import { ping } from '@libp2p/ping';
import { identify } from '@libp2p/identify';
import { uPnPNAT } from '@libp2p/upnp-nat';
import { autoNAT } from '@libp2p/autonat';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { webRTC } from '@libp2p/webrtc';
import { webSockets } from '@libp2p/websockets';
import { all } from '@libp2p/websockets/filters';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { pipe } from 'it-pipe';
import { multiaddr } from '@multiformats/multiaddr';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { randomBytes } from 'crypto';
import { readFile, readdir, stat, watch, writeFile } from 'fs/promises';
import { join, basename } from 'path';
import { homedir } from 'os';
import { DIG_PROTOCOL, DIG_DISCOVERY_PROTOCOL } from './types.js';
import { generateCryptoIPv6 } from './utils.js';
import { Logger } from './logger.js';
import { DIGOnlyPeerDiscovery } from './DIGOnlyPeerDiscovery.js';
import { LocalNetworkDiscovery } from './LocalNetworkDiscovery.js';
import { UnifiedTurnCoordination } from './UnifiedTurnCoordination.js';
import { PeerConnectionCapabilities } from './PeerConnectionCapabilities.js';
import { ComprehensiveNATTraversal } from './ComprehensiveNATTraversal.js';
import { IntelligentDownloadOrchestrator } from './IntelligentDownloadOrchestrator.js';
import { UPnPPortManager } from './UPnPPortManager.js';
import { PublicTurnServerFallback } from './PublicTurnServerFallback.js';
import { PortManager } from './PortManager.js';
import { WebSocketRelay } from './WebSocketRelay.js';
import { E2EEncryption } from './E2EEncryption.js';
import { ZeroKnowledgePrivacy } from './ZeroKnowledgePrivacy.js';
import { DownloadManager } from './DownloadManager.js';
export class DIGNode {
    constructor(config = {}) {
        this.config = config;
        this.digFiles = new Map();
        this.watcher = null;
        this.isStarted = false;
        this.logger = new Logger('DIGNode');
        this.startTime = 0;
        this.portManager = new PortManager();
        this.e2eEncryption = new E2EEncryption();
        // Node state
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
            e2eEncryption: true,
            protocolVersion: '1.0.0',
            environment: 'development'
        };
        this.metrics = {
            filesLoaded: 0,
            peersConnected: 0,
            downloadSuccesses: 0,
            errors: 0
        };
        this.validateConfig(config);
        this.digPath = config.digPath || join(homedir(), '.dig');
        this.detectEnvironment();
    }
    // Start the consolidated DIG node
    async start() {
        if (this.isStarted) {
            throw new Error('DIG Node is already started');
        }
        try {
            this.startTime = Date.now();
            this.logger.info('🚀 Starting Consolidated DIG Node with Dual-Role Peer System...');
            // Generate crypto-IPv6 identity
            const publicKey = this.config.publicKey || randomBytes(32).toString('hex');
            this.cryptoIPv6 = generateCryptoIPv6(publicKey);
            this.logger.info(`🔐 Crypto-IPv6: ${this.cryptoIPv6}`);
            // Ensure DIG directory
            const hasFileAccess = await this.ensureDigDirectory();
            // Initialize LibP2P with comprehensive NAT traversal
            await this.initializeLibP2PWithNATTraversal();
            // Initialize intelligent subsystems
            await this.initializeIntelligentSubsystems();
            // Start core services
            await this.startCoreServices(hasFileAccess);
            this.isStarted = true;
            this.logger.info('✅ Consolidated DIG Node started successfully');
            this.logStartupSummary();
        }
        catch (error) {
            this.logger.error('Failed to start DIG Node:', error);
            await this.cleanup();
            throw error;
        }
    }
    // Initialize LibP2P with comprehensive NAT traversal support
    async initializeLibP2PWithNATTraversal() {
        const isAWS = process.env.AWS_DEPLOYMENT === 'true';
        // Use port manager to avoid conflicts
        const preferredPort = this.config.port || 4001;
        const { addresses, mainPort, wsPort } = await this.portManager.generateLibP2PAddressConfig(preferredPort, isAWS);
        this.logger.info(`🔧 Using ports: LibP2P=${mainPort}, WebSocket=${wsPort}`);
        // Essential services
        const services = {
            ping: ping(),
            identify: identify(),
            dht: kadDHT({ clientMode: false }),
            gossipsub: gossipsub({ emitSelf: false })
        };
        // Add NAT traversal services with graceful degradation
        if (!isAWS) {
            try {
                services.upnp = uPnPNAT();
                this.nodeCapabilities.upnp = true;
                this.logger.info('✅ UPnP NAT traversal enabled');
            }
            catch (error) {
                this.logger.warn('⚠️ UPnP disabled:', error);
            }
            try {
                services.autonat = autoNAT();
                this.nodeCapabilities.autonat = true;
                this.logger.info('✅ AutoNAT detection enabled');
            }
            catch (error) {
                this.logger.warn('⚠️ AutoNAT disabled:', error);
            }
        }
        // Initialize public TURN fallback
        this.publicTurnFallback = new PublicTurnServerFallback(this);
        // Transport configuration with NAT traversal and public TURN fallback
        const transports = [tcp(), webSockets({ filter: all })];
        // Add WebRTC for NAT traversal with public TURN servers (non-AWS only)
        if (!isAWS) {
            try {
                // Get public TURN servers for WebRTC ICE configuration
                const publicTurnConfig = this.publicTurnFallback.getRecommendedIceConfiguration();
                transports.push(webRTC({
                    rtcConfiguration: publicTurnConfig
                }));
                this.nodeCapabilities.webrtc = true;
                this.logger.info('✅ WebRTC NAT traversal enabled with public TURN fallback');
            }
            catch (error) {
                this.logger.warn('⚠️ WebRTC disabled:', error);
            }
        }
        // Add Circuit Relay transport
        try {
            transports.push(circuitRelayTransport());
            this.nodeCapabilities.circuitRelay = true;
            this.logger.info('✅ Circuit Relay transport enabled');
        }
        catch (error) {
            this.logger.warn('⚠️ Circuit Relay disabled:', error);
        }
        // Peer discovery configuration - use public LibP2P bootstrap servers
        const peerDiscovery = [];
        // Always use public LibP2P bootstrap servers for global connectivity
        const publicBootstrapServers = [
            '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
            '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
            '/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ',
            '/ip4/147.75.77.187/tcp/4001/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa'
        ];
        peerDiscovery.push(bootstrap({ list: publicBootstrapServers }));
        this.logger.info(`🌐 Using ${publicBootstrapServers.length} public LibP2P bootstrap servers`);
        // Add custom DIG bootstrap servers if provided
        if (this.config.bootstrapPeers && this.config.bootstrapPeers.length > 0) {
            peerDiscovery.push(bootstrap({ list: this.config.bootstrapPeers }));
            this.logger.info(`🎯 Also using ${this.config.bootstrapPeers.length} custom DIG bootstrap servers`);
        }
        if (this.config.enableMdns !== false && !isAWS) {
            peerDiscovery.push(mdns());
            this.nodeCapabilities.mdns = true;
        }
        // Create LibP2P node
        this.node = await createLibp2p({
            addresses,
            transports,
            connectionEncrypters: [noise()], // Mandatory encryption
            streamMuxers: [yamux()],
            peerDiscovery,
            services,
            connectionManager: {
                maxConnections: 100,
                dialTimeout: 60000, // Longer timeout for NAT traversal
                maxParallelDials: 10
            }
        });
        // Set up protocol handlers
        await this.node.handle(DIG_PROTOCOL, this.handleDIGRequest.bind(this));
        await this.node.handle(DIG_DISCOVERY_PROTOCOL, this.handleDiscoveryRequest.bind(this));
        this.nodeCapabilities.libp2p = true;
        this.nodeCapabilities.dht = true;
        this.nodeCapabilities.websockets = true;
        this.logger.info('✅ LibP2P initialized with comprehensive NAT traversal');
    }
    // Initialize intelligent subsystems
    async initializeIntelligentSubsystems() {
        // Initialize zero-knowledge privacy
        this.zkPrivacy = new ZeroKnowledgePrivacy(this.node.peerId.toString());
        // Initialize DIG-only subsystems
        this.peerDiscovery = new DIGOnlyPeerDiscovery(this);
        this.localNetworkDiscovery = new LocalNetworkDiscovery(this);
        this.turnCoordination = new UnifiedTurnCoordination(this);
        this.peerCapabilities = new PeerConnectionCapabilities(this);
        this.natTraversal = new ComprehensiveNATTraversal(this);
        this.downloadOrchestrator = new IntelligentDownloadOrchestrator(this);
        this.upnpPortManager = new UPnPPortManager(this);
        this.downloadManager = new DownloadManager(this.digPath, this);
        this.logger.info('✅ Intelligent subsystems initialized');
    }
    // Start core services
    async startCoreServices(hasFileAccess) {
        // Load existing stores if file access available
        if (hasFileAccess) {
            await this.scanDIGFiles();
            await this.announceStores();
            await this.startFileWatcher();
            this.nodeCapabilities.storeSync = true;
        }
        // Start intelligent subsystems
        await this.safeServiceInit('UPnP Port Manager', () => this.upnpPortManager.initialize());
        await this.safeServiceInit('Local Network Discovery', () => this.localNetworkDiscovery.start());
        await this.safeServiceInit('DIG-Only Peer Discovery', () => this.peerDiscovery.start());
        await this.safeServiceInit('TURN Coordination', () => this.turnCoordination.start());
        await this.safeServiceInit('Connection Capabilities', () => this.peerCapabilities.initialize());
        await this.safeServiceInit('Download Orchestrator', () => this.downloadOrchestrator.initialize());
        // Start WebSocket relay only if custom discovery servers are configured
        // (Public bootstrap doesn't need WebSocket relay)
        if (this.config.discoveryServers && this.config.discoveryServers.length > 0) {
            await this.safeServiceInit('WebSocket Relay', () => this.startWebSocketRelay());
            this.logger.info('🔄 Using custom discovery servers with WebSocket relay');
        }
        else {
            this.logger.info('🌐 Using public LibP2P bootstrap only (no WebSocket relay needed)');
        }
        // Resume incomplete downloads
        if (hasFileAccess) {
            await this.downloadManager.resumeIncompleteDownloads();
        }
        // Start peer discovery and sync
        this.startPeerEventHandling();
        this.startStoreSync();
        this.logger.info('✅ All core services started');
    }
    // Safely initialize services with error handling
    async safeServiceInit(serviceName, initFunction) {
        try {
            await initFunction();
            this.logger.info(`✅ ${serviceName} started`);
        }
        catch (error) {
            this.logger.warn(`⚠️ ${serviceName} failed to start:`, error);
        }
    }
    // Handle DIG protocol requests
    async handleDIGRequest({ stream }) {
        const self = this;
        try {
            await pipe(stream, async function* (source) {
                for await (const chunk of source) {
                    const request = JSON.parse(uint8ArrayToString(chunk.subarray()));
                    // Handle different request types
                    if (request.type === 'GET_STORE_CONTENT') {
                        yield* self.serveStore(request.storeId);
                    }
                    else if (request.type === 'GET_FILE_RANGE') {
                        yield* self.serveFileRange(request.storeId, request.rangeStart, request.rangeEnd, request.chunkId);
                    }
                    else if (request.type === 'HANDSHAKE') {
                        const handshakeResponse = await self.handleHandshake(request);
                        yield uint8ArrayFromString(JSON.stringify(handshakeResponse));
                    }
                    else if (request.type === 'DIG_NETWORK_IDENTIFICATION') {
                        const identResponse = self.handleDIGNetworkIdentification(request);
                        yield uint8ArrayFromString(JSON.stringify(identResponse));
                    }
                    else if (request.type === 'VERIFY_DIG_MEMBERSHIP') {
                        const verifyResponse = self.handleDIGMembershipVerification(request);
                        yield uint8ArrayFromString(JSON.stringify(verifyResponse));
                    }
                    else if (request.type === 'GET_PEER_INFO') {
                        const peerInfoResponse = self.handleGetPeerInfo(request);
                        yield uint8ArrayFromString(JSON.stringify(peerInfoResponse));
                    }
                    break;
                }
            }, stream);
        }
        catch (error) {
            this.logger.error('DIG request handling failed:', error);
        }
    }
    // Handle discovery protocol requests
    async handleDiscoveryRequest({ stream }) {
        const self = this;
        try {
            await pipe(stream, async function* (source) {
                for await (const chunk of source) {
                    const request = JSON.parse(uint8ArrayToString(chunk.subarray()));
                    if (request.type === 'LIST_STORES') {
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
            this.logger.error('Discovery request handling failed:', error);
        }
    }
    // Serve store content
    async *serveStore(storeId) {
        const digFile = this.digFiles.get(storeId);
        if (!digFile) {
            const response = { success: false, error: 'Store not found' };
            yield uint8ArrayFromString(JSON.stringify(response));
            return;
        }
        try {
            const response = {
                success: true,
                size: digFile.content.length,
                mimeType: digFile.metadata.mimeType
            };
            yield uint8ArrayFromString(JSON.stringify(response) + '\n');
            // Send file content in chunks
            const CHUNK_SIZE = 64 * 1024;
            for (let i = 0; i < digFile.content.length; i += CHUNK_SIZE) {
                yield digFile.content.subarray(i, i + CHUNK_SIZE);
            }
        }
        catch (error) {
            const response = { success: false, error: 'Failed to serve store' };
            yield uint8ArrayFromString(JSON.stringify(response));
        }
    }
    // Serve file range for parallel downloads
    async *serveFileRange(storeId, rangeStart, rangeEnd, chunkId) {
        const digFile = this.digFiles.get(storeId);
        if (!digFile) {
            const response = { success: false, error: 'Store not found', chunkId };
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
            yield uint8ArrayFromString(JSON.stringify(response) + '\n');
            // Send range content
            const CHUNK_SIZE = 64 * 1024;
            for (let i = 0; i < rangeContent.length; i += CHUNK_SIZE) {
                const chunk = rangeContent.subarray(i, Math.min(i + CHUNK_SIZE, rangeContent.length));
                yield chunk;
            }
        }
        catch (error) {
            const response = { success: false, error: 'Failed to serve range', chunkId };
            yield uint8ArrayFromString(JSON.stringify(response));
        }
    }
    // Handle protocol handshake
    async handleHandshake(request) {
        try {
            // Establish shared secret if public key provided
            if (request.publicKey) {
                this.e2eEncryption.establishSharedSecret('temp-peer', request.publicKey);
            }
            return {
                success: true,
                protocolVersion: this.nodeCapabilities.protocolVersion,
                supportedFeatures: E2EEncryption.getProtocolCapabilities(),
                publicKey: this.e2eEncryption.getPublicKey(),
                metadata: {
                    nodeCapabilities: this.nodeCapabilities,
                    storeCount: this.digFiles.size,
                    acceptsDirectConnections: this.peerCapabilities?.peerAcceptsDirectConnections(this.node.peerId.toString()) || false
                }
            };
        }
        catch (error) {
            return {
                success: false,
                error: `Handshake failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }
    // Handle DIG network identification requests
    handleDIGNetworkIdentification(request) {
        this.logger.info(`🔍 DIG network identification request from peer`);
        return {
            success: true,
            networkId: 'dig-mainnet',
            isDIGNode: true,
            protocolVersion: '1.0.0',
            timestamp: Date.now()
        };
    }
    // Handle DIG membership verification requests
    handleDIGMembershipVerification(request) {
        this.logger.info(`🔐 DIG membership verification request`);
        return {
            success: true,
            networkId: 'dig-mainnet',
            cryptoIPv6: this.cryptoIPv6,
            capabilities: this.nodeCapabilities,
            stores: this.getAvailableStores(),
            timestamp: Date.now()
        };
    }
    // Handle get peer info requests
    handleGetPeerInfo(request) {
        this.logger.info(`📋 Peer info request: ${request.requestedInfo?.join(', ') || 'all'}`);
        const response = {
            success: true,
            peerId: this.node.peerId.toString(),
            timestamp: Date.now()
        };
        const requestedInfo = request.requestedInfo || [];
        if (requestedInfo.includes('stores') || requestedInfo.length === 0) {
            response.stores = this.getAvailableStores();
        }
        if (requestedInfo.includes('capabilities') || requestedInfo.length === 0) {
            response.capabilities = this.nodeCapabilities;
        }
        if (requestedInfo.includes('cryptoIPv6') || requestedInfo.length === 0) {
            response.cryptoIPv6 = this.cryptoIPv6;
        }
        if (requestedInfo.includes('nodeType') || requestedInfo.length === 0) {
            response.nodeType = 'full';
        }
        return response;
    }
    // Get connection capabilities response
    getConnectionCapabilitiesResponse() {
        return {
            success: true,
            metadata: {
                acceptsDirectConnections: this.peerCapabilities?.peerAcceptsDirectConnections(this.node.peerId.toString()) || false,
                canActAsTurnServer: this.peerCapabilities?.peerCanActAsTurnServer(this.node.peerId.toString()) || false,
                natTraversalMethods: this.nodeCapabilities.upnp ? ['upnp'] : [],
                connectionTypes: ['tcp', 'websocket'],
                testResults: this.nodeCapabilities
            }
        };
    }
    // Start WebSocket relay for bootstrap communication
    async startWebSocketRelay() {
        const bootstrapUrl = this.config.discoveryServers?.[0];
        if (!bootstrapUrl)
            return;
        try {
            this.webSocketRelay = new WebSocketRelay(bootstrapUrl, this.node.peerId.toString());
            await this.webSocketRelay.connect();
            this.logger.info('🔄 WebSocket relay connected');
        }
        catch (error) {
            this.logger.warn('WebSocket relay failed:', error);
        }
    }
    // Start peer event handling with security awareness
    startPeerEventHandling() {
        this.node.addEventListener('peer:connect', (event) => {
            try {
                const peerId = event.detail?.toString();
                if (peerId) {
                    this.metrics.peersConnected++;
                    this.logger.info(`🤝 Connected to peer: ${peerId}`);
                }
            }
            catch (error) {
                this.logger.debug('Peer connect event error:', error);
            }
        });
        this.node.addEventListener('peer:disconnect', (event) => {
            try {
                const peerId = event.detail?.toString();
                if (peerId) {
                    this.logger.info(`👋 Disconnected from peer: ${peerId}`);
                    // Note: DIG-only discovery automatically handles peer cleanup
                }
            }
            catch (error) {
                this.logger.debug('Peer disconnect event error:', error);
            }
        });
    }
    // Start store synchronization
    startStoreSync() {
        // Initial sync after 5 seconds
        setTimeout(() => this.syncStores(), 5000);
        // Periodic sync every 30 seconds
        setInterval(() => {
            this.syncStores().catch(error => {
                this.logger.error('Store sync error:', error);
            });
        }, 30000);
    }
    // Synchronize stores using intelligent download orchestrator
    async syncStores() {
        try {
            // Get stores we don't have from DIG peers
            const digPeers = this.peerDiscovery?.getDIGPeers() || [];
            const allRemoteStores = new Set();
            for (const peer of digPeers) {
                for (const storeId of peer.stores) {
                    if (!this.digFiles.has(storeId)) {
                        allRemoteStores.add(storeId);
                    }
                }
            }
            if (allRemoteStores.size > 0) {
                this.logger.info(`📥 Syncing ${allRemoteStores.size} missing stores`);
                for (const storeId of Array.from(allRemoteStores).slice(0, 5)) { // Limit concurrent downloads
                    try {
                        const downloadResult = await this.downloadOrchestrator.downloadStore(storeId);
                        if (downloadResult.success && downloadResult.data) {
                            await this.saveDownloadedStore(storeId, downloadResult.data);
                            this.logger.info(`✅ Synced store: ${storeId} via ${downloadResult.strategy}`);
                        }
                    }
                    catch (error) {
                        this.logger.debug(`Failed to sync store ${storeId}:`, error);
                    }
                }
            }
        }
        catch (error) {
            this.logger.error('Store sync failed:', error);
        }
    }
    // File management methods
    async ensureDigDirectory() {
        try {
            await import('fs/promises').then(fs => fs.access(this.digPath));
            return true;
        }
        catch {
            try {
                await import('fs/promises').then(fs => fs.mkdir(this.digPath, { recursive: true }));
                this.logger.info(`📁 Created DIG directory: ${this.digPath}`);
                return true;
            }
            catch (error) {
                this.logger.warn('Cannot create DIG directory - file operations disabled:', error);
                return false;
            }
        }
    }
    async scanDIGFiles() {
        try {
            const files = await readdir(this.digPath);
            for (const file of files) {
                if (file.endsWith('.dig')) {
                    await this.loadDIGFile(join(this.digPath, file));
                }
            }
            this.logger.info(`📁 Loaded ${this.digFiles.size} stores`);
        }
        catch (error) {
            this.logger.warn('Failed to scan DIG files:', error);
        }
    }
    async loadDIGFile(filePath) {
        try {
            const storeId = basename(filePath, '.dig');
            const content = await readFile(filePath);
            const stats = await stat(filePath);
            this.digFiles.set(storeId, {
                storeId,
                filePath,
                content,
                metadata: {
                    name: storeId,
                    size: content.length,
                    created: stats.birthtime.toISOString(),
                    mimeType: 'application/x-dig-archive'
                }
            });
            this.metrics.filesLoaded++;
        }
        catch (error) {
            this.logger.error(`Failed to load ${filePath}:`, error);
            this.metrics.errors++;
        }
    }
    async announceStores() {
        for (const storeId of this.digFiles.keys()) {
            await this.announceStore(storeId);
        }
    }
    async announceStore(storeId) {
        try {
            const dht = this.node.services.dht;
            if (dht) {
                const key = uint8ArrayFromString(`/dig-store/${storeId}`);
                const value = uint8ArrayFromString(JSON.stringify({
                    peerId: this.node.peerId.toString(),
                    cryptoIPv6: this.cryptoIPv6,
                    timestamp: Date.now()
                }));
                await dht.put(key, value);
            }
        }
        catch (error) {
            this.logger.debug(`Failed to announce store ${storeId}:`, error);
        }
    }
    async startFileWatcher() {
        try {
            this.watcher = watch(this.digPath, { recursive: false });
            // Run watcher in background
            this.runFileWatcher();
        }
        catch (error) {
            this.logger.warn('File watcher disabled:', error);
        }
    }
    async runFileWatcher() {
        try {
            for await (const event of this.watcher) {
                if (event.filename && event.filename.endsWith('.dig')) {
                    const filePath = join(this.digPath, event.filename);
                    const storeId = basename(event.filename, '.dig');
                    try {
                        await stat(filePath);
                        await this.loadDIGFile(filePath);
                        await this.announceStore(storeId);
                        this.logger.info(`📁 Updated store: ${storeId}`);
                    }
                    catch (statError) {
                        this.digFiles.delete(storeId);
                        this.logger.info(`📁 Removed store: ${storeId}`);
                    }
                }
            }
        }
        catch (error) {
            this.logger.warn('File watcher error:', error);
        }
    }
    async saveDownloadedStore(storeId, content) {
        try {
            const filePath = join(this.digPath, `${storeId}.dig`);
            await writeFile(filePath, content);
            await this.loadDIGFile(filePath);
            await this.announceStore(storeId);
            this.metrics.downloadSuccesses++;
        }
        catch (error) {
            this.logger.error(`Failed to save store ${storeId}:`, error);
            throw error;
        }
    }
    // Utility methods
    validateConfig(config) {
        if (config.port && (config.port < 1 || config.port > 65535)) {
            throw new Error('Port must be between 1 and 65535');
        }
    }
    detectEnvironment() {
        const isAWS = process.env.AWS_DEPLOYMENT === 'true';
        this.nodeCapabilities.environment = isAWS ? 'aws' :
            (process.env.NODE_ENV === 'production' ? 'production' : 'development');
    }
    logStartupSummary() {
        const capabilities = Object.entries(this.nodeCapabilities)
            .filter(([_, value]) => value === true)
            .map(([key]) => key);
        console.log('📊 Consolidated DIG Node Summary:');
        console.log(`   🆔 Peer ID: ${this.node.peerId.toString()}`);
        console.log(`   🔐 Crypto-IPv6: ${this.cryptoIPv6}`);
        console.log(`   📁 Stores: ${this.digFiles.size}`);
        console.log(`   🔧 Capabilities: ${capabilities.join(', ')}`);
        console.log(`   🌍 Environment: ${this.nodeCapabilities.environment}`);
        console.log(`   🎯 Architecture: Dual-Role Peer System`);
        console.log(`   📡 NAT Traversal: Comprehensive (8 methods)`);
        console.log(`   🔒 Privacy: Mandatory (Crypto-IPv6 + E2E + ZK)`);
    }
    // Public API
    getNode() { return this.node; }
    getCryptoIPv6() { return this.cryptoIPv6; }
    getAvailableStores() { return Array.from(this.digFiles.keys()); }
    getCapabilities() { return { ...this.nodeCapabilities }; }
    isHealthy() { return this.isStarted && !!this.node; }
    getStatus() {
        return {
            isStarted: this.isStarted,
            peerId: this.node?.peerId?.toString(),
            cryptoIPv6: this.cryptoIPv6,
            stores: Array.from(this.digFiles.keys()),
            connectedPeers: this.node ? this.node.getPeers().map(p => p.toString()) : [],
            metrics: this.getMetrics(),
            startTime: this.startTime
        };
    }
    getMetrics() {
        return {
            ...this.metrics,
            uptime: this.isStarted ? Date.now() - this.startTime : 0,
            storesCount: this.digFiles.size,
            peersCount: this.node ? this.node.getPeers().length : 0
        };
    }
    getNetworkHealth() {
        const connectedPeers = this.node ? this.node.getPeers().length : 0;
        const digPeers = this.peerDiscovery?.getDIGPeers().length || 0;
        const turnServers = this.turnCoordination?.getTurnStats()?.totalTurnServers || 0;
        return {
            isHealthy: this.isHealthy(),
            connectedPeers,
            digPeers,
            turnServers,
            storesShared: this.digFiles.size,
            connectionCapabilities: this.peerCapabilities?.getCapabilityStats()
        };
    }
    // Download store using intelligent orchestrator
    async downloadStore(storeId) {
        try {
            const result = await this.downloadOrchestrator.downloadStore(storeId);
            if (result.success && result.data) {
                await this.saveDownloadedStore(storeId, result.data);
                this.logger.info(`✅ Downloaded ${storeId} via ${result.strategy}`);
                return true;
            }
            return false;
        }
        catch (error) {
            this.logger.error(`Download failed for ${storeId}:`, error);
            return false;
        }
    }
    // Legacy API methods for backwards compatibility
    hasStore(storeId) {
        return this.digFiles.has(storeId);
    }
    async findStorePeers(storeId) {
        const digPeers = this.peerDiscovery?.getDIGPeersWithStore(storeId) || [];
        return digPeers.map(peer => ({
            peerId: peer.peerId,
            cryptoIPv6: peer.cryptoIPv6,
            timestamp: peer.lastSeen
        }));
    }
    async connectToPeer(peerAddress) {
        // Try local network discovery first for hotel networks
        const isLocal = this.localNetworkDiscovery && await this.localNetworkDiscovery.manualConnectToPeer(peerAddress);
        if (isLocal) {
            this.logger.info(`✅ Connected to local DIG peer: ${peerAddress}`);
            return;
        }
        // Fallback to direct connection
        const addr = multiaddr(peerAddress);
        await this.node.dial(addr);
        this.logger.info(`✅ Connected to peer: ${peerAddress}`);
    }
    // Manual connection for hotel networks (IP:PORT format)
    async connectToLocalPeer(ipAddress, port = 4001) {
        try {
            this.logger.info(`🏠 Attempting local network connection: ${ipAddress}:${port}`);
            // Try local network discovery
            if (this.localNetworkDiscovery) {
                const peerAddress = `/ip4/${ipAddress}/tcp/${port}`;
                return await this.localNetworkDiscovery.manualConnectToPeer(peerAddress);
            }
            return false;
        }
        catch (error) {
            this.logger.error(`Local peer connection failed to ${ipAddress}:${port}:`, error);
            return false;
        }
    }
    getConnectionInfo() {
        const peers = this.node ? this.node.getPeers() : [];
        const digPeers = this.peerDiscovery?.getDIGPeers() || [];
        const capabilityStats = this.peerCapabilities?.getCapabilityStats();
        return {
            listeningAddresses: this.node ? this.node.getMultiaddrs().map(addr => addr.toString()) : [],
            connectedPeers: peers.map(peer => peer.toString()),
            peerCount: peers.length,
            digPeers: digPeers.length,
            turnServers: this.turnCoordination?.getTurnStats()?.totalTurnServers || 0,
            connectionCapabilities: capabilityStats,
            upnpStatus: this.upnpPortManager?.getUPnPStatus(),
            externalAddresses: this.upnpPortManager?.getExternalAddresses() || [],
            localNetworkStatus: this.localNetworkDiscovery?.getLocalNetworkStatus(),
            canAcceptDirectConnections: capabilityStats ? capabilityStats.directCapablePeers > 0 : false,
            canActAsTurnServer: capabilityStats ? capabilityStats.turnCapablePeers > 0 : false,
            availableConnectionMethods: this.getAvailableConnectionMethods()
        };
    }
    getNodeCapabilities() {
        return { ...this.nodeCapabilities };
    }
    getUPnPStatus() {
        return this.upnpPortManager?.getUPnPStatus() || {
            available: false,
            totalMappings: 0,
            activeMappings: 0,
            portRanges: { libp2p: [], websocket: [], turn: [] },
            lastRefresh: 0
        };
    }
    getMultiaddrs() {
        return this.node ? this.node.getMultiaddrs() : [];
    }
    getAvailableConnectionMethods() {
        const methods = [];
        if (this.nodeCapabilities.upnp)
            methods.push('UPnP');
        if (this.nodeCapabilities.autonat)
            methods.push('AutoNAT');
        if (this.nodeCapabilities.webrtc)
            methods.push('WebRTC');
        if (this.nodeCapabilities.websockets)
            methods.push('WebSockets');
        if (this.nodeCapabilities.circuitRelay)
            methods.push('Circuit Relay');
        if (this.nodeCapabilities.dht)
            methods.push('DHT');
        if (this.nodeCapabilities.mdns)
            methods.push('mDNS');
        methods.push('TCP Direct');
        return methods;
    }
    async discoverAllPeers() {
        this.logger.info('🔍 Starting manual peer discovery...');
        // Trigger peer discovery
        await this.peerDiscovery?.discoverDIGPeers?.();
    }
    async forceConnectToPeers() {
        this.logger.info('🔗 Force connecting to all known peers...');
        // Use comprehensive NAT traversal to connect to all known peers
        const digPeers = this.peerDiscovery?.getDIGPeers() || [];
        for (const peer of digPeers.slice(0, 5)) {
            try {
                await this.natTraversal?.attemptConnection(peer.peerId, []);
            }
            catch (error) {
                // Silent failure
            }
        }
    }
    // Cleanup and stop
    async stop() {
        if (!this.isStarted)
            return;
        this.logger.info('🛑 Stopping Consolidated DIG Node...');
        await this.cleanup();
        this.isStarted = false;
        this.logger.info('✅ DIG Node stopped');
    }
    async cleanup() {
        try {
            await this.peerDiscovery?.stop();
            await this.turnCoordination?.stop();
            await this.upnpPortManager?.cleanup();
            await this.webSocketRelay?.disconnect();
            if (this.watcher) {
                await this.watcher.close();
                this.watcher = null;
            }
            await this.node?.stop();
        }
        catch (error) {
            this.logger.error('Cleanup error:', error);
        }
    }
}
//# sourceMappingURL=DIGNode.js.map