/**
 * Peer Connection Capabilities Tracker
 * 
 * Tracks which peers can accept direct connections vs need TURN relay:
 * - Direct-capable peers: Can receive direct LibP2P connections
 * - NAT-restricted peers: Need TURN relay to receive connections
 * - Dual-role peers: Direct-capable peers that can also act as TURN servers
 * 
 * Strategy:
 * 1. Try ALL LibP2P NAT traversal methods for direct connection
 * 2. Use direct-capable peers as TURN servers for NAT-restricted peers
 * 3. Share connection capability info across the network
 */

import { Logger } from './logger.js'

export class PeerConnectionCapabilities {
  private logger = new Logger('PeerCapabilities')
  private digNode: any
  private peerCapabilities = new Map<string, PeerConnectionInfo>()
  private connectionTestResults = new Map<string, ConnectionTestResult>()
  private capabilityAnnouncements = new Map<string, CapabilityAnnouncement>()

  constructor(digNode: any) {
    this.digNode = digNode
  }

  // Initialize connection capability tracking
  async initialize(): Promise<void> {
    try {
      this.logger.info('🔍 Initializing peer connection capability tracking...')

      // 1. Test our own connection capabilities
      await this.testOwnConnectionCapabilities()

      // 2. Set up peer capability monitoring
      this.setupPeerCapabilityMonitoring()

      // 3. Subscribe to capability announcements
      await this.subscribeToCapabilityAnnouncements()

      // 4. Start periodic capability testing
      this.startPeriodicCapabilityTesting()

      this.logger.info('✅ Peer connection capability tracking initialized')

    } catch (error) {
      this.logger.error('Failed to initialize capability tracking:', error)
    }
  }

  // Test our own connection capabilities
  private async testOwnConnectionCapabilities(): Promise<void> {
    try {
      const addresses = this.digNode.node.getMultiaddrs()
      const capabilities: OwnConnectionCapabilities = {
        acceptsDirectConnections: false,
        canActAsTurnServer: false,
        natTraversalMethods: [],
        externalAddresses: [],
        connectionTypes: []
      }

      // Check for external addresses (indicates direct connection capability)
      const externalAddresses = addresses.filter((addr: any) => {
        const addrStr = addr.toString()
        return !addrStr.includes('127.0.0.1') && 
               !addrStr.includes('::1') && 
               !addrStr.includes('192.168.') &&
               !addrStr.includes('10.0.') &&
               !addrStr.includes('172.16.') &&
               !addrStr.includes('172.17.') &&
               !addrStr.includes('172.18.') &&
               !addrStr.includes('172.19.') &&
               !addrStr.includes('172.2') &&
               !addrStr.includes('172.3')
      })

      if (externalAddresses.length > 0) {
        capabilities.acceptsDirectConnections = true
        capabilities.canActAsTurnServer = true
        capabilities.externalAddresses = externalAddresses.map((addr: any) => addr.toString())
        capabilities.connectionTypes.push('direct-tcp', 'direct-websocket')
        
        this.logger.info('✅ Node accepts direct connections - can act as TURN server')
      } else {
        this.logger.info('🔒 Node behind NAT - needs TURN relay for incoming connections')
      }

      // Test available NAT traversal methods
      capabilities.natTraversalMethods = await this.detectAvailableNATTraversalMethods()

      // Store our capabilities
      this.peerCapabilities.set(this.digNode.node.peerId.toString(), {
        peerId: this.digNode.node.peerId.toString(),
        acceptsDirectConnections: capabilities.acceptsDirectConnections,
        canActAsTurnServer: capabilities.canActAsTurnServer,
        natTraversalMethods: capabilities.natTraversalMethods,
        connectionTypes: capabilities.connectionTypes,
        lastTested: Date.now(),
        testResults: {
          upnp: this.digNode.nodeCapabilities.upnp,
          autonat: this.digNode.nodeCapabilities.autonat,
          webrtc: this.digNode.nodeCapabilities.webrtc,
          circuitRelay: this.digNode.nodeCapabilities.circuitRelay
        }
      })

      // Announce our capabilities to the network
      await this.announceOwnCapabilities(capabilities)

    } catch (error) {
      this.logger.error('Failed to test own connection capabilities:', error)
    }
  }

  // Detect available NAT traversal methods
  private async detectAvailableNATTraversalMethods(): Promise<string[]> {
    const methods: string[] = []

    // Check LibP2P capabilities
    if (this.digNode.nodeCapabilities.upnp) methods.push('upnp')
    if (this.digNode.nodeCapabilities.autonat) methods.push('autonat')
    if (this.digNode.nodeCapabilities.webrtc) methods.push('webrtc')
    if (this.digNode.nodeCapabilities.circuitRelay) methods.push('circuit-relay')
    if (this.digNode.nodeCapabilities.websockets) methods.push('websockets')

    // Always available methods
    methods.push('tcp-direct', 'hole-punching')

    this.logger.info(`🔧 Available NAT traversal methods: ${methods.join(', ')}`)
    return methods
  }

  // Set up peer capability monitoring
  private setupPeerCapabilityMonitoring(): void {
    // Monitor new peer connections
    this.digNode.node.addEventListener('peer:connect', async (evt: any) => {
      const connection = evt.detail
      const peerId = connection.remotePeer.toString()
      
      // Test connection capabilities for new peers
      setTimeout(async () => {
        await this.testPeerConnectionCapabilities(peerId, connection)
      }, 2000) // Wait for connection to stabilize
    })

    // Monitor peer disconnections
    this.digNode.node.addEventListener('peer:disconnect', (evt: any) => {
      const peerId = evt.detail.toString()
      this.peerCapabilities.delete(peerId)
      this.connectionTestResults.delete(peerId)
    })
  }

  // Test peer connection capabilities
  private async testPeerConnectionCapabilities(peerId: string, connection: any): Promise<void> {
    try {
      this.logger.debug(`🔍 Testing connection capabilities for peer: ${peerId}`)

      const testResult: ConnectionTestResult = {
        peerId,
        testedAt: Date.now(),
        directConnectionPossible: false,
        natTraversalUsed: 'unknown',
        connectionMethod: 'unknown',
        canAcceptIncoming: false,
        roundTripTime: 0
      }

      // 1. Determine how we connected to this peer
      const connectionAddr = connection.remoteAddr?.toString() || ''
      
      if (connectionAddr.includes('127.0.0.1') || connectionAddr.includes('192.168.')) {
        testResult.connectionMethod = 'local-network'
        testResult.directConnectionPossible = true
      } else if (connectionAddr.includes('/p2p-circuit/')) {
        testResult.connectionMethod = 'circuit-relay'
        testResult.natTraversalUsed = 'circuit-relay'
        testResult.directConnectionPossible = false
      } else if (connectionAddr.includes('/webrtc/')) {
        testResult.connectionMethod = 'webrtc'
        testResult.natTraversalUsed = 'webrtc'
        testResult.directConnectionPossible = true
      } else {
        testResult.connectionMethod = 'direct-tcp'
        testResult.directConnectionPossible = true
      }

      // 2. Test if peer can accept incoming connections (ping test)
      const pingStart = Date.now()
      try {
        const pingService = this.digNode.node.services.ping
        if (pingService) {
          await pingService.ping(connection.remotePeer)
          testResult.roundTripTime = Date.now() - pingStart
          testResult.canAcceptIncoming = true
        }
      } catch (pingError) {
        testResult.canAcceptIncoming = false
      }

      // 3. Request peer's own capability information
      const peerCapabilities = await this.requestPeerCapabilities(peerId)
      
      // 4. Store results
      this.connectionTestResults.set(peerId, testResult)
      
      if (peerCapabilities) {
        this.peerCapabilities.set(peerId, peerCapabilities)
        
        // Log peer capability summary
        const capabilityType = peerCapabilities.acceptsDirectConnections ? 
          (peerCapabilities.canActAsTurnServer ? 'Direct + TURN' : 'Direct Only') : 
          'NAT Restricted'
        
        this.logger.info(`📋 Peer ${peerId}: ${capabilityType} (${testResult.connectionMethod})`)
      }

    } catch (error) {
      this.logger.debug(`Failed to test capabilities for ${peerId}:`, error)
    }
  }

  // Request peer's connection capabilities
  private async requestPeerCapabilities(peerId: string): Promise<PeerConnectionInfo | null> {
    try {
      const peer = this.digNode.node.getPeers().find((p: any) => p.toString() === peerId)
      if (!peer) return null

      const stream = await this.digNode.node.dialProtocol(peer, '/dig/1.0.0')
      
      const request = {
        type: 'GET_CONNECTION_CAPABILITIES',
        requestId: `cap_${Date.now()}`
      }

      const { pipe } = await import('it-pipe')
      const { fromString: uint8ArrayFromString, toString: uint8ArrayToString } = await import('uint8arrays')

      await pipe(async function* () {
        yield uint8ArrayFromString(JSON.stringify(request))
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
        if (response.success && response.capabilities) {
          return {
            peerId,
            acceptsDirectConnections: response.capabilities.acceptsDirectConnections,
            canActAsTurnServer: response.capabilities.canActAsTurnServer,
            natTraversalMethods: response.capabilities.natTraversalMethods || [],
            connectionTypes: response.capabilities.connectionTypes || [],
            lastTested: Date.now(),
            testResults: response.capabilities.testResults || {}
          }
        }
      }

      return null

    } catch (error) {
      this.logger.debug(`Failed to request capabilities from ${peerId}:`, error)
      return null
    }
  }

  // Subscribe to capability announcements via gossip
  private async subscribeToCapabilityAnnouncements(): Promise<void> {
    try {
      const gossipsub = this.digNode.node.services.gossipsub
      if (!gossipsub) return

      await gossipsub.subscribe('dig-peer-connection-capabilities')

      gossipsub.addEventListener('message', (evt: any) => {
        if (evt.detail.topic === 'dig-peer-connection-capabilities') {
          this.handleCapabilityAnnouncement(evt.detail.data)
        }
      })

      this.logger.debug('🗣️ Subscribed to peer capability announcements')

    } catch (error) {
      this.logger.debug('Capability announcement subscription failed:', error)
    }
  }

  // Handle capability announcements
  private async handleCapabilityAnnouncement(data: Uint8Array): Promise<void> {
    try {
      const { toString: uint8ArrayToString } = await import('uint8arrays')
      const announcement = JSON.parse(uint8ArrayToString(data))
      
      if (announcement.peerId !== this.digNode.node.peerId.toString()) {
        this.capabilityAnnouncements.set(announcement.peerId, announcement)
        
        // Update peer capabilities
        this.peerCapabilities.set(announcement.peerId, {
          peerId: announcement.peerId,
          acceptsDirectConnections: announcement.acceptsDirectConnections,
          canActAsTurnServer: announcement.canActAsTurnServer,
          natTraversalMethods: announcement.natTraversalMethods || [],
          connectionTypes: announcement.connectionTypes || [],
          lastTested: announcement.timestamp,
          testResults: announcement.testResults || {}
        })

        const capType = announcement.acceptsDirectConnections ? 
          (announcement.canActAsTurnServer ? 'Direct+TURN' : 'Direct') : 'NAT-only'
        
        this.logger.info(`📡 Peer capability update: ${announcement.peerId} (${capType})`)
      }

    } catch (error) {
      this.logger.debug('Invalid capability announcement:', error)
    }
  }

  // Announce our own capabilities
  private async announceOwnCapabilities(capabilities: OwnConnectionCapabilities): Promise<void> {
    try {
      const announcement = {
        peerId: this.digNode.node.peerId.toString(),
        acceptsDirectConnections: capabilities.acceptsDirectConnections,
        canActAsTurnServer: capabilities.canActAsTurnServer,
        natTraversalMethods: capabilities.natTraversalMethods,
        connectionTypes: capabilities.connectionTypes,
        externalAddresses: capabilities.externalAddresses,
        timestamp: Date.now(),
        testResults: {
          upnp: this.digNode.nodeCapabilities.upnp,
          autonat: this.digNode.nodeCapabilities.autonat,
          webrtc: this.digNode.nodeCapabilities.webrtc,
          circuitRelay: this.digNode.nodeCapabilities.circuitRelay
        }
      }

      // Announce via gossip
      const gossipsub = this.digNode.node.services.gossipsub
      if (gossipsub) {
        const { fromString: uint8ArrayFromString } = await import('uint8arrays')
        await gossipsub.publish(
          'dig-peer-connection-capabilities',
          uint8ArrayFromString(JSON.stringify(announcement))
        )
      }

      // Store in DHT for persistence
      const dht = this.digNode.node.services.dht
      if (dht) {
        const key = new TextEncoder().encode(`/dig-capabilities/${this.digNode.node.peerId.toString()}`)
        const value = new TextEncoder().encode(JSON.stringify(announcement))
        await dht.put(key, value)
      }

      this.logger.info(`📡 Announced capabilities: ${capabilities.acceptsDirectConnections ? 'Direct+TURN' : 'NAT-only'}`)

    } catch (error) {
      this.logger.error('Failed to announce capabilities:', error)
    }
  }

  // Start periodic capability testing
  private startPeriodicCapabilityTesting(): void {
    // Test our own capabilities periodically (they can change)
    setInterval(async () => {
      await this.testOwnConnectionCapabilities()
    }, 5 * 60000) // Every 5 minutes

    // Test peer capabilities periodically
    setInterval(async () => {
      await this.testAllPeerCapabilities()
    }, 10 * 60000) // Every 10 minutes
  }

  // Test all known peer capabilities
  private async testAllPeerCapabilities(): Promise<void> {
    const connectedPeers = this.digNode.node.getPeers()
    
    for (const peer of connectedPeers.slice(0, 5)) { // Limit to 5 tests per round
      const peerId = peer.toString()
      const lastTest = this.peerCapabilities.get(peerId)?.lastTested || 0
      const timeSinceTest = Date.now() - lastTest
      
      // Only test if we haven't tested recently
      if (timeSinceTest > 10 * 60000) { // 10 minutes
        await this.testPeerConnectionCapabilities(peerId, { remotePeer: peer })
      }
    }
  }

  // Get direct-capable peers (can accept incoming connections)
  getDirectCapablePeers(): PeerConnectionInfo[] {
    return Array.from(this.peerCapabilities.values())
      .filter(peer => peer.acceptsDirectConnections)
  }

  // Get TURN-capable peers (direct-capable peers that can act as TURN servers)
  getTurnCapablePeers(): PeerConnectionInfo[] {
    return Array.from(this.peerCapabilities.values())
      .filter(peer => peer.canActAsTurnServer)
  }

  // Get NAT-restricted peers (need TURN relay)
  getNATRestrictedPeers(): PeerConnectionInfo[] {
    return Array.from(this.peerCapabilities.values())
      .filter(peer => !peer.acceptsDirectConnections)
  }

  // Get peers with specific store that accept direct connections
  getDirectCapablePeersWithStore(storeId: string): PeerConnectionInfo[] {
    const digPeers = this.digNode.peerDiscovery?.getDIGPeersWithStore(storeId) || []
    
    return digPeers
      .map((digPeer: any) => this.peerCapabilities.get(digPeer.peerId))
      .filter(Boolean)
      .filter((peer: any) => peer!.acceptsDirectConnections) as PeerConnectionInfo[]
  }

  // Get TURN servers that can relay to specific NAT-restricted peer
  getTurnServersForPeer(targetPeerId: string): PeerConnectionInfo[] {
    const targetPeer = this.peerCapabilities.get(targetPeerId)
    
    // If target peer accepts direct connections, no TURN needed
    if (targetPeer?.acceptsDirectConnections) {
      return []
    }

    // Return all available TURN servers
    return this.getTurnCapablePeers()
  }

  // Check if peer accepts direct connections
  peerAcceptsDirectConnections(peerId: string): boolean {
    return this.peerCapabilities.get(peerId)?.acceptsDirectConnections || false
  }

  // Check if peer can act as TURN server
  peerCanActAsTurnServer(peerId: string): boolean {
    return this.peerCapabilities.get(peerId)?.canActAsTurnServer || false
  }

  // Get best connection method for peer
  getBestConnectionMethod(targetPeerId: string): ConnectionStrategy {
    const peerCapabilities = this.peerCapabilities.get(targetPeerId)
    const testResult = this.connectionTestResults.get(targetPeerId)

    if (!peerCapabilities) {
      return {
        method: 'unknown',
        priority: 0,
        requiresTurn: false,
        turnServers: []
      }
    }

    if (peerCapabilities.acceptsDirectConnections) {
      // Direct connection possible
      const method = testResult?.connectionMethod || 'direct-tcp'
      return {
        method,
        priority: 1, // Highest priority
        requiresTurn: false,
        turnServers: [],
        natTraversalMethods: peerCapabilities.natTraversalMethods
      }
    } else {
      // Need TURN relay
      const availableTurnServers = this.getTurnCapablePeers()
      return {
        method: 'turn-relay',
        priority: 2, // Lower priority
        requiresTurn: true,
        turnServers: availableTurnServers,
        natTraversalMethods: []
      }
    }
  }

  // Get network capability statistics
  getCapabilityStats(): NetworkCapabilityStats {
    const allPeers = Array.from(this.peerCapabilities.values())
    
    return {
      totalPeers: allPeers.length,
      directCapablePeers: allPeers.filter(p => p.acceptsDirectConnections).length,
      turnCapablePeers: allPeers.filter(p => p.canActAsTurnServer).length,
      natRestrictedPeers: allPeers.filter(p => !p.acceptsDirectConnections).length,
      connectionCoverage: this.calculateConnectionCoverage(),
      lastCapabilityTest: Math.max(...allPeers.map(p => p.lastTested), 0)
    }
  }

  // Calculate how well the network can connect to all peers
  private calculateConnectionCoverage(): number {
    const allPeers = Array.from(this.peerCapabilities.values())
    const natRestrictedPeers = allPeers.filter(p => !p.acceptsDirectConnections)
    const turnServers = allPeers.filter(p => p.canActAsTurnServer)
    
    if (natRestrictedPeers.length === 0) {
      return 100 // All peers accept direct connections
    }
    
    if (turnServers.length === 0) {
      return allPeers.length > 0 ? (allPeers.filter(p => p.acceptsDirectConnections).length / allPeers.length) * 100 : 0
    }
    
    // All NAT-restricted peers can be reached via TURN servers
    return 100
  }
}

// Own connection capabilities
interface OwnConnectionCapabilities {
  acceptsDirectConnections: boolean
  canActAsTurnServer: boolean
  natTraversalMethods: string[]
  externalAddresses: string[]
  connectionTypes: string[]
}

// Peer connection information
export interface PeerConnectionInfo {
  peerId: string
  acceptsDirectConnections: boolean
  canActAsTurnServer: boolean
  natTraversalMethods: string[]
  connectionTypes: string[]
  lastTested: number
  testResults: any
}

// Connection test result
interface ConnectionTestResult {
  peerId: string
  testedAt: number
  directConnectionPossible: boolean
  natTraversalUsed: string
  connectionMethod: string
  canAcceptIncoming: boolean
  roundTripTime: number
}

// Capability announcement
interface CapabilityAnnouncement {
  peerId: string
  acceptsDirectConnections: boolean
  canActAsTurnServer: boolean
  natTraversalMethods: string[]
  timestamp: number
}

// Connection strategy
export interface ConnectionStrategy {
  method: string
  priority: number
  requiresTurn: boolean
  turnServers: PeerConnectionInfo[]
  natTraversalMethods?: string[]
}

// Network capability statistics
interface NetworkCapabilityStats {
  totalPeers: number
  directCapablePeers: number
  turnCapablePeers: number
  natRestrictedPeers: number
  connectionCoverage: number
  lastCapabilityTest: number
}
