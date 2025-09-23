import { Logger } from './logger.js'

export interface PeerInfo {
  peerId: string;
  addresses: string[];
  lastSeen: number;
  cryptoIPv6?: string;
  stores?: string[];
  capabilities?: any;
}

export class GlobalDiscovery {
  private logger = new Logger('GlobalDiscovery')
  public knownPeers = new Map<string, PeerInfo>()
  private discoveryServers: string[] = []
  private registrationInterval: NodeJS.Timeout | null = null
  private discoveryInterval: NodeJS.Timeout | null = null
  
  constructor(
    private peerId: string,
    private addresses: string[],
    private cryptoIPv6: string,
    private getStores: () => string[],
    customBootstrapServers?: string[],
    private privacyMode: boolean = false
  ) {
    // Use DIG network bootstrap servers (AWS EBS instance as primary)
    this.discoveryServers = customBootstrapServers || [
      'http://dig-bootstrap-v2-prod.eba-vfishzna.us-east-1.elasticbeanstalk.com'
    ]
    
    this.logger.info(`🌍 Using discovery servers: ${this.discoveryServers.join(', ')}`)
  }

  // Start global discovery
  async start(): Promise<void> {
    this.logger.info('🌍 Starting global peer discovery...')
    
    // Register with discovery servers
    await this.registerWithDiscoveryServers()
    
    // Start periodic registration (every 2 minutes for faster updates)
    this.registrationInterval = setInterval(() => {
      this.registerWithDiscoveryServers().catch(error => {
        this.logger.warn('Registration failed:', error)
      })
    }, 2 * 60 * 1000)
    
    // Start periodic peer discovery (every 30 seconds for faster peer updates)
    this.discoveryInterval = setInterval(() => {
      this.discoverPeers().catch(error => {
        this.logger.warn('Peer discovery failed:', error)
      })
    }, 30 * 1000)
    
    // Initial peer discovery
    setTimeout(() => this.discoverPeers(), 5000)
  }

  async stop(): Promise<void> {
    if (this.registrationInterval) {
      clearInterval(this.registrationInterval)
      this.registrationInterval = null
    }
    
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval)
      this.discoveryInterval = null
    }
    
    // Unregister from discovery servers
    await this.unregisterFromDiscoveryServers()
  }

  // Register this node with discovery servers (crypto-IPv6 only for privacy)
  private async registerWithDiscoveryServers(): Promise<void> {
    const registration = this.privacyMode ? {
      peerId: this.peerId,
      // 🔐 PRIVACY: Only expose crypto-derived IPv6, never real IP addresses
      addresses: [`/ip6/${this.cryptoIPv6}/tcp/4001`, `/ip6/${this.cryptoIPv6}/ws`],
      realAddresses: this.addresses, // Send real addresses privately for resolution
      cryptoIPv6: this.cryptoIPv6,
      stores: this.getStores(),
      timestamp: Date.now(),
      version: '1.0.0',
      privacyMode: true // Flag to indicate crypto-IPv6-only mode
    } : {
      peerId: this.peerId,
      addresses: this.addresses, // Normal mode: expose real addresses
      cryptoIPv6: this.cryptoIPv6,
      stores: this.getStores(),
      timestamp: Date.now(),
      version: '1.0.0',
      privacyMode: false
    }

    for (const server of this.discoveryServers) {
      try {
        const response = await fetch(`${server}/register`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(registration),
          signal: AbortSignal.timeout(10000) // 10 second timeout
        })

        if (response.ok) {
          this.logger.debug(`✅ Registered with ${server}`)
        } else {
          this.logger.warn(`❌ Registration failed with ${server}: ${response.status}`)
        }
      } catch (error) {
        this.logger.debug(`Discovery server ${server} not available:`, error)
        // Don't log as error since discovery servers might not exist yet
      }
    }
  }

  // Discover peers from discovery servers (with crypto-IPv6 privacy support)
  private async discoverPeers(): Promise<string[]> {
    const discoveredAddresses: string[] = []

    for (const server of this.discoveryServers) {
      try {
        // Use crypto-IPv6 directory in privacy mode for enhanced privacy
        const endpoint = this.privacyMode ? '/crypto-ipv6-directory' : '/peers'
        const response = await fetch(`${server}${endpoint}`, {
          signal: AbortSignal.timeout(10000)
        })

        if (response.ok) {
          const data = await response.json()
          if (data.peers && Array.isArray(data.peers)) {
            for (const peer of data.peers) {
              if (peer.peerId !== this.peerId) {
                // In privacy mode, construct crypto-IPv6 addresses
                let peerAddresses: string[] = []
                
                if (this.privacyMode && peer.cryptoIPv6) {
                  // 🔐 PRIVACY: Use crypto-IPv6 addresses only
                  peerAddresses = [
                    `/ip6/${peer.cryptoIPv6}/tcp/4001/p2p/${peer.peerId}`,
                    `/ip6/${peer.cryptoIPv6}/ws/p2p/${peer.peerId}`
                  ]
                  this.logger.debug(`🔐 Privacy mode: Using crypto-IPv6 for ${peer.peerId}: ${peer.cryptoIPv6}`)
                } else if (peer.addresses) {
                  // Normal mode: use provided addresses
                  peerAddresses = peer.addresses
                }
                
                if (peerAddresses.length > 0) {
                  this.knownPeers.set(peer.peerId, {
                    ...peer,
                    addresses: peerAddresses,
                    lastSeen: Date.now()
                  })
                  
                  // Add addresses for connection attempts
                  discoveredAddresses.push(...peerAddresses)
                  this.logger.debug(`👤 Discovered peer: ${peer.peerId} with ${peerAddresses.length} addresses (privacy: ${this.privacyMode})`)
                }
              } else if (peer.peerId === this.peerId) {
                this.logger.debug(`⏭️ Skipping self-discovery: ${peer.peerId}`)
              }
            }
            
            const uniquePeers = data.peers.filter((p: any) => p.peerId !== this.peerId)
            this.logger.info(`🔍 Discovered ${uniquePeers.length} unique peers from ${server} (total: ${data.peers.length}, excluding self)`)
          }
        }
      } catch (error) {
        this.logger.debug(`Discovery server ${server} not available:`, error)
      }
    }

    return discoveredAddresses
  }

  // Unregister from discovery servers
  private async unregisterFromDiscoveryServers(): Promise<void> {
    for (const server of this.discoveryServers) {
      try {
        await fetch(`${server}/unregister`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ peerId: this.peerId }),
          signal: AbortSignal.timeout(5000)
        })
      } catch (error) {
        // Ignore unregistration errors
      }
    }
  }

  // Get all known peer addresses for connection attempts
  getKnownPeerAddresses(): string[] {
    const addresses: string[] = []
    const now = Date.now()
    const maxAge = 10 * 60 * 1000 // 10 minutes

    for (const [peerId, peer] of this.knownPeers) {
      if (now - peer.lastSeen < maxAge) {
        addresses.push(...peer.addresses)
      }
    }

    return addresses
  }

  // Get discovery statistics
  getStats(): any {
    return {
      knownPeers: this.knownPeers.size,
      discoveryServers: this.discoveryServers.length,
      totalAddresses: this.getKnownPeerAddresses().length
    }
  }

  // Add custom discovery server
  addDiscoveryServer(serverUrl: string): void {
    if (!this.discoveryServers.includes(serverUrl)) {
      this.discoveryServers.push(serverUrl)
      this.logger.info(`Added discovery server: ${serverUrl}`)
    }
  }

  // Use DHT-based global discovery as fallback
  async discoverViaDHT(dhtService: any): Promise<string[]> {
    const discoveredAddresses: string[] = []
    
    try {
      // Search for DIG network nodes in DHT
      const searchKey = new TextEncoder().encode('/dig-network/peers')
      
      if (dhtService && dhtService.getClosestPeers) {
        for await (const peer of dhtService.getClosestPeers(searchKey)) {
          try {
            if (peer.toString() !== this.peerId) {
              // Try to get peer info from DHT
              const peerKey = new TextEncoder().encode(`/dig-peer/${peer.toString()}`)
              for await (const event of dhtService.get(peerKey)) {
                if (event.name === 'VALUE') {
                  try {
                    const peerInfo = JSON.parse(new TextDecoder().decode(event.value))
                    if (peerInfo.addresses) {
                      discoveredAddresses.push(...peerInfo.addresses)
                      this.knownPeers.set(peer.toString(), {
                        peerId: peer.toString(),
                        addresses: peerInfo.addresses,
                        lastSeen: Date.now(),
                        cryptoIPv6: peerInfo.cryptoIPv6,
                        stores: peerInfo.stores
                      })
                    }
                  } catch (parseError) {
                    this.logger.debug('Failed to parse DHT peer info:', parseError)
                  }
                }
              }
            }
          } catch (error) {
            this.logger.debug(`DHT peer discovery error for ${peer.toString()}:`, error)
          }
        }
      }
    } catch (error) {
      this.logger.warn('DHT-based discovery failed:', error)
    }

    return discoveredAddresses
  }

  // Announce this node to DHT for global discovery
  async announceToGlobalDHT(dhtService: any): Promise<void> {
    try {
      const announcement = {
        peerId: this.peerId,
        addresses: this.addresses,
        cryptoIPv6: this.cryptoIPv6,
        stores: this.getStores(),
        timestamp: Date.now()
      }

      const key = new TextEncoder().encode(`/dig-peer/${this.peerId}`)
      const value = new TextEncoder().encode(JSON.stringify(announcement))
      
      if (dhtService && dhtService.put) {
        await dhtService.put(key, value)
        this.logger.debug('📡 Announced to global DHT')
      }
    } catch (error) {
      this.logger.warn('Failed to announce to global DHT:', error)
    }
  }
}
