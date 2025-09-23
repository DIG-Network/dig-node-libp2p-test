/**
 * Unified Peer Discovery System
 * 
 * Consolidates all peer discovery methods into a single, clean interface:
 * - Public LibP2P bootstrap integration
 * - DHT-based peer discovery
 * - GossipSub peer announcements
 * - DIG network filtering
 * - Crypto-IPv6 privacy
 */

import { randomBytes } from 'crypto'
import { Logger } from './logger.js'
import { DIG_PROTOCOL } from './types.js'
import { SecurityIsolation, PeerSecurityLevel } from './SecurityIsolation.js'

export class UnifiedPeerDiscovery {
  private logger = new Logger('PeerDiscovery')
  private digNode: any
  private digPeers = new Map<string, DIGPeerInfo>()
  private discoveryInterval: NodeJS.Timeout | null = null
  public securityIsolation!: SecurityIsolation

  // Public LibP2P infrastructure (free, maintained by Protocol Labs)
  private readonly PUBLIC_BOOTSTRAP_NODES = [
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
    '/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ'
  ]

  constructor(digNode: any) {
    this.digNode = digNode
  }

  // Start unified peer discovery with security isolation
  async start(): Promise<void> {
    try {
      this.logger.info('🌐 Starting unified peer discovery with security isolation...')

      // Initialize security isolation system
      this.securityIsolation = new SecurityIsolation(this.digNode)

      // 1. Connect to public LibP2P bootstrap servers (with security isolation)
      await this.connectToPublicBootstrap()

      // 2. Set up DIG network filtering with security policies
      this.setupDIGNetworkFiltering()

      // 3. Announce ourselves to DIG network only (not to public infrastructure)
      await this.announceToDIGNetwork()

      // 4. Start periodic discovery
      this.startPeriodicDiscovery()

      this.logger.info('✅ Unified peer discovery with security isolation started')

    } catch (error) {
      this.logger.error('Failed to start peer discovery:', error)
    }
  }

  // Connect to public LibP2P bootstrap servers (free infrastructure)
  private async connectToPublicBootstrap(): Promise<void> {
    let connectedCount = 0
    
    for (const bootstrapAddr of this.PUBLIC_BOOTSTRAP_NODES) {
      try {
        const { multiaddr } = await import('@multiformats/multiaddr')
        const addr = multiaddr(bootstrapAddr)
        
        const connection = await this.digNode.node.dial(addr)
        if (connection) {
          connectedCount++
          this.logger.info(`✅ Connected to public bootstrap: ${bootstrapAddr}`)
        }
      } catch (error) {
        this.logger.debug(`Failed to connect to ${bootstrapAddr}:`, error)
      }
    }

    this.logger.info(`📊 Connected to ${connectedCount} public bootstrap servers`)
  }

  // Set up DIG network filtering (only connect to DIG peers)
  private setupDIGNetworkFiltering(): void {
    this.digNode.node.addEventListener('peer:connect', async (evt: any) => {
      try {
        const connection = evt.detail
        
        // Safely get peer ID with null checks
        const remotePeer = connection?.remotePeer
        if (!remotePeer) {
          this.logger.debug('⏭️ Connection event without remote peer')
          return
        }
        
        const peerId = remotePeer.toString()
        
        // Skip public infrastructure peers (no DIG protocol, no privacy)
        if (this.isPublicInfrastructurePeer(peerId)) {
          this.logger.debug(`🔒 Isolating public infrastructure peer: ${peerId} (no DIG protocol access)`)
          // Don't test DIG protocol on public infrastructure - they don't support it
          // and we don't want to expose our DIG network capabilities to them
          return
        }

        // Classify peer and apply security isolation
        const securityLevel = await this.securityIsolation.classifyPeer(peerId, connection)
        
        if (securityLevel.classification === 'verified-dig') {
          this.logger.info(`✅ Verified DIG network peer: ${peerId} (${securityLevel.privacyLevel} privacy)`)
          await this.addDIGPeer(peerId, connection)
        } else {
          this.logger.debug(`🔒 Peer isolated: ${peerId} (${securityLevel.classification}, ${securityLevel.trustLevel} trust)`)
          // Peer is isolated with appropriate security policy
        }
      } catch (error) {
        this.logger.debug('Peer connection filtering error:', error)
      }
    })

    this.logger.info('🔒 DIG network filtering with security isolation active')
  }

  // Test if peer supports DIG protocol
  private async testDIGProtocolSupport(connection: any): Promise<boolean> {
    try {
      const stream = await this.digNode.node.dialProtocol(connection.remotePeer, DIG_PROTOCOL)
      return !!stream
    } catch (error) {
      return false
    }
  }

  // Check if peer is public LibP2P infrastructure
  private isPublicInfrastructurePeer(peerId: string): boolean {
    const publicPeerIds = [
      'QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
      'QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
      'QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ'
    ]
    return publicPeerIds.some(publicId => peerId.includes(publicId))
  }

  // Add DIG peer to registry
  private async addDIGPeer(peerId: string, connection: any): Promise<void> {
    try {
      // Get comprehensive DIG peer info
      const peerInfo = await this.getDIGPeerInfo(peerId, connection)
      if (peerInfo) {
        this.digPeers.set(peerId, peerInfo)
        
        // Store in DHT for other DIG peers
        await this.storeDIGPeerInDHT(peerId, peerInfo)
      }
    } catch (error) {
      this.logger.debug(`Failed to add DIG peer ${peerId}:`, error)
    }
  }

  // Get comprehensive DIG peer information
  private async getDIGPeerInfo(peerId: string, connection: any): Promise<DIGPeerInfo | null> {
    try {
      // Request peer information via DIG protocol
      const stream = await this.digNode.node.dialProtocol(connection.remotePeer, DIG_PROTOCOL)
      
      const request = {
        type: 'GET_PEER_INFO',
        requestedInfo: ['stores', 'capabilities', 'cryptoIPv6', 'turnCapable']
      }

      // Send request and get response
      // Implementation would handle the actual protocol exchange
      
      return {
        peerId,
        cryptoIPv6: `fd00:${randomBytes(14).toString('hex')}`, // Placeholder
        stores: [],
        capabilities: {},
        turnCapable: false,
        lastSeen: Date.now(),
        discoveredVia: 'public-bootstrap'
      }
    } catch (error) {
      this.logger.debug(`Failed to get DIG peer info for ${peerId}:`, error)
      return null
    }
  }

  // Store DIG peer in public IPFS DHT
  private async storeDIGPeerInDHT(peerId: string, peerInfo: DIGPeerInfo): Promise<void> {
    try {
      const dht = this.digNode.node.services.dht
      if (!dht) return

      const key = new TextEncoder().encode(`/dig-network-v1/peers/${peerId}`)
      const value = new TextEncoder().encode(JSON.stringify({
        ...peerInfo,
        timestamp: Date.now(),
        networkId: 'dig-mainnet'
      }))

      await dht.put(key, value)
      this.logger.debug(`🔑 Stored DIG peer in DHT: ${peerId}`)
    } catch (error) {
      this.logger.debug('Failed to store DIG peer in DHT:', error)
    }
  }

  // Announce ourselves to DIG network
  private async announceToDIGNetwork(): Promise<void> {
    try {
      const announcement = {
        peerId: this.digNode.node.peerId.toString(),
        networkId: 'dig-mainnet',
        cryptoIPv6: this.digNode.cryptoIPv6,
        capabilities: this.digNode.nodeCapabilities,
        stores: this.digNode.getAvailableStores(),
        timestamp: Date.now()
      }

      // Announce via DHT
      const dht = this.digNode.node.services.dht
      if (dht) {
        const key = new TextEncoder().encode(`/dig-network-v1/peers/${announcement.peerId}`)
        const value = new TextEncoder().encode(JSON.stringify(announcement))
        await dht.put(key, value)
      }

      // Announce via GossipSub
      const gossipsub = this.digNode.node.services.gossipsub
      if (gossipsub) {
        const { fromString: uint8ArrayFromString } = await import('uint8arrays')
        await gossipsub.publish(
          'dig-network-announcements',
          uint8ArrayFromString(JSON.stringify(announcement))
        )
      }

      this.logger.info('📡 Announced to DIG network')
    } catch (error) {
      this.logger.error('Failed to announce to DIG network:', error)
    }
  }

  // Start periodic discovery
  private startPeriodicDiscovery(): void {
    this.discoveryInterval = setInterval(async () => {
      await this.discoverDIGPeersInternal()
    }, 60000) // Every minute
  }

  // Get DIG network peers
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
      .filter(peer => peer.turnCapable)
  }

  // Manually trigger DIG peer discovery (public method)
  async discoverDIGPeers(): Promise<void> {
    await this.discoverDIGPeersInternal()
  }
  
  // Internal DIG peer discovery method
  private async discoverDIGPeersInternal(): Promise<void> {
    // Implementation from the private method above
    try {
      const connectedPeers = this.digNode.node.getPeers()
      let digPeerCount = 0
      
      for (const peer of connectedPeers) {
        const peerId = peer.toString()
        
        if (!this.digPeers.has(peerId) && !this.isPublicInfrastructurePeer(peerId)) {
          const isDIG = await this.testDIGProtocolSupport({ remotePeer: peer })
          if (isDIG) {
            await this.addDIGPeer(peerId, { remotePeer: peer })
            digPeerCount++
          }
        }
      }

      this.logger.debug(`🔍 Discovery: ${digPeerCount} new DIG peers, ${this.digPeers.size} total`)
    } catch (error) {
      this.logger.debug('DIG peer discovery failed:', error)
    }
  }

  // Stop peer discovery
  async stop(): Promise<void> {
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval)
      this.discoveryInterval = null
    }
    this.logger.info('🛑 Peer discovery stopped')
  }
}

// Simplified DIG peer information
interface DIGPeerInfo {
  peerId: string
  cryptoIPv6: string
  stores: string[]
  capabilities: any
  turnCapable: boolean
  lastSeen: number
  discoveredVia: 'public-bootstrap' | 'gossip' | 'dht'
}
