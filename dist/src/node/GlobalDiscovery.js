import { Logger } from './logger.js';
export class GlobalDiscovery {
    constructor(peerId, addresses, cryptoIPv6, getStores, customBootstrapServers) {
        this.peerId = peerId;
        this.addresses = addresses;
        this.cryptoIPv6 = cryptoIPv6;
        this.getStores = getStores;
        this.logger = new Logger('GlobalDiscovery');
        this.knownPeers = new Map();
        this.discoveryServers = [];
        this.registrationInterval = null;
        this.discoveryInterval = null;
        // 🔐 PRIVACY IS ALWAYS ENABLED - No option to disable
        // Use DIG network bootstrap servers (AWS EBS instance as primary)
        this.discoveryServers = customBootstrapServers || [
            'http://dig-bootstrap-v2-prod.eba-vfishzna.us-east-1.elasticbeanstalk.com'
        ];
        this.logger.info(`🌍 Using discovery servers: ${this.discoveryServers.join(', ')}`);
    }
    // Start global discovery
    async start() {
        this.logger.info('🌍 Starting global peer discovery...');
        // Register with discovery servers
        await this.registerWithDiscoveryServers();
        // Start periodic registration (every 2 minutes for faster updates)
        this.registrationInterval = setInterval(() => {
            this.registerWithDiscoveryServers().catch(error => {
                this.logger.warn('Registration failed:', error);
            });
        }, 2 * 60 * 1000);
        // Start periodic peer discovery (every 30 seconds for faster peer updates)
        this.discoveryInterval = setInterval(() => {
            this.discoverPeers().catch(error => {
                this.logger.warn('Peer discovery failed:', error);
            });
        }, 30 * 1000);
        // Verify registration status periodically and re-register if needed
        setInterval(() => {
            this.verifyRegistrationStatus().catch(error => {
                this.logger.warn('Registration verification failed:', error);
            });
        }, 5 * 60 * 1000); // Every 5 minutes
        // Initial peer discovery
        setTimeout(() => this.discoverPeers(), 5000);
    }
    async stop() {
        if (this.registrationInterval) {
            clearInterval(this.registrationInterval);
            this.registrationInterval = null;
        }
        if (this.discoveryInterval) {
            clearInterval(this.discoveryInterval);
            this.discoveryInterval = null;
        }
        // Unregister from discovery servers
        await this.unregisterFromDiscoveryServers();
    }
    // Register this node with discovery servers (crypto-IPv6 only for privacy)
    async registerWithDiscoveryServers() {
        // 🔐 ALWAYS use privacy mode to protect IP addresses
        const registration = {
            peerId: this.peerId,
            // 🔐 PRIVACY: Only expose crypto-derived IPv6, never real IP addresses
            addresses: [`/ip6/${this.cryptoIPv6}/tcp/4001/p2p/${this.peerId}`, `/ip6/${this.cryptoIPv6}/ws/p2p/${this.peerId}`],
            realAddresses: this.addresses, // Send real addresses privately for resolution only
            cryptoIPv6: this.cryptoIPv6,
            stores: this.getStores(),
            timestamp: Date.now(),
            version: '1.0.0',
            privacyMode: true, // ALWAYS true for IP privacy
            capabilities: {
                libp2p: true,
                dht: true,
                storeSync: true,
                e2eEncryption: true,
                turnServer: false, // Will be updated by TURN detection
                bootstrapServer: false // Will be updated by bootstrap detection
            },
            // Enhanced handshake information (Chia-like protocol)
            networkId: process.env.DIG_NETWORK_ID || 'mainnet',
            softwareVersion: process.env.npm_package_version || '1.0.0',
            serverPort: 4001, // Default DIG port
            nodeType: 0, // Will be determined by capabilities
            capabilityList: [] // Will be populated with capability codes
        };
        for (const server of this.discoveryServers) {
            try {
                const response = await fetch(`${server}/register`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(registration),
                    signal: AbortSignal.timeout(10000) // 10 second timeout
                });
                if (response.ok) {
                    this.logger.debug(`✅ Registered with ${server}`);
                }
                else {
                    this.logger.warn(`❌ Registration failed with ${server}: ${response.status}`);
                }
            }
            catch (error) {
                this.logger.debug(`Discovery server ${server} not available:`, error);
                // Don't log as error since discovery servers might not exist yet
            }
        }
    }
    // Discover peers from discovery servers (with crypto-IPv6 privacy support)
    async discoverPeers() {
        const discoveredAddresses = [];
        for (const server of this.discoveryServers) {
            try {
                // 🔐 ALWAYS use crypto-IPv6 directory for privacy
                const endpoint = '/crypto-ipv6-directory';
                const response = await fetch(`${server}${endpoint}`, {
                    signal: AbortSignal.timeout(10000)
                });
                if (response.ok) {
                    const data = await response.json();
                    if (data.peers && Array.isArray(data.peers)) {
                        for (const peer of data.peers) {
                            if (peer.peerId !== this.peerId) {
                                // 🔐 ALWAYS construct crypto-IPv6 addresses (privacy mandatory)
                                let peerAddresses = [];
                                if (peer.cryptoIPv6) {
                                    // 🔐 PRIVACY: Always use crypto-IPv6 addresses only
                                    peerAddresses = [
                                        `/ip6/${peer.cryptoIPv6}/tcp/4001/p2p/${peer.peerId}`,
                                        `/ip6/${peer.cryptoIPv6}/ws/p2p/${peer.peerId}`
                                    ];
                                    this.logger.debug(`🔐 Using crypto-IPv6 for ${peer.peerId}: ${peer.cryptoIPv6}`);
                                }
                                else {
                                    this.logger.warn(`⚠️ Peer ${peer.peerId} has no crypto-IPv6 address - skipping for privacy`);
                                    continue; // Skip peers without crypto-IPv6
                                }
                                if (peerAddresses.length > 0) {
                                    this.knownPeers.set(peer.peerId, {
                                        ...peer,
                                        addresses: peerAddresses,
                                        lastSeen: Date.now()
                                    });
                                    // Add addresses for connection attempts
                                    discoveredAddresses.push(...peerAddresses);
                                    this.logger.debug(`👤 Discovered peer: ${peer.peerId} with ${peerAddresses.length} crypto-IPv6 addresses`);
                                }
                            }
                            else if (peer.peerId === this.peerId) {
                                this.logger.debug(`⏭️ Skipping self-discovery: ${peer.peerId}`);
                            }
                        }
                        const uniquePeers = data.peers.filter((p) => p.peerId !== this.peerId);
                        this.logger.info(`🔍 Discovered ${uniquePeers.length} unique peers from ${server} (total: ${data.peers.length}, excluding self)`);
                    }
                }
            }
            catch (error) {
                this.logger.debug(`Discovery server ${server} not available:`, error);
            }
        }
        return discoveredAddresses;
    }
    // Unregister from discovery servers
    async unregisterFromDiscoveryServers() {
        for (const server of this.discoveryServers) {
            try {
                await fetch(`${server}/unregister`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ peerId: this.peerId }),
                    signal: AbortSignal.timeout(5000)
                });
            }
            catch (error) {
                // Ignore unregistration errors
            }
        }
    }
    // Get all known peer addresses for connection attempts
    getKnownPeerAddresses() {
        const addresses = [];
        const now = Date.now();
        const maxAge = 10 * 60 * 1000; // 10 minutes
        for (const [peerId, peer] of this.knownPeers) {
            if (now - peer.lastSeen < maxAge) {
                addresses.push(...peer.addresses);
            }
        }
        return addresses;
    }
    // Get discovery statistics
    getStats() {
        return {
            knownPeers: this.knownPeers.size,
            discoveryServers: this.discoveryServers.length,
            totalAddresses: this.getKnownPeerAddresses().length
        };
    }
    // Add custom discovery server
    addDiscoveryServer(serverUrl) {
        if (!this.discoveryServers.includes(serverUrl)) {
            this.discoveryServers.push(serverUrl);
            this.logger.info(`Added discovery server: ${serverUrl}`);
        }
    }
    // Use DHT-based global discovery as fallback
    async discoverViaDHT(dhtService) {
        const discoveredAddresses = [];
        try {
            // Search for DIG network nodes in DHT
            const searchKey = new TextEncoder().encode('/dig-network/peers');
            if (dhtService && dhtService.getClosestPeers) {
                for await (const peer of dhtService.getClosestPeers(searchKey)) {
                    try {
                        if (peer.toString() !== this.peerId) {
                            // Try to get peer info from DHT
                            const peerKey = new TextEncoder().encode(`/dig-peer/${peer.toString()}`);
                            for await (const event of dhtService.get(peerKey)) {
                                if (event.name === 'VALUE') {
                                    try {
                                        const peerInfo = JSON.parse(new TextDecoder().decode(event.value));
                                        if (peerInfo.addresses) {
                                            discoveredAddresses.push(...peerInfo.addresses);
                                            this.knownPeers.set(peer.toString(), {
                                                peerId: peer.toString(),
                                                addresses: peerInfo.addresses,
                                                lastSeen: Date.now(),
                                                cryptoIPv6: peerInfo.cryptoIPv6,
                                                stores: peerInfo.stores
                                            });
                                        }
                                    }
                                    catch (parseError) {
                                        this.logger.debug('Failed to parse DHT peer info:', parseError);
                                    }
                                }
                            }
                        }
                    }
                    catch (error) {
                        this.logger.debug(`DHT peer discovery error for ${peer.toString()}:`, error);
                    }
                }
            }
        }
        catch (error) {
            this.logger.warn('DHT-based discovery failed:', error);
        }
        return discoveredAddresses;
    }
    // Verify registration status and re-register if needed
    async verifyRegistrationStatus() {
        this.logger.info('🔍 Verifying registration status with bootstrap servers...');
        for (const server of this.discoveryServers) {
            try {
                // Check if we're registered by looking for ourselves in the crypto-IPv6 directory
                const response = await fetch(`${server}/crypto-ipv6-directory`, {
                    signal: AbortSignal.timeout(10000)
                });
                if (response.ok) {
                    const data = await response.json();
                    const isRegistered = data.peers?.some((p) => p.peerId === this.peerId);
                    if (isRegistered) {
                        this.logger.info(`✅ Registration verified with ${server}`);
                    }
                    else {
                        this.logger.warn(`❌ Not found in ${server} directory - re-registering...`);
                        await this.registerWithDiscoveryServers();
                    }
                }
                else {
                    this.logger.warn(`⚠️ Failed to verify registration with ${server}: ${response.status}`);
                    // Re-register on verification failure
                    await this.registerWithDiscoveryServers();
                }
            }
            catch (error) {
                this.logger.warn(`Registration verification failed for ${server}:`, error);
                // Re-register on error
                try {
                    await this.registerWithDiscoveryServers();
                }
                catch (regError) {
                    this.logger.error('Re-registration failed:', regError);
                }
            }
        }
    }
    // Announce this node to DHT for global discovery
    async announceToGlobalDHT(dhtService) {
        try {
            const announcement = {
                peerId: this.peerId,
                addresses: this.addresses,
                cryptoIPv6: this.cryptoIPv6,
                stores: this.getStores(),
                timestamp: Date.now()
            };
            const key = new TextEncoder().encode(`/dig-peer/${this.peerId}`);
            const value = new TextEncoder().encode(JSON.stringify(announcement));
            if (dhtService && dhtService.put) {
                await dhtService.put(key, value);
                this.logger.debug('📡 Announced to global DHT');
            }
        }
        catch (error) {
            this.logger.warn('Failed to announce to global DHT:', error);
        }
    }
}
//# sourceMappingURL=GlobalDiscovery.js.map