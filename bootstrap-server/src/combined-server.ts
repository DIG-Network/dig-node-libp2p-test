#!/usr/bin/env node

/**
 * Combined Bootstrap Server for DIG Network
 * 
 * Combines:
 * - HTTP API server (existing functionality)
 * - LibP2P bootstrap server (new dedicated bootstrap)
 * - Cost-aware TURN coordination
 * - Peer discovery and routing
 */

const express = require('express')
const cors = require('cors')
const { createServer } = require('http')
const { Server: SocketIOServer } = require('socket.io')

import type { Request, Response } from 'express'
import { LibP2PBootstrapServer } from './libp2p-bootstrap.js'
import { CostAwareTURNServerFallback } from './CostAwareTURNServer-Fallback.js'

// Configuration
const PORT = parseInt(process.env.PORT || '3000')
const LIBP2P_PORT = 4001
const NODE_ENV = process.env.NODE_ENV || 'development'

console.log('🚀 Starting Combined DIG Network Bootstrap Server')
console.log(`🌐 HTTP Port: ${PORT}`)
console.log(`🔗 LibP2P Port: ${LIBP2P_PORT}`)
console.log(`🔧 Environment: ${NODE_ENV}`)
console.log('============================================')

// Initialize components
const libp2pBootstrap = new LibP2PBootstrapServer()
const costAwareTURN = new CostAwareTURNServerFallback()

// Express app for HTTP API
const app = express()
const httpServer = createServer(app)

// Socket.IO for WebSocket relay
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket'],
  allowEIO3: false,
  pingTimeout: 60000,
  pingInterval: 25000
})

// Middleware
app.use(cors())
app.use(express.json({ limit: '10mb' }))

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  const libp2pStatus = libp2pBootstrap.getStatus()
  const costStats = costAwareTURN.getCostStatistics()
  
  const health = {
    status: 'healthy',
    service: 'DIG Network Combined Bootstrap Server',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: NODE_ENV,
    libp2p: {
      peerId: libp2pStatus.peerId,
      connectedPeers: libp2pStatus.connectedPeers,
      digNodes: libp2pStatus.digNodes,
      addresses: libp2pStatus.addresses
    },
    costInfo: {
      budgetUsed: `${(costStats.costMetrics.costRatio * 100).toFixed(1)}%`,
      projectedMonthlyCost: `$${costStats.costMetrics.projectedMonthlySpend.toFixed(2)}`,
      budgetLimit: `$${costStats.costMetrics.budgetLimit.toFixed(2)}`,
      mode: costStats.mode.currentThreshold,
      activeSessions: costStats.sessionStats.total
    }
  }
  res.json(health)
})

// LibP2P bootstrap info endpoint
app.get('/libp2p-bootstrap', (req: Request, res: Response) => {
  const status = libp2pBootstrap.getStatus()
  res.json({
    success: true,
    bootstrap: {
      peerId: status.peerId,
      addresses: status.addresses,
      connectedPeers: status.connectedPeers,
      digNodes: status.digNodes
    },
    connectionInfo: {
      // Provide connection string for DIG nodes
      bootstrapAddress: status.addresses[0], // First address for connection
      protocol: 'libp2p',
      port: LIBP2P_PORT
    }
  })
})

// DIG node registration endpoint (simplified)
app.post('/register-dig-node', (req: Request, res: Response) => {
  try {
    const { peerId, stores = [] } = req.body
    
    if (!peerId) {
      return res.status(400).json({ error: 'Missing peerId' })
    }

    console.log(`📝 DIG node registered: ${peerId.substring(0, 20)}... (${stores.length} stores)`)
    
    res.json({
      success: true,
      peerId,
      bootstrapInfo: {
        libp2pAddress: libp2pBootstrap.getStatus().addresses[0],
        httpEndpoint: `http://localhost:${PORT}`,
        totalPeers: libp2pBootstrap.getStatus().connectedPeers
      }
    })

  } catch (error) {
    console.error('DIG node registration error:', error)
    res.status(500).json({ error: 'Registration failed' })
  }
})

// Cost-aware TURN allocation
app.post('/allocate-turn', async (req: Request, res: Response) => {
  try {
    const response = await costAwareTURN.handleAllocationRequest(req.body)
    
    if (response.shutdown) {
      res.status(503).json(response)
    } else if (response.success) {
      res.json(response)
    } else {
      res.status(429).json(response)
    }

  } catch (error) {
    console.error('TURN allocation error:', error)
    res.status(500).json({ error: 'TURN allocation failed' })
  }
})

// Cost statistics
app.get('/cost-stats', (req: Request, res: Response) => {
  try {
    const stats = costAwareTURN.getCostStatistics()
    res.json(stats)
  } catch (error) {
    console.error('Cost stats error:', error)
    res.status(500).json({ error: 'Failed to get cost statistics' })
  }
})

// Start the combined server
async function startCombinedServer() {
  try {
    // Initialize cost monitoring
    await costAwareTURN.initialize()
    
    // Start LibP2P bootstrap server
    await libp2pBootstrap.start()
    
    // Start HTTP server
    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log('✅ Combined DIG Network Bootstrap Server started successfully!')
      console.log(`🌐 HTTP API: http://0.0.0.0:${PORT}`)
      console.log(`🔗 LibP2P Bootstrap: ${libp2pBootstrap.getStatus().addresses[0]}`)
      console.log(`💰 Cost monitoring: enabled`)
      console.log('')
      console.log('🔗 Available endpoints:')
      console.log(`   Health: http://0.0.0.0:${PORT}/health`)
      console.log(`   LibP2P Info: http://0.0.0.0:${PORT}/libp2p-bootstrap`)
      console.log(`   DIG Registration: POST http://0.0.0.0:${PORT}/register-dig-node`)
      console.log(`   TURN Allocation: POST http://0.0.0.0:${PORT}/allocate-turn`)
      console.log(`   Cost Stats: http://0.0.0.0:${PORT}/cost-stats`)
      console.log('')
      console.log('💡 DIG nodes can connect using:')
      console.log(`   LibP2P: ${libp2pBootstrap.getStatus().addresses[0]}`)
    })
  } catch (error) {
    console.error('❌ Failed to start combined server:', error)
    process.exit(1)
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...')
  await libp2pBootstrap.stop()
  await costAwareTURN.cleanup()
  httpServer.close(() => {
    console.log('✅ Combined bootstrap server closed')
    process.exit(0)
  })
})

process.on('SIGINT', async () => {
  console.log('🛑 Received SIGINT, shutting down gracefully...')
  await libp2pBootstrap.stop()
  await costAwareTURN.cleanup()
  httpServer.close(() => {
    console.log('✅ Combined bootstrap server closed')
    process.exit(0)
  })
})

// Start the server
startCombinedServer()
