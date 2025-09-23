/**
 * Persistent Signaling Connection Manager
 * 
 * Maintains lightweight persistent connections ONLY for signaling purposes:
 * - Receive TURN connection instructions
 * - Get file transfer requests
 * - Coordinate on-demand TURN connections
 * - Handle NAT traversal signaling
 * 
 * Key: Data transfer connections are still on-demand and temporary
 */

import { io, Socket } from 'socket.io-client'
import { Logger } from './logger.js'

export class PersistentSignalingConnection {
  private logger = new Logger('SignalingConnection')
  private signalingSocket: Socket | null = null
  private digNode: any
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10
  private reconnectDelay = 5000 // 5 seconds

  constructor(digNode: any) {
    this.digNode = digNode
  }

  // Establish persistent signaling connection (lightweight)
  async establishSignalingConnection(): Promise<void> {
    try {
      const bootstrapUrl = this.digNode.config.discoveryServers?.[0]
      if (!bootstrapUrl) {
        throw new Error('No bootstrap server for signaling')
      }

      const wsUrl = bootstrapUrl.replace('http://', 'ws://').replace('https://', 'wss://')
      
      this.logger.info(`📡 Establishing persistent signaling connection to ${wsUrl}`)

      this.signalingSocket = io(wsUrl, {
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: this.reconnectDelay,
        timeout: 20000
      })

      // Set up signaling event handlers
      this.setupSignalingHandlers()

      // Wait for connection
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Signaling connection timeout'))
        }, 20000)

        this.signalingSocket!.on('connect', () => {
          clearTimeout(timeout)
          this.reconnectAttempts = 0
          this.logger.info(`✅ Persistent signaling connection established`)
          
          // Register for signaling (lightweight registration)
          this.signalingSocket!.emit('register-for-signaling', {
            peerId: this.digNode.node.peerId.toString(),
            cryptoIPv6: this.digNode.cryptoIPv6,
            purpose: 'signaling-only', // Not for data transfer
            capabilities: ['turn-connection-coordination', 'file-transfer-signaling']
          })
          
          resolve()
        })

        this.signalingSocket!.on('connect_error', (error) => {
          clearTimeout(timeout)
          reject(error)
        })
      })

    } catch (error) {
      this.logger.error('Failed to establish signaling connection:', error)
      throw error
    }
  }

  // Set up signaling event handlers
  private setupSignalingHandlers(): void {
    if (!this.signalingSocket) return

    // Handle TURN connection signals (CRITICAL for NAT traversal)
    this.signalingSocket.on('turn-connection-signal', async (data: any) => {
      const { requestId, turnServerInfo, instruction, requesterPeerId } = data
      
      this.logger.info(`📡 Received TURN connection signal from ${requesterPeerId}: ${instruction}`)
      
      if (instruction === 'connect-to-turn-server') {
        try {
          // Establish on-demand connection to specified TURN server
          await this.establishOnDemandTurnConnection(turnServerInfo, requestId, requesterPeerId)
        } catch (error) {
          this.logger.error(`Failed to establish on-demand TURN connection:`, error)
        }
      }
    })

    // Handle file transfer requests through signaling
    this.signalingSocket.on('file-transfer-request', async (data: any) => {
      const { storeId, requestId, requesterPeerId, turnServerInfo } = data
      
      this.logger.info(`📥 File transfer request via signaling: ${storeId} for ${requesterPeerId}`)
      
      try {
        // Check if we have the requested store
        const digFile = this.digNode.digFiles.get(storeId)
        if (digFile) {
          // Establish on-demand TURN connection for this transfer
          await this.establishOnDemandTurnConnection(turnServerInfo, requestId, requesterPeerId)
          
          // Send file data through TURN server
          await this.sendFileViaTurn(storeId, requestId, turnServerInfo)
        } else {
          // Notify that we don't have the file
          this.signalingSocket!.emit('file-not-available', {
            requestId,
            storeId,
            peerId: this.digNode.node.peerId.toString()
          })
        }
      } catch (error) {
        this.logger.error(`File transfer request handling failed:`, error)
      }
    })

    // Handle reconnection
    this.signalingSocket.on('reconnect', () => {
      this.logger.info('🔄 Signaling connection reconnected')
      this.reconnectAttempts = 0
    })

    this.signalingSocket.on('disconnect', (reason) => {
      this.logger.warn(`📡 Signaling connection disconnected: ${reason}`)
      
      if (reason === 'io server disconnect') {
        // Server disconnected us, try to reconnect
        this.attemptReconnect()
      }
    })
  }

  // Establish on-demand TURN connection when signaled
  private async establishOnDemandTurnConnection(
    turnServerInfo: any, 
    requestId: string, 
    requesterPeerId: string
  ): Promise<void> {
    try {
      this.logger.info(`🔌 Establishing on-demand TURN connection to ${turnServerInfo.peerId} for request ${requestId}`)

      // Create temporary connection ONLY for this transfer
      const turnWsUrl = this.getTurnServerWebSocketUrl(turnServerInfo)
      const turnSocket = io(turnWsUrl, {
        transports: ['websocket'],
        timeout: 15000,
        forceNew: true // Force new connection
      })

      // Wait for TURN connection
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('TURN connection timeout'))
        }, 15000)

        turnSocket.on('connect', () => {
          clearTimeout(timeout)
          this.logger.info(`✅ On-demand TURN connection established: ${turnServerInfo.peerId}`)
          
          // Register for this specific transfer
          turnSocket.emit('register-for-transfer', {
            peerId: this.digNode.node.peerId.toString(),
            requestId,
            purpose: 'file-transfer',
            requesterPeerId
          })
          
          resolve()
        })

        turnSocket.on('connect_error', (error) => {
          clearTimeout(timeout)
          reject(error)
        })
      })

      // Set up file transfer handlers for this connection
      this.setupTurnTransferHandlers(turnSocket, requestId)

      // Notify requester that we're connected and ready
      this.signalingSocket?.emit('turn-connection-established', {
        requestId,
        connectedPeerId: this.digNode.node.peerId.toString(),
        turnServerInfo,
        status: 'ready-for-transfer'
      })

    } catch (error) {
      this.logger.error(`Failed to establish on-demand TURN connection:`, error)
      throw error
    }
  }

  // Set up file transfer handlers for temporary TURN connection
  private setupTurnTransferHandlers(turnSocket: Socket, requestId: string): void {
    // Handle file transfer requests through this TURN connection
    turnSocket.on('transfer-file-request', async (data: any) => {
      if (data.requestId === requestId) {
        const { storeId, rangeStart, rangeEnd } = data
        
        try {
          const digFile = this.digNode.digFiles.get(storeId)
          if (digFile) {
            let fileData: Buffer
            
            if (typeof rangeStart === 'number' && typeof rangeEnd === 'number') {
              // Byte range request
              fileData = digFile.content.subarray(rangeStart, rangeEnd + 1)
              this.logger.info(`📤 Sending file range via TURN: ${storeId} (${rangeStart}-${rangeEnd})`)
            } else {
              // Full file request
              fileData = digFile.content
              this.logger.info(`📤 Sending full file via TURN: ${storeId} (${fileData.length} bytes)`)
            }

            // Send file data through TURN connection
            turnSocket.emit('transfer-file-data', {
              requestId,
              storeId,
              fileData: fileData.toString('base64'),
              size: fileData.length,
              rangeStart,
              rangeEnd
            })

          } else {
            turnSocket.emit('transfer-error', {
              requestId,
              error: 'File not found'
            })
          }
        } catch (error) {
          turnSocket.emit('transfer-error', {
            requestId,
            error: error instanceof Error ? error.message : 'Transfer failed'
          })
        }
      }
    })

    // Handle transfer completion
    turnSocket.on('transfer-complete', (data: any) => {
      if (data.requestId === requestId) {
        this.logger.info(`✅ Transfer completed via TURN: ${requestId}`)
        
        // Cleanup this temporary connection
        setTimeout(() => {
          turnSocket.disconnect()
          this.logger.debug(`🧹 Cleaned up on-demand TURN connection for ${requestId}`)
        }, 5000)
      }
    })
  }

  // Get WebSocket URL for TURN server
  private getTurnServerWebSocketUrl(turnServerInfo: any): string {
    if (turnServerInfo.type === 'bootstrap') {
      return turnServerInfo.url.replace('http://', 'ws://').replace('https://', 'wss://')
    } else {
      // Peer TURN server - extract from addresses
      const match = turnServerInfo.addresses?.[0]?.match(/\/ip4\/([^\/]+)\/tcp\/(\d+)/)
      if (match) {
        const [, ip, port] = match
        const wsPort = parseInt(port) + 1000
        return `ws://${ip}:${wsPort}`
      }
      throw new Error(`Cannot determine WebSocket URL for ${turnServerInfo.peerId}`)
    }
  }

  // Send file through established TURN connection
  private async sendFileViaTurn(storeId: string, requestId: string, turnServerInfo: any): Promise<void> {
    try {
      // The file sending is handled by the turn transfer handlers
      // This method coordinates the overall process
      this.logger.info(`📤 Coordinating file send via TURN: ${storeId}`)
      
      // File transfer is handled by the setupTurnTransferHandlers
      // when the TURN server requests the file
      
    } catch (error) {
      this.logger.error(`Failed to send file via TURN:`, error)
    }
  }

  // Attempt to reconnect signaling connection
  private async attemptReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error('🚫 Max reconnection attempts reached for signaling connection')
      return
    }

    this.reconnectAttempts++
    this.logger.info(`🔄 Attempting signaling reconnection (${this.reconnectAttempts}/${this.maxReconnectAttempts})`)

    setTimeout(async () => {
      try {
        await this.establishSignalingConnection()
      } catch (error) {
        this.logger.error('Signaling reconnection failed:', error)
        this.attemptReconnect()
      }
    }, this.reconnectDelay * this.reconnectAttempts) // Exponential backoff
  }

  // Check if signaling connection is active
  isSignalingConnected(): boolean {
    return this.signalingSocket?.connected || false
  }

  // Cleanup signaling connection
  async cleanup(): Promise<void> {
    if (this.signalingSocket) {
      this.signalingSocket.disconnect()
      this.signalingSocket = null
      this.logger.info('🧹 Cleaned up signaling connection')
    }
  }
}
