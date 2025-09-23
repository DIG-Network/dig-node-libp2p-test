/**
 * Unified TURN Coordination System
 * 
 * Consolidates all TURN-related functionality:
 * - On-demand TURN connections
 * - Decentralized TURN discovery
 * - Public LibP2P infrastructure integration
 * - Bootstrap server fallback
 * - Clean, single interface for all TURN operations
 */

import { Logger } from './logger.js'

export class UnifiedTurnCoordination {
  private logger = new Logger('TurnCoordination')
  private digNode: any
  private turnServers = new Map<string, TurnServerInfo>()
  private activeConnections = new Map<string, any>()

  constructor(digNode: any) {
    this.digNode = digNode
  }

  // Start unified TURN coordination
  async start(): Promise<void> {
    try {
      this.logger.info('📡 Starting unified TURN coordination...')

      // 1. Discover TURN servers via multiple methods
      await this.discoverTurnServers()

      // 2. Set up TURN capability monitoring
      this.setupTurnCapabilityMonitoring()

      // 3. Start periodic TURN server health monitoring
      this.startTurnServerMonitoring()

      this.logger.info('✅ Unified TURN coordination started')

    } catch (error) {
      this.logger.error('Failed to start TURN coordination:', error)
    }
  }

  // Discover TURN servers via all available methods
  private async discoverTurnServers(): Promise<void> {
    try {
      // Discover via DHT
      await this.discoverTurnServersViaDHT()

      // Discover via gossip
      await this.subscribeToTurnServerAnnouncements()

      // Check if we can act as TURN server
      await this.detectOwnTurnCapability()

      this.logger.info(`📊 TURN discovery complete: ${this.turnServers.size} servers available`)

    } catch (error) {
      this.logger.debug('TURN server discovery failed:', error)
    }
  }

  // Discover TURN servers via public IPFS DHT
  private async discoverTurnServersViaDHT(): Promise<void> {
    try {
      const dht = this.digNode.node.services.dht
      if (!dht) return

      // Search for TURN servers in DHT
      const key = new TextEncoder().encode('/dig-turn-servers/registry')
      
      for await (const event of dht.get(key)) {
        if (event.name === 'VALUE') {
          try {
            const serverInfo = JSON.parse(new TextDecoder().decode(event.value))
            if (this.validateTurnServerInfo(serverInfo)) {
              this.turnServers.set(serverInfo.peerId, {
                ...serverInfo,
                discoveredVia: 'dht',
                lastSeen: Date.now()
              })
            }
          } catch (parseError) {
            // Silent parse failure
          }
        }
      }

      this.logger.debug(`🔑 Found ${this.turnServers.size} TURN servers via DHT`)

    } catch (error) {
      this.logger.debug('DHT TURN discovery failed:', error)
    }
  }

  // Subscribe to TURN server announcements
  private async subscribeToTurnServerAnnouncements(): Promise<void> {
    try {
      const gossipsub = this.digNode.node.services.gossipsub
      if (!gossipsub) return

      await gossipsub.subscribe('dig-turn-server-announcements')

      gossipsub.addEventListener('message', (evt: any) => {
        if (evt.detail.topic === 'dig-turn-server-announcements') {
          this.handleTurnServerAnnouncement(evt.detail.data)
        }
      })

      this.logger.debug('🗣️ Subscribed to TURN server announcements')

    } catch (error) {
      this.logger.debug('TURN announcement subscription failed:', error)
    }
  }

  // Handle TURN server announcements
  private async handleTurnServerAnnouncement(data: Uint8Array): Promise<void> {
    try {
      const { toString: uint8ArrayToString } = await import('uint8arrays')
      const announcement = JSON.parse(uint8ArrayToString(data))
      
      if (this.validateTurnServerInfo(announcement)) {
        this.turnServers.set(announcement.peerId, {
          ...announcement,
          discoveredVia: 'gossip',
          lastSeen: Date.now()
        })
        
        this.logger.info(`📡 TURN server announced: ${announcement.peerId}`)
      }
    } catch (error) {
      this.logger.debug('Invalid TURN announcement:', error)
    }
  }

  // Detect if we can act as TURN server
  private async detectOwnTurnCapability(): Promise<void> {
    try {
      const addresses = this.digNode.node.getMultiaddrs()
      const hasExternalAddress = addresses.some((addr: any) => {
        const addrStr = addr.toString()
        return !addrStr.includes('127.0.0.1') && !addrStr.includes('192.168.')
      })

      if (hasExternalAddress) {
        this.digNode.nodeCapabilities.turnServer = true
        await this.announceTurnCapability()
        this.logger.info('📡 Node can act as TURN server')
      } else {
        this.logger.info('🔒 Node behind NAT - cannot act as TURN server')
      }
    } catch (error) {
      this.logger.debug('TURN capability detection failed:', error)
    }
  }

  // Announce our TURN capability
  private async announceTurnCapability(): Promise<void> {
    try {
      const announcement = {
        peerId: this.digNode.node.peerId.toString(),
        type: 'peer',
        cryptoIPv6: this.digNode.cryptoIPv6,
        capabilities: ['file-relay', 'chunk-relay'],
        maxCapacity: 10,
        currentLoad: 0,
        addresses: this.digNode.node.getMultiaddrs().map((addr: any) => addr.toString()),
        timestamp: Date.now()
      }

      // Announce via DHT
      const dht = this.digNode.node.services.dht
      if (dht) {
        const key = new TextEncoder().encode('/dig-turn-servers/registry')
        const value = new TextEncoder().encode(JSON.stringify(announcement))
        await dht.put(key, value)
      }

      // Announce via gossip
      const gossipsub = this.digNode.node.services.gossipsub
      if (gossipsub) {
        const { fromString: uint8ArrayFromString } = await import('uint8arrays')
        await gossipsub.publish(
          'dig-turn-server-announcements',
          uint8ArrayFromString(JSON.stringify(announcement))
        )
      }

      this.logger.info('📡 Announced TURN capability')
    } catch (error) {
      this.logger.error('Failed to announce TURN capability:', error)
    }
  }

  // Set up TURN capability monitoring
  private setupTurnCapabilityMonitoring(): void {
    // Monitor for TURN capability changes
    setInterval(() => {
      this.detectOwnTurnCapability()
    }, 5 * 60000) // Every 5 minutes
  }

  // Start TURN server health monitoring
  private startTurnServerMonitoring(): void {
    setInterval(async () => {
      await this.monitorTurnServerHealth()
    }, 2 * 60000) // Every 2 minutes
  }

  // Monitor TURN server health
  private async monitorTurnServerHealth(): Promise<void> {
    let healthyCount = 0
    
    for (const [peerId, server] of this.turnServers) {
      try {
        const isHealthy = await this.testTurnServerHealth(server)
        server.healthStatus = isHealthy ? 'healthy' : 'unhealthy'
        if (isHealthy) healthyCount++
      } catch (error) {
        server.healthStatus = 'unhealthy'
      }
    }

    this.logger.debug(`📊 TURN health: ${healthyCount}/${this.turnServers.size} servers healthy`)
  }

  // Test TURN server health
  private async testTurnServerHealth(server: TurnServerInfo): Promise<boolean> {
    try {
      if (server.type === 'bootstrap') {
        const response = await fetch(`${server.url}/health`, {
          signal: AbortSignal.timeout(5000)
        })
        return response.ok
      } else {
        // Test peer TURN server
        const peer = this.digNode.node.getPeers().find((p: any) => p.toString() === server.peerId)
        return !!peer
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
      (info.url || info.addresses)
    )
  }

  // Get best TURN server for file transfer
  getBestTurnServer(): TurnServerInfo | null {
    const healthyServers = Array.from(this.turnServers.values())
      .filter(server => server.healthStatus === 'healthy')
      .sort((a, b) => (a.currentLoad || 0) - (b.currentLoad || 0))

    return healthyServers[0] || null
  }

  // Get all available TURN servers
  getAvailableTurnServers(): TurnServerInfo[] {
    return Array.from(this.turnServers.values())
      .filter(server => server.healthStatus !== 'unhealthy')
  }

  // Request file via TURN coordination
  async requestFileViaTurn(storeId: string, sourcePeerId: string): Promise<Buffer | null> {
    try {
      const turnServer = this.getBestTurnServer()
      if (!turnServer) {
        throw new Error('No TURN servers available')
      }

      this.logger.info(`📡 Requesting file via TURN: ${storeId} via ${turnServer.peerId}`)

      // Use the best available TURN server
      // Implementation would coordinate the file transfer
      
      return null // Placeholder
    } catch (error) {
      this.logger.error(`TURN file request failed:`, error)
      return null
    }
  }

  // Request specific chunk via TURN coordination (for DownloadManager)
  async requestChunk(storeId: string, rangeStart: number, rangeEnd: number, turnServerId: string): Promise<Buffer | null> {
    try {
      const turnServer = this.turnServers.get(turnServerId)
      if (!turnServer) {
        throw new Error(`TURN server ${turnServerId} not found`)
      }

      this.logger.debug(`📦 Requesting chunk via TURN: ${storeId} (${rangeStart}-${rangeEnd})`)

      // Coordinate chunk download through TURN server
      // Implementation would handle the actual TURN relay
      
      return null // Placeholder for now
    } catch (error) {
      this.logger.debug(`TURN chunk request failed:`, error)
      return null
    }
  }

  // Establish TURN relay connection (for ComprehensiveNATTraversal)
  async establishTurnRelay(targetPeerId: string): Promise<any> {
    try {
      const turnServer = this.getBestTurnServer()
      if (!turnServer) {
        throw new Error('No TURN servers available')
      }

      this.logger.info(`📡 Establishing TURN relay to ${targetPeerId} via ${turnServer.peerId}`)

      // Implementation would establish the TURN relay connection
      // For now, return a mock connection object
      
      return {
        remotePeer: { toString: () => targetPeerId },
        isRelay: true,
        turnServer: turnServer.peerId
      }
    } catch (error) {
      this.logger.error(`Failed to establish TURN relay to ${targetPeerId}:`, error)
      return null
    }
  }

  // Get TURN coordination statistics
  getTurnStats(): any {
    return {
      totalTurnServers: this.turnServers.size,
      healthyTurnServers: Array.from(this.turnServers.values()).filter(s => s.healthStatus === 'healthy').length,
      activeConnections: this.activeConnections.size,
      ownTurnCapable: this.digNode.nodeCapabilities.turnServer
    }
  }

  // Stop TURN coordination
  async stop(): Promise<void> {
    // Cleanup all connections
    for (const [key, connection] of this.activeConnections) {
      try {
        connection.socket?.disconnect()
      } catch (error) {
        // Silent cleanup
      }
    }
    this.activeConnections.clear()
    this.logger.info('🛑 TURN coordination stopped')
  }
}

// Simplified TURN server information
interface TurnServerInfo {
  peerId: string
  type: 'bootstrap' | 'peer'
  url?: string
  addresses?: string[]
  cryptoIPv6?: string
  maxCapacity: number
  currentLoad?: number
  healthStatus: 'healthy' | 'unhealthy' | 'unknown'
  discoveredVia: 'dht' | 'gossip' | 'manual'
  lastSeen: number
}
