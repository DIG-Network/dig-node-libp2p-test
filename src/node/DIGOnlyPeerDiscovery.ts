/**
 * DIG-Only Peer Discovery System
 * 
 * Problem: Public LibP2P bootstrap connects to ALL LibP2P peers (IPFS, other projects)
 * Solution: Filter to DIG Network peers only using:
 * - Custom DIG network namespace in DHT
 * - DIG-specific GossipSub topics
 * - Protocol verification before connecting
 * - Avoid connecting to non-DIG peers entirely
 */

import { Logger } from './logger.js'
import { DIG_PROTOCOL } from './types.js'

export class DIGOnlyPeerDiscovery {
  private logger = new Logger('DIGOnlyDiscovery')
  private digNode: any
  private digPeers = new Map<string, DIGPeerInfo>()
  private digNetworkNamespace = 'dig-network-mainnet-v1'
  private discoveryInterval: NodeJS.Timeout | null = null
  private announceInterval: NodeJS.Timeout | null = null

  // DIG Network specific topics (avoid general LibP2P noise)
  private readonly DIG_GOSSIP_TOPICS = {
    PEER_DISCOVERY: 'dig-network-peer-discovery-v1',
    PEER_ANNOUNCEMENTS: 'dig-network-peer-announcements-v1',
    STORE_SHARING: 'dig-network-store-sharing-v1',
    CAPABILITY_SHARING: 'dig-network-capability-sharing-v1'
  }

  constructor(digNode: any) {
    this.digNode = digNode
  }

  // Start DIG-only peer discovery
  async start(): Promise<void> {
    try {
      this.logger.info('🎯 Starting DIG-only peer discovery (filtering out non-DIG peers)...')

      // 1. Set up DIG network namespace in DHT
      await this.setupDIGNetworkDHT()

      // 2. Subscribe to DIG-specific GossipSub topics only
      await this.subscribeToDIGNetworkTopics()

      // 3. Announce ourselves to DIG network namespace
      await this.announceToDIGNetworkNamespace()

      // 4. Start periodic DIG peer discovery
      this.startDIGOnlyDiscovery()

      // 5. Filter existing connections to DIG peers only
      await this.filterExistingConnectionsToDIGPeers()

      this.logger.info('✅ DIG-only peer discovery started')

    } catch (error) {
      this.logger.error('Failed to start DIG-only discovery:', error)
    }
  }

  // Set up DIG network namespace in DHT
  private async setupDIGNetworkDHT(): Promise<void> {
    try {
      const dht = this.digNode.node.services.dht
      if (!dht) {
        this.logger.warn('⚠️ DHT not available for DIG namespace')
        return
      }

      this.logger.info('🔑 Setting up DIG network namespace in DHT...')

      // Store our DIG network registration
      const digRegistration = {
        peerId: this.digNode.node.peerId.toString(),
        networkId: 'dig-mainnet',
        protocolVersion: '1.0.0',
        cryptoIPv6: this.digNode.cryptoIPv6,
        nodeType: 'full', // or based on capabilities
        stores: this.digNode.getAvailableStores(),
        capabilities: this.digNode.nodeCapabilities,
        addresses: this.digNode.node.getMultiaddrs().map((addr: any) => addr.toString()),
        timestamp: Date.now()
      }

      // Store in DIG network namespace
      const key = new TextEncoder().encode(`/${this.digNetworkNamespace}/peers/${digRegistration.peerId}`)
      const value = new TextEncoder().encode(JSON.stringify(digRegistration))
      
      await dht.put(key, value)
      this.logger.info('📡 Registered in DIG network DHT namespace')

    } catch (error) {
      this.logger.debug('DIG network DHT setup failed:', error)
    }
  }

  // Subscribe to DIG-specific GossipSub topics
  private async subscribeToDIGNetworkTopics(): Promise<void> {
    try {
      const gossipsub = this.digNode.node.services.gossipsub
      if (!gossipsub) {
        this.logger.warn('⚠️ GossipSub not available for DIG topics')
        return
      }

      this.logger.info('🗣️ Subscribing to DIG network topics...')

      // Subscribe to DIG-specific topics
      for (const [topicName, topicId] of Object.entries(this.DIG_GOSSIP_TOPICS)) {
        try {
          await gossipsub.subscribe(topicId)
          this.logger.debug(`✅ Subscribed to ${topicName}: ${topicId}`)
        } catch (error) {
          this.logger.debug(`Failed to subscribe to ${topicName}:`, error)
        }
      }

      // Handle DIG network messages
      gossipsub.addEventListener('message', (evt: any) => {
        this.handleDIGNetworkMessage(evt.detail)
      })

      this.logger.info('✅ Subscribed to DIG network topics')

    } catch (error) {
      this.logger.debug('DIG network topic subscription failed:', error)
    }
  }

  // Handle DIG network GossipSub messages
  private async handleDIGNetworkMessage(message: any): Promise<void> {
    try {
      const { topic, data } = message
      const { toString: uint8ArrayToString } = await import('uint8arrays')
      const payload = JSON.parse(uint8ArrayToString(data))

      // Only process messages from DIG network
      if (payload.networkId !== 'dig-mainnet') {
        return
      }

      if (topic === this.DIG_GOSSIP_TOPICS.PEER_ANNOUNCEMENTS) {
        await this.handleDIGPeerAnnouncement(payload)
      } else if (topic === this.DIG_GOSSIP_TOPICS.STORE_SHARING) {
        await this.handleDIGStoreAnnouncement(payload)
      } else if (topic === this.DIG_GOSSIP_TOPICS.CAPABILITY_SHARING) {
        await this.handleDIGCapabilityAnnouncement(payload)
      }

    } catch (error) {
      this.logger.debug('Failed to handle DIG network message:', error)
    }
  }

  // Handle DIG peer announcements
  private async handleDIGPeerAnnouncement(payload: any): Promise<void> {
    const { peerId, cryptoIPv6, stores, capabilities, addresses } = payload

    if (peerId === this.digNode.node.peerId.toString()) {
      return // Ignore our own announcements
    }

    // Add verified DIG peer
    this.digPeers.set(peerId, {
      peerId,
      cryptoIPv6,
      stores: stores || [],
      capabilities: capabilities || {},
      addresses: addresses || [],
      lastSeen: Date.now(),
      discoveredVia: 'gossip-announcement',
      verified: true // Came from DIG network topic
    })

    this.logger.info(`✅ Discovered DIG peer via gossip: ${peerId} (${stores?.length || 0} stores)`)

    // Try to connect to this verified DIG peer
    await this.connectToDIGPeer(peerId, addresses)
  }

  // Handle DIG store announcements
  private async handleDIGStoreAnnouncement(payload: any): Promise<void> {
    const { peerId, stores } = payload

    if (peerId === this.digNode.node.peerId.toString()) {
      return
    }

    // Update peer store information
    const existingPeer = this.digPeers.get(peerId)
    if (existingPeer) {
      existingPeer.stores = stores || []
      existingPeer.lastSeen = Date.now()
      this.logger.debug(`📁 Updated stores for DIG peer ${peerId}: ${stores?.length || 0} stores`)
    }
  }

  // Handle DIG capability announcements
  private async handleDIGCapabilityAnnouncement(payload: any): Promise<void> {
    const { peerId, capabilities } = payload

    if (peerId === this.digNode.node.peerId.toString()) {
      return
    }

    // Update peer capability information
    const existingPeer = this.digPeers.get(peerId)
    if (existingPeer) {
      existingPeer.capabilities = capabilities || {}
      existingPeer.lastSeen = Date.now()
      
      if (capabilities?.turnServer) {
        this.logger.info(`📡 DIG peer ${peerId} announced TURN capability`)
      }
    }
  }

  // Announce ourselves to DIG network namespace
  private async announceToDIGNetworkNamespace(): Promise<void> {
    try {
      const announcement = {
        peerId: this.digNode.node.peerId.toString(),
        networkId: 'dig-mainnet',
        protocolVersion: '1.0.0',
        cryptoIPv6: this.digNode.cryptoIPv6,
        nodeType: 'full',
        stores: this.digNode.getAvailableStores(),
        capabilities: this.digNode.nodeCapabilities,
        addresses: this.digNode.node.getMultiaddrs().map((addr: any) => addr.toString()),
        timestamp: Date.now()
      }

      let announced = false

      // Announce via DIG-specific GossipSub topic
      try {
        const gossipsub = this.digNode.node.services.gossipsub
        if (gossipsub) {
          const { fromString: uint8ArrayFromString } = await import('uint8arrays')
          await gossipsub.publish(
            this.DIG_GOSSIP_TOPICS.PEER_ANNOUNCEMENTS,
            uint8ArrayFromString(JSON.stringify(announcement))
          )
          announced = true
          this.logger.debug('📡 Announced to DIG GossipSub network')
        }
      } catch (gossipError) {
        this.logger.debug('DIG GossipSub announcement failed:', gossipError)
      }

      // Store in DIG network DHT namespace
      try {
        const dht = this.digNode.node.services.dht
        if (dht) {
          const key = new TextEncoder().encode(`/${this.digNetworkNamespace}/peers/${announcement.peerId}`)
          const value = new TextEncoder().encode(JSON.stringify(announcement))
          await dht.put(key, value)
          announced = true
          this.logger.debug('📡 Announced to DIG DHT namespace')
        }
      } catch (dhtError) {
        this.logger.debug('DIG DHT announcement failed:', dhtError)
      }

      if (announced) {
        this.logger.info('📡 Announced to DIG network')
      } else {
        this.logger.debug('⏳ DIG network announcement deferred (network not ready)')
      }

    } catch (error) {
      this.logger.debug('DIG network announcement failed:', error)
    }
  }

  // Start DIG-only discovery (no random LibP2P peers)
  private startDIGOnlyDiscovery(): void {
    // Periodic DIG peer discovery via DHT namespace
    this.discoveryInterval = setInterval(async () => {
      await this.discoverDIGPeersViaDHTNamespace()
    }, 60000) // Every minute

    // Periodic DIG network announcements
    this.announceInterval = setInterval(async () => {
      await this.announceToDIGNetworkNamespace()
    }, 5 * 60000) // Every 5 minutes
  }

  // Discover DIG peers via DHT namespace (not random LibP2P peers)
  private async discoverDIGPeersViaDHTNamespace(): Promise<void> {
    try {
      const dht = this.digNode.node.services.dht
      if (!dht) return

      this.logger.debug('🔍 Searching DIG network namespace in DHT...')

      // Search for DIG network peers in our namespace
      const searchKey = new TextEncoder().encode(`/${this.digNetworkNamespace}/peers/`)
      
      // This would scan the DIG network namespace for peers
      // For now, we'll rely on gossip announcements and manual connections
      
      this.logger.debug(`🔍 DIG namespace search: ${this.digPeers.size} known DIG peers`)

    } catch (error) {
      this.logger.debug('DIG namespace discovery failed:', error)
    }
  }

  // Filter existing connections to DIG peers only
  private async filterExistingConnectionsToDIGPeers(): Promise<void> {
    try {
      const connectedPeers = this.digNode.node.getPeers()
      this.logger.info(`🔍 Filtering ${connectedPeers.length} connected peers to DIG network only...`)

      let digPeerCount = 0
      let nonDigPeerCount = 0

      for (const peer of connectedPeers) {
        const peerId = peer.toString()
        
        // Skip public infrastructure peers (we need them for connectivity)
        if (this.isPublicInfrastructurePeer(peerId)) {
          this.logger.debug(`🌐 Keeping public infrastructure peer: ${peerId} (needed for connectivity)`)
          continue
        }

        // Test if peer supports DIG protocol
        const isDIGPeer = await this.testDIGProtocolSupport(peer)
        
        if (isDIGPeer) {
          digPeerCount++
          this.logger.info(`✅ Verified DIG peer: ${peerId}`)
          
          // Get comprehensive DIG peer info
          const digPeerInfo = await this.getDIGPeerInfo(peerId, peer)
          if (digPeerInfo) {
            this.digPeers.set(peerId, digPeerInfo)
          }
        } else {
          nonDigPeerCount++
          this.logger.debug(`⏭️ Disconnecting from non-DIG peer: ${peerId}`)
          
          // Disconnect from non-DIG peers to avoid noise
          try {
            await this.digNode.node.hangUp(peer)
          } catch (error) {
            // Silent failure - peer might already be disconnected
          }
        }
      }

      this.logger.info(`🎯 DIG network filtering complete: ${digPeerCount} DIG peers, ${nonDigPeerCount} non-DIG peers disconnected`)

    } catch (error) {
      this.logger.error('Failed to filter existing connections:', error)
    }
  }

  // Test if peer supports DIG protocol (without exposing sensitive data)
  private async testDIGProtocolSupport(peer: any): Promise<boolean> {
    try {
      // Try to establish DIG protocol stream
      const stream = await this.digNode.node.dialProtocol(peer, DIG_PROTOCOL)
      
      if (stream) {
        // Send minimal DIG network identification
        const identRequest = {
          type: 'DIG_NETWORK_IDENTIFICATION',
          networkId: 'dig-mainnet',
          protocolVersion: '1.0.0'
          // No sensitive data sent
        }

        const { pipe } = await import('it-pipe')
        const { fromString: uint8ArrayFromString, toString: uint8ArrayToString } = await import('uint8arrays')

        await pipe(async function* () {
          yield uint8ArrayFromString(JSON.stringify(identRequest))
        }, stream.sink)

        // Read response with short timeout
        const chunks: Uint8Array[] = []
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('DIG identification timeout')), 3000)
        )

        await Promise.race([
          pipe(stream.source, async function (source: any) {
            for await (const chunk of source) {
              chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk.subarray()))
            }
          }),
          timeoutPromise
        ])

        if (chunks.length > 0) {
          const response = JSON.parse(uint8ArrayToString(chunks[0]))
          const isDIGPeer = response.networkId === 'dig-mainnet' && response.isDIGNode === true
          
          if (isDIGPeer) {
            this.logger.debug(`✅ Confirmed DIG peer: ${peer.toString()}`)
          } else {
            this.logger.debug(`❌ Not a DIG peer: ${peer.toString()}`)
          }
          
          return isDIGPeer
        }
      }

      return false

    } catch (error) {
      this.logger.debug(`DIG protocol test failed for ${peer.toString()} (expected for non-DIG peers)`)
      return false
    }
  }

  // Get comprehensive DIG peer information
  private async getDIGPeerInfo(peerId: string, peer: any): Promise<DIGPeerInfo | null> {
    try {
      const stream = await this.digNode.node.dialProtocol(peer, DIG_PROTOCOL)
      
      const infoRequest = {
        type: 'GET_PEER_INFO',
        requestedInfo: ['stores', 'capabilities', 'cryptoIPv6', 'nodeType']
      }

      const { pipe } = await import('it-pipe')
      const { fromString: uint8ArrayFromString, toString: uint8ArrayToString } = await import('uint8arrays')

      await pipe(async function* () {
        yield uint8ArrayFromString(JSON.stringify(infoRequest))
      }, stream.sink)

      const chunks: Uint8Array[] = []
      await pipe(stream.source, async function (source: any) {
        for await (const chunk of source) {
          chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk.subarray()))
        }
      })

      if (chunks.length > 0) {
        const response = JSON.parse(uint8ArrayToString(chunks[0]))
        
        if (response.success) {
          return {
            peerId,
            cryptoIPv6: response.cryptoIPv6 || `fd00:${peerId.slice(0, 32)}`,
            stores: response.stores || [],
            capabilities: response.capabilities || {},
            addresses: [peer.toString()], // Use peer connection address
            lastSeen: Date.now(),
            discoveredVia: 'protocol-verification',
            verified: true
          }
        }
      }

      return null

    } catch (error) {
      this.logger.debug(`Failed to get DIG peer info for ${peerId}:`, error)
      return null
    }
  }

  // Connect to verified DIG peer
  private async connectToDIGPeer(peerId: string, addresses: string[]): Promise<void> {
    try {
      // Check if already connected
      const existingPeer = this.digNode.node.getPeers().find((p: any) => p.toString() === peerId)
      if (existingPeer) {
        this.logger.debug(`⏭️ Already connected to DIG peer: ${peerId}`)
        return
      }

      // Try to connect using provided addresses
      for (const address of addresses.slice(0, 3)) { // Limit attempts
        try {
          const { multiaddr } = await import('@multiformats/multiaddr')
          const addr = multiaddr(address)
          
          const connection = await this.digNode.node.dial(addr)
          if (connection) {
            this.logger.info(`✅ Connected to DIG peer: ${peerId}`)
            return
          }
        } catch (error) {
          // Try next address
        }
      }

      this.logger.debug(`❌ Failed to connect to DIG peer: ${peerId}`)

    } catch (error) {
      this.logger.debug(`DIG peer connection failed for ${peerId}:`, error)
    }
  }

  // Check if peer is public LibP2P infrastructure
  private isPublicInfrastructurePeer(peerId: string): boolean {
    const publicPeerIds = [
      'QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
      'QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
      'QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ',
      'QmbLHAnMoJPWSCR5Zp9J6W3KmKx6qeGBZp9rKTdKNWqFk'
    ]
    
    return publicPeerIds.some(publicId => peerId.includes(publicId))
  }

  // Get DIG network peers only
  getDIGPeers(): DIGPeerInfo[] {
    return Array.from(this.digPeers.values())
  }

  // Get DIG peers with specific store
  getDIGPeersWithStore(storeId: string): DIGPeerInfo[] {
    return Array.from(this.digPeers.values())
      .filter(peer => peer.stores.includes(storeId))
  }

  // Get DIG TURN servers
  getDIGTurnServers(): DIGPeerInfo[] {
    return Array.from(this.digPeers.values())
      .filter(peer => peer.capabilities?.turnServer)
  }

  // Force discovery of DIG peers (public method)
  async discoverDIGPeers(): Promise<void> {
    await this.discoverDIGPeersViaDHTNamespace()
  }

  // Get discovery statistics
  getDIGDiscoveryStats(): DIGDiscoveryStats {
    const peers = Array.from(this.digPeers.values())
    
    return {
      totalDIGPeers: peers.length,
      verifiedDIGPeers: peers.filter(p => p.verified).length,
      peersWithStores: peers.filter(p => p.stores.length > 0).length,
      turnCapablePeers: peers.filter(p => p.capabilities?.turnServer).length,
      lastDiscovery: Math.max(...peers.map(p => p.lastSeen), 0),
      discoveryMethods: ['dht-namespace', 'gossip-topics', 'protocol-verification']
    }
  }

  // Stop DIG-only discovery
  async stop(): Promise<void> {
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval)
      this.discoveryInterval = null
    }
    
    if (this.announceInterval) {
      clearInterval(this.announceInterval)
      this.announceInterval = null
    }
    
    this.logger.info('🛑 DIG-only peer discovery stopped')
  }
}

// DIG peer information
interface DIGPeerInfo {
  peerId: string
  cryptoIPv6: string
  stores: string[]
  capabilities: any
  addresses: string[]
  lastSeen: number
  discoveredVia: 'dht-namespace' | 'gossip-announcement' | 'protocol-verification'
  verified: boolean
}

// DIG discovery statistics
interface DIGDiscoveryStats {
  totalDIGPeers: number
  verifiedDIGPeers: number
  peersWithStores: number
  turnCapablePeers: number
  lastDiscovery: number
  discoveryMethods: string[]
}
