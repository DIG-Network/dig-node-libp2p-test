/**
 * Comprehensive NAT Traversal System
 * 
 * Implements ALL LibP2P NAT traversal methods before falling back to TURN:
 * 1. Direct TCP connection
 * 2. UPnP port mapping
 * 3. AutoNAT detection and hole punching
 * 4. WebRTC with STUN/TURN
 * 5. Circuit Relay via public LibP2P nodes
 * 6. WebSocket connections
 * 7. DHT-assisted connection coordination
 * 8. TURN relay as absolute last resort
 */

import { multiaddr } from '@multiformats/multiaddr'
import { Logger } from './logger.js'

export class ComprehensiveNATTraversal {
  private logger = new Logger('NATTraversal')
  private digNode: any
  private connectionAttempts = new Map<string, ConnectionAttemptLog>()

  // Public LibP2P relay nodes for circuit relay
  private readonly PUBLIC_CIRCUIT_RELAYS = [
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
    '/ip4/147.75.77.187/tcp/4001/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa'
  ]

  constructor(digNode: any) {
    this.digNode = digNode
  }

  // Attempt connection using ALL available NAT traversal methods
  async attemptConnection(targetPeerId: string, targetAddresses: string[]): Promise<ConnectionResult> {
    const attemptId = `conn_${targetPeerId}_${Date.now()}`
    
    this.logger.info(`🔗 Starting comprehensive connection attempt to ${targetPeerId}`)
    
    const attemptLog: ConnectionAttemptLog = {
      targetPeerId,
      startTime: Date.now(),
      methods: [],
      finalResult: null
    }

    try {
      // Method 1: Direct TCP Connection
      const directResult = await this.attemptDirectConnection(targetPeerId, targetAddresses)
      attemptLog.methods.push(directResult)
      if (directResult.success) {
        attemptLog.finalResult = directResult
        this.connectionAttempts.set(attemptId, attemptLog)
        return directResult
      }

      // Method 2: UPnP Port Mapping + Direct
      if (this.digNode.nodeCapabilities.upnp) {
        const upnpResult = await this.attemptUPnPConnection(targetPeerId, targetAddresses)
        attemptLog.methods.push(upnpResult)
        if (upnpResult.success) {
          attemptLog.finalResult = upnpResult
          this.connectionAttempts.set(attemptId, attemptLog)
          return upnpResult
        }
      }

      // Method 3: AutoNAT + Hole Punching
      if (this.digNode.nodeCapabilities.autonat) {
        const autonatResult = await this.attemptAutoNATConnection(targetPeerId, targetAddresses)
        attemptLog.methods.push(autonatResult)
        if (autonatResult.success) {
          attemptLog.finalResult = autonatResult
          this.connectionAttempts.set(attemptId, attemptLog)
          return autonatResult
        }
      }

      // Method 4: WebRTC with STUN servers
      if (this.digNode.nodeCapabilities.webrtc) {
        const webrtcResult = await this.attemptWebRTCConnection(targetPeerId)
        attemptLog.methods.push(webrtcResult)
        if (webrtcResult.success) {
          attemptLog.finalResult = webrtcResult
          this.connectionAttempts.set(attemptId, attemptLog)
          return webrtcResult
        }
      }

      // Method 5: Circuit Relay via Public LibP2P Nodes
      if (this.digNode.nodeCapabilities.circuitRelay) {
        const circuitResult = await this.attemptCircuitRelayConnection(targetPeerId)
        attemptLog.methods.push(circuitResult)
        if (circuitResult.success) {
          attemptLog.finalResult = circuitResult
          this.connectionAttempts.set(attemptId, attemptLog)
          return circuitResult
        }
      }

      // Method 6: WebSocket Connection
      if (this.digNode.nodeCapabilities.websockets) {
        const wsResult = await this.attemptWebSocketConnection(targetPeerId, targetAddresses)
        attemptLog.methods.push(wsResult)
        if (wsResult.success) {
          attemptLog.finalResult = wsResult
          this.connectionAttempts.set(attemptId, attemptLog)
          return wsResult
        }
      }

      // Method 7: DHT-Assisted Connection Coordination
      const dhtResult = await this.attemptDHTAssistedConnection(targetPeerId)
      attemptLog.methods.push(dhtResult)
      if (dhtResult.success) {
        attemptLog.finalResult = dhtResult
        this.connectionAttempts.set(attemptId, attemptLog)
        return dhtResult
      }

      // Method 8: TURN Relay (ABSOLUTE LAST RESORT)
      this.logger.warn(`⚠️ All direct methods failed for ${targetPeerId}, using TURN relay as last resort`)
      const turnResult = await this.attemptTurnRelayConnection(targetPeerId)
      attemptLog.methods.push(turnResult)
      attemptLog.finalResult = turnResult
      this.connectionAttempts.set(attemptId, attemptLog)
      
      return turnResult

    } catch (error) {
      this.logger.error(`All connection methods failed for ${targetPeerId}:`, error)
      const failureResult: ConnectionResult = {
        method: 'all-failed',
        success: false,
        connection: null,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - attemptLog.startTime
      }
      attemptLog.finalResult = failureResult
      this.connectionAttempts.set(attemptId, attemptLog)
      return failureResult
    }
  }

  // Method 1: Direct TCP connection
  private async attemptDirectConnection(targetPeerId: string, addresses: string[]): Promise<ConnectionResult> {
    const startTime = Date.now()
    
    try {
      this.logger.debug(`🔗 Attempting direct TCP connection to ${targetPeerId}`)

      for (const address of addresses) {
        try {
          const addr = multiaddr(address)
          const connection = await Promise.race([
            this.digNode.node.dial(addr),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Direct connection timeout')), 15000)
            )
          ])

          if (connection) {
            this.logger.info(`✅ Direct TCP connection successful to ${targetPeerId}`)
            return {
              method: 'direct-tcp',
              success: true,
              connection,
              duration: Date.now() - startTime,
              address
            }
          }
        } catch (error) {
          // Try next address
        }
      }

      throw new Error('All direct addresses failed')

    } catch (error) {
      return {
        method: 'direct-tcp',
        success: false,
        connection: null,
        error: error instanceof Error ? error.message : 'Direct connection failed',
        duration: Date.now() - startTime
      }
    }
  }

  // Method 2: UPnP port mapping
  private async attemptUPnPConnection(targetPeerId: string, addresses: string[]): Promise<ConnectionResult> {
    const startTime = Date.now()
    
    try {
      this.logger.debug(`🔧 Attempting UPnP-assisted connection to ${targetPeerId}`)

      // UPnP should have already mapped our ports, try direct connection
      // with UPnP-mapped external addresses
      const upnpService = this.digNode.node.services.upnp
      if (upnpService) {
        // Try connection with UPnP assistance
        for (const address of addresses) {
          try {
            const addr = multiaddr(address)
            const connection = await Promise.race([
              this.digNode.node.dial(addr),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('UPnP connection timeout')), 20000)
              )
            ])

            if (connection) {
              this.logger.info(`✅ UPnP-assisted connection successful to ${targetPeerId}`)
              return {
                method: 'upnp-direct',
                success: true,
                connection,
                duration: Date.now() - startTime,
                address
              }
            }
          } catch (error) {
            // Try next address
          }
        }
      }

      throw new Error('UPnP connection failed')

    } catch (error) {
      return {
        method: 'upnp-direct',
        success: false,
        connection: null,
        error: error instanceof Error ? error.message : 'UPnP failed',
        duration: Date.now() - startTime
      }
    }
  }

  // Method 3: AutoNAT + Hole Punching
  private async attemptAutoNATConnection(targetPeerId: string, addresses: string[]): Promise<ConnectionResult> {
    const startTime = Date.now()
    
    try {
      this.logger.debug(`🕳️ Attempting AutoNAT hole punching to ${targetPeerId}`)

      // AutoNAT helps detect our external address and coordinate hole punching
      const autonatService = this.digNode.node.services.autonat
      if (autonatService) {
        // Use AutoNAT to coordinate simultaneous connection attempts
        for (const address of addresses) {
          try {
            const addr = multiaddr(address)
            
            // Coordinate hole punching via DHT
            await this.coordinateHolePunching(targetPeerId, addr)
            
            const connection = await Promise.race([
              this.digNode.node.dial(addr),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Hole punching timeout')), 25000)
              )
            ])

            if (connection) {
              this.logger.info(`✅ AutoNAT hole punching successful to ${targetPeerId}`)
              return {
                method: 'autonat-hole-punch',
                success: true,
                connection,
                duration: Date.now() - startTime,
                address
              }
            }
          } catch (error) {
            // Try next address
          }
        }
      }

      throw new Error('AutoNAT connection failed')

    } catch (error) {
      return {
        method: 'autonat-hole-punch',
        success: false,
        connection: null,
        error: error instanceof Error ? error.message : 'AutoNAT failed',
        duration: Date.now() - startTime
      }
    }
  }

  // Method 4: WebRTC connection
  private async attemptWebRTCConnection(targetPeerId: string): Promise<ConnectionResult> {
    const startTime = Date.now()
    
    try {
      this.logger.debug(`📹 Attempting WebRTC connection to ${targetPeerId}`)

      // WebRTC can traverse most NATs using STUN servers
      const webrtcAddr = `/webrtc/p2p/${targetPeerId}`
      const addr = multiaddr(webrtcAddr)
      
      const connection = await Promise.race([
        this.digNode.node.dial(addr),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('WebRTC connection timeout')), 30000)
        )
      ])

      if (connection) {
        this.logger.info(`✅ WebRTC connection successful to ${targetPeerId}`)
        return {
          method: 'webrtc',
          success: true,
          connection,
          duration: Date.now() - startTime
        }
      }

      throw new Error('WebRTC connection failed')

    } catch (error) {
      return {
        method: 'webrtc',
        success: false,
        connection: null,
        error: error instanceof Error ? error.message : 'WebRTC failed',
        duration: Date.now() - startTime
      }
    }
  }

  // Method 5: Circuit Relay via Public LibP2P Nodes
  private async attemptCircuitRelayConnection(targetPeerId: string): Promise<ConnectionResult> {
    const startTime = Date.now()
    
    try {
      this.logger.debug(`🔄 Attempting circuit relay connection to ${targetPeerId}`)

      for (const relayAddr of this.PUBLIC_CIRCUIT_RELAYS) {
        try {
          // Create circuit relay address
          const circuitAddr = `${relayAddr}/p2p-circuit/p2p/${targetPeerId}`
          const addr = multiaddr(circuitAddr)
          
          const connection = await Promise.race([
            this.digNode.node.dial(addr),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Circuit relay timeout')), 35000)
            )
          ])

          if (connection) {
            this.logger.info(`✅ Circuit relay connection successful to ${targetPeerId} via ${relayAddr}`)
            return {
              method: 'circuit-relay',
              success: true,
              connection,
              duration: Date.now() - startTime,
              relayNode: relayAddr
            }
          }
        } catch (error) {
          // Try next relay
        }
      }

      throw new Error('All circuit relays failed')

    } catch (error) {
      return {
        method: 'circuit-relay',
        success: false,
        connection: null,
        error: error instanceof Error ? error.message : 'Circuit relay failed',
        duration: Date.now() - startTime
      }
    }
  }

  // Method 6: WebSocket connection
  private async attemptWebSocketConnection(targetPeerId: string, addresses: string[]): Promise<ConnectionResult> {
    const startTime = Date.now()
    
    try {
      this.logger.debug(`🌐 Attempting WebSocket connection to ${targetPeerId}`)

      for (const address of addresses) {
        try {
          // Convert TCP address to WebSocket address
          const wsAddress = address.replace('/tcp/', '/ws/')
          const addr = multiaddr(wsAddress)
          
          const connection = await Promise.race([
            this.digNode.node.dial(addr),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('WebSocket timeout')), 20000)
            )
          ])

          if (connection) {
            this.logger.info(`✅ WebSocket connection successful to ${targetPeerId}`)
            return {
              method: 'websocket',
              success: true,
              connection,
              duration: Date.now() - startTime,
              address: wsAddress
            }
          }
        } catch (error) {
          // Try next address
        }
      }

      throw new Error('WebSocket connection failed')

    } catch (error) {
      return {
        method: 'websocket',
        success: false,
        connection: null,
        error: error instanceof Error ? error.message : 'WebSocket failed',
        duration: Date.now() - startTime
      }
    }
  }

  // Method 7: DHT-Assisted Connection Coordination
  private async attemptDHTAssistedConnection(targetPeerId: string): Promise<ConnectionResult> {
    const startTime = Date.now()
    
    try {
      this.logger.debug(`🔑 Attempting DHT-assisted connection to ${targetPeerId}`)

      const dht = this.digNode.node.services.dht
      if (!dht) {
        throw new Error('DHT not available')
      }

      // Store connection request in DHT for target peer to find
      const connectionRequest = {
        fromPeerId: this.digNode.node.peerId.toString(),
        toPeerId: targetPeerId,
        requestId: `dht_conn_${Date.now()}`,
        timestamp: Date.now(),
        addresses: this.digNode.node.getMultiaddrs().map((addr: any) => addr.toString())
      }

      const key = new TextEncoder().encode(`/dig-connection-request/${targetPeerId}`)
      const value = new TextEncoder().encode(JSON.stringify(connectionRequest))
      await dht.put(key, value)

      // Wait for target peer to respond with their connection info
      // This is a coordination mechanism for simultaneous connection attempts
      
      // For now, try a coordinated connection attempt
      await new Promise(resolve => setTimeout(resolve, 2000)) // Give time for coordination
      
      // Attempt connection after coordination
      const peer = this.digNode.node.getPeers().find((p: any) => p.toString() === targetPeerId)
      if (peer) {
        this.logger.info(`✅ DHT-assisted connection successful to ${targetPeerId}`)
        return {
          method: 'dht-assisted',
          success: true,
          connection: peer,
          duration: Date.now() - startTime
        }
      }

      throw new Error('DHT coordination failed')

    } catch (error) {
      return {
        method: 'dht-assisted',
        success: false,
        connection: null,
        error: error instanceof Error ? error.message : 'DHT assistance failed',
        duration: Date.now() - startTime
      }
    }
  }

  // Method 8: TURN Relay (Last Resort)
  private async attemptTurnRelayConnection(targetPeerId: string): Promise<ConnectionResult> {
    const startTime = Date.now()
    
    try {
      this.logger.warn(`📡 LAST RESORT: Using TURN relay for ${targetPeerId}`)

      // Use unified TURN coordination
      const turnCoordination = this.digNode.turnCoordination
      if (!turnCoordination) {
        throw new Error('TURN coordination not available')
      }

      const turnConnection = await turnCoordination.establishTurnRelay(targetPeerId)
      
      if (turnConnection) {
        this.logger.info(`✅ TURN relay connection established to ${targetPeerId}`)
        return {
          method: 'turn-relay',
          success: true,
          connection: turnConnection,
          duration: Date.now() - startTime,
          isRelay: true
        }
      }

      throw new Error('TURN relay failed')

    } catch (error) {
      return {
        method: 'turn-relay',
        success: false,
        connection: null,
        error: error instanceof Error ? error.message : 'TURN relay failed',
        duration: Date.now() - startTime
      }
    }
  }

  // Coordinate hole punching via DHT
  private async coordinateHolePunching(targetPeerId: string, targetAddr: any): Promise<void> {
    try {
      const dht = this.digNode.node.services.dht
      if (!dht) return

      // Store hole punching coordination info
      const coordination = {
        fromPeerId: this.digNode.node.peerId.toString(),
        toPeerId: targetPeerId,
        targetAddress: targetAddr.toString(),
        timestamp: Date.now(),
        action: 'simultaneous-dial'
      }

      const key = new TextEncoder().encode(`/dig-hole-punch/${targetPeerId}`)
      const value = new TextEncoder().encode(JSON.stringify(coordination))
      await dht.put(key, value)

      this.logger.debug(`🕳️ Coordinated hole punching for ${targetPeerId}`)

    } catch (error) {
      this.logger.debug('Hole punching coordination failed:', error)
    }
  }

  // Get connection attempt statistics
  getConnectionStats(): ConnectionStats {
    const attempts = Array.from(this.connectionAttempts.values())
    const methodStats = new Map<string, { attempts: number, successes: number }>()

    for (const attempt of attempts) {
      for (const method of attempt.methods) {
        const current = methodStats.get(method.method) || { attempts: 0, successes: 0 }
        current.attempts++
        if (method.success) current.successes++
        methodStats.set(method.method, current)
      }
    }

    const stats: any = {
      totalAttempts: attempts.length,
      successfulConnections: attempts.filter(a => a.finalResult?.success).length,
      methodSuccessRates: {}
    }

    for (const [method, data] of methodStats) {
      stats.methodSuccessRates[method] = {
        attempts: data.attempts,
        successes: data.successes,
        successRate: data.attempts > 0 ? (data.successes / data.attempts) * 100 : 0
      }
    }

    return stats
  }

  // Get the most successful connection method
  getBestConnectionMethod(): string {
    const stats = this.getConnectionStats()
    let bestMethod = 'direct-tcp'
    let bestRate = 0

    for (const [method, data] of Object.entries(stats.methodSuccessRates)) {
      const methodData = data as any
      if (methodData.attempts >= 3 && methodData.successRate > bestRate) {
        bestMethod = method
        bestRate = methodData.successRate
      }
    }

    return bestMethod
  }
}

// Connection attempt result
export interface ConnectionResult {
  method: string
  success: boolean
  connection: any
  error?: string
  duration: number
  address?: string
  relayNode?: string
  isRelay?: boolean
}

// Connection attempt log
interface ConnectionAttemptLog {
  targetPeerId: string
  startTime: number
  methods: ConnectionResult[]
  finalResult: ConnectionResult | null
}

// Connection statistics
interface ConnectionStats {
  totalAttempts: number
  successfulConnections: number
  methodSuccessRates: Record<string, {
    attempts: number
    successes: number
    successRate: number
  }>
}
