/**
 * Decentralized TURN Coordination System
 * 
 * Eliminates centralized signaling dependencies by using:
 * - DHT-based TURN server discovery and signaling
 * - Gossip network for real-time TURN availability
 * - Peer-to-peer signaling through connected peers
 * - Distributed TURN server registry
 * - Multi-hop signaling for NAT traversal
 * - Redundant signaling paths
 */

import { createHash } from 'crypto'
import { Logger } from './logger.js'

export class DecentralizedTurnCoordination {
  private logger = new Logger('DecentralizedTURN')
  private digNode: any
  private turnServerRegistry = new Map<string, DecentralizedTurnServer>()
  private signalingRoutes = new Map<string, SignalingRoute[]>()
  private pendingSignals = new Map<string, PendingSignal>()

  constructor(digNode: any) {
    this.digNode = digNode
  }

  // Initialize decentralized TURN coordination
  async initialize(): Promise<void> {
    try {
      this.logger.info('🌐 Initializing decentralized TURN coordination...')

      // 1. Discover TURN servers via DHT
      await this.discoverTurnServersViaDHT()

      // 2. Subscribe to TURN server announcements via gossip
      await this.subscribeToTurnServerGossip()

      // 3. Establish multi-hop signaling routes
      await this.establishSignalingRoutes()

      // 4. Start periodic TURN server health monitoring
      this.startTurnServerHealthMonitoring()

      this.logger.info('✅ Decentralized TURN coordination initialized')

    } catch (error) {
      this.logger.error('Failed to initialize decentralized TURN coordination:', error)
    }
  }

  // Discover TURN servers via distributed hash table (no central server)
  private async discoverTurnServersViaDHT(): Promise<void> {
    try {
      const dht = this.digNode.node.services.dht
      if (!dht) return

      this.logger.info('🔍 Discovering TURN servers via DHT...')

      // Search for TURN server announcements in DHT
      const turnServerKey = new TextEncoder().encode('/dig-turn-servers/registry')
      
      for await (const event of dht.get(turnServerKey)) {
        if (event.name === 'VALUE') {
          try {
            const turnServerInfo = JSON.parse(new TextDecoder().decode(event.value))
            
            if (this.validateTurnServerInfo(turnServerInfo)) {
              this.turnServerRegistry.set(turnServerInfo.peerId, {
                ...turnServerInfo,
                discoveredVia: 'dht',
                lastSeen: Date.now(),
                healthStatus: 'unknown'
              })
              
              this.logger.info(`📡 Discovered TURN server via DHT: ${turnServerInfo.peerId}`)
            }
          } catch (parseError) {
            this.logger.debug('Invalid TURN server data in DHT:', parseError)
          }
        }
      }

      this.logger.info(`📊 DHT discovery complete: ${this.turnServerRegistry.size} TURN servers found`)

    } catch (error) {
      this.logger.debug('DHT TURN server discovery failed:', error)
    }
  }

  // Subscribe to TURN server announcements via gossip network
  private async subscribeToTurnServerGossip(): Promise<void> {
    try {
      const gossipsub = this.digNode.node.services.gossipsub
      if (!gossipsub) return

      this.logger.info('🗣️ Subscribing to TURN server gossip...')

      // Subscribe to TURN server announcements
      await gossipsub.subscribe('dig-turn-server-announcements')
      await gossipsub.subscribe('dig-turn-server-availability')

      // Handle TURN server announcements
      gossipsub.addEventListener('message', (evt: any) => {
        const { topic, data } = evt.detail
        
        if (topic === 'dig-turn-server-announcements') {
          this.handleTurnServerAnnouncement(data)
        } else if (topic === 'dig-turn-server-availability') {
          this.handleTurnServerAvailability(data)
        }
      })

      this.logger.info('✅ Subscribed to TURN server gossip network')

    } catch (error) {
      this.logger.debug('TURN server gossip subscription failed:', error)
    }
  }

  // Establish multi-hop signaling routes for decentralized signaling
  private async establishSignalingRoutes(): Promise<void> {
    try {
      this.logger.info('🕸️ Establishing decentralized signaling routes...')

      const connectedPeers = this.digNode.node.getPeers()
      
      for (const peer of connectedPeers) {
        const peerId = peer.toString()
        
        // Create signaling route through this peer
        const route: SignalingRoute = {
          peerId,
          hopCount: 1,
          reliability: 0.9, // Initial reliability score
          lastUsed: 0,
          capabilities: ['peer-signaling', 'message-relay']
        }

        // Store route
        if (!this.signalingRoutes.has(peerId)) {
          this.signalingRoutes.set(peerId, [])
        }
        this.signalingRoutes.get(peerId)!.push(route)

        this.logger.debug(`🔗 Established signaling route via ${peerId}`)
      }

      // Discover multi-hop routes through connected peers
      await this.discoverMultiHopSignalingRoutes()

      this.logger.info(`🕸️ Signaling routes established: ${this.signalingRoutes.size} direct routes`)

    } catch (error) {
      this.logger.debug('Signaling route establishment failed:', error)
    }
  }

  // Request file transfer using decentralized TURN coordination
  async requestFileViaDecentralizedTurn(storeId: string, sourcePeerId: string): Promise<Buffer | null> {
    try {
      this.logger.info(`📥 Requesting file via decentralized TURN: ${storeId} from ${sourcePeerId}`)

      // 1. Select best TURN server from decentralized registry
      const bestTurnServer = this.selectBestTurnServer()
      if (!bestTurnServer) {
        throw new Error('No TURN servers available in decentralized registry')
      }

      // 2. Signal source peer via multiple decentralized paths
      const signalSuccess = await this.signalPeerViaDecentralizedRoutes(
        sourcePeerId, 
        bestTurnServer, 
        storeId
      )

      if (!signalSuccess) {
        throw new Error('Failed to signal source peer via decentralized routes')
      }

      // 3. Establish on-demand connection to TURN server
      // For now, return null as placeholder
      const transferData = null // await this.coordinateDecentralizedTransfer(storeId, sourcePeerId, bestTurnServer)

      return transferData

    } catch (error) {
      this.logger.error(`Decentralized TURN request failed for ${storeId}:`, error)
      return null
    }
  }

  // Signal peer via multiple decentralized routes (no single point of failure)
  private async signalPeerViaDecentralizedRoutes(
    targetPeerId: string, 
    turnServerInfo: DecentralizedTurnServer, 
    storeId: string
  ): Promise<boolean> {
    try {
      this.logger.info(`📡 Signaling ${targetPeerId} via decentralized routes...`)

      const signalMessage = {
        type: 'DECENTRALIZED_TURN_SIGNAL',
        targetPeerId,
        turnServerInfo,
        storeId,
        requestId: `decentralized_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        hopLimit: 5, // Maximum 5 hops
        signalPath: [this.digNode.node.peerId.toString()]
      }

      // Try multiple signaling methods simultaneously
      const signalingAttempts = [
        this.signalViaDHT(targetPeerId, signalMessage),
        this.signalViaGossip(signalMessage),
        this.signalViaConnectedPeers(targetPeerId, signalMessage),
        this.signalViaMultiHopRouting(targetPeerId, signalMessage)
      ]

      // Wait for any signaling method to succeed
      const results = await Promise.allSettled(signalingAttempts)
      const successCount = results.filter(r => r.status === 'fulfilled').length

      this.logger.info(`📊 Decentralized signaling: ${successCount}/4 methods succeeded`)

      return successCount > 0

    } catch (error) {
      this.logger.error(`Decentralized signaling failed for ${targetPeerId}:`, error)
      return false
    }
  }

  // Signal via DHT (distributed hash table)
  private async signalViaDHT(targetPeerId: string, signalMessage: any): Promise<void> {
    try {
      const dht = this.digNode.node.services.dht
      if (!dht) throw new Error('DHT not available')

      // Store signal in DHT for target peer to find
      const signalKey = new TextEncoder().encode(`/dig-turn-signal/${targetPeerId}`)
      const signalValue = new TextEncoder().encode(JSON.stringify(signalMessage))

      await dht.put(signalKey, signalValue)
      this.logger.debug(`📡 Stored TURN signal in DHT for ${targetPeerId}`)

    } catch (error) {
      this.logger.debug(`DHT signaling failed:`, error)
      throw error
    }
  }

  // Signal via gossip network (real-time broadcast)
  private async signalViaGossip(signalMessage: any): Promise<void> {
    try {
      const gossipsub = this.digNode.node.services.gossipsub
      if (!gossipsub) throw new Error('Gossipsub not available')

      // Broadcast signal via gossip network
      const { fromString: uint8ArrayFromString } = await import('uint8arrays')
      
      await gossipsub.publish(
        'dig-turn-coordination-signals',
        uint8ArrayFromString(JSON.stringify(signalMessage))
      )

      this.logger.debug(`📡 Broadcasted TURN signal via gossip`)

    } catch (error) {
      this.logger.debug(`Gossip signaling failed:`, error)
      throw error
    }
  }

  // Signal via connected peers (multi-hop routing)
  private async signalViaConnectedPeers(targetPeerId: string, signalMessage: any): Promise<void> {
    try {
      const connectedPeers = this.digNode.node.getPeers()
      
      for (const peer of connectedPeers.slice(0, 3)) { // Try 3 peers
        try {
          const stream = await this.digNode.node.dialProtocol(peer, '/dig/1.0.0')
          
          const relayRequest = {
            type: 'RELAY_TURN_SIGNAL',
            targetPeerId,
            signalMessage,
            hopCount: signalMessage.signalPath.length
          }

          const { pipe } = await import('it-pipe')
          const { fromString: uint8ArrayFromString } = await import('uint8arrays')

          await pipe(async function* () {
            yield uint8ArrayFromString(JSON.stringify(relayRequest))
          }, stream.sink)

          this.logger.debug(`📡 Sent TURN signal via peer ${peer.toString()}`)

        } catch (error) {
          // Silent failure - try next peer
        }
      }

    } catch (error) {
      this.logger.debug(`Peer signaling failed:`, error)
      throw error
    }
  }

  // Signal via multi-hop routing (mesh network)
  private async signalViaMultiHopRouting(targetPeerId: string, signalMessage: any): Promise<void> {
    try {
      // Find route to target peer through mesh network
      const routes = this.signalingRoutes.get(targetPeerId) || []
      
      for (const route of routes.slice(0, 2)) { // Try 2 best routes
        try {
          await this.sendSignalViaRoute(route, signalMessage)
          this.logger.debug(`📡 Sent TURN signal via route ${route.peerId}`)
        } catch (error) {
          // Silent failure - try next route
        }
      }

    } catch (error) {
      this.logger.debug(`Multi-hop signaling failed:`, error)
      throw error
    }
  }

  // Select best TURN server from decentralized registry
  private selectBestTurnServer(): DecentralizedTurnServer | null {
    const availableServers = Array.from(this.turnServerRegistry.values())
      .filter(server => server.healthStatus === 'healthy' || server.healthStatus === 'unknown')
      .sort((a, b) => (a.currentLoad || 0) - (b.currentLoad || 0))

    return availableServers[0] || null
  }

  // Handle TURN server announcements from gossip
  private async handleTurnServerAnnouncement(data: Uint8Array): Promise<void> {
    try {
      const { toString: uint8ArrayToString } = await import('uint8arrays')
      const announcement = JSON.parse(uint8ArrayToString(data))
      
      if (this.validateTurnServerInfo(announcement)) {
        this.turnServerRegistry.set(announcement.peerId, {
          ...announcement,
          discoveredVia: 'gossip',
          lastSeen: Date.now(),
          healthStatus: 'healthy'
        })
        
        this.logger.info(`📡 TURN server announced via gossip: ${announcement.peerId}`)
      }

    } catch (error) {
      this.logger.debug('Invalid TURN server announcement:', error)
    }
  }

  // Handle TURN server availability updates
  private async handleTurnServerAvailability(data: Uint8Array): Promise<void> {
    try {
      const { toString: uint8ArrayToString } = await import('uint8arrays')
      const availability = JSON.parse(uint8ArrayToString(data))
      
      const server = this.turnServerRegistry.get(availability.peerId)
      if (server) {
        server.currentLoad = availability.currentLoad || 0
        server.maxCapacity = availability.maxCapacity || 10
        server.healthStatus = availability.status || 'unknown'
        server.lastSeen = Date.now()
        
        this.logger.debug(`📊 TURN server availability update: ${availability.peerId} (load: ${availability.currentLoad})`)
      }

    } catch (error) {
      this.logger.debug('Invalid TURN availability update:', error)
    }
  }

  // Announce ourselves as TURN server to decentralized network
  async announceTurnServerCapability(): Promise<void> {
    try {
      if (!this.digNode.nodeCapabilities.turnServer) return

      const announcement = {
        peerId: this.digNode.node.peerId.toString(),
        cryptoIPv6: this.digNode.cryptoIPv6,
        type: 'peer',
        capabilities: ['file-relay', 'chunk-relay', 'websocket-coordination'],
        maxCapacity: 10,
        currentLoad: 0,
        addresses: this.digNode.node.getMultiaddrs().map((addr: any) => addr.toString()),
        timestamp: Date.now(),
        networkId: process.env.DIG_NETWORK_ID || 'mainnet'
      }

      // Announce via DHT
      const dht = this.digNode.node.services.dht
      if (dht) {
        const key = new TextEncoder().encode('/dig-turn-servers/registry')
        const value = new TextEncoder().encode(JSON.stringify(announcement))
        await dht.put(key, value)
        this.logger.info('📡 Announced TURN capability to DHT')
      }

      // Announce via gossip
      const gossipsub = this.digNode.node.services.gossipsub
      if (gossipsub) {
        const { fromString: uint8ArrayFromString } = await import('uint8arrays')
        await gossipsub.publish(
          'dig-turn-server-announcements',
          uint8ArrayFromString(JSON.stringify(announcement))
        )
        this.logger.info('📡 Announced TURN capability via gossip')
      }

    } catch (error) {
      this.logger.error('Failed to announce TURN capability:', error)
    }
  }

  // Discover multi-hop signaling routes through mesh network
  private async discoverMultiHopSignalingRoutes(): Promise<void> {
    try {
      this.logger.info('🕸️ Discovering multi-hop signaling routes...')

      const connectedPeers = this.digNode.node.getPeers()
      
      for (const peer of connectedPeers) {
        try {
          // Ask peer for their signaling routes
          const routes = await this.requestSignalingRoutesFromPeer(peer.toString())
          
          for (const route of routes) {
            // Add multi-hop route (peer → route.peerId)
            const multiHopRoute: SignalingRoute = {
              peerId: route.peerId,
              hopCount: route.hopCount + 1,
              reliability: route.reliability * 0.9, // Decrease reliability with hops
              lastUsed: 0,
              capabilities: route.capabilities,
              nextHop: peer.toString()
            }

            if (!this.signalingRoutes.has(route.peerId)) {
              this.signalingRoutes.set(route.peerId, [])
            }
            this.signalingRoutes.get(route.peerId)!.push(multiHopRoute)
          }

        } catch (error) {
          // Silent failure - peer might not support route discovery
        }
      }

      this.logger.info(`🕸️ Multi-hop route discovery complete: ${this.signalingRoutes.size} destinations`)

    } catch (error) {
      this.logger.debug('Multi-hop route discovery failed:', error)
    }
  }

  // Request signaling routes from peer
  private async requestSignalingRoutesFromPeer(peerId: string): Promise<SignalingRoute[]> {
    try {
      const peer = this.digNode.node.getPeers().find((p: any) => p.toString() === peerId)
      if (!peer) return []

      const stream = await this.digNode.node.dialProtocol(peer, '/dig/1.0.0')
      
      const routeRequest = {
        type: 'REQUEST_SIGNALING_ROUTES',
        requestId: `route_req_${Date.now()}`
      }

      const { pipe } = await import('it-pipe')
      const { fromString: uint8ArrayFromString, toString: uint8ArrayToString } = await import('uint8arrays')

      await pipe(async function* () {
        yield uint8ArrayFromString(JSON.stringify(routeRequest))
      }, stream.sink)

      // Read response
      const chunks: Uint8Array[] = []
      await pipe(stream.source, async function (source: any) {
        for await (const chunk of source) {
          chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk.subarray()))
        }
      })

      if (chunks.length > 0) {
        const response = JSON.parse(uint8ArrayToString(chunks[0]))
        if (response.success && response.routes) {
          return response.routes
        }
      }

      return []

    } catch (error) {
      this.logger.debug(`Failed to get signaling routes from ${peerId}:`, error)
      return []
    }
  }

  // Send signal via specific route
  private async sendSignalViaRoute(route: SignalingRoute, signalMessage: any): Promise<void> {
    try {
      const peer = this.digNode.node.getPeers().find((p: any) => p.toString() === route.peerId)
      if (!peer) throw new Error('Route peer not connected')

      const stream = await this.digNode.node.dialProtocol(peer, '/dig/1.0.0')
      
      const relayMessage = {
        type: 'RELAY_TURN_SIGNAL',
        targetPeerId: signalMessage.targetPeerId,
        signalMessage,
        routeInfo: route
      }

      const { pipe } = await import('it-pipe')
      const { fromString: uint8ArrayFromString } = await import('uint8arrays')

      await pipe(async function* () {
        yield uint8ArrayFromString(JSON.stringify(relayMessage))
      }, stream.sink)

      route.lastUsed = Date.now()
      route.reliability = Math.min(route.reliability + 0.1, 1.0) // Increase reliability on success

    } catch (error) {
      route.reliability = Math.max(route.reliability - 0.2, 0.1) // Decrease reliability on failure
      throw error
    }
  }

  // Start periodic TURN server health monitoring
  private startTurnServerHealthMonitoring(): void {
    setInterval(async () => {
      await this.monitorTurnServerHealth()
    }, 60000) // Every minute

    setInterval(async () => {
      await this.announceTurnServerCapability()
    }, 5 * 60000) // Every 5 minutes
  }

  // Monitor health of discovered TURN servers
  private async monitorTurnServerHealth(): Promise<void> {
    try {
      let healthyCount = 0
      
      for (const [peerId, server] of this.turnServerRegistry) {
        try {
          const isHealthy = await this.testTurnServerHealth(server)
          server.healthStatus = isHealthy ? 'healthy' : 'unhealthy'
          server.lastSeen = Date.now()
          
          if (isHealthy) healthyCount++

        } catch (error) {
          server.healthStatus = 'unhealthy'
        }
      }

      this.logger.debug(`📊 TURN server health: ${healthyCount}/${this.turnServerRegistry.size} healthy`)

    } catch (error) {
      this.logger.debug('TURN server health monitoring failed:', error)
    }
  }

  // Test TURN server health
  private async testTurnServerHealth(server: DecentralizedTurnServer): Promise<boolean> {
    try {
      if (server.type === 'bootstrap') {
        // Test bootstrap server health
        const response = await fetch(`${server.url}/health`, {
          signal: AbortSignal.timeout(5000)
        })
        return response.ok
      } else {
        // Test peer TURN server health
        const peer = this.digNode.node.getPeers().find((p: any) => p.toString() === server.peerId)
        return peer !== undefined
      }
    } catch (error) {
      return false
    }
  }

  // Validate TURN server information
  private validateTurnServerInfo(info: any): boolean {
    return !!(
      info.peerId &&
      info.type &&
      (info.url || info.addresses) &&
      typeof info.maxCapacity === 'number'
    )
  }

  // Get decentralized TURN server statistics
  getDecentralizedTurnStats(): DecentralizedTurnStats {
    const servers = Array.from(this.turnServerRegistry.values())
    
    return {
      totalServers: servers.length,
      healthyServers: servers.filter(s => s.healthStatus === 'healthy').length,
      bootstrapServers: servers.filter(s => s.type === 'bootstrap').length,
      peerServers: servers.filter(s => s.type === 'peer').length,
      averageLoad: servers.reduce((sum, s) => sum + (s.currentLoad || 0), 0) / servers.length,
      signalingRoutes: this.signalingRoutes.size,
      discoveryMethods: ['dht', 'gossip', 'peer-routes', 'multi-hop']
    }
  }
}

// Decentralized TURN server registry entry
interface DecentralizedTurnServer {
  peerId: string
  type: 'bootstrap' | 'peer'
  url?: string
  addresses?: string[]
  cryptoIPv6?: string
  capabilities: string[]
  maxCapacity: number
  currentLoad?: number
  healthStatus: 'healthy' | 'unhealthy' | 'unknown'
  discoveredVia: 'dht' | 'gossip' | 'peer-routes'
  lastSeen: number
}

// Signaling route through mesh network
interface SignalingRoute {
  peerId: string
  hopCount: number
  reliability: number
  lastUsed: number
  capabilities: string[]
  nextHop?: string
}

// Pending signal coordination
interface PendingSignal {
  requestId: string
  targetPeerId: string
  signalMessage: any
  attempts: number
  createdAt: number
}

// Decentralized TURN statistics
interface DecentralizedTurnStats {
  totalServers: number
  healthyServers: number
  bootstrapServers: number
  peerServers: number
  averageLoad: number
  signalingRoutes: number
  discoveryMethods: string[]
}
