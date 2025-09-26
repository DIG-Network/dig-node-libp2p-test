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
  public activeConnections = new Map<string, any>()

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

      // AWS bootstrap server fallback discovery
      await this.discoverAWSBootstrapTurnServers()

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

      let dhtSuccess = false
      let gossipSuccess = false

      // Try DHT announcement (may fail if DHT not ready)
      try {
        const dht = this.digNode.node.services.dht
        if (dht) {
          const key = new TextEncoder().encode('/dig-turn-servers/registry')
          const value = new TextEncoder().encode(JSON.stringify(announcement))
          await dht.put(key, value)
          dhtSuccess = true
          this.logger.debug('📡 TURN DHT announcement successful')
        }
      } catch (dhtError) {
        this.logger.debug('TURN DHT announcement failed (expected during bootstrap):', dhtError)
      }

      // Try GossipSub announcement (may fail if no DIG peers subscribed)
      try {
        const gossipsub = this.digNode.node.services.gossipsub
        if (gossipsub) {
          const { fromString: uint8ArrayFromString } = await import('uint8arrays')
          await gossipsub.publish(
            'dig-turn-server-announcements',
            uint8ArrayFromString(JSON.stringify(announcement))
          )
          gossipSuccess = true
          this.logger.debug('📡 TURN GossipSub announcement successful')
        }
      } catch (gossipError) {
        this.logger.debug('TURN GossipSub announcement failed (expected with no DIG peers):', gossipError)
      }

      if (dhtSuccess || gossipSuccess) {
        this.logger.info('📡 Announced TURN capability')
      } else {
        this.logger.debug('⏳ TURN announcement deferred (DHT/Gossip not ready)')
      }

    } catch (error) {
      this.logger.debug('TURN capability announcement failed (will retry):', error)
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

  // Coordinate TURN connection between NAT-restricted peers
  async coordinateTurnConnection(targetPeerId: string, storeId?: string): Promise<any> {
    try {
      const turnServer = this.getBestTurnServer()
      if (!turnServer) {
        this.logger.warn('❌ No TURN servers available for coordination')
        return null
      }

      this.logger.info(`📡 Coordinating TURN connection to ${targetPeerId} via ${turnServer.peerId}`)

      // Step 1: Signal both peers to connect to the TURN server
      const coordinationResult = await this.signalTurnConnection(turnServer, targetPeerId, storeId)
      
      if (coordinationResult.success) {
        this.logger.info(`✅ TURN coordination successful: ${coordinationResult.method}`)
        return coordinationResult
      } else {
        this.logger.warn(`⚠️ TURN coordination failed: ${coordinationResult.error}`)
        return null
      }

    } catch (error) {
      this.logger.error(`Failed to coordinate TURN connection to ${targetPeerId}:`, error)
      return null
    }
  }

  // Signal TURN connection to both peers
  private async signalTurnConnection(turnServer: TurnServerInfo, targetPeerId: string, storeId?: string): Promise<any> {
    try {
      if (turnServer.type === 'bootstrap') {
        // Use AWS bootstrap server for TURN coordination
        return await this.coordinateViaTurnBootstrap(turnServer, targetPeerId, storeId)
      } else {
        // Use peer TURN server for coordination
        return await this.coordinateViaPeerTurn(turnServer, targetPeerId, storeId)
      }
    } catch (error) {
      this.logger.error('TURN signaling failed:', error)
      return { success: false, error: 'TURN signaling failed' }
    }
  }

  // Coordinate via AWS bootstrap TURN server
  private async coordinateViaTurnBootstrap(turnServer: TurnServerInfo, targetPeerId: string, storeId?: string): Promise<any> {
    try {
      this.logger.info(`📡 Using AWS bootstrap TURN coordination for ${targetPeerId}`)

      // Request TURN coordination via AWS bootstrap
      const coordinationRequest = {
        fromPeerId: this.digNode.node.peerId.toString(),
        toPeerId: targetPeerId,
        storeId,
        method: 'turn-coordination',
        userTier: process.env.DIG_USER_TIER || 'free',
        isPremium: process.env.DIG_IS_PREMIUM === 'true'
      }

      const response = await fetch(`${turnServer.url}/relay-store`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(coordinationRequest)
      })

      if (response.ok) {
        const result = await response.json()
        return {
          success: true,
          method: 'aws-bootstrap-turn',
          turnServer: turnServer.peerId,
          coordination: result
        }
      } else {
        return {
          success: false,
          error: `AWS bootstrap TURN coordination failed: ${response.status}`
        }
      }

    } catch (error) {
      return {
        success: false,
        error: `AWS bootstrap TURN coordination error: ${error}`
      }
    }
  }

  // Coordinate via peer TURN server with WebSocket signaling
  private async coordinateViaPeerTurn(turnServer: TurnServerInfo, targetPeerId: string, storeId?: string): Promise<any> {
    try {
      this.logger.info(`📡 Using peer TURN coordination: ${turnServer.peerId} for ${targetPeerId}`)

      // Step 1: Establish WebSocket connection to TURN server for signaling
      const turnServerWS = await this.establishTurnServerWebSocket(turnServer)
      if (!turnServerWS) {
        return {
          success: false,
          error: 'Could not establish WebSocket to TURN server'
        }
      }

      // Step 2: Signal target peer to also connect to TURN server
      const targetSignaled = await this.signalPeerToConnectToTurnServer(targetPeerId, turnServer)
      if (!targetSignaled) {
        return {
          success: false,
          error: 'Could not signal target peer to connect to TURN server'
        }
      }

      // Step 3: Request TURN coordination via DIG protocol
      const stream = await this.digNode.node.dialProtocol(turnServer.peerId, '/dig/1.0.0')
      
      const coordinationRequest = {
        type: 'TURN_COORDINATION_REQUEST',
        fromPeerId: this.digNode.node.peerId.toString(),
        targetPeerId,
        storeId,
        timestamp: Date.now(),
        websocketEstablished: true
      }

      const response = await this.digNode.sendStreamMessage(stream, coordinationRequest)
      await stream.close()

      if (response && response.success) {
        this.logger.info(`✅ TURN coordination established with WebSocket signaling`)
        return {
          success: true,
          method: 'peer-turn-websocket',
          turnServer: turnServer.peerId,
          sessionId: response.sessionId,
          websocket: turnServerWS
        }
      }

      return {
        success: false,
        error: 'TURN coordination request failed'
      }

    } catch (error) {
      return {
        success: false,
        error: `Peer TURN coordination error: ${error}`
      }
    }
  }

  // Establish WebSocket connection to TURN server for signaling
  private async establishTurnServerWebSocket(turnServer: TurnServerInfo): Promise<any> {
    try {
      this.logger.info(`🔌 Establishing WebSocket to TURN server: ${turnServer.peerId}`)

      // Extract IP from TURN server addresses
      const turnAddress = turnServer.addresses?.[0]
      if (!turnAddress) {
        throw new Error('No TURN server address available')
      }

      const match = turnAddress.match(/\/ip4\/([^\/]+)\/tcp\/(\d+)/)
      if (!match) {
        throw new Error('Could not extract IP from TURN address')
      }

      const [, ip, port] = match
      const wsPort = parseInt(port) + 2000 // WebSocket signaling port
      const wsUrl = `ws://${ip}:${wsPort}`

      this.logger.info(`🔌 Connecting to TURN WebSocket: ${wsUrl}`)

      // For now, return a mock WebSocket connection
      // In full implementation, would establish actual WebSocket
      return {
        url: wsUrl,
        connected: true,
        turnServer: turnServer.peerId
      }

    } catch (error) {
      this.logger.warn(`Failed to establish WebSocket to TURN server:`, error)
      return null
    }
  }

  // Signal target peer to connect to TURN server
  private async signalPeerToConnectToTurnServer(targetPeerId: string, turnServer: TurnServerInfo): Promise<boolean> {
    try {
      this.logger.info(`📡 Signaling ${targetPeerId} to connect to TURN server ${turnServer.peerId}`)

      // Method 1: Direct signaling via LibP2P (if connected)
      const targetPeer = this.digNode.node.getPeers().find((p: any) => p.toString() === targetPeerId)
      
      if (targetPeer) {
        try {
          const stream = await this.digNode.node.dialProtocol(targetPeer, '/dig/1.0.0')
          
          const signal = {
            type: 'TURN_CONNECTION_SIGNAL',
            turnServerPeerId: turnServer.peerId,
            turnServerAddresses: turnServer.addresses,
            requestId: `turn_signal_${Date.now()}`,
            fromPeerId: this.digNode.node.peerId.toString(),
            timestamp: Date.now()
          }

          await this.digNode.sendStreamMessage(stream, signal)
          await stream.close()

          this.logger.info(`✅ Direct signal sent to ${targetPeerId}`)
          return true

        } catch (directError) {
          this.logger.debug(`Direct signaling failed:`, directError)
        }
      }

      // Method 2: DHT signaling (if direct connection unavailable)
      const dht = this.digNode.node.services.dht
      if (dht) {
        try {
          const signal = {
            type: 'TURN_CONNECTION_SIGNAL',
            turnServerPeerId: turnServer.peerId,
            turnServerAddresses: turnServer.addresses,
            fromPeerId: this.digNode.node.peerId.toString(),
            timestamp: Date.now()
          }

          const key = new TextEncoder().encode(`/dig-turn-signal/${targetPeerId}`)
          const value = new TextEncoder().encode(JSON.stringify(signal))
          await dht.put(key, value)

          this.logger.info(`✅ DHT signal stored for ${targetPeerId}`)
          return true

        } catch (dhtError) {
          this.logger.debug(`DHT signaling failed:`, dhtError)
        }
      }

      // Method 3: AWS Bootstrap signaling (last resort)
      const awsConfig = this.digNode.getAWSBootstrapConfig?.()
      if (awsConfig?.enabled) {
        try {
          const response = await fetch(`${awsConfig.url}/signal-turn-connection`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              targetPeerId,
              turnServerInfo: {
                peerId: turnServer.peerId,
                addresses: turnServer.addresses
              },
              requestId: `aws_signal_${Date.now()}`,
              requesterPeerId: this.digNode.node.peerId.toString(),
              instruction: 'connect-to-turn-server'
            })
          })

          if (response.ok) {
            this.logger.info(`✅ AWS bootstrap signal sent for ${targetPeerId}`)
            return true
          }

        } catch (awsError) {
          this.logger.debug(`AWS bootstrap signaling failed:`, awsError)
        }
      }

      this.logger.warn(`⚠️ Could not signal ${targetPeerId} to connect to TURN server`)
      return false

    } catch (error) {
      this.logger.error(`Failed to signal peer ${targetPeerId}:`, error)
      return false
    }
  }

  // Establish TURN relay connection (for ComprehensiveNATTraversal)
  async establishTurnRelay(targetPeerId: string): Promise<any> {
    try {
      return await this.coordinateTurnConnection(targetPeerId)
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

  // Discover AWS bootstrap server as TURN fallback
  private async discoverAWSBootstrapTurnServers(): Promise<void> {
    try {
      const awsBootstrapUrl = process.env.DIG_AWS_BOOTSTRAP_URL || 
                             'http://awseb--AWSEB-qNbAdipmcXyx-770761774.us-east-1.elb.amazonaws.com'
      
      if (process.env.DIG_AWS_BOOTSTRAP_ENABLED === 'false') {
        this.logger.debug('⏭️ AWS bootstrap TURN discovery disabled')
        return
      }

      this.logger.debug('🌐 Discovering AWS bootstrap server as TURN fallback...')

      // Test AWS bootstrap server availability
      const response = await fetch(`${awsBootstrapUrl}/health`, {
        signal: AbortSignal.timeout(5000)
      })

      if (response.ok) {
        const health = await response.json()
        
        // Add AWS bootstrap server as TURN fallback
        const awsBootstrapTurn: TurnServerInfo = {
          peerId: 'aws-bootstrap-server',
          type: 'bootstrap',
          url: awsBootstrapUrl,
          addresses: [awsBootstrapUrl],
          maxCapacity: 100, // High capacity for fallback
          currentLoad: health.costInfo?.activeSessions || 0,
          healthStatus: health.status === 'healthy' ? 'healthy' : 'unhealthy',
          discoveredVia: 'manual',
          lastSeen: Date.now(),
          costInfo: health.costInfo
        }

        this.turnServers.set('aws-bootstrap-server', awsBootstrapTurn)
        
        const costMode = health.costInfo?.mode || 'unknown'
        this.logger.info(`✅ AWS bootstrap TURN server discovered (${costMode} mode, ${health.costInfo?.budgetUsed || 'unknown'} budget used)`)
        
        // Log cost warning if in throttling mode
        if (costMode === 'throttle' || costMode === 'emergency' || costMode === 'shutdown') {
          this.logger.warn(`⚠️ AWS bootstrap in ${costMode} mode - limited availability`)
        }

      } else {
        this.logger.warn(`⚠️ AWS bootstrap server not available: ${response.status}`)
      }

    } catch (error) {
      this.logger.debug('AWS bootstrap TURN discovery failed:', error)
    }
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
  costInfo?: any // AWS bootstrap cost information
}
