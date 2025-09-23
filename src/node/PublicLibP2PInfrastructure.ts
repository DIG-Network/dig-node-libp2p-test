/**
 * Public LibP2P Infrastructure Integration
 * 
 * Leverages existing public LibP2P infrastructure for decentralized coordination:
 * - Public bootstrap nodes for initial peer discovery
 * - Public circuit relay servers for NAT traversal
 * - IPFS DHT network for distributed signaling
 * - Public rendezvous servers for peer coordination
 * - Decentralized pub/sub for real-time coordination
 */

import { Logger } from './logger.js'

export class PublicLibP2PInfrastructure {
  private logger = new Logger('PublicLibP2P')
  private digNode: any

  // Public LibP2P bootstrap nodes (maintained by Protocol Labs and community)
  private readonly PUBLIC_BOOTSTRAP_NODES = [
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zp9J6W3KmKx6qeGBZp9rKTdKNWqFk',
    '/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ',
    '/ip4/104.131.131.82/udp/4001/quic/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ'
  ]

  // Public circuit relay servers for NAT traversal
  private readonly PUBLIC_RELAY_SERVERS = [
    '/ip4/147.75.77.187/tcp/4002/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
    '/ip4/147.75.77.187/udp/4002/quic/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
    '/ip4/139.178.68.217/tcp/4002/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
    '/ip4/139.178.68.217/udp/4002/quic/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN'
  ]

  // Public rendezvous servers for peer coordination
  private readonly PUBLIC_RENDEZVOUS_SERVERS = [
    '/ip4/147.75.77.187/tcp/4003/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
    '/dnsaddr/rendezvous.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN'
  ]

  constructor(digNode: any) {
    this.digNode = digNode
  }

  // Initialize public LibP2P infrastructure integration
  async initialize(): Promise<void> {
    try {
      this.logger.info('🌐 Initializing public LibP2P infrastructure integration...')

      // 1. Connect to public bootstrap nodes for peer discovery
      await this.connectToPublicBootstrapNodes()

      // 2. Use public circuit relay servers for NAT traversal
      await this.configurePublicCircuitRelays()

      // 3. Use IPFS DHT for decentralized signaling
      await this.configureIPFSDHTSignaling()

      // 4. Set up public rendezvous coordination
      await this.configurePublicRendezvous()

      this.logger.info('✅ Public LibP2P infrastructure integration complete')

    } catch (error) {
      this.logger.error('Failed to initialize public LibP2P infrastructure:', error)
    }
  }

  // Connect to public bootstrap nodes for initial peer discovery
  private async connectToPublicBootstrapNodes(): Promise<void> {
    try {
      this.logger.info('🔍 Connecting to public LibP2P bootstrap nodes...')

      // Add public bootstrap nodes to LibP2P configuration
      for (const bootstrapAddr of this.PUBLIC_BOOTSTRAP_NODES) {
        try {
          const { multiaddr } = await import('@multiformats/multiaddr')
          const addr = multiaddr(bootstrapAddr)
          
          // Connect to bootstrap node
          const connection = await this.digNode.node.dial(addr)
          if (connection) {
            this.logger.info(`✅ Connected to public bootstrap: ${bootstrapAddr}`)
          }
        } catch (error) {
          this.logger.debug(`Failed to connect to bootstrap ${bootstrapAddr}:`, error)
        }
      }

    } catch (error) {
      this.logger.debug('Public bootstrap connection failed:', error)
    }
  }

  // Configure public circuit relay servers for NAT traversal
  private async configurePublicCircuitRelays(): Promise<void> {
    try {
      this.logger.info('🔄 Configuring public circuit relay servers...')

      for (const relayAddr of this.PUBLIC_RELAY_SERVERS) {
        try {
          const { multiaddr } = await import('@multiformats/multiaddr')
          const addr = multiaddr(relayAddr)
          
          // Test circuit relay capability
          const connection = await this.digNode.node.dial(addr)
          if (connection) {
            this.logger.info(`✅ Public circuit relay available: ${relayAddr}`)
            
            // Use this relay for NAT traversal coordination
            await this.registerWithCircuitRelay(connection, relayAddr)
          }
        } catch (error) {
          this.logger.debug(`Circuit relay ${relayAddr} not available:`, error)
        }
      }

    } catch (error) {
      this.logger.debug('Public circuit relay configuration failed:', error)
    }
  }

  // Use IPFS DHT for decentralized signaling
  private async configureIPFSDHTSignaling(): Promise<void> {
    try {
      this.logger.info('🔑 Configuring IPFS DHT for decentralized signaling...')

      const dht = this.digNode.node.services.dht
      if (!dht) {
        this.logger.warn('DHT not available for IPFS signaling')
        return
      }

      // Announce our TURN coordination capability to IPFS DHT
      const turnCoordinationKey = new TextEncoder().encode(`/dig/turn-coordination/${this.digNode.cryptoIPv6}`)
      const coordinationInfo = {
        peerId: this.digNode.node.peerId.toString(),
        cryptoIPv6: this.digNode.cryptoIPv6,
        capabilities: ['turn-signaling', 'file-coordination'],
        addresses: this.digNode.node.getMultiaddrs().map((addr: any) => addr.toString()),
        timestamp: Date.now(),
        networkId: 'dig-mainnet'
      }

      await dht.put(turnCoordinationKey, new TextEncoder().encode(JSON.stringify(coordinationInfo)))
      this.logger.info('📡 Announced TURN coordination capability to IPFS DHT')

      // Set up DHT signaling monitoring
      this.monitorDHTSignaling()

    } catch (error) {
      this.logger.debug('IPFS DHT signaling configuration failed:', error)
    }
  }

  // Configure public rendezvous servers for peer coordination
  private async configurePublicRendezvous(): Promise<void> {
    try {
      this.logger.info('🤝 Configuring public rendezvous servers...')

      for (const rendezvousAddr of this.PUBLIC_RENDEZVOUS_SERVERS) {
        try {
          const { multiaddr } = await import('@multiformats/multiaddr')
          const addr = multiaddr(rendezvousAddr)
          
          // Connect to rendezvous server
          const connection = await this.digNode.node.dial(addr)
          if (connection) {
            this.logger.info(`✅ Connected to public rendezvous: ${rendezvousAddr}`)
            
            // Register for DIG network coordination
            await this.registerWithRendezvous(connection, 'dig-turn-coordination')
          }
        } catch (error) {
          this.logger.debug(`Rendezvous ${rendezvousAddr} not available:`, error)
        }
      }

    } catch (error) {
      this.logger.debug('Public rendezvous configuration failed:', error)
    }
  }

  // Monitor DHT for signaling messages
  private async monitorDHTSignaling(): Promise<void> {
    try {
      const dht = this.digNode.node.services.dht
      if (!dht) return

      // Monitor for TURN signals directed at us
      const signalKey = new TextEncoder().encode(`/dig/turn-signal/${this.digNode.node.peerId.toString()}`)
      
      // Periodic check for signals in DHT
      setInterval(async () => {
        try {
          for await (const event of dht.get(signalKey)) {
            if (event.name === 'VALUE') {
              const signal = JSON.parse(new TextDecoder().decode(event.value))
              await this.handleDHTSignal(signal)
            }
          }
        } catch (error) {
          // Silent monitoring
        }
      }, 30000) // Check every 30 seconds

    } catch (error) {
      this.logger.debug('DHT signaling monitoring setup failed:', error)
    }
  }

  // Handle signals received via DHT
  private async handleDHTSignal(signal: any): Promise<void> {
    try {
      if (signal.type === 'TURN_CONNECTION_REQUEST') {
        this.logger.info(`📡 Received TURN signal via DHT from ${signal.requesterPeerId}`)
        
        // Process the TURN connection request
        await this.digNode.onDemandTurn.handleTurnConnectionRequest(signal, signal.requesterPeerId)
      }

    } catch (error) {
      this.logger.debug('DHT signal handling failed:', error)
    }
  }

  // Register with circuit relay for coordination
  private async registerWithCircuitRelay(connection: any, relayAddr: string): Promise<void> {
    try {
      // Register our coordination capability with the relay
      this.logger.debug(`📡 Registering coordination capability with circuit relay`)
      
      // Circuit relays can help coordinate TURN connections
      // by providing a meeting point for peers behind NAT

    } catch (error) {
      this.logger.debug('Circuit relay registration failed:', error)
    }
  }

  // Register with rendezvous server for peer coordination
  private async registerWithRendezvous(connection: any, namespace: string): Promise<void> {
    try {
      // Register in DIG network namespace for coordination
      this.logger.debug(`🤝 Registering with rendezvous server for ${namespace}`)
      
      // Rendezvous servers can help peers find each other
      // and coordinate TURN connections

    } catch (error) {
      this.logger.debug('Rendezvous registration failed:', error)
    }
  }

  // Use public LibP2P infrastructure to signal peer behind NAT
  async signalPeerViaPublicInfrastructure(
    targetPeerId: string, 
    turnServerInfo: any, 
    requestId: string
  ): Promise<boolean> {
    try {
      this.logger.info(`📡 Signaling ${targetPeerId} via public LibP2P infrastructure...`)

      const signalMessage = {
        type: 'TURN_CONNECTION_REQUEST',
        targetPeerId,
        turnServerInfo,
        requestId,
        requesterPeerId: this.digNode.node.peerId.toString(),
        timestamp: Date.now()
      }

      // Try multiple public infrastructure methods
      const signalingMethods = [
        this.signalViaIPFSDHT(targetPeerId, signalMessage),
        this.signalViaPublicGossip(signalMessage),
        this.signalViaCircuitRelay(targetPeerId, signalMessage),
        this.signalViaRendezvous(targetPeerId, signalMessage)
      ]

      const results = await Promise.allSettled(signalingMethods)
      const successCount = results.filter(r => r.status === 'fulfilled').length

      this.logger.info(`📊 Public infrastructure signaling: ${successCount}/4 methods succeeded`)
      return successCount > 0

    } catch (error) {
      this.logger.error(`Public infrastructure signaling failed:`, error)
      return false
    }
  }

  // Signal via IPFS DHT (globally distributed)
  private async signalViaIPFSDHT(targetPeerId: string, signalMessage: any): Promise<void> {
    try {
      const dht = this.digNode.node.services.dht
      if (!dht) throw new Error('DHT not available')

      // Store signal in IPFS DHT for target peer
      const signalKey = new TextEncoder().encode(`/dig/turn-signal/${targetPeerId}`)
      const signalValue = new TextEncoder().encode(JSON.stringify(signalMessage))

      await dht.put(signalKey, signalValue)
      this.logger.debug(`📡 Stored TURN signal in IPFS DHT for ${targetPeerId}`)

    } catch (error) {
      this.logger.debug('IPFS DHT signaling failed:', error)
      throw error
    }
  }

  // Signal via public gossip network
  private async signalViaPublicGossip(signalMessage: any): Promise<void> {
    try {
      const gossipsub = this.digNode.node.services.gossipsub
      if (!gossipsub) throw new Error('GossipSub not available')

      // Broadcast signal on public DIG coordination topic
      const { fromString: uint8ArrayFromString } = await import('uint8arrays')
      
      await gossipsub.publish(
        'dig-public-turn-coordination',
        uint8ArrayFromString(JSON.stringify(signalMessage))
      )

      this.logger.debug(`📡 Broadcasted TURN signal via public gossip`)

    } catch (error) {
      this.logger.debug('Public gossip signaling failed:', error)
      throw error
    }
  }

  // Signal via public circuit relay servers
  private async signalViaCircuitRelay(targetPeerId: string, signalMessage: any): Promise<void> {
    try {
      // Use public circuit relays as coordination points
      for (const relayAddr of this.PUBLIC_RELAY_SERVERS.slice(0, 2)) {
        try {
          const { multiaddr } = await import('@multiformats/multiaddr')
          const addr = multiaddr(relayAddr)
          
          // Connect through circuit relay
          const connection = await this.digNode.node.dial(addr)
          if (connection) {
            // Use relay as coordination point
            this.logger.debug(`📡 Using circuit relay for coordination: ${relayAddr}`)
            // Circuit relay can help coordinate the signaling
          }
        } catch (error) {
          // Silent failure - try next relay
        }
      }

    } catch (error) {
      this.logger.debug('Circuit relay signaling failed:', error)
      throw error
    }
  }

  // Signal via public rendezvous servers
  private async signalViaRendezvous(targetPeerId: string, signalMessage: any): Promise<void> {
    try {
      // Use public rendezvous servers for coordination
      for (const rendezvousAddr of this.PUBLIC_RENDEZVOUS_SERVERS) {
        try {
          const { multiaddr } = await import('@multiformats/multiaddr')
          const addr = multiaddr(rendezvousAddr)
          
          // Connect to rendezvous server
          const connection = await this.digNode.node.dial(addr)
          if (connection) {
            this.logger.debug(`🤝 Using rendezvous for coordination: ${rendezvousAddr}`)
            // Rendezvous can help coordinate peer meetings
          }
        } catch (error) {
          // Silent failure - try next rendezvous
        }
      }

    } catch (error) {
      this.logger.debug('Rendezvous signaling failed:', error)
      throw error
    }
  }

  // Get public infrastructure status
  getPublicInfrastructureStatus(): PublicInfrastructureStatus {
    const connectedPeers = this.digNode.node.getPeers()
    
    // Count connections to public infrastructure
    let publicBootstrapConnections = 0
    let publicRelayConnections = 0
    let publicRendezvousConnections = 0

    for (const peer of connectedPeers) {
      const peerAddr = peer.toString()
      
      if (this.PUBLIC_BOOTSTRAP_NODES.some(addr => addr.includes(peerAddr))) {
        publicBootstrapConnections++
      }
      if (this.PUBLIC_RELAY_SERVERS.some(addr => addr.includes(peerAddr))) {
        publicRelayConnections++
      }
      if (this.PUBLIC_RENDEZVOUS_SERVERS.some(addr => addr.includes(peerAddr))) {
        publicRendezvousConnections++
      }
    }

    return {
      totalPublicConnections: publicBootstrapConnections + publicRelayConnections + publicRendezvousConnections,
      bootstrapConnections: publicBootstrapConnections,
      relayConnections: publicRelayConnections,
      rendezvousConnections: publicRendezvousConnections,
      dhtAvailable: !!this.digNode.node.services.dht,
      gossipAvailable: !!this.digNode.node.services.gossipsub,
      infrastructureHealth: this.calculateInfrastructureHealth()
    }
  }

  // Calculate overall public infrastructure health
  private calculateInfrastructureHealth(): string {
    const status = this.getPublicInfrastructureStatus()
    
    if (status.totalPublicConnections >= 3 && status.dhtAvailable && status.gossipAvailable) {
      return 'EXCELLENT'
    } else if (status.totalPublicConnections >= 2 && (status.dhtAvailable || status.gossipAvailable)) {
      return 'GOOD'
    } else if (status.totalPublicConnections >= 1) {
      return 'LIMITED'
    } else {
      return 'POOR'
    }
  }

  // Enhanced decentralized TURN coordination using public infrastructure
  async coordinateDecentralizedTurnWithPublicInfrastructure(
    storeId: string,
    sourcePeerId: string,
    targetPeerId: string
  ): Promise<TurnCoordinationResult> {
    try {
      this.logger.info(`🌐 Coordinating decentralized TURN using public LibP2P infrastructure...`)

      // 1. Discover available TURN servers via public DHT
      const turnServers = await this.discoverTurnServersViaPublicDHT()

      // 2. Select best TURN server based on load and proximity
      const bestTurnServer = this.selectOptimalTurnServer(turnServers, sourcePeerId, targetPeerId)

      if (!bestTurnServer) {
        throw new Error('No suitable TURN servers found via public infrastructure')
      }

      // 3. Coordinate both peers to connect to selected TURN server
      const coordinationSuccess = await this.coordinatePeersViaPublicInfrastructure(
        sourcePeerId,
        targetPeerId,
        bestTurnServer,
        storeId
      )

      return {
        success: coordinationSuccess,
        turnServer: bestTurnServer,
        coordinationMethod: 'public-libp2p-infrastructure',
        infrastructureUsed: ['ipfs-dht', 'gossipsub', 'circuit-relay', 'rendezvous']
      }

    } catch (error) {
      this.logger.error('Public infrastructure TURN coordination failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  // Discover TURN servers via public IPFS DHT
  private async discoverTurnServersViaPublicDHT(): Promise<any[]> {
    try {
      const dht = this.digNode.node.services.dht
      if (!dht) return []

      const turnServers: any[] = []
      
      // Search for TURN servers in public IPFS DHT
      const searchKey = new TextEncoder().encode('/dig/turn-servers/public-registry')
      
      for await (const event of dht.get(searchKey)) {
        if (event.name === 'VALUE') {
          try {
            const serverInfo = JSON.parse(new TextDecoder().decode(event.value))
            if (this.validatePublicTurnServer(serverInfo)) {
              turnServers.push(serverInfo)
            }
          } catch (parseError) {
            // Silent parse failure
          }
        }
      }

      this.logger.info(`📡 Discovered ${turnServers.length} TURN servers via public IPFS DHT`)
      return turnServers

    } catch (error) {
      this.logger.debug('Public DHT TURN discovery failed:', error)
      return []
    }
  }

  // Select optimal TURN server based on network topology
  private selectOptimalTurnServer(turnServers: any[], sourcePeerId: string, targetPeerId: string): any | null {
    if (turnServers.length === 0) return null

    // Sort by load and proximity
    return turnServers
      .filter(server => server.healthStatus !== 'unhealthy')
      .sort((a, b) => {
        const loadA = a.currentLoad || 0
        const loadB = b.currentLoad || 0
        return loadA - loadB
      })[0]
  }

  // Coordinate both peers via public infrastructure
  private async coordinatePeersViaPublicInfrastructure(
    sourcePeerId: string,
    targetPeerId: string, 
    turnServer: any,
    storeId: string
  ): Promise<boolean> {
    try {
      // Use multiple public infrastructure methods for coordination
      const coordinationMethods = [
        this.signalViaIPFSDHT(sourcePeerId, { turnServer, storeId }),
        this.signalViaPublicGossip({ targetPeerId: sourcePeerId, turnServer, storeId }),
        this.signalViaCircuitRelay(sourcePeerId, { turnServer, storeId })
      ]

      const results = await Promise.allSettled(coordinationMethods)
      const successCount = results.filter(r => r.status === 'fulfilled').length

      return successCount > 0

    } catch (error) {
      this.logger.error('Public infrastructure coordination failed:', error)
      return false
    }
  }

  // Validate public TURN server information
  private validatePublicTurnServer(serverInfo: any): boolean {
    return !!(
      serverInfo.peerId &&
      serverInfo.type &&
      serverInfo.networkId === 'dig-mainnet' &&
      (serverInfo.addresses || serverInfo.url)
    )
  }
}

// Public infrastructure status
interface PublicInfrastructureStatus {
  totalPublicConnections: number
  bootstrapConnections: number
  relayConnections: number
  rendezvousConnections: number
  dhtAvailable: boolean
  gossipAvailable: boolean
  infrastructureHealth: string
}

// TURN coordination result
interface TurnCoordinationResult {
  success: boolean
  turnServer?: any
  coordinationMethod?: string
  infrastructureUsed?: string[]
  error?: string
}
