/**
 * On-Demand TURN Connection Manager
 * 
 * Features:
 * - Dynamic WebSocket connections to TURN servers only when needed
 * - Connection pooling and reuse across the network
 * - Automatic connection cleanup after transfers
 * - TURN server discovery and connection coordination
 * - Support for bootstrap server and peer TURN servers
 */

import { io, Socket } from 'socket.io-client'
import { Logger } from './logger.js'

export class OnDemandTurnConnection {
  private logger = new Logger('OnDemandTURN')
  private activeConnections = new Map<string, TurnConnection>()
  private connectionRequests = new Map<string, PendingRequest>()
  private digNode: any

  constructor(digNode: any) {
    this.digNode = digNode
  }

  // Request file transfer via on-demand TURN connection
  async requestFileViaOnDemandTurn(
    storeId: string, 
    sourcePeerId: string, 
    turnServerInfo: TurnServerInfo,
    rangeStart?: number,
    rangeEnd?: number
  ): Promise<Buffer | null> {
    try {
      const requestId = `turn_request_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      this.logger.info(`📡 Requesting on-demand TURN connection: ${storeId} via ${turnServerInfo.peerId}`)

      // 1. Signal source peer to connect to TURN server
      await this.signalPeerToConnectToTurn(sourcePeerId, turnServerInfo, requestId)

      // 2. Establish our own connection to TURN server
      const turnConnection = await this.connectToTurnServer(turnServerInfo, requestId)

      // 3. Coordinate the file transfer
      const transferData = await this.coordinateFileTransfer(
        turnConnection, 
        storeId, 
        sourcePeerId, 
        requestId,
        rangeStart,
        rangeEnd
      )

      // 4. Cleanup connections after transfer
      await this.cleanupTurnConnection(turnServerInfo.peerId, requestId)

      return transferData

    } catch (error) {
      this.logger.error(`On-demand TURN request failed for ${storeId}:`, error)
      return null
    }
  }

  // Signal peer to establish on-demand connection to TURN server
  private async signalPeerToConnectToTurn(
    sourcePeerId: string, 
    turnServerInfo: TurnServerInfo, 
    requestId: string
  ): Promise<void> {
    try {
      // Find the source peer
      const sourcePeer = this.digNode.node.getPeers().find((p: any) => p.toString() === sourcePeerId)
      
      if (sourcePeer) {
        // Direct LibP2P signal to peer
        const stream = await this.digNode.node.dialProtocol(sourcePeer, '/dig/1.0.0')
        
        const connectionSignal = {
          type: 'TURN_CONNECTION_REQUEST',
          requestId,
          turnServerInfo,
          instruction: 'connect-to-turn-server',
          purpose: 'file-transfer',
          requesterPeerId: this.digNode.node.peerId.toString()
        }

        const { pipe } = await import('it-pipe')
        const { fromString: uint8ArrayFromString } = await import('uint8arrays')

        await pipe(async function* () {
          yield uint8ArrayFromString(JSON.stringify(connectionSignal))
        }, stream.sink)

        this.logger.info(`📡 Signaled ${sourcePeerId} to connect to TURN server ${turnServerInfo.peerId}`)

      } else {
        // Fallback: Signal via bootstrap server
        await this.signalPeerViaBoostrap(sourcePeerId, turnServerInfo, requestId)
      }

    } catch (error) {
      this.logger.error(`Failed to signal peer ${sourcePeerId}:`, error)
      throw error
    }
  }

  // Signal peer via bootstrap server to connect to TURN
  private async signalPeerViaBoostrap(
    sourcePeerId: string, 
    turnServerInfo: TurnServerInfo, 
    requestId: string
  ): Promise<void> {
    try {
      const bootstrapUrl = this.digNode.config.discoveryServers?.[0]
      if (!bootstrapUrl) {
        throw new Error('No bootstrap server available for signaling')
      }

      const response = await fetch(`${bootstrapUrl}/signal-turn-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetPeerId: sourcePeerId,
          turnServerInfo,
          requestId,
          requesterPeerId: this.digNode.node.peerId.toString(),
          instruction: 'connect-to-turn-server'
        })
      })

      if (!response.ok) {
        throw new Error(`Bootstrap signaling failed: ${response.status}`)
      }

      this.logger.info(`📡 Signaled ${sourcePeerId} via bootstrap to connect to TURN server`)

    } catch (error) {
      this.logger.error(`Bootstrap signaling failed:`, error)
      throw error
    }
  }

  // Establish on-demand connection to TURN server
  private async connectToTurnServer(turnServerInfo: TurnServerInfo, requestId: string): Promise<TurnConnection> {
    try {
      const connectionKey = `${turnServerInfo.peerId}_${requestId}`
      
      // Check if we already have a connection
      let connection = this.activeConnections.get(connectionKey)
      if (connection && connection.socket.connected) {
        this.logger.debug(`🔄 Reusing existing TURN connection: ${turnServerInfo.peerId}`)
        return connection
      }

      // Create new on-demand connection
      const wsUrl = this.getTurnServerWebSocketUrl(turnServerInfo)
      const socket = io(wsUrl, {
        transports: ['websocket'],
        timeout: 15000,
        forceNew: true // Force new connection for this request
      })

      connection = {
        peerId: turnServerInfo.peerId,
        socket,
        requestId,
        connected: false,
        createdAt: Date.now()
      }

      // Wait for connection
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('TURN connection timeout'))
        }, 15000)

        socket.on('connect', () => {
          clearTimeout(timeout)
          connection!.connected = true
          this.logger.info(`📡 Connected to TURN server: ${turnServerInfo.peerId}`)
          
          // Register for file transfer
          socket.emit('register-for-transfer', {
            peerId: this.digNode.node.peerId.toString(),
            requestId,
            purpose: 'file-transfer'
          })
          
          resolve()
        })

        socket.on('connect_error', (error) => {
          clearTimeout(timeout)
          reject(error)
        })
      })

      this.activeConnections.set(connectionKey, connection)
      return connection

    } catch (error) {
      this.logger.error(`Failed to connect to TURN server ${turnServerInfo.peerId}:`, error)
      throw error
    }
  }

  // Coordinate file transfer through TURN server
  private async coordinateFileTransfer(
    turnConnection: TurnConnection,
    storeId: string,
    sourcePeerId: string,
    requestId: string,
    rangeStart?: number,
    rangeEnd?: number
  ): Promise<Buffer | null> {
    try {
      this.logger.info(`🔄 Coordinating file transfer: ${storeId} from ${sourcePeerId}`)

      // Request file transfer through TURN server
      const transferRequest = {
        type: 'coordinate-transfer',
        storeId,
        sourcePeerId,
        targetPeerId: this.digNode.node.peerId.toString(),
        requestId,
        rangeStart,
        rangeEnd
      }

      // Send transfer request
      turnConnection.socket.emit('coordinate-file-transfer', transferRequest)

      // Wait for file data
      return new Promise<Buffer | null>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('File transfer timeout'))
        }, 60000) // 1 minute timeout

        turnConnection.socket.on('file-transfer-data', (data: any) => {
          if (data.requestId === requestId) {
            clearTimeout(timeout)
            
            if (data.success && data.fileData) {
              const fileData = Buffer.from(data.fileData, 'base64')
              this.logger.info(`✅ Received file data via TURN: ${fileData.length} bytes`)
              resolve(fileData)
            } else {
              reject(new Error(data.error || 'File transfer failed'))
            }
          }
        })

        turnConnection.socket.on('transfer-error', (error: any) => {
          if (error.requestId === requestId) {
            clearTimeout(timeout)
            reject(new Error(error.message || 'Transfer error'))
          }
        })
      })

    } catch (error) {
      this.logger.error(`File transfer coordination failed:`, error)
      return null
    }
  }

  // Get WebSocket URL for TURN server
  private getTurnServerWebSocketUrl(turnServerInfo: TurnServerInfo): string {
    if (turnServerInfo.type === 'bootstrap') {
      // Bootstrap server WebSocket
      return turnServerInfo.url.replace('http://', 'ws://').replace('https://', 'wss://')
    } else {
      // Peer TURN server WebSocket
      // Extract IP from crypto-IPv6 address and use standard port
      const match = turnServerInfo.addresses?.[0]?.match(/\/ip4\/([^\/]+)\/tcp\/(\d+)/)
      if (match) {
        const [, ip, port] = match
        const wsPort = parseInt(port) + 1000 // WebSocket port convention
        return `ws://${ip}:${wsPort}`
      } else {
        throw new Error(`Cannot determine WebSocket URL for TURN server ${turnServerInfo.peerId}`)
      }
    }
  }

  // Cleanup TURN connection after transfer
  private async cleanupTurnConnection(turnServerId: string, requestId: string): Promise<void> {
    try {
      const connectionKey = `${turnServerId}_${requestId}`
      const connection = this.activeConnections.get(connectionKey)
      
      if (connection) {
        // Graceful disconnect
        connection.socket.emit('transfer-complete', { requestId })
        
        // Close connection after brief delay
        setTimeout(() => {
          connection.socket.disconnect()
          this.activeConnections.delete(connectionKey)
          this.logger.debug(`🧹 Cleaned up TURN connection: ${turnServerId}`)
        }, 5000) // 5 second delay for graceful cleanup
      }

    } catch (error) {
      this.logger.debug(`TURN connection cleanup failed:`, error)
    }
  }

  // Handle incoming TURN connection requests from other peers
  async handleTurnConnectionRequest(request: any, fromPeerId: string): Promise<void> {
    try {
      const { requestId, turnServerInfo, instruction, purpose } = request

      if (instruction === 'connect-to-turn-server' && purpose === 'file-transfer') {
        this.logger.info(`📡 Received TURN connection request from ${fromPeerId}: ${turnServerInfo.peerId}`)

        // Establish connection to the specified TURN server
        const connection = await this.connectToTurnServer(turnServerInfo, requestId)
        
        // Notify requesting peer that we're connected
        await this.notifyTurnConnectionEstablished(fromPeerId, requestId, turnServerInfo)
      }

    } catch (error) {
      this.logger.error(`Failed to handle TURN connection request:`, error)
    }
  }

  // Notify peer that TURN connection is established
  private async notifyTurnConnectionEstablished(
    requesterPeerId: string, 
    requestId: string, 
    turnServerInfo: TurnServerInfo
  ): Promise<void> {
    try {
      const requesterPeer = this.digNode.node.getPeers().find((p: any) => p.toString() === requesterPeerId)
      
      if (requesterPeer) {
        const stream = await this.digNode.node.dialProtocol(requesterPeer, '/dig/1.0.0')
        
        const notification = {
          type: 'TURN_CONNECTION_ESTABLISHED',
          requestId,
          turnServerInfo,
          connectedPeerId: this.digNode.node.peerId.toString(),
          status: 'ready-for-transfer'
        }

        const { pipe } = await import('it-pipe')
        const { fromString: uint8ArrayFromString } = await import('uint8arrays')

        await pipe(async function* () {
          yield uint8ArrayFromString(JSON.stringify(notification))
        }, stream.sink)

        this.logger.info(`✅ Notified ${requesterPeerId} that TURN connection is established`)
      }

    } catch (error) {
      this.logger.error(`Failed to notify TURN connection establishment:`, error)
    }
  }

  // Get active TURN connections
  getActiveTurnConnections(): TurnConnectionInfo[] {
    const connections: TurnConnectionInfo[] = []
    
    for (const [key, connection] of this.activeConnections) {
      connections.push({
        peerId: connection.peerId,
        requestId: connection.requestId,
        connected: connection.connected,
        duration: Date.now() - connection.createdAt,
        status: connection.connected ? 'active' : 'connecting'
      })
    }

    return connections
  }

  // Cleanup all connections
  async cleanup(): Promise<void> {
    for (const [key, connection] of this.activeConnections) {
      try {
        connection.socket.disconnect()
      } catch (error) {
        // Silent cleanup
      }
    }
    this.activeConnections.clear()
    this.logger.info('🧹 Cleaned up all TURN connections')
  }
}

// TURN server information
export interface TurnServerInfo {
  peerId: string
  type: 'bootstrap' | 'peer'
  url: string
  addresses?: string[]
  cryptoIPv6?: string
  port?: number
}

// Active TURN connection
interface TurnConnection {
  peerId: string
  socket: Socket
  requestId: string
  connected: boolean
  createdAt: number
}

// Pending transfer request
interface PendingRequest {
  requestId: string
  storeId: string
  sourcePeerId: string
  targetPeerId: string
  turnServerInfo: TurnServerInfo
  createdAt: number
}

// TURN connection information
export interface TurnConnectionInfo {
  peerId: string
  requestId: string
  connected: boolean
  duration: number
  status: string
}
