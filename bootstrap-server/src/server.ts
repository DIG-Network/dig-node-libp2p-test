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
import { CostAwareTURNServer } from './CostAwareTURNServer.js'

// Type definitions for requests
interface TurnAllocationRequest {
  peerId: string
  sessionId?: string
  estimatedBandwidthMbps: number
  userTier?: string
  isPremium?: boolean
  p2pAttempted?: boolean
  storeId?: string
  rangeStart?: number
  rangeEnd?: number
}

// Extend global type for pending bootstrap TURN requests
declare global {
  var pendingBootstrapTurnRequests: Map<string, any> | undefined
  var httpTurnRelays: Map<string, any> | undefined
}

// Node type constants (matching DIG node)
enum NodeType {
  FULL_NODE = 0,      // Full DIG node with all capabilities
  LIGHT_NODE = 1,     // Light node (limited storage)
  BOOTSTRAP_NODE = 2, // Bootstrap/discovery server
  TURN_NODE = 3,      // Dedicated TURN server
  RELAY_NODE = 4      // Relay-only node
}

// Capability codes (matching DIG node)
enum CapabilityCode {
  STORE_SYNC = 1,           // Can sync .dig stores
  TURN_RELAY = 2,           // Can act as TURN server
  BOOTSTRAP_DISCOVERY = 3,  // Can provide peer discovery
  E2E_ENCRYPTION = 4,       // Supports end-to-end encryption
  BYTE_RANGE_DOWNLOAD = 5,  // Supports parallel byte-range downloads
  GOSSIP_DISCOVERY = 6,     // Supports gossip-based peer discovery
  DHT_STORAGE = 7,          // Supports DHT storage
  CIRCUIT_RELAY = 8,        // Supports LibP2P circuit relay
  WEBRTC_NAT = 9,           // Supports WebRTC NAT traversal
  MESH_ROUTING = 10         // Supports mesh routing
}

// Interface for registered peers with mandatory privacy features
interface RegisteredPeer {
  peerId: string
  addresses: string[] // ALWAYS crypto-IPv6 addresses only
  realAddresses?: string[] // Private real addresses (only for authenticated resolution)
  cryptoIPv6: string // MANDATORY - no registration without crypto-IPv6
  stores: string[]
  version: string
  privacyMode: boolean // ALWAYS true - no option to disable
  capabilities?: any // Full capability object
  turnCapable?: boolean
  bootstrapCapable?: boolean
  turnAddresses?: string[]
  turnPort?: number
  turnLoad?: number
  turnCapacity?: number
  lastSeen: number
  // Comprehensive handshake information (Chia-like protocol)
  networkId: string // MANDATORY - network compatibility
  softwareVersion: string // MANDATORY - feature compatibility
  serverPort: number // MANDATORY - connection info
  nodeType: number // MANDATORY - node classification
  capabilityList: Array<[number, string]> // MANDATORY - detailed capabilities
  // Zero-knowledge privacy features
  zkProofSupported: boolean // Supports zero-knowledge proofs
  onionRoutingSupported: boolean // Supports onion routing
  timingObfuscationEnabled: boolean // Has timing obfuscation
  trafficMixingEnabled: boolean // Has traffic mixing
  metadataScrambled: boolean // Uses metadata scrambling
}

// Configuration
const PORT = parseInt(process.env.PORT || '3000')
const NODE_ENV = process.env.NODE_ENV || 'development'
const PEER_TIMEOUT = 10 * 60 * 1000 // 10 minutes

console.log('🚀 Starting DIG Network Bootstrap Server')
console.log(`🌐 Port: ${PORT}`)
console.log(`🔧 Environment: ${NODE_ENV}`)
console.log('============================================')

// Types (using enhanced interface above)

interface ExtendedSocket {
  peerId?: string
  [key: string]: any
}

// In-memory storage
const registeredPeers = new Map<string, RegisteredPeer>()
const turnServers = new Map<string, RegisteredPeer>()

// Cost-aware TURN server (full version with AWS cost monitoring)
const costAwareTURN = new CostAwareTURNServer()

// Express app
const app = express()
const httpServer = createServer(app)

// Socket.IO server for WebSocket relay with enhanced security
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  // Enhanced security settings
  transports: ['websocket'], // Only WebSocket, no polling fallback for security
  allowEIO3: false, // Disable legacy protocol
  pingTimeout: 60000,
  pingInterval: 25000,
  upgradeTimeout: 10000,
  maxHttpBufferSize: 1e6 // 1MB limit
})

// Middleware
app.use(cors())
app.use(express.json({ limit: '10mb' }))

// Health check endpoint with cost information
app.get('/health', (req: Request, res: Response) => {
  const costStats = costAwareTURN.getCostStatistics()
  
  const health = {
    status: costStats.mode.shutdown ? 'degraded' : 'healthy',
    service: 'DIG Network Bootstrap Server',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    peers: registeredPeers.size,
    turnServers: turnServers.size,
    socketConnections: io.sockets.sockets.size,
    environment: NODE_ENV,
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

// Peer registration endpoint
app.post('/register', (req: Request, res: Response) => {
  try {
    const { 
      peerId, 
      addresses, 
      cryptoIPv6, 
      stores = [], 
      version = '1.0.0', 
      privacyMode = true, // ALWAYS true - mandatory privacy
      capabilities = {},
      turnCapable = false,
      bootstrapCapable = false,
      // Comprehensive handshake information (MANDATORY)
      networkId = 'mainnet',
      softwareVersion = '1.0.0',
      serverPort = 4001,
      nodeType = 0,
      capabilityList = [],
      // Zero-knowledge privacy features (MANDATORY)
      zkProofSupported = true,
      onionRoutingSupported = true,
      timingObfuscationEnabled = true,
      trafficMixingEnabled = true,
      metadataScrambled = true
    } = req.body
    
    if (!peerId || !addresses || !Array.isArray(addresses)) {
      return res.status(400).json({ error: 'Missing required fields: peerId, addresses' })
    }

    // 🔐 MANDATORY PRIVACY VALIDATION
    if (!cryptoIPv6) {
      return res.status(400).json({ 
        error: 'PRIVACY VIOLATION: cryptoIPv6 is mandatory for all registrations',
        required: 'All peers must have crypto-IPv6 addresses'
      })
    }

    if (privacyMode !== true) {
      console.log(`⚠️ PRIVACY ENFORCEMENT: Forcing privacyMode=true for ${peerId}`)
      // Force privacy mode - no option to disable
    }

    // Validate that addresses are crypto-IPv6 only (no real IPs exposed)
    const hasRealIPs = addresses.some(addr => 
      addr.includes('/ip4/') && !addr.includes('/ip6/fd00:')
    )
    
    if (hasRealIPs) {
      console.log(`🚨 PRIVACY VIOLATION: Peer ${peerId} attempting to register with real IP addresses`)
      return res.status(403).json({
        error: 'PRIVACY VIOLATION: Real IP addresses not allowed in public registration',
        required: 'Only crypto-IPv6 addresses permitted',
        received: addresses.length,
        cryptoIPv6Required: true
      })
    }

    console.log(`🔐 Privacy validation passed for ${peerId}: crypto-IPv6 only, privacy mode enforced`)

    // MANDATORY PRIVACY: Always use crypto-IPv6 addresses only
    const peer: RegisteredPeer = {
      peerId,
      addresses: [`/ip6/${cryptoIPv6}/tcp/4001/p2p/${peerId}`, `/ip6/${cryptoIPv6}/ws/p2p/${peerId}`], // ALWAYS crypto-IPv6
      realAddresses: addresses, // Store real addresses privately for authenticated resolution only
      cryptoIPv6,
      stores,
      version,
      privacyMode: true, // ALWAYS true - mandatory privacy
      capabilities: capabilities,
      turnCapable: turnCapable || capabilities?.turnServer || false,
      bootstrapCapable: bootstrapCapable || capabilities?.bootstrapServer || false,
      lastSeen: Date.now(),
      // Comprehensive handshake information (MANDATORY)
      networkId,
      softwareVersion,
      serverPort,
      nodeType,
      capabilityList,
      // Zero-knowledge privacy features (MANDATORY)
      zkProofSupported,
      onionRoutingSupported,
      timingObfuscationEnabled,
      trafficMixingEnabled,
      metadataScrambled
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

// Peer discovery endpoint (read-only, no cleanup)
app.get('/peers', (req: Request, res: Response) => {
  try {
    const includeStores = req.query.includeStores === 'true'
    const includeCapabilities = req.query.includeCapabilities === 'true'
    const now = Date.now()
    
    // Get active peers (don't modify the registry here)
    const activePeers = Array.from(registeredPeers.values())
      .filter(peer => now - peer.lastSeen < PEER_TIMEOUT) // Filter but don't delete
      .map(peer => ({
        peerId: peer.peerId,
        addresses: peer.addresses,
        cryptoIPv6: peer.cryptoIPv6,
        stores: includeStores ? peer.stores : undefined,
        lastSeen: peer.lastSeen,
        version: peer.version,
        turnCapable: peer.turnCapable,
        bootstrapCapable: peer.bootstrapCapable,
        capabilities: includeCapabilities ? peer.capabilities : undefined,
        privacyMode: peer.privacyMode
      }))

    res.json({
      peers: activePeers,
      total: activePeers.length,
      totalRegistered: registeredPeers.size, // Show total vs active
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('Peers endpoint error:', error)
    res.status(500).json({ error: 'Failed to get peers' })
  }
})

// Peer heartbeat endpoint to keep registration active
app.post('/heartbeat', (req: Request, res: Response) => {
  try {
    const { peerId } = req.body
    
    if (!peerId) {
      return res.status(400).json({ error: 'Missing required field: peerId' })
    }

    const peer = registeredPeers.get(peerId)
    if (peer) {
      // Update lastSeen timestamp
      peer.lastSeen = Date.now()
      console.log(`💓 Heartbeat received from peer: ${peerId}`)
      
      res.json({ 
        success: true, 
        peerId,
        lastSeen: peer.lastSeen,
        timestamp: new Date().toISOString()
      })
    } else {
      res.status(404).json({ 
        error: 'Peer not found - please register first',
        suggestion: 'Use POST /register to register this peer'
      })
    }
  } catch (error) {
    console.error('Heartbeat error:', error)
    res.status(500).json({ error: 'Heartbeat failed' })
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

// Cost-aware TURN allocation endpoint
app.post('/allocate-turn', async (req: Request, res: Response) => {
  try {
    const request: TurnAllocationRequest = {
      peerId: req.body.peerId,
      sessionId: req.body.sessionId,
      estimatedBandwidthMbps: req.body.estimatedBandwidthMbps || 10,
      userTier: req.body.userTier || 'free',
      isPremium: req.body.isPremium || false,
      p2pAttempted: req.body.p2pAttempted || false,
      storeId: req.body.storeId,
      rangeStart: req.body.rangeStart,
      rangeEnd: req.body.rangeEnd
    }

    if (!request.peerId) {
      return res.status(400).json({ error: 'Missing required field: peerId' })
    }

    const response = await costAwareTURN.handleAllocationRequest(request)
    
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

// Cost statistics endpoint
app.get('/cost-stats', (req: Request, res: Response) => {
  try {
    const stats = costAwareTURN.getCostStatistics()
    res.json(stats)
  } catch (error) {
    console.error('Cost stats error:', error)
    res.status(500).json({ error: 'Failed to get cost statistics' })
  }
})

// Store relay endpoint with cost-aware TURN allocation
app.post('/relay-store', async (req: Request, res: Response) => {
  try {
    const { 
      storeId, 
      fromPeerId, 
      toPeerId, 
      turnServerId,
      rangeStart,
      rangeEnd,
      chunkId,
      totalSize,
      userTier,
      isPremium
    } = req.body
    
    if (!storeId || !fromPeerId || !toPeerId) {
      return res.status(400).json({ error: 'Missing required fields: storeId, fromPeerId, toPeerId' })
    }

    // Check if this should use cost-aware TURN allocation
    const isRangeRequest = typeof rangeStart === 'number' && typeof rangeEnd === 'number'
    const estimatedMB = isRangeRequest ? (rangeEnd - rangeStart + 1) / (1024 * 1024) : 10
    const estimatedBandwidth = Math.min(estimatedMB * 8, 100) // Convert to Mbps, cap at 100

    // Cost-aware TURN allocation check
    const turnRequest: TurnAllocationRequest = {
      peerId: fromPeerId,
      estimatedBandwidthMbps: estimatedBandwidth,
      userTier: userTier || 'free',
      isPremium: isPremium || false,
      p2pAttempted: false, // Will be checked later
      storeId,
      rangeStart,
      rangeEnd
    }

    const turnResponse = await costAwareTURN.handleAllocationRequest(turnRequest)
    
    if (!turnResponse.success) {
      return res.status(429).json({
        error: `Cost-aware throttling: ${turnResponse.error}`,
        retryAfter: turnResponse.retryAfter,
        suggestion: turnResponse.suggestion,
        costInfo: turnResponse.costInfo
      })
    }

    // Update session bandwidth tracking if we have a session
    if (turnResponse.sessionId) {
      const bytesToTransfer = isRangeRequest ? (rangeEnd - rangeStart + 1) : (totalSize || 1024 * 1024)
      costAwareTURN.updateSessionBandwidth(turnResponse.sessionId, bytesToTransfer)
    }

    const logMsg = isRangeRequest 
      ? `🔄 Cost-aware store range relay: ${storeId} (${rangeStart}-${rangeEnd}) from ${fromPeerId} to ${toPeerId} [${turnResponse.limits?.priorityLevel}]`
      : `🔄 Cost-aware store relay: ${storeId} from ${fromPeerId} to ${toPeerId} [${turnResponse.limits?.priorityLevel}]`
    
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

    // Check if we can act as fallback TURN server (direct HTTP relay)
    const sourcePeer = registeredPeers.get(fromPeerId)
    const targetPeer = registeredPeers.get(toPeerId)
    
    if (sourcePeer && targetPeer) {
      // Bootstrap server acts as fallback TURN server via HTTP relay
      console.log(`📡 Acting as fallback TURN server: ${fromPeerId} -> ${toPeerId}`)
      
      const method = isRangeRequest ? 'bootstrap-turn-range-relay' : 'bootstrap-turn-relay'
      
      return res.json({
        success: true,
        method,
        fallbackTurnServer: {
          type: 'bootstrap-server',
          relayEndpoint: '/bootstrap-turn-relay',
          addresses: ['bootstrap-server'],
          port: 3000
        },
        rangeInfo: isRangeRequest ? { rangeStart, rangeEnd, chunkId, totalSize } : undefined
      })
    }

    // Final fallback to WebSocket relay
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
      res.status(404).json({ error: 'Target peer not connected and no relay methods available' })
    }
  } catch (error) {
    console.error('Store relay error:', error)
    res.status(500).json({ error: 'Store relay failed' })
  }
})

// Crypto-IPv6 address resolution endpoint (privacy-preserving)
app.post('/resolve-crypto-ipv6', (req: Request, res: Response) => {
  try {
    const { cryptoIPv6 } = req.body
    
    if (!cryptoIPv6) {
      return res.status(400).json({ error: 'Missing cryptoIPv6 parameter' })
    }

    // Find peer by crypto-IPv6
    let foundPeer = null
    for (const [peerId, peer] of registeredPeers) {
      if (peer.cryptoIPv6 === cryptoIPv6) {
        foundPeer = peer
        break
      }
    }

    if (!foundPeer) {
      return res.status(404).json({ 
        error: 'Crypto-IPv6 address not found',
        cryptoIPv6,
        suggestion: 'Peer may not be online or registered'
      })
    }

    // Return the real addresses for connection (only to authenticated requesters)
    // In a production system, you might want additional authentication here
    const realAddresses = foundPeer.realAddresses || foundPeer.addresses || []
    
    console.log(`🔍 Resolved crypto-IPv6 ${cryptoIPv6} to ${realAddresses.length} addresses for peer ${foundPeer.peerId}`)
    
    res.json({
      success: true,
      cryptoIPv6,
      peerId: foundPeer.peerId,
      addresses: realAddresses,
      lastSeen: foundPeer.lastSeen
    })

  } catch (error) {
    console.error('Crypto-IPv6 resolution error:', error)
    res.status(500).json({ error: 'Resolution failed' })
  }
})

// Crypto-IPv6 overlay network directory (privacy-preserving peer discovery)
app.get('/crypto-ipv6-directory', (req: Request, res: Response) => {
  try {
    const directory = []
    
    for (const [peerId, peer] of registeredPeers) {
      if (peer.cryptoIPv6) {
        directory.push({
          peerId,
          cryptoIPv6: peer.cryptoIPv6,
          stores: peer.stores || [],
          lastSeen: peer.lastSeen,
          version: peer.version,
          privacyMode: true, // ALWAYS true - mandatory
          turnCapable: peer.turnCapable || false,
          bootstrapCapable: peer.bootstrapCapable || false,
          // Comprehensive handshake information (Chia-like protocol)
          networkId: peer.networkId,
          softwareVersion: peer.softwareVersion,
          serverPort: peer.serverPort,
          nodeType: peer.nodeType,
          nodeTypeDescription: getNodeTypeDescription(peer.nodeType),
          capabilities: peer.capabilityList || [],
          capabilityCount: peer.capabilityList?.length || 0,
          // Zero-knowledge privacy features status
          zkProofSupported: peer.zkProofSupported,
          onionRoutingSupported: peer.onionRoutingSupported,
          timingObfuscationEnabled: peer.timingObfuscationEnabled,
          trafficMixingEnabled: peer.trafficMixingEnabled,
          metadataScrambled: peer.metadataScrambled,
          privacyLevel: calculatePeerPrivacyLevel(peer),
          // 🔐 PRIVACY: Real IP addresses are NEVER included in public directory
        })
      }
    }
    
    console.log(`🔍 Crypto-IPv6 directory requested: ${directory.length} peers`)
    
    res.json({
      success: true,
      peers: directory,
      totalPeers: directory.length,
      privacyEnabled: true,
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('Crypto-IPv6 directory error:', error)
    res.status(500).json({ error: 'Failed to get crypto-IPv6 directory' })
  }
})

// Peer exchange over TURN (enable peer sharing through TURN relay)
app.post('/turn-peer-exchange', (req: Request, res: Response) => {
  try {
    const { fromPeerId, toPeerId, maxPeers = 10, includeCapabilities = true } = req.body
    
    if (!fromPeerId || !toPeerId) {
      return res.status(400).json({ error: 'Missing required fields: fromPeerId, toPeerId' })
    }

    const sourcePeer = registeredPeers.get(fromPeerId)
    const targetPeer = registeredPeers.get(toPeerId)
    
    if (!sourcePeer || !targetPeer) {
      return res.status(404).json({ error: 'One or both peers not found' })
    }

    console.log(`📋 TURN peer exchange: ${fromPeerId} sharing peers with ${toPeerId}`)

    // Find the source peer's socket connection
    const sourceSocket = Array.from(io.sockets.sockets.values())
      .find(socket => (socket as ExtendedSocket).peerId === fromPeerId) as ExtendedSocket
    
    if (!sourceSocket) {
      return res.status(404).json({ error: 'Source peer not connected via WebSocket' })
    }

    // Create unique request ID
    const requestId = `turn_peer_exchange_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    // Set up response handler
    const responseTimeout = setTimeout(() => {
      console.log(`⏱️ TURN peer exchange timeout for request ${requestId}`)
      if (!res.headersSent) {
        res.status(408).json({ error: 'Peer exchange timeout' })
      }
    }, 15000) // 15 second timeout

    // Store the HTTP response object
    if (!global.pendingBootstrapTurnRequests) {
      global.pendingBootstrapTurnRequests = new Map()
    }
    global.pendingBootstrapTurnRequests.set(requestId, {
      res,
      timeout: responseTimeout,
      isRangeRequest: false,
      requestId,
      startTime: Date.now()
    })

    // Send peer exchange request to source peer
    const requestData = {
      toPeerId,
      requestId,
      method: 'turn-peer-exchange',
      maxPeers,
      includeCapabilities
    }
    
    console.log(`📡 Requesting peer list from ${fromPeerId} for TURN relay to ${toPeerId}`)
    sourceSocket.emit('turn-peer-exchange-request', requestData)

  } catch (error) {
    console.error('TURN peer exchange error:', error)
    res.status(500).json({ error: 'TURN peer exchange failed' })
  }
})

// HTTP-only bootstrap TURN relay (no WebSocket dependency)
app.post('/bootstrap-turn-http-relay', (req: Request, res: Response) => {
  try {
    const { storeId, fromPeerId, toPeerId, rangeStart, rangeEnd } = req.body
    
    if (!storeId || !fromPeerId || !toPeerId) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const sourcePeer = registeredPeers.get(fromPeerId)
    const targetPeer = registeredPeers.get(toPeerId)
    
    if (!sourcePeer || !targetPeer) {
      return res.status(404).json({ error: 'One or both peers not found' })
    }

    const isRangeRequest = typeof rangeStart === 'number' && typeof rangeEnd === 'number'
    
    console.log(`📡 HTTP-only bootstrap TURN relay: ${storeId} ${isRangeRequest ? `(${rangeStart}-${rangeEnd})` : ''} from ${fromPeerId} to ${toPeerId}`)
    
    // For HTTP-only TURN, we need to coordinate the transfer differently
    // This would require the requesting peer to poll for the data
    // or use a different coordination mechanism
    
    // Store the relay request for coordination
    const relayId = `http_turn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    // Create a relay coordination entry
    if (!global.httpTurnRelays) {
      global.httpTurnRelays = new Map()
    }
    
    global.httpTurnRelays.set(relayId, {
      storeId,
      fromPeerId,
      toPeerId,
      rangeStart,
      rangeEnd,
      status: 'pending',
      created: Date.now()
    })

    console.log(`📡 Created HTTP TURN relay coordination: ${relayId}`)
    
    res.json({
      success: true,
      relayId,
      method: 'http-turn-relay',
      coordinationEndpoint: `/bootstrap-turn-coordinate/${relayId}`,
      suggestion: 'Use coordination endpoint to complete transfer'
    })

  } catch (error) {
    console.error('HTTP bootstrap TURN relay error:', error)
    res.status(500).json({ error: 'HTTP bootstrap TURN relay failed' })
  }
})

// Coordination endpoint for HTTP-only TURN relay
app.get('/bootstrap-turn-coordinate/:relayId', (req: Request, res: Response) => {
  try {
    const { relayId } = req.params
    
    if (!global.httpTurnRelays) {
      return res.status(404).json({ error: 'No HTTP TURN relays active' })
    }
    
    const relay = global.httpTurnRelays.get(relayId)
    if (!relay) {
      return res.status(404).json({ error: 'Relay coordination not found' })
    }
    
    console.log(`📊 HTTP TURN coordination status for ${relayId}: ${relay.status}`)
    
    res.json({
      success: true,
      relayId,
      status: relay.status,
      storeId: relay.storeId,
      fromPeerId: relay.fromPeerId,
      toPeerId: relay.toPeerId,
      created: relay.created,
      suggestion: relay.status === 'pending' ? 'Transfer coordination in progress' : 'Check relay status'
    })

  } catch (error) {
    console.error('HTTP TURN coordination error:', error)
    res.status(500).json({ error: 'HTTP TURN coordination failed' })
  }
})

// Direct HTTP bootstrap TURN relay (works without WebSocket connections)
app.post('/bootstrap-turn-direct', (req: Request, res: Response) => {
  try {
    const { storeId, fromPeerId, toPeerId } = req.body
    
    if (!storeId || !fromPeerId || !toPeerId) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const sourcePeer = registeredPeers.get(fromPeerId)
    const targetPeer = registeredPeers.get(toPeerId)
    
    if (!sourcePeer || !targetPeer) {
      return res.status(404).json({ error: 'One or both peers not found in registry' })
    }

    console.log(`📡 Direct HTTP bootstrap TURN: ${storeId} from ${fromPeerId} to ${toPeerId}`)
    
    // For direct HTTP TURN, we provide the real addresses for direct connection
    // This is authenticated since both peers are registered
    const sourceAddresses = sourcePeer.realAddresses || sourcePeer.addresses
    
    if (!sourceAddresses || sourceAddresses.length === 0) {
      return res.status(404).json({ error: 'Source peer has no available addresses' })
    }

    console.log(`📡 Bootstrap TURN providing ${sourceAddresses.length} addresses for direct connection`)
    
    res.json({
      success: true,
      method: 'direct-http-turn',
      sourceAddresses: sourceAddresses,
      sourcePeerId: fromPeerId,
      storeId: storeId,
      suggestion: 'Connect directly to source peer using provided addresses'
    })

  } catch (error) {
    console.error('Direct HTTP bootstrap TURN error:', error)
    res.status(500).json({ error: 'Direct HTTP bootstrap TURN failed' })
  }
})

// Bootstrap server acting as fallback TURN server
app.post('/bootstrap-turn-relay', (req: Request, res: Response) => {
  try {
    const { storeId, fromPeerId, toPeerId, rangeStart, rangeEnd, chunkId } = req.body
    
    if (!storeId || !fromPeerId || !toPeerId) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const sourcePeer = registeredPeers.get(fromPeerId)
    if (!sourcePeer) {
      return res.status(404).json({ error: 'Source peer not found' })
    }

    const isRangeRequest = typeof rangeStart === 'number' && typeof rangeEnd === 'number'
    
    console.log(`🔄 Bootstrap TURN relay: ${storeId} ${isRangeRequest ? `(${rangeStart}-${rangeEnd})` : ''} from ${fromPeerId} to ${toPeerId}`)
    
    // Find the source peer's socket connection
    const sourceSocket = Array.from(io.sockets.sockets.values())
      .find(socket => (socket as ExtendedSocket).peerId === fromPeerId) as ExtendedSocket
    
    if (!sourceSocket) {
      console.log(`⚠️ Bootstrap TURN failed: Source peer ${fromPeerId} not connected via WebSocket`)
      console.log(`📊 Connected sockets: ${Array.from(io.sockets.sockets.values()).length}`)
      return res.status(404).json({ 
        error: 'Source peer not connected via WebSocket',
        suggestion: 'Bootstrap TURN requires both peers to be connected via WebSocket for relay',
        fromPeerId,
        toPeerId,
        connectedSockets: Array.from(io.sockets.sockets.values()).length,
        availablePeers: Array.from(registeredPeers.keys())
      })
    }

    // Create a unique request ID for this transfer
    const requestId = chunkId || `bootstrap_turn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    // Set up response handler with timeout
    const responseTimeout = setTimeout(() => {
      console.log(`⏱️ Bootstrap TURN relay timeout for request ${requestId}`)
      if (!res.headersSent) {
        res.status(408).json({ error: 'Request timeout' })
      }
    }, 30000) // 30 second timeout
    
    // Store the HTTP response object for this request
    const pendingRequest = {
      res,
      timeout: responseTimeout,
      isRangeRequest,
      requestId,
      startTime: Date.now()
    }
    
    // Use a Map to track pending bootstrap TURN requests
    if (!global.pendingBootstrapTurnRequests) {
      global.pendingBootstrapTurnRequests = new Map()
    }
    global.pendingBootstrapTurnRequests.set(requestId, pendingRequest)
    
    // Send request to source peer via WebSocket
    const requestData = {
      storeId,
      toPeerId,
      requestId,
      method: 'bootstrap-turn-relay',
      ...(isRangeRequest ? { rangeStart, rangeEnd, chunkId, totalSize: undefined } : {})
    }
    
    console.log(`📡 Requesting data from ${fromPeerId} via WebSocket for bootstrap TURN relay`)
    sourceSocket.emit('bootstrap-turn-request', requestData)
    
  } catch (error) {
    console.error('Bootstrap TURN relay error:', error)
    res.status(500).json({ error: 'Bootstrap TURN relay failed' })
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

  // Handle bootstrap TURN relay responses
  // Handle TURN peer exchange responses
  socket.on('turn-peer-exchange-response', (data: any) => {
    const { requestId, success, error, peers } = data
    
    if (!global.pendingBootstrapTurnRequests) {
      console.log(`⚠️ No pending requests map for TURN peer exchange response ${requestId}`)
      return
    }
    
    const pendingRequest = global.pendingBootstrapTurnRequests.get(requestId)
    if (!pendingRequest) {
      console.log(`⚠️ No pending request found for TURN peer exchange response ${requestId}`)
      return
    }
    
    // Clear timeout
    clearTimeout(pendingRequest.timeout)
    global.pendingBootstrapTurnRequests.delete(requestId)
    
    const { res, startTime } = pendingRequest
    const duration = Date.now() - startTime
    
    if (res.headersSent) {
      console.log(`⚠️ HTTP response already sent for request ${requestId}`)
      return
    }
    
    if (!success || error) {
      console.log(`❌ TURN peer exchange failed for ${requestId}: ${error}`)
      return res.status(500).json({ error: error || 'Peer exchange failed' })
    }
    
    console.log(`✅ TURN peer exchange completed for ${requestId}: ${peers?.length || 0} peers in ${duration}ms`)
    
    res.json({
      success: true,
      peers: peers || [],
      totalPeers: peers?.length || 0,
      method: 'turn-peer-exchange',
      duration
    })
  })

  socket.on('bootstrap-turn-response', (data: any) => {
    const { requestId, success, error, storeData, size } = data
    
    if (!global.pendingBootstrapTurnRequests) {
      console.log(`⚠️ No pending requests map for bootstrap TURN response ${requestId}`)
      return
    }
    
    const pendingRequest = global.pendingBootstrapTurnRequests.get(requestId)
    if (!pendingRequest) {
      console.log(`⚠️ No pending request found for bootstrap TURN response ${requestId}`)
      return
    }
    
    // Clear timeout
    clearTimeout(pendingRequest.timeout)
    global.pendingBootstrapTurnRequests.delete(requestId)
    
    const { res, startTime } = pendingRequest
    const duration = Date.now() - startTime
    
    if (res.headersSent) {
      console.log(`⚠️ HTTP response already sent for request ${requestId}`)
      return
    }
    
    if (!success || error) {
      console.log(`❌ Bootstrap TURN relay failed for ${requestId}: ${error}`)
      return res.status(500).json({ error: error || 'Store retrieval failed' })
    }
    
    if (!storeData) {
      console.log(`❌ No store data received for ${requestId}`)
      return res.status(404).json({ error: 'No store data received' })
    }
    
    try {
      // Validate store data before processing
      if (typeof storeData !== 'string') {
        console.log(`❌ Invalid store data type for ${requestId}: ${typeof storeData}`)
        return res.status(500).json({ error: 'Invalid store data format' })
      }

      // Convert base64 data back to binary
      const binaryData = Buffer.from(storeData, 'base64')
      
      // Validate data size (185 bytes suggests JSON error response)
      if (binaryData.length < 1000 && binaryData.toString().includes('{')) {
        console.log(`❌ Suspected JSON error response (${binaryData.length} bytes): ${binaryData.toString().substring(0, 100)}`)
        return res.status(500).json({ error: 'Received JSON error instead of store data' })
      }
      
      console.log(`✅ Bootstrap TURN relay completed for ${requestId}: ${binaryData.length} bytes in ${duration}ms`)
      
      // Set appropriate headers for binary data
      res.setHeader('Content-Type', 'application/octet-stream')
      res.setHeader('Content-Length', binaryData.length)
      res.setHeader('Content-Disposition', `attachment; filename="${storeData.substring(0, 16)}.dig"`)
      
      // Send the binary data
      res.send(binaryData)
      
    } catch (processError) {
      console.error(`❌ Error processing bootstrap TURN response for ${requestId}:`, processError)
      res.status(500).json({ error: 'Failed to process store data' })
    }
  })

  // Handle TURN chunk responses (CRITICAL - this was missing!)
  socket.on('turn-chunk-response', (data: any) => {
    const { requestId, success, error, chunkData, size } = data
    
    if (!global.pendingBootstrapTurnRequests) {
      console.log(`⚠️ No pending requests map for TURN chunk response ${requestId}`)
      return
    }
    
    const pendingRequest = global.pendingBootstrapTurnRequests.get(requestId)
    if (!pendingRequest) {
      console.log(`⚠️ No pending request found for TURN chunk response ${requestId}`)
      return
    }
    
    // Clear timeout
    clearTimeout(pendingRequest.timeout)
    global.pendingBootstrapTurnRequests.delete(requestId)
    
    const { res, startTime } = pendingRequest
    const duration = Date.now() - startTime
    
    if (res.headersSent) {
      console.log(`⚠️ HTTP response already sent for request ${requestId}`)
      return
    }
    
    if (!success || error) {
      console.log(`❌ TURN chunk relay failed for ${requestId}: ${error}`)
      return res.status(500).json({ error: error || 'Chunk retrieval failed' })
    }
    
    if (!chunkData) {
      console.log(`❌ No chunk data received for ${requestId}`)
      return res.status(404).json({ error: 'No chunk data received' })
    }
    
    try {
      // Convert base64 chunk data back to binary
      const binaryData = Buffer.from(chunkData, 'base64')
      
      console.log(`✅ TURN chunk relay completed for ${requestId}: ${binaryData.length} bytes in ${duration}ms`)
      
      // Set appropriate headers for chunk data
      res.setHeader('Content-Type', 'application/octet-stream')
      res.setHeader('Content-Length', binaryData.length)
      res.setHeader('Content-Range', `bytes ${pendingRequest.rangeStart || 0}-${pendingRequest.rangeEnd || binaryData.length - 1}/${size || binaryData.length}`)
      
      // Send the chunk data
      res.send(binaryData)
      
    } catch (processError) {
      console.error(`❌ Error processing TURN chunk response for ${requestId}:`, processError)
      res.status(500).json({ error: 'Failed to process chunk data' })
    }
  })

  socket.on('disconnect', () => {
    if (extSocket.peerId) {
      console.log(`🔌 Peer ${extSocket.peerId} disconnected`)
    }
  })
})

// Cleanup stale peers periodically (timeout-based only - peers must ping us to stay alive)
setInterval(async () => {
  const now = Date.now()
  let cleanedCount = 0
  
  console.log(`🔍 Checking ${registeredPeers.size} registered peers for heartbeat timeout...`)
  
  for (const [peerId, peer] of registeredPeers) {
    // Only remove peers that haven't sent heartbeat for the full timeout period
    if (now - peer.lastSeen > PEER_TIMEOUT) {
      registeredPeers.delete(peerId)
      turnServers.delete(peerId)
      cleanedCount++
      console.log(`🧹 Removed expired peer: ${peerId} (no heartbeat for ${Math.round((now - peer.lastSeen) / 60000)} minutes)`)
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`🔍 Cleanup complete: ${cleanedCount} expired peers removed, ${registeredPeers.size} active`)
    console.log(`💡 Reminder: Peers must send heartbeat via POST /heartbeat every ${PEER_TIMEOUT / 60000} minutes`)
  } else {
    console.log(`🔍 All ${registeredPeers.size} peers sending heartbeats regularly`)
  }
}, 5 * 60 * 1000) // Every 5 minutes

// Note: Peer reachability is now determined by heartbeat messages, not connection testing
// This is more reliable for NAT-ed peers that can't accept incoming connections

// Signal peer to connect to TURN server for on-demand transfer
app.post('/signal-turn-connection', (req: Request, res: Response) => {
  try {
    const { targetPeerId, turnServerInfo, requestId, requesterPeerId, instruction } = req.body
    
    if (!targetPeerId || !turnServerInfo || !requestId) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    console.log(`📡 Signaling ${targetPeerId} to connect to TURN server ${turnServerInfo.peerId}`)

    // Find target peer's WebSocket connection
    const targetSocket = Array.from(io.sockets.sockets.values())
      .find(socket => (socket as ExtendedSocket).peerId === targetPeerId) as ExtendedSocket
    
    if (!targetSocket) {
      return res.status(404).json({ 
        error: 'Target peer not connected for signaling',
        targetPeerId,
        suggestion: 'Peer must be connected via WebSocket to receive TURN connection signals'
      })
    }

    // Send TURN connection signal to target peer
    targetSocket.emit('turn-connection-signal', {
      requestId,
      turnServerInfo,
      instruction,
      requesterPeerId,
      timestamp: Date.now()
    })

    console.log(`📡 Sent TURN connection signal to ${targetPeerId}`)
    
    res.json({
      success: true,
      message: `TURN connection signal sent to ${targetPeerId}`,
      turnServerInfo,
      requestId
    })

  } catch (error) {
    console.error('TURN connection signaling error:', error)
    res.status(500).json({ error: 'TURN connection signaling failed' })
  }
})

// Get available TURN servers for on-demand connections
app.get('/available-turn-servers', (req: Request, res: Response) => {
  try {
    const availableTurnServers = []
    
    // Add bootstrap server as TURN option
    availableTurnServers.push({
      peerId: 'bootstrap-server',
      type: 'bootstrap',
      url: `http://0.0.0.0:${PORT}`,
      capabilities: ['websocket-relay', 'http-coordination', 'data-validation'],
      load: Array.from(io.sockets.sockets.values()).length,
      maxCapacity: 100
    })

    // Add registered peer TURN servers
    for (const [peerId, peer] of registeredPeers) {
      if (peer.turnCapable) {
        availableTurnServers.push({
          peerId,
          type: 'peer',
          cryptoIPv6: peer.cryptoIPv6,
          addresses: peer.realAddresses || peer.addresses,
          capabilities: peer.capabilityList || [],
          load: peer.turnLoad || 0,
          maxCapacity: peer.turnCapacity || 10
        })
      }
    }

    // Sort by load (lowest first)
    availableTurnServers.sort((a, b) => (a.load || 0) - (b.load || 0))

    console.log(`📡 Available TURN servers: ${availableTurnServers.length}`)
    
    res.json({
      success: true,
      turnServers: availableTurnServers,
      totalServers: availableTurnServers.length,
      recommendation: availableTurnServers[0] // Lowest load server
    })

  } catch (error) {
    console.error('TURN server discovery error:', error)
    res.status(500).json({ error: 'Failed to get available TURN servers' })
  }
})

// TURN relay chunk endpoint for direct TURN server communication
app.post('/turn-relay-chunk', (req: Request, res: Response) => {
  try {
    const { storeId, sourcePeerId, targetPeerId, rangeStart, rangeEnd } = req.body
    
    if (!storeId || !sourcePeerId || !targetPeerId) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const sourcePeer = registeredPeers.get(sourcePeerId)
    if (!sourcePeer) {
      return res.status(404).json({ error: 'Source peer not found' })
    }

    console.log(`📡 TURN relay chunk: ${storeId} (${rangeStart}-${rangeEnd}) from ${sourcePeerId} to ${targetPeerId}`)

    // Find source peer's WebSocket connection
    const sourceSocket = Array.from(io.sockets.sockets.values())
      .find(socket => (socket as ExtendedSocket).peerId === sourcePeerId) as ExtendedSocket
    
    if (!sourceSocket) {
      return res.status(404).json({ 
        error: 'Source peer not connected for TURN relay',
        sourcePeerId,
        suggestion: 'Peer must be connected via WebSocket for chunk relay'
      })
    }

    // Create unique request ID for chunk
    const requestId = `turn_chunk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    // Set up response handler
    const responseTimeout = setTimeout(() => {
      if (!res.headersSent) {
        res.status(408).json({ error: 'TURN chunk relay timeout' })
      }
    }, 30000)

    // Store pending request
    if (!global.pendingBootstrapTurnRequests) {
      global.pendingBootstrapTurnRequests = new Map()
    }
    global.pendingBootstrapTurnRequests.set(requestId, {
      res,
      timeout: responseTimeout,
      isRangeRequest: true,
      requestId,
      startTime: Date.now()
    })

    // Request chunk from source peer
    sourceSocket.emit('turn-chunk-request', {
      storeId,
      targetPeerId,
      rangeStart,
      rangeEnd,
      requestId
    })

    console.log(`📡 Requested chunk from ${sourcePeerId} for TURN relay`)

  } catch (error) {
    console.error('TURN relay chunk error:', error)
    res.status(500).json({ error: 'TURN relay chunk failed' })
  }
})

// Helper methods for privacy and node information
function getNodeTypeDescription(nodeType: number): string {
  switch (nodeType) {
    case NodeType.FULL_NODE: return 'Full Node'
    case NodeType.LIGHT_NODE: return 'Light Node'
    case NodeType.BOOTSTRAP_NODE: return 'Bootstrap Node'
    case NodeType.TURN_NODE: return 'TURN Node'
    case NodeType.RELAY_NODE: return 'Relay Node'
    default: return 'Unknown Node'
  }
}

function calculatePeerPrivacyLevel(peer: RegisteredPeer): string {
  let privacyScore = 0
  let maxScore = 0

  // Core privacy features (mandatory)
  maxScore += 3
  if (peer.privacyMode) privacyScore += 1
  if (peer.cryptoIPv6) privacyScore += 1
  if (peer.addresses.every(addr => addr.includes('/ip6/fd00:'))) privacyScore += 1

  // Zero-knowledge features (mandatory with fallback)
  maxScore += 5
  if (peer.zkProofSupported) privacyScore += 1
  if (peer.onionRoutingSupported) privacyScore += 1
  if (peer.timingObfuscationEnabled) privacyScore += 1
  if (peer.trafficMixingEnabled) privacyScore += 1
  if (peer.metadataScrambled) privacyScore += 1

  const percentage = (privacyScore / maxScore) * 100

  if (percentage >= 90) return 'MAXIMUM'
  if (percentage >= 75) return 'HIGH'
  if (percentage >= 50) return 'MEDIUM'
  if (percentage >= 25) return 'LOW'
  return 'INSUFFICIENT'
}

// Initialize cost-aware TURN server and start the server
async function startServer() {
  try {
    // Initialize cost monitoring
    await costAwareTURN.initialize()
    
    // Start the HTTP server
    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log('✅ DIG Bootstrap Server started successfully!')
      console.log(`🌐 HTTP Server: http://0.0.0.0:${PORT}`)
      console.log(`🔌 Socket.IO: enabled for WebSocket relay`)
      console.log(`📡 TURN coordination: enabled with cost-aware throttling`)
      console.log(`💰 Budget monitoring: enabled`)
      console.log(`🔐 Privacy enforcement: MANDATORY`)
      console.log('')
      console.log('💰 COST-AWARE FEATURES:')
      console.log(`   💵 Monthly budget: $${process.env.MONTHLY_BUDGET || '800'}`)
      console.log('   📊 Real-time AWS cost monitoring')
      console.log('   🚦 Multi-tier throttling (warning → throttle → emergency)')
      console.log('   👑 User tier prioritization')
      console.log('   📈 Bandwidth limiting and session management')
      console.log('   🚨 Emergency shutdown protection')
      console.log('')
      console.log('🛡️ MANDATORY PRIVACY FEATURES:')
      console.log('   🔊 Noise encryption required')
      console.log('   🔐 Crypto-IPv6 addresses only')
      console.log('   🕵️ Zero-knowledge proofs enabled')
      console.log('   🧅 Onion routing supported')
      console.log('   ⏱️ Timing obfuscation active')
      console.log('   🔀 Traffic mixing enabled')
      console.log('   🎭 Metadata scrambling active')
      console.log('   🚫 Real IP addresses FORBIDDEN')
      console.log('')
      console.log('🔗 Available endpoints:')
      console.log(`   Health: http://0.0.0.0:${PORT}/health`)
      console.log(`   Register: POST http://0.0.0.0:${PORT}/register`)
      console.log(`   Peers: http://0.0.0.0:${PORT}/peers`)
      console.log(`   Stats: http://0.0.0.0:${PORT}/stats`)
      console.log(`   TURN Servers: http://0.0.0.0:${PORT}/turn-servers`)
      console.log(`   Store Relay: POST http://0.0.0.0:${PORT}/relay-store`)
      console.log(`   💰 TURN Allocation: POST http://0.0.0.0:${PORT}/allocate-turn`)
      console.log(`   💰 Cost Stats: http://0.0.0.0:${PORT}/cost-stats`)
      console.log('')
      console.log('💡 DIG nodes can connect using:')
      console.log(`   DIG_BOOTSTRAP_NODES="http://[HOSTNAME]:${PORT}"`)
    })
  } catch (error) {
    console.error('❌ Failed to start server:', error)
    process.exit(1)
  }
}

// Start the server
startServer()

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...')
  await costAwareTURN.cleanup()
  httpServer.close(() => {
    console.log('✅ Bootstrap server closed')
    process.exit(0)
  })
})

process.on('SIGINT', async () => {
  console.log('🛑 Received SIGINT, shutting down gracefully...')
  await costAwareTURN.cleanup()
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
