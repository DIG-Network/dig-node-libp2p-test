/**
 * Intelligent Download Orchestrator
 * 
 * Implements the dual-role peer system:
 * - Direct-capable peers: Try direct connection first, use as TURN server second
 * - NAT-restricted peers: Always need TURN relay
 * - Download strategy: Direct > NAT traversal > TURN relay > Bootstrap fallback
 * 
 * Key insight: Any peer that accepts direct connections can also act as TURN server
 */

import { Logger } from './logger.js'
import { PeerConnectionCapabilities, ConnectionStrategy } from './PeerConnectionCapabilities.js'
import { ComprehensiveNATTraversal, ConnectionResult } from './ComprehensiveNATTraversal.js'

export class IntelligentDownloadOrchestrator {
  private logger = new Logger('DownloadOrchestrator')
  private digNode: any
  private peerCapabilities: PeerConnectionCapabilities
  private natTraversal: ComprehensiveNATTraversal
  private downloadAttempts = new Map<string, DownloadAttemptLog>()

  constructor(digNode: any) {
    this.digNode = digNode
    this.peerCapabilities = new PeerConnectionCapabilities(digNode)
    this.natTraversal = new ComprehensiveNATTraversal(digNode)
  }

  // Initialize the orchestrator
  async initialize(): Promise<void> {
    await this.peerCapabilities.initialize()
    this.logger.info('🎯 Intelligent download orchestrator initialized')
  }

  // Orchestrate store download using optimal strategy
  async downloadStore(storeId: string): Promise<DownloadResult> {
    const attemptId = `download_${storeId}_${Date.now()}`
    
    this.logger.info(`📥 Starting intelligent download: ${storeId}`)
    
    const attemptLog: DownloadAttemptLog = {
      storeId,
      startTime: Date.now(),
      strategies: [],
      finalResult: null
    }

    try {
      // Strategy 1: Direct connections to peers with the store
      const directResult = await this.attemptDirectDownload(storeId)
      attemptLog.strategies.push(directResult)
      if (directResult.success) {
        attemptLog.finalResult = directResult
        this.downloadAttempts.set(attemptId, attemptLog)
        return directResult
      }

      // Strategy 2: NAT traversal to peers with the store
      const natResult = await this.attemptNATTraversalDownload(storeId)
      attemptLog.strategies.push(natResult)
      if (natResult.success) {
        attemptLog.finalResult = natResult
        this.downloadAttempts.set(attemptId, attemptLog)
        return natResult
      }

      // Strategy 3: Use direct-capable peers as TURN servers
      const turnResult = await this.attemptDualRoleTurnDownload(storeId)
      attemptLog.strategies.push(turnResult)
      if (turnResult.success) {
        attemptLog.finalResult = turnResult
        this.downloadAttempts.set(attemptId, attemptLog)
        return turnResult
      }

      // Strategy 4: Bootstrap server fallback (absolute last resort)
      const bootstrapResult = await this.attemptBootstrapDownload(storeId)
      attemptLog.strategies.push(bootstrapResult)
      attemptLog.finalResult = bootstrapResult
      this.downloadAttempts.set(attemptId, attemptLog)
      
      return bootstrapResult

    } catch (error) {
      this.logger.error(`All download strategies failed for ${storeId}:`, error)
      const failureResult: DownloadResult = {
        strategy: 'all-failed',
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - attemptLog.startTime,
        peersAttempted: 0
      }
      attemptLog.finalResult = failureResult
      this.downloadAttempts.set(attemptId, attemptLog)
      return failureResult
    }
  }

  // Strategy 1: Direct download from direct-capable peers
  private async attemptDirectDownload(storeId: string): Promise<DownloadResult> {
    const startTime = Date.now()
    
    try {
      this.logger.info(`🔗 Attempting direct download for ${storeId}`)

      // Get direct-capable peers that have this store
      const directPeers = this.peerCapabilities.getDirectCapablePeersWithStore(storeId)
      
      if (directPeers.length === 0) {
        throw new Error('No direct-capable peers have this store')
      }

      this.logger.info(`📊 Found ${directPeers.length} direct-capable peers with store ${storeId}`)

      // Try direct download from each peer
      for (const peer of directPeers) {
        try {
          // Check if we're already connected
          const connectedPeer = this.digNode.node.getPeers().find((p: any) => p.toString() === peer.peerId)
          
          if (connectedPeer) {
            // Already connected - download directly
            const downloadData = await this.downloadFromConnectedPeer(storeId, peer.peerId)
            if (downloadData) {
              this.logger.info(`✅ Direct download successful from ${peer.peerId}`)
              return {
                strategy: 'direct-connected',
                success: true,
                data: downloadData,
                duration: Date.now() - startTime,
                peersAttempted: 1,
                sourcePeer: peer.peerId
              }
            }
          } else {
            // Need to establish connection first
            const connectionResult = await this.natTraversal.attemptConnection(peer.peerId, [])
            if (connectionResult.success && connectionResult.connection) {
              const downloadData = await this.downloadFromConnectedPeer(storeId, peer.peerId)
              if (downloadData) {
                this.logger.info(`✅ Direct download successful after connection to ${peer.peerId}`)
                return {
                  strategy: 'direct-after-connection',
                  success: true,
                  data: downloadData,
                  duration: Date.now() - startTime,
                  peersAttempted: 1,
                  sourcePeer: peer.peerId,
                  connectionMethod: connectionResult.method
                }
              }
            }
          }
        } catch (error) {
          this.logger.debug(`Direct download failed from ${peer.peerId}:`, error)
        }
      }

      throw new Error('All direct download attempts failed')

    } catch (error) {
      return {
        strategy: 'direct-download',
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Direct download failed',
        duration: Date.now() - startTime,
        peersAttempted: 0
      }
    }
  }

  // Strategy 2: NAT traversal download
  private async attemptNATTraversalDownload(storeId: string): Promise<DownloadResult> {
    const startTime = Date.now()
    
    try {
      this.logger.info(`🕳️ Attempting NAT traversal download for ${storeId}`)

      // Get all peers with the store (including NAT-restricted ones)
      const peersWithStore = this.digNode.peerDiscovery?.getDIGPeersWithStore(storeId) || []
      
      if (peersWithStore.length === 0) {
        throw new Error('No peers have this store')
      }

      this.logger.info(`📊 Found ${peersWithStore.length} peers with store, attempting NAT traversal`)

      // Try comprehensive NAT traversal for each peer
      for (const peer of peersWithStore) {
        try {
          const connectionResult = await this.natTraversal.attemptConnection(peer.peerId, [])
          
          if (connectionResult.success && connectionResult.connection) {
            const downloadData = await this.downloadFromConnectedPeer(storeId, peer.peerId)
            if (downloadData) {
              this.logger.info(`✅ NAT traversal download successful from ${peer.peerId} via ${connectionResult.method}`)
              return {
                strategy: 'nat-traversal',
                success: true,
                data: downloadData,
                duration: Date.now() - startTime,
                peersAttempted: 1,
                sourcePeer: peer.peerId,
                connectionMethod: connectionResult.method
              }
            }
          }
        } catch (error) {
          this.logger.debug(`NAT traversal failed for ${peer.peerId}:`, error)
        }
      }

      throw new Error('All NAT traversal attempts failed')

    } catch (error) {
      return {
        strategy: 'nat-traversal',
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'NAT traversal failed',
        duration: Date.now() - startTime,
        peersAttempted: 0
      }
    }
  }

  // Strategy 3: Dual-role TURN download (direct-capable peers as TURN servers)
  private async attemptDualRoleTurnDownload(storeId: string): Promise<DownloadResult> {
    const startTime = Date.now()
    
    try {
      this.logger.info(`📡 Attempting dual-role TURN download for ${storeId}`)

      // Find peers with the store
      const peersWithStore = this.digNode.peerDiscovery?.getDIGPeersWithStore(storeId) || []
      
      // Find direct-capable peers that can act as TURN servers
      const turnCapablePeers = this.peerCapabilities.getTurnCapablePeers()
      
      if (peersWithStore.length === 0) {
        throw new Error('No peers have this store')
      }
      
      if (turnCapablePeers.length === 0) {
        throw new Error('No TURN-capable peers available')
      }

      this.logger.info(`📊 Using ${turnCapablePeers.length} TURN servers to reach ${peersWithStore.length} peers with store`)

      // Try each combination: TURN server + source peer
      for (const turnServer of turnCapablePeers.slice(0, 3)) { // Limit to 3 TURN servers
        for (const sourcePeer of peersWithStore.slice(0, 2)) { // Limit to 2 source peers per TURN server
          try {
            // Skip if source peer is the same as TURN server (use direct download instead)
            if (sourcePeer.peerId === turnServer.peerId) {
              continue
            }

            this.logger.debug(`📡 TURN relay: ${sourcePeer.peerId} → ${turnServer.peerId} → us`)

            const downloadData = await this.downloadViaTurnRelay(storeId, sourcePeer.peerId, turnServer.peerId)
            if (downloadData) {
              this.logger.info(`✅ Dual-role TURN download successful: ${sourcePeer.peerId} via ${turnServer.peerId}`)
              return {
                strategy: 'dual-role-turn',
                success: true,
                data: downloadData,
                duration: Date.now() - startTime,
                peersAttempted: 1,
                sourcePeer: sourcePeer.peerId,
                turnServer: turnServer.peerId
              }
            }
          } catch (error) {
            this.logger.debug(`TURN relay failed: ${sourcePeer.peerId} via ${turnServer.peerId}:`, error)
          }
        }
      }

      throw new Error('All dual-role TURN attempts failed')

    } catch (error) {
      return {
        strategy: 'dual-role-turn',
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Dual-role TURN failed',
        duration: Date.now() - startTime,
        peersAttempted: 0
      }
    }
  }

  // Strategy 4: Bootstrap server fallback
  private async attemptBootstrapDownload(storeId: string): Promise<DownloadResult> {
    const startTime = Date.now()
    
    try {
      this.logger.warn(`☁️ LAST RESORT: Bootstrap server download for ${storeId}`)

      const bootstrapUrl = this.digNode.config.discoveryServers?.[0]
      if (!bootstrapUrl) {
        throw new Error('No bootstrap server configured')
      }

      // Use existing bootstrap download logic
      const downloadData = await this.downloadFromBootstrapServer(storeId, bootstrapUrl)
      
      if (downloadData) {
        this.logger.info(`✅ Bootstrap download successful (last resort)`)
        return {
          strategy: 'bootstrap-fallback',
          success: true,
          data: downloadData,
          duration: Date.now() - startTime,
          peersAttempted: 1,
          isLastResort: true
        }
      }

      throw new Error('Bootstrap download failed')

    } catch (error) {
      return {
        strategy: 'bootstrap-fallback',
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Bootstrap failed',
        duration: Date.now() - startTime,
        peersAttempted: 0
      }
    }
  }

  // Download from already connected peer
  private async downloadFromConnectedPeer(storeId: string, peerId: string): Promise<Buffer | null> {
    try {
      const peer = this.digNode.node.getPeers().find((p: any) => p.toString() === peerId)
      if (!peer) {
        throw new Error('Peer not connected')
      }

      // Use DIG protocol to download store
      const stream = await this.digNode.node.dialProtocol(peer, '/dig/1.0.0')
      
      const request = {
        type: 'GET_STORE_CONTENT',
        storeId
      }

      const { pipe } = await import('it-pipe')
      const { fromString: uint8ArrayFromString, toString: uint8ArrayToString } = await import('uint8arrays')

      await pipe(async function* () {
        yield uint8ArrayFromString(JSON.stringify(request))
      }, stream.sink)

      // Collect response data
      const chunks: Uint8Array[] = []
      let isFirstChunk = true
      let metadata: any = null

      await pipe(stream.source, async function (source: any) {
        for await (const chunk of source) {
          if (isFirstChunk) {
            try {
              const response = JSON.parse(uint8ArrayToString(chunk))
              if (response.success) {
                metadata = response
                isFirstChunk = false
                continue
              } else {
                throw new Error(response.error || 'Download failed')
              }
            } catch (parseError) {
              // Treat as binary data if parsing fails
              chunks.push(chunk)
            }
          } else {
            chunks.push(chunk)
          }
        }
      })

      if (chunks.length > 0) {
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
        const content = new Uint8Array(totalLength)
        let offset = 0
        
        for (const chunk of chunks) {
          content.set(chunk, offset)
          offset += chunk.length
        }

        this.logger.debug(`📥 Downloaded ${content.length} bytes from ${peerId}`)
        return Buffer.from(content)
      }

      return null

    } catch (error) {
      this.logger.debug(`Direct peer download failed from ${peerId}:`, error)
      return null
    }
  }

  // Download via TURN relay using dual-role peer system
  private async downloadViaTurnRelay(storeId: string, sourcePeerId: string, turnServerPeerId: string): Promise<Buffer | null> {
    try {
      this.logger.debug(`📡 TURN relay download: ${sourcePeerId} → ${turnServerPeerId} → us`)

      // 1. Signal source peer to connect to TURN server
      await this.signalPeerToConnectToTurnServer(sourcePeerId, turnServerPeerId)

      // 2. Establish our own connection to TURN server
      const turnConnection = await this.connectToTurnServer(turnServerPeerId)
      if (!turnConnection) {
        throw new Error('Failed to connect to TURN server')
      }

      // 3. Request file transfer through TURN relay
      const downloadData = await this.requestFileViaTurnRelay(storeId, sourcePeerId, turnServerPeerId)
      
      return downloadData

    } catch (error) {
      this.logger.debug(`TURN relay download failed:`, error)
      return null
    }
  }

  // Signal peer to connect to TURN server
  private async signalPeerToConnectToTurnServer(sourcePeerId: string, turnServerPeerId: string): Promise<void> {
    try {
      // Try direct signaling first
      const sourcePeer = this.digNode.node.getPeers().find((p: any) => p.toString() === sourcePeerId)
      
      if (sourcePeer) {
        const stream = await this.digNode.node.dialProtocol(sourcePeer, '/dig/1.0.0')
        
        const signal = {
          type: 'CONNECT_TO_TURN_SERVER',
          turnServerPeerId,
          requestId: `turn_signal_${Date.now()}`,
          requesterPeerId: this.digNode.node.peerId.toString()
        }

        const { pipe } = await import('it-pipe')
        const { fromString: uint8ArrayFromString } = await import('uint8arrays')

        await pipe(async function* () {
          yield uint8ArrayFromString(JSON.stringify(signal))
        }, stream.sink)

        this.logger.debug(`📡 Signaled ${sourcePeerId} to connect to TURN server ${turnServerPeerId}`)
      } else {
        // Fallback to DHT signaling
        await this.signalViaDHT(sourcePeerId, turnServerPeerId)
      }

    } catch (error) {
      this.logger.debug(`Failed to signal peer ${sourcePeerId}:`, error)
      throw error
    }
  }

  // Signal via DHT
  private async signalViaDHT(sourcePeerId: string, turnServerPeerId: string): Promise<void> {
    const dht = this.digNode.node.services.dht
    if (!dht) throw new Error('DHT not available for signaling')

    const signal = {
      type: 'TURN_CONNECTION_SIGNAL',
      fromPeerId: this.digNode.node.peerId.toString(),
      turnServerPeerId,
      timestamp: Date.now()
    }

    const key = new TextEncoder().encode(`/dig-turn-signal/${sourcePeerId}`)
    const value = new TextEncoder().encode(JSON.stringify(signal))
    await dht.put(key, value)

    this.logger.debug(`🔑 Stored TURN signal in DHT for ${sourcePeerId}`)
  }

  // Connect to TURN server
  private async connectToTurnServer(turnServerPeerId: string): Promise<any> {
    try {
      // Check if we're already connected
      const turnPeer = this.digNode.node.getPeers().find((p: any) => p.toString() === turnServerPeerId)
      
      if (turnPeer) {
        return turnPeer // Already connected
      }

      // Establish connection to TURN server
      const connectionResult = await this.natTraversal.attemptConnection(turnServerPeerId, [])
      return connectionResult.success ? connectionResult.connection : null

    } catch (error) {
      this.logger.debug(`Failed to connect to TURN server ${turnServerPeerId}:`, error)
      return null
    }
  }

  // Request file via TURN relay
  private async requestFileViaTurnRelay(storeId: string, sourcePeerId: string, turnServerPeerId: string): Promise<Buffer | null> {
    try {
      // Implementation would coordinate the TURN relay transfer
      // For now, return null as placeholder
      return null
    } catch (error) {
      this.logger.debug('TURN relay file request failed:', error)
      return null
    }
  }

  // Download from bootstrap server (last resort)
  private async downloadFromBootstrapServer(storeId: string, bootstrapUrl: string): Promise<Buffer | null> {
    try {
      // Implementation would use bootstrap server as absolute fallback
      // For now, return null as placeholder
      return null
    } catch (error) {
      this.logger.debug('Bootstrap server download failed:', error)
      return null
    }
  }

  // Get download orchestration statistics
  getOrchestrationStats(): OrchestrationStats {
    const attempts = Array.from(this.downloadAttempts.values())
    const strategyStats = new Map<string, { attempts: number, successes: number }>()

    for (const attempt of attempts) {
      for (const strategy of attempt.strategies) {
        const current = strategyStats.get(strategy.strategy) || { attempts: 0, successes: 0 }
        current.attempts++
        if (strategy.success) current.successes++
        strategyStats.set(strategy.strategy, current)
      }
    }

    const stats: any = {
      totalDownloads: attempts.length,
      successfulDownloads: attempts.filter(a => a.finalResult?.success).length,
      strategySuccessRates: {},
      peerCapabilityStats: this.peerCapabilities.getCapabilityStats()
    }

    for (const [strategy, data] of strategyStats) {
      stats.strategySuccessRates[strategy] = {
        attempts: data.attempts,
        successes: data.successes,
        successRate: data.attempts > 0 ? (data.successes / data.attempts) * 100 : 0
      }
    }

    return stats
  }
}

// Download result
export interface DownloadResult {
  strategy: string
  success: boolean
  data: Buffer | null
  error?: string
  duration: number
  peersAttempted: number
  sourcePeer?: string
  turnServer?: string
  connectionMethod?: string
  isLastResort?: boolean
}

// Download attempt log
interface DownloadAttemptLog {
  storeId: string
  startTime: number
  strategies: DownloadResult[]
  finalResult: DownloadResult | null
}

// Orchestration statistics
interface OrchestrationStats {
  totalDownloads: number
  successfulDownloads: number
  strategySuccessRates: Record<string, {
    attempts: number
    successes: number
    successRate: number
  }>
  peerCapabilityStats: any
}
