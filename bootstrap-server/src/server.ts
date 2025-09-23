#!/usr/bin/env node

/**
 * DIG Network Bootstrap Server
 * 
 * Dedicated bootstrap server for peer discovery and coordination.
 * Designed specifically for AWS Elastic Beanstalk deployment.
 * 
 * Features:
 * - Peer registration and discovery
 * - Socket.IO WebSocket relay for NAT traversal
 * - TURN server coordination
 * - Health monitoring
 * - Lightweight and reliable operation
 */

const express = require('express')
const cors = require('cors')
const { createServer } = require('http')
const { Server: SocketIOServer } = require('socket.io')

import type { Request, Response } from 'express'
import type { Socket } from 'socket.io'

// Configuration
const PORT = parseInt(process.env.PORT || '3000')
const NODE_ENV = process.env.NODE_ENV || 'development'
const PEER_TIMEOUT = 10 * 60 * 1000 // 10 minutes

console.log('🚀 Starting DIG Network Bootstrap Server')
console.log(`🌐 Port: ${PORT}`)
console.log(`🔧 Environment: ${NODE_ENV}`)
console.log('============================================')

// Types
interface RegisteredPeer {
  peerId: string
  addresses: string[]
  cryptoIPv6: string
  stores: string[]
  lastSeen: number
  version?: string
  turnCapable?: boolean
  turnAddresses?: string[]
  turnPort?: number
  turnCapacity?: number
  turnLoad?: number
}

interface ExtendedSocket {
  peerId?: string
  [key: string]: any
}

// In-memory storage
const registeredPeers = new Map<string, RegisteredPeer>()
const turnServers = new Map<string, RegisteredPeer>()

// Express app
const app = express()
const httpServer = createServer(app)

// Socket.IO server for WebSocket relay
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling']
})

// Middleware
app.use(cors())
app.use(express.json({ limit: '10mb' }))

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  const health = {
    status: 'healthy',
    service: 'DIG Network Bootstrap Server',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    peers: registeredPeers.size,
    turnServers: turnServers.size,
    socketConnections: io.sockets.sockets.size,
    environment: NODE_ENV
  }
  res.json(health)
})

// Peer registration endpoint
app.post('/register', (req: Request, res: Response) => {
  try {
    const { peerId, addresses, cryptoIPv6, stores = [], version = '1.0.0' } = req.body
    
    if (!peerId || !addresses || !Array.isArray(addresses)) {
      return res.status(400).json({ error: 'Missing required fields: peerId, addresses' })
    }

    const peer: RegisteredPeer = {
      peerId,
      addresses,
      cryptoIPv6,
      stores,
      version,
      lastSeen: Date.now()
    }

    registeredPeers.set(peerId, peer)
    console.log(`✅ Registered peer: ${peerId} (${stores.length} stores, v${version})`)
    
    res.json({ 
      success: true, 
      peerId, 
      totalPeers: registeredPeers.size,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('Registration error:', error)
    res.status(500).json({ error: 'Registration failed' })
  }
})

// Peer discovery endpoint
app.get('/peers', (req: Request, res: Response) => {
  try {
    const includeStores = req.query.includeStores === 'true'
    const now = Date.now()
    
    // Clean up expired peers
    for (const [id, peer] of registeredPeers.entries()) {
      if (now - peer.lastSeen > PEER_TIMEOUT) {
        registeredPeers.delete(id)
        turnServers.delete(id)
        console.log(`🧹 Cleaned up expired peer: ${id}`)
      }
    }

    const activePeers = Array.from(registeredPeers.values())
      .map(peer => ({
        peerId: peer.peerId,
        addresses: peer.addresses,
        cryptoIPv6: peer.cryptoIPv6,
        stores: includeStores ? peer.stores : undefined,
        lastSeen: peer.lastSeen,
        version: peer.version,
        turnCapable: peer.turnCapable
      }))

    res.json({
      peers: activePeers,
      total: activePeers.length,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('Peers endpoint error:', error)
    res.status(500).json({ error: 'Failed to get peers' })
  }
})

// Stats endpoint
app.get('/stats', (req: Request, res: Response) => {
  const now = Date.now()
  const activePeers = Array.from(registeredPeers.values())
    .filter(peer => now - peer.lastSeen < PEER_TIMEOUT)

  res.json({
    totalPeers: registeredPeers.size,
    activePeers: activePeers.length,
    turnServers: turnServers.size,
    socketConnections: io.sockets.sockets.size,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  })
})

// TURN server registration
app.post('/register-turn-server', (req: Request, res: Response) => {
  try {
    const { peerId, turnAddresses, turnPort, turnCapacity = 10 } = req.body
    
    if (!peerId || !turnAddresses || !turnPort) {
      return res.status(400).json({ error: 'Missing required fields: peerId, turnAddresses, turnPort' })
    }

    const peer = registeredPeers.get(peerId)
    if (peer) {
      peer.turnCapable = true
      peer.turnAddresses = turnAddresses
      peer.turnPort = turnPort
      peer.turnCapacity = turnCapacity
      peer.turnLoad = 0
      
      turnServers.set(peerId, peer)
      console.log(`📡 Registered TURN server: ${peerId}:${turnPort}`)
      
      res.json({ success: true, turnServers: turnServers.size })
    } else {
      res.status(404).json({ error: 'Peer not found - register peer first' })
    }
  } catch (error) {
    console.error('TURN registration error:', error)
    res.status(500).json({ error: 'TURN registration failed' })
  }
})

// TURN servers list
app.get('/turn-servers', (req: Request, res: Response) => {
  try {
    const servers = Array.from(turnServers.values())
      .filter(server => server.turnCapable && (server.turnLoad || 0) < (server.turnCapacity || 10))
      .sort((a, b) => (a.turnLoad || 0) - (b.turnLoad || 0))
    
    res.json({
      servers,
      total: servers.length,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('TURN servers endpoint error:', error)
    res.status(500).json({ error: 'Failed to get TURN servers' })
  }
})

// Store relay endpoint with byte-range support
app.post('/relay-store', (req: Request, res: Response) => {
  try {
    const { 
      storeId, 
      fromPeerId, 
      toPeerId, 
      turnServerId,
      rangeStart,
      rangeEnd,
      chunkId,
      totalSize
    } = req.body
    
    if (!storeId || !fromPeerId || !toPeerId) {
      return res.status(400).json({ error: 'Missing required fields: storeId, fromPeerId, toPeerId' })
    }

    const isRangeRequest = typeof rangeStart === 'number' && typeof rangeEnd === 'number'
    const logMsg = isRangeRequest 
      ? `🔄 Store range relay: ${storeId} (${rangeStart}-${rangeEnd}) from ${fromPeerId} to ${toPeerId}`
      : `🔄 Store relay: ${storeId} from ${fromPeerId} to ${toPeerId}`
    
    console.log(logMsg)

    // Try to use peer TURN servers first (with load balancing for ranges)
    if (turnServerId) {
      const turnServer = turnServers.get(turnServerId)
      if (turnServer && (turnServer.turnLoad || 0) < (turnServer.turnCapacity || 10)) {
        // For range requests, only increment load by fraction based on range size
        const loadIncrement = isRangeRequest && totalSize 
          ? (rangeEnd - rangeStart + 1) / totalSize 
          : 1
        
        turnServer.turnLoad = (turnServer.turnLoad || 0) + loadIncrement
        
        const method = isRangeRequest ? 'turn-range-relay' : 'turn-relay'
        console.log(`📡 Routing via TURN server: ${turnServerId} (method: ${method})`)
        
        return res.json({ 
          success: true, 
          method,
          turnServer: {
            addresses: turnServer.turnAddresses,
            port: turnServer.turnPort
          },
          rangeInfo: isRangeRequest ? { rangeStart, rangeEnd, chunkId, totalSize } : undefined
        })
      }
    }

    // Distribute range requests across available TURN servers for load balancing
    if (isRangeRequest && turnServers.size > 1) {
      const availableTurnServers = Array.from(turnServers.values())
        .filter(server => (server.turnLoad || 0) < (server.turnCapacity || 10))
        .sort((a, b) => (a.turnLoad || 0) - (b.turnLoad || 0))
      
      if (availableTurnServers.length > 0) {
        const selectedTurn = availableTurnServers[0]
        const loadIncrement = totalSize ? (rangeEnd - rangeStart + 1) / totalSize : 0.1
        selectedTurn.turnLoad = (selectedTurn.turnLoad || 0) + loadIncrement
        
        console.log(`📡 Auto-selected TURN server for range: ${selectedTurn.peerId}`)
        
        return res.json({
          success: true,
          method: 'turn-range-relay',
          turnServer: {
            addresses: selectedTurn.turnAddresses,
            port: selectedTurn.turnPort
          },
          rangeInfo: { rangeStart, rangeEnd, chunkId, totalSize }
        })
      }
    }

    // Fallback to WebSocket relay
    const targetSocket = Array.from(io.sockets.sockets.values())
      .find(socket => (socket as ExtendedSocket).peerId === toPeerId) as ExtendedSocket
    
    if (targetSocket) {
      const requestData = {
        storeId,
        fromPeerId,
        requestId: chunkId || `req_${Date.now()}`,
        ...(isRangeRequest ? { rangeStart, rangeEnd, chunkId, totalSize } : {})
      }
      
      targetSocket.emit('store-request', requestData)
      
      const method = isRangeRequest ? 'websocket-range-relay' : 'websocket-relay'
      console.log(`🔌 Routing via WebSocket relay to ${toPeerId} (method: ${method})`)
      res.json({ success: true, method })
    } else {
      res.status(404).json({ error: 'Target peer not connected' })
    }
  } catch (error) {
    console.error('Store relay error:', error)
    res.status(500).json({ error: 'Store relay failed' })
  }
})

// Socket.IO connection handling
io.on('connection', (socket: Socket) => {
  const extSocket = socket as ExtendedSocket
  console.log(`🔌 Socket.IO client connected: ${socket.id}`)

  socket.on('register-peer', (data: any) => {
    extSocket.peerId = data.peerId
    console.log(`📝 Socket registered for peer: ${data.peerId}`)
  })

  socket.on('store-response', (data: any) => {
    const { storeId, toPeerId, storeData, requestId } = data
    
    // Find the requesting peer's socket
    const targetSocket = Array.from(io.sockets.sockets.values())
      .find(s => (s as ExtendedSocket).peerId === toPeerId) as ExtendedSocket
    
    if (targetSocket) {
      targetSocket.emit('store-data', {
        storeId,
        storeData,
        requestId
      })
      console.log(`📦 Relayed store data for ${storeId} to ${toPeerId}`)
    }
  })

  socket.on('disconnect', () => {
    if (extSocket.peerId) {
      console.log(`🔌 Peer ${extSocket.peerId} disconnected`)
    }
  })
})

// Cleanup stale peers periodically
setInterval(() => {
  const now = Date.now()
  let cleanedCount = 0
  
  for (const [peerId, peer] of registeredPeers) {
    if (now - peer.lastSeen > PEER_TIMEOUT) {
      registeredPeers.delete(peerId)
      turnServers.delete(peerId)
      cleanedCount++
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`🧹 Cleaned up ${cleanedCount} stale peers`)
  }
}, 5 * 60 * 1000) // Every 5 minutes

// Start the server
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('✅ DIG Bootstrap Server started successfully!')
  console.log(`🌐 HTTP Server: http://0.0.0.0:${PORT}`)
  console.log(`🔌 Socket.IO: enabled for WebSocket relay`)
  console.log(`📡 TURN coordination: enabled`)
  console.log('')
  console.log('🔗 Available endpoints:')
  console.log(`   Health: http://0.0.0.0:${PORT}/health`)
  console.log(`   Register: POST http://0.0.0.0:${PORT}/register`)
  console.log(`   Peers: http://0.0.0.0:${PORT}/peers`)
  console.log(`   Stats: http://0.0.0.0:${PORT}/stats`)
  console.log(`   TURN Servers: http://0.0.0.0:${PORT}/turn-servers`)
  console.log(`   Store Relay: POST http://0.0.0.0:${PORT}/relay-store`)
  console.log('')
  console.log('💡 DIG nodes can connect using:')
  console.log(`   DIG_BOOTSTRAP_NODES="http://[HOSTNAME]:${PORT}"`)
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...')
  httpServer.close(() => {
    console.log('✅ Bootstrap server closed')
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  console.log('🛑 Received SIGINT, shutting down gracefully...')
  httpServer.close(() => {
    console.log('✅ Bootstrap server closed')
    process.exit(0)
  })
})

// Error handling
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error)
  process.exit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection:', reason)
  process.exit(1)
})
