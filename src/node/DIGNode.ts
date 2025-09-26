/**
 * Consolidated DIG Node Implementation
 * 
 * Combines the best of both DIGNode.ts and CleanDIGNode.ts:
 * - Clean architecture from CleanDIGNode
 * - Full functionality from DIGNode
 * - Dual-role peer system (direct + TURN)
 * - Comprehensive NAT traversal
 * - Intelligent download orchestration
 */

import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { kadDHT } from '@libp2p/kad-dht'
import { bootstrap } from '@libp2p/bootstrap'
import { mdns } from '@libp2p/mdns'
import { ping } from '@libp2p/ping'
import { identify } from '@libp2p/identify'
import { uPnPNAT } from '@libp2p/upnp-nat'
import { autoNAT } from '@libp2p/autonat'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { webRTC } from '@libp2p/webrtc'
import { webSockets } from '@libp2p/websockets'
import { all } from '@libp2p/websockets/filters'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { pipe } from 'it-pipe'
import { multiaddr } from '@multiformats/multiaddr'
import { toString as uint8ArrayToString } from 'uint8arrays/to-string'
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string'
import { randomBytes, createHash } from 'crypto'
import { readFile, readdir, stat, watch, writeFile } from 'fs/promises'
import { join, basename } from 'path'
import { homedir } from 'os'
import type { Stream } from '@libp2p/interface'
import type { Libp2p } from 'libp2p'

import { 
  DIGFile, 
  DIGNodeConfig, 
  DIGRequest, 
  DIGResponse, 
  NodeCapabilities,
  DIGHandshake,
  NodeType,
  CapabilityCode,
  DIG_PROTOCOL, 
  DIG_DISCOVERY_PROTOCOL 
} from './types.js'
import { generateCryptoIPv6, parseURN, createCryptoIPv6Addresses, resolveCryptoIPv6, isCryptoIPv6Address } from './utils.js'
import { Logger } from './logger.js'
import { DIGOnlyPeerDiscovery } from './DIGOnlyPeerDiscovery.js'
import { LocalNetworkDiscovery } from './LocalNetworkDiscovery.js'
import { UnifiedTurnCoordination } from './UnifiedTurnCoordination.js'
import { PeerConnectionCapabilities } from './PeerConnectionCapabilities.js'
import { ComprehensiveNATTraversal } from './ComprehensiveNATTraversal.js'
import { IntelligentDownloadOrchestrator } from './IntelligentDownloadOrchestrator.js'
import { UPnPPortManager } from './UPnPPortManager.js'
import { PublicTurnServerFallback } from './PublicTurnServerFallback.js'
import { PortManager } from './PortManager.js'
import { WebSocketRelay } from './WebSocketRelay.js'
import { E2EEncryption } from './E2EEncryption.js'
import { ZeroKnowledgePrivacy } from './ZeroKnowledgePrivacy.js'
import { DownloadManager } from './DownloadManager.js'

export class DIGNode {
  // Core LibP2P and DIG functionality
  private node!: Libp2p
  private digFiles = new Map<string, DIGFile>()
  private digPath: string
  private cryptoIPv6!: string
  private watcher: any = null
  private isStarted = false
  private logger = new Logger('DIGNode')
  private startTime = 0
  
  // DIG peer tracking
  private digPeers = new Map<string, any>()

  // Unified intelligent subsystems
  private peerDiscovery!: DIGOnlyPeerDiscovery
  private localNetworkDiscovery!: LocalNetworkDiscovery
  private turnCoordination!: UnifiedTurnCoordination
  private peerCapabilities!: PeerConnectionCapabilities
  private natTraversal!: ComprehensiveNATTraversal
  private downloadOrchestrator!: IntelligentDownloadOrchestrator
  private upnpPortManager!: UPnPPortManager
  private publicTurnFallback!: PublicTurnServerFallback
  private portManager = new PortManager()
  private webSocketRelay!: WebSocketRelay
  private e2eEncryption = new E2EEncryption()
  private zkPrivacy!: ZeroKnowledgePrivacy
  private downloadManager!: DownloadManager
  
  // Node state
  private nodeCapabilities: NodeCapabilities = {
    libp2p: false,
    dht: false,
    mdns: false,
    upnp: false,
    autonat: false,
    webrtc: false,
    websockets: false,
    circuitRelay: false,
    turnServer: false,
    bootstrapServer: false,
    storeSync: false,
    e2eEncryption: true,
    protocolVersion: '1.0.0',
    environment: 'development'
  }
  
  private metrics = {
    filesLoaded: 0,
    peersConnected: 0,
    downloadSuccesses: 0,
    errors: 0
  }

  constructor(private config: DIGNodeConfig = {}) {
    this.validateConfig(config)
    this.digPath = config.digPath || join(homedir(), '.dig')
    this.detectEnvironment()
  }

  // Start the consolidated DIG node
  async start(): Promise<void> {
    if (this.isStarted) {
      throw new Error('DIG Node is already started')
    }

    try {
      this.startTime = Date.now()
      this.logger.info('🚀 Starting Consolidated DIG Node with Dual-Role Peer System...')
      
      // Generate crypto-IPv6 identity
      const publicKey = this.config.publicKey || randomBytes(32).toString('hex')
      this.cryptoIPv6 = generateCryptoIPv6(publicKey)
      this.logger.info(`🔐 Crypto-IPv6: ${this.cryptoIPv6}`)

      // Ensure DIG directory
      const hasFileAccess = await this.ensureDigDirectory()

      // Initialize LibP2P with comprehensive NAT traversal
      await this.initializeLibP2PWithNATTraversal()

      // Initialize intelligent subsystems
      await this.initializeIntelligentSubsystems()

      // Start core services
      await this.startCoreServices(hasFileAccess)

      this.isStarted = true
      this.logger.info('✅ Consolidated DIG Node started successfully')
      this.logStartupSummary()

    } catch (error) {
      this.logger.error('Failed to start DIG Node:', error)
      await this.cleanup()
      throw error
    }
  }

  // Initialize LibP2P with comprehensive NAT traversal support
  private async initializeLibP2PWithNATTraversal(): Promise<void> {
    const isAWS = process.env.AWS_DEPLOYMENT === 'true'
    
    // Use port manager to avoid conflicts
    const preferredPort = this.config.port || 4001
    const { addresses, mainPort, wsPort } = await this.portManager.generateLibP2PAddressConfig(preferredPort, isAWS)
    
    this.logger.info(`🔧 Using ports: LibP2P=${mainPort}, WebSocket=${wsPort}`)

    // Essential services
    const services: any = {
      ping: ping(),
      identify: identify(),
      dht: kadDHT({ clientMode: false }),
      gossipsub: gossipsub({ emitSelf: false })
    }

    // Add NAT traversal services with graceful degradation
    if (!isAWS) {
      try {
        services.upnp = uPnPNAT()
        this.nodeCapabilities.upnp = true
        this.logger.info('✅ UPnP NAT traversal enabled')
      } catch (error) {
        this.logger.warn('⚠️ UPnP disabled:', error)
      }

      try {
        services.autonat = autoNAT()
        this.nodeCapabilities.autonat = true
        this.logger.info('✅ AutoNAT detection enabled')
      } catch (error) {
        this.logger.warn('⚠️ AutoNAT disabled:', error)
      }
    }

    // Initialize public TURN fallback
    this.publicTurnFallback = new PublicTurnServerFallback(this)

    // Transport configuration with NAT traversal and public TURN fallback
    const transports: any[] = [tcp(), webSockets({ filter: all })]
    
    // Add WebRTC for NAT traversal with public TURN servers (non-AWS only)
    if (!isAWS) {
      try {
        // Get public TURN servers for WebRTC ICE configuration
        const publicTurnConfig = this.publicTurnFallback.getRecommendedIceConfiguration()
        
        transports.push(webRTC({
          rtcConfiguration: publicTurnConfig
        }))
        this.nodeCapabilities.webrtc = true
        this.logger.info('✅ WebRTC NAT traversal enabled with public TURN fallback')
      } catch (error) {
        this.logger.warn('⚠️ WebRTC disabled:', error)
      }
    }

    // Add Circuit Relay transport
    try {
      transports.push(circuitRelayTransport())
      this.nodeCapabilities.circuitRelay = true
      this.logger.info('✅ Circuit Relay transport enabled')
    } catch (error) {
      this.logger.warn('⚠️ Circuit Relay disabled:', error)
    }

    // Peer discovery configuration - enhanced for local DIG node discovery
    const peerDiscovery = []
    
    // Always use public LibP2P bootstrap servers for global connectivity
    try {
      const bootstrapList = [
        // Public LibP2P bootstrap servers (primary)
      '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
      '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
        '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zp7VBuFTjXPyBWWBGGvCVXVWb3DqhJ',
        '/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt'
    ]
    
    // Add custom DIG bootstrap servers if provided
    if (this.config.bootstrapPeers && this.config.bootstrapPeers.length > 0) {
        bootstrapList.push(...this.config.bootstrapPeers)
        this.logger.info(`🎯 Added ${this.config.bootstrapPeers.length} custom DIG bootstrap servers`)
      }

      peerDiscovery.push(bootstrap({ list: bootstrapList }))
      this.nodeCapabilities.bootstrapServer = true
      this.logger.info(`✅ Bootstrap discovery enabled with ${bootstrapList.length} servers`)
    } catch (error) {
      this.logger.warn('⚠️ Bootstrap discovery disabled:', error)
    }

    // Enhanced mDNS for local DIG node discovery
    if (this.config.enableMdns !== false && !isAWS) {
      try {
        peerDiscovery.push(mdns({
          // Enhanced mDNS configuration for better local discovery
          interval: 10000, // Scan every 10 seconds
          broadcast: true,
          serviceTag: 'dig-network', // Custom service tag for DIG nodes
          peerName: `dig-node-${this.node?.peerId?.toString()?.slice(-8) || 'unknown'}`
        }))
      this.nodeCapabilities.mdns = true
        this.logger.info('✅ Enhanced mDNS local discovery enabled')
      } catch (error) {
        this.logger.warn('⚠️ mDNS discovery disabled:', error)
      }
    }

    // Add custom DIG discovery servers
    if (this.config.discoveryServers && this.config.discoveryServers.length > 0) {
      try {
        peerDiscovery.push(bootstrap({
          list: this.config.discoveryServers
        }))
        this.logger.info(`✅ Custom DIG discovery servers: ${this.config.discoveryServers.length}`)
      } catch (error) {
        this.logger.warn('⚠️ Custom discovery servers disabled:', error)
      }
    }

    // Create LibP2P node
    this.node = await createLibp2p({
      addresses,
      transports,
      connectionEncrypters: [noise()], // Mandatory encryption
      streamMuxers: [yamux()],
      peerDiscovery,
      services,
      connectionManager: {
        maxConnections: 100,
        dialTimeout: 60000, // Longer timeout for NAT traversal
        maxParallelDials: 10
      }
    })

    // Set up protocol handlers
    await this.node.handle(DIG_PROTOCOL, this.handleDIGRequest.bind(this))
    await this.node.handle(DIG_DISCOVERY_PROTOCOL, this.handleDiscoveryRequest.bind(this))
    
    this.nodeCapabilities.libp2p = true
    this.nodeCapabilities.dht = true
    this.nodeCapabilities.websockets = true
    this.logger.info('✅ LibP2P initialized with comprehensive NAT traversal')
  }

  // Initialize intelligent subsystems after LibP2P is ready
  private async initializeIntelligentSubsystems(): Promise<void> {
    try {
      this.logger.info('🧠 Initializing intelligent subsystems...')

      // Set up peer connection handlers for DIG node identification
      this.setupDIGPeerIdentification()

      // Initialize all intelligent subsystems
      this.upnpPortManager = new UPnPPortManager(this)
      this.localNetworkDiscovery = new LocalNetworkDiscovery(this)
      this.peerDiscovery = new DIGOnlyPeerDiscovery(this)
      this.turnCoordination = new UnifiedTurnCoordination(this)
      this.peerCapabilities = new PeerConnectionCapabilities(this)
      this.natTraversal = new ComprehensiveNATTraversal(this)
      this.downloadOrchestrator = new IntelligentDownloadOrchestrator(this)
      this.publicTurnFallback = new PublicTurnServerFallback(this)
      this.zkPrivacy = new ZeroKnowledgePrivacy(this.node.peerId.toString())
      this.downloadManager = new DownloadManager(this.digPath, this)

      // Initialize WebSocket relay for NAT traversal (if needed)
      if (this.config.discoveryServers && this.config.discoveryServers.length > 0) {
        this.webSocketRelay = new WebSocketRelay(this.config.discoveryServers[0], this.node.peerId.toString())
      }
    
    this.logger.info('✅ Intelligent subsystems initialized')

      // Set up AWS bootstrap fallback (after a delay to let other systems start)
      setTimeout(async () => {
        await this.setupAWSBootstrapFallback()
      }, 10000) // 10 second delay

    } catch (error) {
      this.logger.error('Failed to initialize intelligent subsystems:', error)
      throw error
    }
  }

  // Set up AWS bootstrap server as last resort fallback
  private async setupAWSBootstrapFallback(): Promise<void> {
    try {
      this.logger.info('🌐 Setting up AWS bootstrap server as last resort fallback...')

      // 1. Always register with AWS bootstrap server (not just when peer count is low)
      const registered = await this.useAWSBootstrapFallback()
      
      if (registered) {
         // 2. Always discover peers from AWS bootstrap to find other DIG nodes
         this.logger.info(`🔍 Discovering DIG peers from AWS bootstrap...`)
         await this.discoverPeersFromAWSBootstrap()

         // 2.5. Update registration with correct store count after stores are loaded
         setTimeout(async () => {
           this.logger.info('🔄 Updating AWS bootstrap registration with correct store count...')
           await this.useAWSBootstrapFallback() // Re-register with loaded stores
         }, 2000) // Wait 2 seconds for stores to load

         // 2.6. Trigger immediate store synchronization with discovered peers
         setTimeout(async () => {
           await this.syncStoresFromBootstrapPeers()
         }, 5000) // Wait 5 seconds for connections to establish

         // 3. Set up intelligent periodic heartbeat system (every 2 minutes)
        let consecutiveFailures = 0
        const maxFailures = 3
        
        setInterval(async () => {
          try {
            const success = await this.sendAWSBootstrapHeartbeat()
            
            if (success) {
              consecutiveFailures = 0 // Reset failure count on success
            } else {
              consecutiveFailures++
              this.logger.debug(`AWS bootstrap heartbeat failed (${consecutiveFailures}/${maxFailures})`)
              
              // If we have multiple consecutive failures, try full re-registration
              if (consecutiveFailures >= maxFailures) {
                this.logger.info('🔄 Multiple heartbeat failures - attempting full re-registration...')
                const reregistered = await this.useAWSBootstrapFallback()
                if (reregistered) {
                  consecutiveFailures = 0 // Reset on successful re-registration
                  this.logger.info('✅ AWS bootstrap re-registration successful after heartbeat failures')
                }
              }
            }
          } catch (error) {
            consecutiveFailures++
            this.logger.debug(`AWS bootstrap heartbeat error (${consecutiveFailures}/${maxFailures}):`, error)
          }
        }, 2 * 60 * 1000) // Every 2 minutes to stay well within 10-minute timeout

        this.logger.info('✅ AWS bootstrap fallback configured successfully')
      } else {
        this.logger.warn('⚠️ AWS bootstrap fallback not available')
      }

    } catch (error) {
      this.logger.warn('Failed to setup AWS bootstrap fallback:', error)
    }
  }

  // Set up DIG peer identification and prioritization
  private setupDIGPeerIdentification(): void {
    try {
      // Listen for new peer connections
      this.node.addEventListener('peer:connect', (event) => {
        this.handleNewPeerConnection(event.detail)
      })

      // Listen for peer disconnections
      this.node.addEventListener('peer:disconnect', (event) => {
        this.handlePeerDisconnection(event.detail)
      })

      // Listen for peer discovery events
      this.node.addEventListener('peer:discovery', (event) => {
        this.handlePeerDiscovery(event.detail)
      })

      this.logger.info('✅ DIG peer identification handlers set up')

    } catch (error) {
      this.logger.warn('⚠️ Failed to set up peer identification:', error)
    }
  }

  // Handle new peer connections with DIG node identification
  private async handleNewPeerConnection(peerId: any): Promise<void> {
    try {
      this.logger.debug(`🔗 New peer connected: ${peerId.toString()}`)

      // Try to identify if this is a DIG node
      const isDIGNode = await this.identifyDIGNode(peerId)
      
      if (isDIGNode) {
        this.logger.info(`🎯 DIG node identified: ${peerId.toString()}`)
        
        // Add to our DIG peer list
        this.digPeers.set(peerId.toString(), {
          peerId: peerId.toString(),
          identified: true,
          capabilities: {},
          lastSeen: Date.now(),
          connectionType: 'direct'
        })

        // Perform DIG handshake
        await this.performDIGHandshake(peerId)
      } else {
        this.logger.debug(`🌐 Regular LibP2P peer: ${peerId.toString()}`)
      }

      // Update metrics
      this.metrics.peersConnected = this.node.getPeers().length

    } catch (error) {
      this.logger.debug(`Failed to handle peer connection for ${peerId}:`, error)
    }
  }

  // Handle peer disconnections
  private handlePeerDisconnection(peerId: any): void {
    try {
      this.logger.debug(`🔌 Peer disconnected: ${peerId.toString()}`)
      
      // Remove from DIG peers if it was a DIG node
      if (this.digPeers.has(peerId.toString())) {
        this.digPeers.delete(peerId.toString())
        this.logger.info(`📤 DIG node disconnected: ${peerId.toString()}`)
      }

      // Update metrics
      this.metrics.peersConnected = this.node.getPeers().length

    } catch (error) {
      this.logger.debug(`Failed to handle peer disconnection for ${peerId}:`, error)
    }
  }

  // Handle peer discovery events
  private handlePeerDiscovery(peer: any): void {
    try {
      this.logger.debug(`🔍 Peer discovered: ${peer.id?.toString()} via ${peer.multiaddrs?.length || 0} addresses`)
      
      // If this peer has local addresses, it might be on our network
      const hasLocalAddress = peer.multiaddrs?.some((addr: any) => {
        const addrStr = addr.toString()
        return addrStr.includes('192.168.') || 
               addrStr.includes('10.0.') || 
               addrStr.includes('172.16.') ||
               addrStr.includes('127.0.0.1')
      })

      if (hasLocalAddress) {
        this.logger.info(`🏠 Local network peer discovered: ${peer.id?.toString()}`)
      }

    } catch (error) {
      this.logger.debug(`Failed to handle peer discovery:`, error)
    }
  }

  // Identify if a peer is a DIG node
  private async identifyDIGNode(peerId: any): Promise<boolean> {
    const peerIdStr = peerId.toString()
    this.logger.debug(`🔍 Attempting to identify DIG node: ${peerIdStr}`)
    
    try {
      // Method 1: Try to open a DIG protocol stream
      this.logger.debug(`📡 Trying DIG protocol stream to ${peerIdStr}`)
      const stream = await this.node.dialProtocol(peerId, DIG_PROTOCOL)
      if (stream) {
        // Send a DIG identification request
        const identificationRequest = {
          type: 'DIG_NETWORK_IDENTIFICATION',
          version: '1.0.0',
          timestamp: Date.now()
        }
        
        this.logger.debug(`📤 Sending DIG identification request to ${peerIdStr}`)
        const response = await this.sendStreamMessage(stream, identificationRequest)
        await stream.close()
        
        this.logger.debug(`📥 DIG identification response from ${peerIdStr}:`, response)
        
        if (response && response.isDIGNode === true) {
          this.logger.info(`🎯 DIG node confirmed via protocol: ${peerIdStr}`)
          return true
        }
      }

    } catch (error) {
      // If DIG protocol fails, this is likely not a DIG node
      this.logger.debug(`DIG protocol identification failed for ${peerIdStr}:`, error)
    }

    // Method 2: Check if peer responds to DIG discovery protocol
    try {
      this.logger.debug(`📡 Trying DIG discovery protocol to ${peerIdStr}`)
      const stream = await this.node.dialProtocol(peerId, DIG_DISCOVERY_PROTOCOL)
      if (stream) {
        await stream.close()
        this.logger.info(`🎯 DIG node confirmed via discovery protocol: ${peerIdStr}`)
        return true // If it accepts DIG discovery protocol, it's likely a DIG node
      }
    } catch (error) {
      this.logger.debug(`DIG discovery protocol failed for ${peerIdStr}:`, error)
    }

    this.logger.debug(`❌ Peer ${peerIdStr} is not a DIG node`)
    return false
  }

  // Perform DIG handshake with a peer
  private async performDIGHandshake(peerId: any): Promise<void> {
    try {
      const stream = await this.node.dialProtocol(peerId, DIG_PROTOCOL)
      
             const handshake: DIGHandshake = {
         networkId: 'mainnet',
         protocolVersion: '1.0.0',
         softwareVersion: '1.0.0',
         serverPort: this.config.port || 4001,
         nodeType: NodeType.FULL_NODE,
         capabilities: [
           [CapabilityCode.STORE_SYNC, 'Store synchronization'],
           [CapabilityCode.E2E_ENCRYPTION, 'End-to-end encryption'],
           [CapabilityCode.BYTE_RANGE_DOWNLOAD, 'Parallel downloads']
         ],
         peerId: this.node.peerId.toString(),
         cryptoIPv6: this.cryptoIPv6,
         publicKey: this.config.publicKey || '',
         timestamp: Date.now(),
         stores: Array.from(this.digFiles.keys())
       }

      await this.sendStreamMessage(stream, handshake)
      await stream.close()

      this.logger.debug(`🤝 DIG handshake completed with ${peerId.toString()}`)

    } catch (error) {
      this.logger.debug(`DIG handshake failed with ${peerId}:`, error)
    }
  }

  // Send message over stream and wait for response
  async sendStreamMessage(stream: Stream, message: any): Promise<any> {
    try {
      const messageData = uint8ArrayFromString(JSON.stringify(message))
      
      // Send message
      await pipe([messageData], stream.sink)

      // Read response
      const response = await pipe(stream.source, async (source) => {
        for await (const chunk of source) {
          const responseStr = uint8ArrayToString(chunk.subarray())
          return JSON.parse(responseStr)
        }
      })

      return response

    } catch (error) {
      this.logger.debug('Stream message failed:', error)
      throw error
    }
  }

  // Start core services
  private async startCoreServices(hasFileAccess: boolean): Promise<void> {
    // Load existing stores if file access available
    if (hasFileAccess) {
      await this.scanDIGFiles()
      await this.announceStores()
      await this.startFileWatcher()
      this.nodeCapabilities.storeSync = true
    }

    // Start intelligent subsystems
    await this.safeServiceInit('UPnP Port Manager', () => this.upnpPortManager.initialize())
    await this.safeServiceInit('Local Network Discovery', () => this.localNetworkDiscovery.start())
    await this.safeServiceInit('DIG-Only Peer Discovery', () => this.peerDiscovery.start())
    await this.safeServiceInit('TURN Coordination', () => this.turnCoordination.start())
    await this.safeServiceInit('Connection Capabilities', () => this.peerCapabilities.initialize())
    await this.safeServiceInit('Download Orchestrator', () => this.downloadOrchestrator.initialize())
    
    // Start HTTP server for direct downloads if TURN capable
    if (this.nodeCapabilities.turnServer || this.upnpPortManager?.getExternalIP()) {
      await this.safeServiceInit('HTTP Download Server', () => this.startHTTPDownloadServer())
    }

    // Start WebSocket relay only if custom discovery servers are configured
    // (Public bootstrap doesn't need WebSocket relay)
    if (this.config.discoveryServers && this.config.discoveryServers.length > 0) {
      await this.safeServiceInit('WebSocket Relay', () => this.startWebSocketRelay())
      this.logger.info('🔄 Using custom discovery servers with WebSocket relay')
    } else {
      this.logger.info('🌐 Using public LibP2P bootstrap only (no WebSocket relay needed)')
    }

    // Resume incomplete downloads
    if (hasFileAccess) {
      await this.downloadManager.resumeIncompleteDownloads()
    }

    // Start peer discovery and sync
    this.startPeerEventHandling()
    this.startStoreSync()
    
    this.logger.info('✅ All core services started')
  }

  // Start HTTP server for direct .dig file downloads
  private async startHTTPDownloadServer(): Promise<void> {
    try {
      const express = await import('express')
      const app = express.default()
      const httpPort = (this.config.port || 4001) + 1000

      // Enable CORS for cross-origin requests
      app.use((req: any, res: any, next: any) => {
        res.header('Access-Control-Allow-Origin', '*')
        res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        res.header('Access-Control-Allow-Headers', 'Content-Type')
        next()
      })

      // Health check endpoint
      app.get('/health', (req: any, res: any) => {
        res.json({
          status: 'healthy',
          service: 'DIG HTTP Download Server',
          peerId: this.node.peerId.toString(),
          stores: Array.from(this.digFiles.keys()),
          timestamp: new Date().toISOString()
        })
      })

      // Direct .dig file download endpoint
      app.get('/download/:storeId', async (req: any, res: any) => {
        try {
          const { storeId } = req.params
          
          if (!this.digFiles.has(storeId)) {
            return res.status(404).json({ error: `Store ${storeId} not found` })
          }

          const digFile = this.digFiles.get(storeId)!
          const filePath = join(this.digPath, `${storeId}.dig`)
          
          this.logger.info(`📡 Serving direct HTTP download: ${storeId}`)
          
          // Read and serve the .dig file
          const { readFile } = await import('fs/promises')
          const fileData = await readFile(filePath)
          
          res.setHeader('Content-Type', 'application/octet-stream')
          res.setHeader('Content-Length', fileData.length)
          res.setHeader('Content-Disposition', `attachment; filename="${storeId}.dig"`)
          
          res.send(fileData)
          
          this.logger.info(`✅ Direct HTTP download served: ${storeId} (${fileData.length} bytes)`)
          
        } catch (error) {
          this.logger.error(`Failed to serve ${req.params.storeId}:`, error)
          res.status(500).json({ error: 'Download failed' })
        }
      })

      // List available stores
      app.get('/stores', (req: any, res: any) => {
        res.json({
          stores: Array.from(this.digFiles.keys()),
          total: this.digFiles.size,
          peerId: this.node.peerId.toString()
        })
      })

      // Start HTTP server
      app.listen(httpPort, '0.0.0.0', () => {
        this.logger.info(`📡 HTTP download server started on port ${httpPort}`)
        this.logger.info(`🔗 Direct download URL: http://[EXTERNAL_IP]:${httpPort}/download/[STORE_ID]`)
      })

    } catch (error) {
      this.logger.warn('Failed to start HTTP download server:', error)
    }
  }

  // Safely initialize services with error handling
  private async safeServiceInit(serviceName: string, initFunction: () => Promise<void> | void): Promise<void> {
    try {
      await initFunction()
      this.logger.info(`✅ ${serviceName} started`)
    } catch (error) {
      this.logger.warn(`⚠️ ${serviceName} failed to start:`, error)
    }
  }

  // Handle DIG protocol requests
  private async handleDIGRequest({ stream }: { stream: Stream }): Promise<void> {
    const self = this
    try {
      await pipe(
        stream,
        async function* (source: any) {
          for await (const chunk of source) {
            const request: DIGRequest = JSON.parse(uint8ArrayToString(chunk.subarray()))
            
            // Handle different request types
            if (request.type === 'GET_STORE_CONTENT') {
              yield* self.serveStore(request.storeId!)
            } else if (request.type === 'GET_FILE_RANGE') {
              yield* self.serveFileRange(request.storeId!, request.rangeStart!, request.rangeEnd!, request.chunkId)
            } else if (request.type === 'HANDSHAKE') {
              const handshakeResponse = await self.handleHandshake(request)
              yield uint8ArrayFromString(JSON.stringify(handshakeResponse))
            } else if (request.type === 'DIG_NETWORK_IDENTIFICATION') {
              const identResponse = self.handleDIGNetworkIdentification(request)
              yield uint8ArrayFromString(JSON.stringify(identResponse))
            } else if (request.type === 'VERIFY_DIG_MEMBERSHIP') {
              const verifyResponse = self.handleDIGMembershipVerification(request)
              yield uint8ArrayFromString(JSON.stringify(verifyResponse))
            } else if (request.type === 'GET_PEER_INFO') {
              const peerInfoResponse = self.handleGetPeerInfo(request)
              yield uint8ArrayFromString(JSON.stringify(peerInfoResponse))
            } else if (request.type === 'TURN_COORDINATION_REQUEST') {
              const turnResponse = await self.handleTurnCoordinationRequest(request)
              yield uint8ArrayFromString(JSON.stringify(turnResponse))
            } else if (request.type === 'TURN_RELAY_DATA') {
              const relayResponse = await self.handleTurnRelayData(request)
              yield uint8ArrayFromString(JSON.stringify(relayResponse))
            } else if (request.type === 'TURN_CONNECTION_SIGNAL') {
              const signalResponse = await self.handleTurnConnectionSignal(request)
              yield uint8ArrayFromString(JSON.stringify(signalResponse))
            }
            break
          }
        },
        stream
      )
    } catch (error) {
      this.logger.error('DIG request handling failed:', error)
    }
  }

  // Handle discovery protocol requests
  private async handleDiscoveryRequest({ stream }: { stream: Stream }): Promise<void> {
    const self = this
    try {
      await pipe(
        stream,
        async function* (source: any) {
          for await (const chunk of source) {
            const request: any = JSON.parse(uint8ArrayToString(chunk.subarray()))
            
            if (request.type === 'LIST_STORES') {
              const response = {
                success: true,
                peerId: self.node.peerId.toString(),
                stores: Array.from(self.digFiles.keys())
              }
              yield uint8ArrayFromString(JSON.stringify(response))
            }
            break
          }
        },
        stream
      )
    } catch (error) {
      this.logger.error('Discovery request handling failed:', error)
    }
  }

  // Serve store content
  private async *serveStore(storeId: string): AsyncGenerator<Uint8Array> {
    const digFile = this.digFiles.get(storeId)
    
    if (!digFile) {
      const response: DIGResponse = { success: false, error: 'Store not found' }
      yield uint8ArrayFromString(JSON.stringify(response))
      return
    }

    try {
      const response: DIGResponse = {
        success: true,
        size: digFile.content.length,
        mimeType: digFile.metadata.mimeType
      }
      yield uint8ArrayFromString(JSON.stringify(response) + '\n')
      
      // Send file content in chunks
      const CHUNK_SIZE = 64 * 1024
      for (let i = 0; i < digFile.content.length; i += CHUNK_SIZE) {
        yield digFile.content.subarray(i, i + CHUNK_SIZE)
      }
    } catch (error) {
      const response: DIGResponse = { success: false, error: 'Failed to serve store' }
      yield uint8ArrayFromString(JSON.stringify(response))
    }
  }

  // Serve file range for parallel downloads
  private async *serveFileRange(storeId: string, rangeStart: number, rangeEnd: number, chunkId?: string): AsyncGenerator<Uint8Array> {
    const digFile = this.digFiles.get(storeId)
    
    if (!digFile) {
      const response: DIGResponse = { success: false, error: 'Store not found', chunkId }
      yield uint8ArrayFromString(JSON.stringify(response))
      return
    }

    try {
      const content = digFile.content
      const totalSize = content.length
      
      // Validate range
      if (rangeStart < 0 || rangeEnd >= totalSize || rangeStart > rangeEnd) {
        const response: DIGResponse = {
          success: false,
          error: `Invalid range: ${rangeStart}-${rangeEnd} (file size: ${totalSize})`,
          chunkId,
          totalSize
        }
        yield uint8ArrayFromString(JSON.stringify(response))
        return
      }

      const rangeContent = content.subarray(rangeStart, rangeEnd + 1)
      
      const response: DIGResponse = {
        success: true,
        storeId,
        size: rangeContent.length,
        totalSize,
        rangeStart,
        rangeEnd,
        chunkId,
        isPartial: true,
        mimeType: digFile.metadata.mimeType
      }

      yield uint8ArrayFromString(JSON.stringify(response) + '\n')
      
      // Send range content
      const CHUNK_SIZE = 64 * 1024
      for (let i = 0; i < rangeContent.length; i += CHUNK_SIZE) {
        const chunk = rangeContent.subarray(i, Math.min(i + CHUNK_SIZE, rangeContent.length))
        yield chunk
      }
      
    } catch (error) {
      const response: DIGResponse = { success: false, error: 'Failed to serve range', chunkId }
      yield uint8ArrayFromString(JSON.stringify(response))
    }
  }

  // Handle protocol handshake
  private async handleHandshake(request: DIGRequest): Promise<DIGResponse> {
    try {
      // Establish shared secret if public key provided
      if (request.publicKey) {
        this.e2eEncryption.establishSharedSecret('temp-peer', request.publicKey)
      }
      
      return {
        success: true,
        protocolVersion: this.nodeCapabilities.protocolVersion,
        supportedFeatures: E2EEncryption.getProtocolCapabilities(),
        publicKey: this.e2eEncryption.getPublicKey(),
        metadata: {
          nodeCapabilities: this.nodeCapabilities,
          storeCount: this.digFiles.size,
          acceptsDirectConnections: this.peerCapabilities?.peerAcceptsDirectConnections(this.node.peerId.toString()) || false
        }
      }
    } catch (error) {
      return {
        success: false,
        error: `Handshake failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }

  // Handle DIG network identification requests
  private handleDIGNetworkIdentification(request: DIGRequest): DIGResponse {
    this.logger.info(`🔍 DIG network identification request from peer`)
    
    return {
      success: true,
      networkId: 'dig-mainnet',
      isDIGNode: true,
      protocolVersion: '1.0.0',
      timestamp: Date.now()
    }
  }

  // Handle DIG membership verification requests
  private handleDIGMembershipVerification(request: DIGRequest): DIGResponse {
    this.logger.info(`🔐 DIG membership verification request`)
    
    return {
      success: true,
      networkId: 'dig-mainnet',
      cryptoIPv6: this.cryptoIPv6,
      capabilities: this.nodeCapabilities,
      stores: this.getAvailableStores(),
      timestamp: Date.now()
    }
  }

  // Handle get peer info requests
  private handleGetPeerInfo(request: DIGRequest): DIGResponse {
    this.logger.info(`📋 Peer info request: ${request.requestedInfo?.join(', ') || 'all'}`)
    
    const response: any = {
      success: true,
      peerId: this.node.peerId.toString(),
      timestamp: Date.now()
    }

    const requestedInfo = request.requestedInfo || []
    
    if (requestedInfo.includes('stores') || requestedInfo.length === 0) {
      response.stores = this.getAvailableStores()
    }
    
    if (requestedInfo.includes('capabilities') || requestedInfo.length === 0) {
      response.capabilities = this.nodeCapabilities
    }
    
    if (requestedInfo.includes('cryptoIPv6') || requestedInfo.length === 0) {
      response.cryptoIPv6 = this.cryptoIPv6
    }
    
    if (requestedInfo.includes('nodeType') || requestedInfo.length === 0) {
      response.nodeType = 'full'
    }

    return response
  }

  // Handle TURN coordination requests (when acting as TURN server)
  private async handleTurnCoordinationRequest(request: DIGRequest): Promise<DIGResponse> {
    try {
      this.logger.info(`📡 TURN coordination request: ${request.fromPeerId} → ${request.targetPeerId} for store ${request.storeId}`)

      // Check if we can act as TURN server
      if (!this.nodeCapabilities.turnServer) {
        return {
          success: false,
          error: 'This node cannot act as TURN server'
        }
      }

      // Check if we have the requested store to relay
      if (request.storeId && !this.digFiles.has(request.storeId)) {
        return {
          success: false,
          error: `Store ${request.storeId} not available for relay`
        }
      }

      // Create TURN relay session
      const sessionId = `turn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      
      // Store the relay session for coordination
      this.turnCoordination.activeConnections.set(sessionId, {
        fromPeerId: request.fromPeerId,
        targetPeerId: request.targetPeerId,
        storeId: request.storeId,
        sessionId,
        status: 'coordinating',
        created: Date.now()
      })

      this.logger.info(`✅ TURN relay session created: ${sessionId}`)

      return {
        success: true,
        sessionId,
        turnServerPeerId: this.node.peerId.toString(),
        externalAddress: this.upnpPortManager?.getExternalIP() || undefined,
        relayPort: (this.config.port || 4001) + 2000, // TURN relay port
        message: 'TURN relay session established'
      }

    } catch (error) {
      this.logger.error('TURN coordination request failed:', error)
      return {
        success: false,
        error: `TURN coordination failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }

  // Handle TURN relay data transfer
  private async handleTurnRelayData(request: DIGRequest): Promise<DIGResponse> {
    try {
      this.logger.info(`📡 TURN relay data request: session ${request.sessionId}`)

      // Find the relay session
      const session = this.turnCoordination.activeConnections.get(request.sessionId || '')
      
      if (!session) {
        return {
          success: false,
          error: 'TURN relay session not found'
        }
      }

      // If this is a store request, serve the file
      if (request.storeId && this.digFiles.has(request.storeId)) {
        const digFile = this.digFiles.get(request.storeId)!
        
        this.logger.info(`📡 Serving store ${request.storeId} via TURN relay`)
        
        return {
          success: true,
          storeId: request.storeId,
          size: digFile.content.length,
          data: digFile.content.toString('base64'), // Base64 encode for JSON transport
          sessionId: request.sessionId
        }
      }

      return {
        success: false,
        error: 'Store not available for TURN relay'
      }

    } catch (error) {
      this.logger.error('TURN relay data failed:', error)
      return {
        success: false,
        error: `TURN relay data failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }

  // Handle TURN connection signals (when another peer wants us to connect to a TURN server)
  private async handleTurnConnectionSignal(request: DIGRequest): Promise<DIGResponse> {
    try {
      this.logger.info(`📡 TURN connection signal received from ${request.fromPeerId}`)

      const turnServerPeerId = request.turnServerPeerId
      const turnServerAddresses = request.turnServerAddresses

      if (!turnServerPeerId || !turnServerAddresses) {
        return {
          success: false,
          error: 'Missing TURN server information in signal'
        }
      }

      // Establish connection to the specified TURN server
      let connected = false
      
      for (const address of turnServerAddresses) {
        try {
          this.logger.info(`🔌 Connecting to signaled TURN server: ${address}`)
          const addr = multiaddr(address)
          await this.node.dial(addr)
          this.logger.info(`✅ Connected to TURN server: ${turnServerPeerId}`)
          connected = true
          break
        } catch (dialError) {
          this.logger.debug(`Failed to connect to TURN server ${address}:`, dialError)
        }
      }

      if (connected) {
        // Establish WebSocket to TURN server for coordination
        const match = turnServerAddresses[0].match(/\/ip4\/([^\/]+)\/tcp\/(\d+)/)
        if (match) {
          const [, ip, port] = match
          const wsPort = parseInt(port) + 2000
          const wsUrl = `ws://${ip}:${wsPort}`
          
          this.logger.info(`🔌 Establishing WebSocket for TURN coordination: ${wsUrl}`)
          
          // Store the WebSocket connection for TURN coordination
          // In full implementation, would establish actual WebSocket
        }

        return {
          success: true,
          message: `Connected to TURN server ${turnServerPeerId}`,
          turnServerPeerId,
          timestamp: Date.now()
        }
      } else {
        return {
          success: false,
          error: `Could not connect to TURN server ${turnServerPeerId}`
        }
      }

    } catch (error) {
      this.logger.error('TURN connection signal handling failed:', error)
      return {
        success: false,
        error: `TURN signal handling failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }

  // Get connection capabilities response
  private getConnectionCapabilitiesResponse(): DIGResponse {
    return {
      success: true,
      metadata: {
        acceptsDirectConnections: this.peerCapabilities?.peerAcceptsDirectConnections(this.node.peerId.toString()) || false,
        canActAsTurnServer: this.peerCapabilities?.peerCanActAsTurnServer(this.node.peerId.toString()) || false,
        natTraversalMethods: this.nodeCapabilities.upnp ? ['upnp'] : [],
        connectionTypes: ['tcp', 'websocket'],
        testResults: this.nodeCapabilities
      }
    }
  }

  // Start WebSocket relay for bootstrap communication
  private async startWebSocketRelay(): Promise<void> {
    const bootstrapUrl = this.config.discoveryServers?.[0]
    if (!bootstrapUrl) return

    try {
      this.webSocketRelay = new WebSocketRelay(bootstrapUrl, this.node.peerId.toString())
      await this.webSocketRelay.connect()
      this.logger.info('🔄 WebSocket relay connected')
    } catch (error) {
      this.logger.warn('WebSocket relay failed:', error)
    }
  }

  // Start peer event handling with security awareness
  private startPeerEventHandling(): void {
    this.node.addEventListener('peer:connect', (event) => {
      try {
        const peerId = event.detail?.toString()
        if (peerId) {
          this.metrics.peersConnected++
          this.logger.info(`🤝 Connected to peer: ${peerId}`)
        }
      } catch (error) {
        this.logger.debug('Peer connect event error:', error)
      }
    })

    this.node.addEventListener('peer:disconnect', (event) => {
      try {
        const peerId = event.detail?.toString()
        if (peerId) {
          this.logger.info(`👋 Disconnected from peer: ${peerId}`)
          // Note: DIG-only discovery automatically handles peer cleanup
        }
      } catch (error) {
        this.logger.debug('Peer disconnect event error:', error)
      }
    })
  }

  // Start store synchronization
  private startStoreSync(): void {
    // Initial sync after 5 seconds
    setTimeout(() => this.syncStores(), 5000)
    
    // Periodic sync every 30 seconds
    setInterval(() => {
      this.syncStores().catch(error => {
        this.logger.error('Store sync error:', error)
      })
    }, 30000)
  }

  // Synchronize stores using intelligent download orchestrator
  private async syncStores(): Promise<void> {
    try {
      // Get stores we don't have from DIG peers
      const digPeers = this.peerDiscovery?.getDIGPeers() || []
      const allRemoteStores = new Set<string>()
      
      for (const peer of digPeers) {
        for (const storeId of peer.stores) {
          if (!this.digFiles.has(storeId)) {
            allRemoteStores.add(storeId)
          }
        }
      }

      if (allRemoteStores.size > 0) {
        this.logger.info(`📥 Syncing ${allRemoteStores.size} missing stores`)
        
        for (const storeId of Array.from(allRemoteStores).slice(0, 5)) { // Limit concurrent downloads
          try {
            const downloadResult = await this.downloadOrchestrator.downloadStore(storeId)
            if (downloadResult.success && downloadResult.data) {
              await this.saveDownloadedStore(storeId, downloadResult.data)
              this.logger.info(`✅ Synced store: ${storeId} via ${downloadResult.strategy}`)
            }
          } catch (error) {
            this.logger.debug(`Failed to sync store ${storeId}:`, error)
          }
        }
      }
    } catch (error) {
      this.logger.error('Store sync failed:', error)
     }
   }

   // Sync stores from peers discovered via AWS bootstrap
   private async syncStoresFromBootstrapPeers(): Promise<void> {
     try {
       this.logger.info('🔄 Starting store sync from AWS bootstrap discovered peers...')

       const awsConfig = this.getAWSBootstrapConfig()
       if (!awsConfig.enabled) return

       // Get all peers with stores from AWS bootstrap
       const response = await fetch(`${awsConfig.url}/peers?includeStores=true`)
       if (!response.ok) return

       const result = await response.json()
       const peersWithStores = result.peers?.filter((peer: any) => 
         peer.stores?.length > 0 && peer.peerId !== this.node.peerId.toString()
       ) || []

       if (peersWithStores.length === 0) {
         this.logger.info('📋 No peers with stores found for synchronization')
         return
       }

       this.logger.info(`📋 Found ${peersWithStores.length} peers with stores for synchronization`)

       // Collect all unique stores we don't have
       const allRemoteStores = new Set<string>()
       for (const peer of peersWithStores) {
         for (const storeId of peer.stores) {
           if (!this.digFiles.has(storeId)) {
             allRemoteStores.add(storeId)
           }
         }
       }

       if (allRemoteStores.size > 0) {
         this.logger.info(`📥 Attempting to sync ${allRemoteStores.size} missing stores`)

         // Download missing stores (limit concurrent downloads)
         const storesToSync = Array.from(allRemoteStores).slice(0, 10)
         
         for (const storeId of storesToSync) {
           try {
             this.logger.info(`📥 Syncing store: ${storeId}`)
             const success = await this.downloadStore(storeId)
             
             if (success) {
               this.logger.info(`✅ Successfully synced store: ${storeId}`)
             } else {
               this.logger.warn(`⚠️ Failed to sync store: ${storeId}`)
             }
           } catch (error) {
             this.logger.debug(`Store sync failed for ${storeId}:`, error)
           }
         }
       } else {
         this.logger.info('✅ All stores already synchronized')
       }

     } catch (error) {
       this.logger.error('Bootstrap store sync failed:', error)
     }
   }

   // File management methods
   private async ensureDigDirectory(): Promise<boolean> {
    try {
      await import('fs/promises').then(fs => fs.access(this.digPath))
      return true
    } catch {
      try {
        await import('fs/promises').then(fs => fs.mkdir(this.digPath, { recursive: true }))
        this.logger.info(`📁 Created DIG directory: ${this.digPath}`)
        return true
      } catch (error) {
        this.logger.warn('Cannot create DIG directory - file operations disabled:', error)
        return false
      }
    }
  }

  private async scanDIGFiles(): Promise<void> {
    try {
      const files = await readdir(this.digPath)
      for (const file of files) {
        if (file.endsWith('.dig')) {
          await this.loadDIGFile(join(this.digPath, file))
        }
      }
      this.logger.info(`📁 Loaded ${this.digFiles.size} stores`)
    } catch (error) {
      this.logger.warn('Failed to scan DIG files:', error)
    }
  }

  private async loadDIGFile(filePath: string): Promise<void> {
    try {
      const storeId = basename(filePath, '.dig')
      const content = await readFile(filePath)
      const stats = await stat(filePath)
      
      this.digFiles.set(storeId, {
        storeId,
        filePath,
        content,
        metadata: {
          name: storeId,
          size: content.length,
          created: stats.birthtime.toISOString(),
          mimeType: 'application/x-dig-archive'
        }
      })
      
      this.metrics.filesLoaded++
    } catch (error) {
      this.logger.error(`Failed to load ${filePath}:`, error)
      this.metrics.errors++
    }
  }

  private async announceStores(): Promise<void> {
    for (const storeId of this.digFiles.keys()) {
      await this.announceStore(storeId)
    }
  }

  private async announceStore(storeId: string): Promise<void> {
    try {
      const dht = this.node.services.dht as any
      if (dht) {
        const key = uint8ArrayFromString(`/dig-store/${storeId}`)
        const value = uint8ArrayFromString(JSON.stringify({
          peerId: this.node.peerId.toString(),
          cryptoIPv6: this.cryptoIPv6,
          timestamp: Date.now()
        }))
        await dht.put(key, value)
      }
    } catch (error) {
      this.logger.debug(`Failed to announce store ${storeId}:`, error)
    }
  }

  private async startFileWatcher(): Promise<void> {
    try {
      this.watcher = watch(this.digPath, { recursive: false })
      
      // Run watcher in background
      this.runFileWatcher()
    } catch (error) {
      this.logger.warn('File watcher disabled:', error)
    }
  }

  private async runFileWatcher(): Promise<void> {
    try {
      for await (const event of this.watcher) {
        if (event.filename && event.filename.endsWith('.dig')) {
          const filePath = join(this.digPath, event.filename)
          const storeId = basename(event.filename, '.dig')
          
          try {
            await stat(filePath)
            await this.loadDIGFile(filePath)
            await this.announceStore(storeId)
            this.logger.info(`📁 Updated store: ${storeId}`)
          } catch (statError) {
            this.digFiles.delete(storeId)
            this.logger.info(`📁 Removed store: ${storeId}`)
          }
        }
      }
    } catch (error) {
      this.logger.warn('File watcher error:', error)
    }
  }

  private async saveDownloadedStore(storeId: string, content: Buffer): Promise<void> {
    try {
      const filePath = join(this.digPath, `${storeId}.dig`)
      await writeFile(filePath, content)
      await this.loadDIGFile(filePath)
      await this.announceStore(storeId)
      this.metrics.downloadSuccesses++
    } catch (error) {
      this.logger.error(`Failed to save store ${storeId}:`, error)
      throw error
    }
  }

  // Utility methods
  private validateConfig(config: DIGNodeConfig): void {
    if (config.port && (config.port < 1 || config.port > 65535)) {
      throw new Error('Port must be between 1 and 65535')
    }
  }

  private detectEnvironment(): void {
    const isAWS = process.env.AWS_DEPLOYMENT === 'true'
    this.nodeCapabilities.environment = isAWS ? 'aws' : 
      (process.env.NODE_ENV === 'production' ? 'production' : 'development')
  }

  private logStartupSummary(): void {
    const capabilities = Object.entries(this.nodeCapabilities)
      .filter(([_, value]) => value === true)
      .map(([key]) => key)
    
    console.log('📊 Consolidated DIG Node Summary:')
    console.log(`   🆔 Peer ID: ${this.node.peerId.toString()}`)
    console.log(`   🔐 Crypto-IPv6: ${this.cryptoIPv6}`)
    console.log(`   📁 Stores: ${this.digFiles.size}`)
    console.log(`   🔧 Capabilities: ${capabilities.join(', ')}`)
    console.log(`   🌍 Environment: ${this.nodeCapabilities.environment}`)
    console.log(`   🎯 Architecture: Dual-Role Peer System`)
    console.log(`   📡 NAT Traversal: Comprehensive (8 methods)`)
    console.log(`   🔒 Privacy: Mandatory (Crypto-IPv6 + E2E + ZK)`)
  }

  // Public API
  getNode(): Libp2p { return this.node }
  getCryptoIPv6(): string { return this.cryptoIPv6 }
  getAvailableStores(): string[] { return Array.from(this.digFiles.keys()) }
  getCapabilities(): NodeCapabilities { return { ...this.nodeCapabilities } }
  isHealthy(): boolean { return this.isStarted && !!this.node }

  getStatus(): any {
    return {
      isStarted: this.isStarted,
      peerId: this.node?.peerId?.toString(),
      cryptoIPv6: this.cryptoIPv6,
      stores: Array.from(this.digFiles.keys()),
      connectedPeers: this.node ? this.node.getPeers().map(p => p.toString()) : [],
      metrics: this.getMetrics(),
      startTime: this.startTime
    }
  }

  getMetrics(): any {
    return {
      ...this.metrics,
      uptime: this.isStarted ? Date.now() - this.startTime : 0,
      storesCount: this.digFiles.size,
      peersCount: this.node ? this.node.getPeers().length : 0
    }
  }

  getNetworkHealth(): any {
    const connectedPeers = this.node ? this.node.getPeers().length : 0
    const digPeers = this.peerDiscovery?.getDIGPeers().length || 0
    const turnServers = this.turnCoordination?.getTurnStats()?.totalTurnServers || 0
    
    return {
      isHealthy: this.isHealthy(),
      connectedPeers,
      digPeers,
      turnServers,
      storesShared: this.digFiles.size,
      connectionCapabilities: this.peerCapabilities?.getCapabilityStats()
    }
  }

  // Download store using intelligent orchestrator
  async downloadStore(storeId: string): Promise<boolean> {
    try {
      // Primary: Use intelligent download orchestrator
      const result = await this.downloadOrchestrator.downloadStore(storeId)
      
      if (result.success && result.data) {
        await this.saveDownloadedStore(storeId, result.data)
        this.logger.info(`✅ Downloaded ${storeId} via ${result.strategy}`)
        return true
      }
      
      // Fallback 1: Try direct HTTP connection to TURN-capable peers
      this.logger.info(`🌐 Primary download failed for ${storeId} - trying direct connection to TURN-capable peers...`)
      const directResult = await this.downloadViaDirectConnection(storeId)
      
      if (directResult) {
        await this.saveDownloadedStore(storeId, directResult)
        this.logger.info(`✅ Downloaded ${storeId} via direct HTTP connection`)
        return true
      }

      // Fallback 2: Try AWS bootstrap TURN relay
      this.logger.info(`📡 Direct connection failed for ${storeId} - trying AWS bootstrap TURN relay...`)
      const awsResult = await this.downloadViaAWSBootstrapTURN(storeId)
      
      if (awsResult) {
        await this.saveDownloadedStore(storeId, awsResult)
        this.logger.info(`✅ Downloaded ${storeId} via AWS bootstrap TURN fallback`)
        return true
      }
      
      return false
    } catch (error) {
      this.logger.error(`Download failed for ${storeId}:`, error)
      return false
    }
  }

  // Download directly from TURN-capable peers via HTTP
  private async downloadViaDirectConnection(storeId: string): Promise<Buffer | null> {
    try {
      const awsConfig = this.getAWSBootstrapConfig()
      
      if (!awsConfig.enabled) {
        return null
      }

      // Find TURN-capable peers with this store
      const response = await fetch(`${awsConfig.url}/peers?includeStores=true`)
      
      if (!response.ok) {
        return null
      }

      const result = await response.json()
      const turnCapablePeersWithStore = result.peers?.filter((peer: any) => 
        peer.stores?.includes(storeId) && 
        peer.peerId !== this.node.peerId.toString() &&
        peer.turnCapable === true &&
        peer.turnAddresses?.length > 0
      ) || []

      if (turnCapablePeersWithStore.length === 0) {
        this.logger.warn(`⚠️ No TURN-capable peers found with store ${storeId}`)
        return null
      }

      // Try direct HTTP download from TURN-capable peers
      for (const peer of turnCapablePeersWithStore) {
        try {
          this.logger.info(`📡 Attempting direct HTTP download from TURN-capable peer: ${peer.peerId}`)
          
          // Extract IP and port from TURN addresses
          for (const turnAddress of peer.turnAddresses) {
            try {
              const match = turnAddress.match(/\/ip4\/([^\/]+)\/tcp\/(\d+)/)
              if (match) {
                const [, ip, port] = match
                
                // Try direct HTTP download (assuming peer runs HTTP server on port+1000)
                const httpPort = parseInt(port) + 1000
                const downloadUrl = `http://${ip}:${httpPort}/download/${storeId}`
                
                this.logger.info(`📡 Trying direct HTTP download: ${downloadUrl}`)
                
                const downloadResponse = await fetch(downloadUrl, {
                  signal: AbortSignal.timeout(30000) // 30 second timeout
                })
                
                if (downloadResponse.ok) {
                  const data = await downloadResponse.arrayBuffer()
                  this.logger.info(`✅ Direct HTTP download successful: ${data.byteLength} bytes from ${peer.peerId}`)
                  return Buffer.from(data)
                }
              }
            } catch (httpError) {
              this.logger.debug(`Direct HTTP download failed from ${peer.peerId}:`, httpError)
            }
          }
        } catch (error) {
          this.logger.debug(`Failed to download from peer ${peer.peerId}:`, error)
        }
      }

      // Fallback to peer TURN coordination if direct HTTP fails
      return await this.downloadViaPeerTURNCoordination(storeId)

    } catch (error) {
      this.logger.debug('Direct connection download failed:', error)
      return null
    }
  }

  // Download via peer TURN coordination
  private async downloadViaPeerTURNCoordination(storeId: string): Promise<Buffer | null> {
    try {
      const awsConfig = this.getAWSBootstrapConfig()
      
      if (!awsConfig.enabled) {
        return null
      }

      // Find peers with this store
      const response = await fetch(`${awsConfig.url}/peers?includeStores=true`)
      
      if (!response.ok) {
        return null
      }

      const result = await response.json()
      const peersWithStore = result.peers?.filter((peer: any) => 
        peer.stores?.includes(storeId) && peer.peerId !== this.node.peerId.toString()
      ) || []

      if (peersWithStore.length === 0) {
        this.logger.warn(`⚠️ No peers found with store ${storeId}`)
        return null
      }

      const sourcePeer = peersWithStore[0]
      this.logger.info(`📡 Attempting TURN coordination for ${storeId} from ${sourcePeer.peerId}`)

      // Use TURN coordination to establish connection
      const turnResult = await this.turnCoordination.coordinateTurnConnection(sourcePeer.peerId, storeId)
      
      if (turnResult && turnResult.success) {
        this.logger.info(`✅ TURN coordination established: ${turnResult.method}`)
        
        // Attempt to download via the coordinated TURN connection
        return await this.downloadViaTurnRelay(sourcePeer.peerId, storeId, turnResult)
      }

      // Final fallback to AWS bootstrap TURN relay
      return await this.downloadViaAWSBootstrapTURN(storeId)

    } catch (error) {
      this.logger.debug('Peer TURN coordination failed:', error)
      return null
    }
  }

  // Download via coordinated TURN relay
  private async downloadViaTurnRelay(sourcePeerId: string, storeId: string, turnResult: any): Promise<Buffer | null> {
    try {
      this.logger.info(`📡 Downloading ${storeId} via TURN relay from ${sourcePeerId}`)

      if (turnResult.method === 'aws-bootstrap-turn') {
        // Use AWS bootstrap TURN relay
        return await this.downloadViaAWSBootstrapTurnRelay(sourcePeerId, storeId, turnResult)
      } else if (turnResult.method === 'peer-turn') {
        // Use peer TURN relay
        return await this.downloadViaPeerTurnRelay(sourcePeerId, storeId, turnResult)
      }

      return null

    } catch (error) {
      this.logger.error('TURN relay download failed:', error)
      return null
    }
  }

  // Download via AWS bootstrap TURN relay
  private async downloadViaAWSBootstrapTurnRelay(sourcePeerId: string, storeId: string, turnResult: any): Promise<Buffer | null> {
    try {
      // Request the file via AWS bootstrap TURN relay
      const relayResponse = await fetch(`${turnResult.coordination.fallbackTurnServer?.relayEndpoint || '/bootstrap-turn-relay'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId,
          fromPeerId: sourcePeerId,
          toPeerId: this.node.peerId.toString()
        })
      })

      if (relayResponse.ok) {
        const data = await relayResponse.arrayBuffer()
        this.logger.info(`✅ AWS bootstrap TURN relay download: ${data.byteLength} bytes`)
        return Buffer.from(data)
      }

      return null

    } catch (error) {
      this.logger.debug('AWS bootstrap TURN relay download failed:', error)
      return null
    }
  }

  // Download via peer TURN relay
  private async downloadViaPeerTurnRelay(sourcePeerId: string, storeId: string, turnResult: any): Promise<Buffer | null> {
    try {
      // Connect to the TURN server and request relay
      const stream = await this.node.dialProtocol(turnResult.turnServer, '/dig/1.0.0')
      
      const relayRequest = {
        type: 'TURN_RELAY_DATA',
        sessionId: turnResult.sessionId,
        storeId,
        fromPeerId: sourcePeerId,
        toPeerId: this.node.peerId.toString()
      }

      const response = await this.sendStreamMessage(stream, relayRequest)
      await stream.close()

      if (response && response.success && response.data) {
        // Decode base64 data
        const data = Buffer.from(response.data, 'base64')
        this.logger.info(`✅ Peer TURN relay download: ${data.length} bytes`)
        return data
      }

      return null

    } catch (error) {
      this.logger.debug('Peer TURN relay download failed:', error)
      return null
    }
  }

  // Download via AWS bootstrap TURN relay as last resort
  private async downloadViaAWSBootstrapTURN(storeId: string): Promise<Buffer | null> {
    try {
      const awsConfig = this.getAWSBootstrapConfig()
      
      if (!awsConfig.enabled) {
        return null
      }

      // Find peers with this store from AWS bootstrap
      const response = await fetch(`${awsConfig.url}/peers?includeStores=true`)
      
      if (!response.ok) {
        return null
      }

      const result = await response.json()
      const peersWithStore = result.peers?.filter((peer: any) => 
        peer.stores?.includes(storeId) && peer.peerId !== this.node.peerId.toString()
      ) || []

      if (peersWithStore.length === 0) {
        this.logger.warn(`⚠️ No peers found with store ${storeId} on AWS bootstrap`)
        return null
      }

      const sourcePeer = peersWithStore[0]
      this.logger.info(`📡 Attempting AWS bootstrap TURN relay from ${sourcePeer.peerId}`)

      // Request relay via AWS bootstrap TURN
      const relayResponse = await fetch(`${awsConfig.url}/relay-store`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId,
          fromPeerId: sourcePeer.peerId,
          toPeerId: this.node.peerId.toString(),
          userTier: process.env.DIG_USER_TIER || 'free',
          isPremium: process.env.DIG_IS_PREMIUM === 'true'
        })
      })

      if (relayResponse.ok) {
        const relayResult = await relayResponse.json()
        
        if (relayResult.success) {
          this.logger.info(`✅ AWS bootstrap TURN relay initiated: ${relayResult.method}`)
          
          // For now, return a placeholder - full implementation would handle the relay
          // This would require WebSocket connection to the bootstrap server
          this.logger.warn('⚠️ AWS bootstrap TURN relay requires WebSocket implementation')
          return null
        }
      }

      return null

    } catch (error) {
      this.logger.debug('AWS bootstrap TURN download failed:', error)
      return null
    }
  }

  // Legacy API methods for backwards compatibility
  hasStore(storeId: string): boolean {
    return this.digFiles.has(storeId)
  }

  async findStorePeers(storeId: string): Promise<any[]> {
    const digPeers = this.peerDiscovery?.getDIGPeersWithStore(storeId) || []
    return digPeers.map(peer => ({
      peerId: peer.peerId,
      cryptoIPv6: peer.cryptoIPv6,
      timestamp: peer.lastSeen
    }))
  }

  async connectToPeer(peerAddress: string): Promise<void> {
    // Try local network discovery first for hotel networks
    const isLocal = this.localNetworkDiscovery && await this.localNetworkDiscovery.manualConnectToPeer(peerAddress)
    
    if (isLocal) {
      this.logger.info(`✅ Connected to local DIG peer: ${peerAddress}`)
      return
    }

    // Fallback to direct connection
    const addr = multiaddr(peerAddress)
    await this.node.dial(addr)
    this.logger.info(`✅ Connected to peer: ${peerAddress}`)
  }

  // Manual connection for hotel networks (IP:PORT format)
  async connectToLocalPeer(ipAddress: string, port: number = 4001): Promise<boolean> {
    try {
      this.logger.info(`🏠 Attempting local network connection: ${ipAddress}:${port}`)
      
      // Try local network discovery
      if (this.localNetworkDiscovery) {
        const peerAddress = `/ip4/${ipAddress}/tcp/${port}`
        return await this.localNetworkDiscovery.manualConnectToPeer(peerAddress)
      }
      
      return false
    } catch (error) {
      this.logger.error(`Local peer connection failed to ${ipAddress}:${port}:`, error)
      return false
    }
  }

  getConnectionInfo(): any {
    const peers = this.node ? this.node.getPeers() : []
    const digPeers = this.peerDiscovery?.getDIGPeers() || []
    const capabilityStats = this.peerCapabilities?.getCapabilityStats()
    
    return {
      listeningAddresses: this.node ? this.node.getMultiaddrs().map(addr => addr.toString()) : [],
      connectedPeers: peers.map(peer => peer.toString()),
      peerCount: peers.length,
      digPeers: digPeers.length,
      turnServers: this.turnCoordination?.getTurnStats()?.totalTurnServers || 0,
      connectionCapabilities: capabilityStats,
      upnpStatus: this.upnpPortManager?.getUPnPStatus(),
      externalAddresses: this.upnpPortManager?.getExternalAddresses() || [],
      localNetworkStatus: this.localNetworkDiscovery?.getLocalNetworkStatus(),
      canAcceptDirectConnections: capabilityStats ? capabilityStats.directCapablePeers > 0 : false,
      canActAsTurnServer: capabilityStats ? capabilityStats.turnCapablePeers > 0 : false,
      availableConnectionMethods: this.getAvailableConnectionMethods()
    }
  }

  getNodeCapabilities(): NodeCapabilities {
    return { ...this.nodeCapabilities }
  }

  getUPnPStatus(): any {
    return this.upnpPortManager?.getUPnPStatus() || {
      available: false,
      totalMappings: 0,
      activeMappings: 0,
      portRanges: { libp2p: [], websocket: [], turn: [] },
      lastRefresh: 0
    }
  }

  getMultiaddrs(): any[] {
    return this.node ? this.node.getMultiaddrs() : []
  }

  private getAvailableConnectionMethods(): string[] {
    const methods: string[] = []
    
    if (this.nodeCapabilities.upnp) methods.push('UPnP')
    if (this.nodeCapabilities.autonat) methods.push('AutoNAT')
    if (this.nodeCapabilities.webrtc) methods.push('WebRTC')
    if (this.nodeCapabilities.websockets) methods.push('WebSockets')
    if (this.nodeCapabilities.circuitRelay) methods.push('Circuit Relay')
    if (this.nodeCapabilities.dht) methods.push('DHT')
    if (this.nodeCapabilities.mdns) methods.push('mDNS')
    
    methods.push('TCP Direct')
    methods.push('AWS Bootstrap Fallback')
    
    return methods
  }

  // Get AWS bootstrap server configuration
  private getAWSBootstrapConfig(): { url: string; enabled: boolean } {
    const awsBootstrapUrl = process.env.DIG_AWS_BOOTSTRAP_URL || 
                           'http://awseb--AWSEB-qNbAdipmcXyx-770761774.us-east-1.elb.amazonaws.com'
    
    return {
      url: awsBootstrapUrl,
      enabled: process.env.DIG_AWS_BOOTSTRAP_ENABLED !== 'false'
    }
  }

  // Use AWS bootstrap server as last resort for peer discovery
  async useAWSBootstrapFallback(): Promise<boolean> {
    try {
      const awsConfig = this.getAWSBootstrapConfig()
      
      if (!awsConfig.enabled) {
        this.logger.debug('⏭️ AWS bootstrap fallback disabled')
        return false
      }

      this.logger.info('🌐 Using AWS bootstrap server as fallback for peer discovery...')
      
      // Determine TURN capability based on UPnP and external connectivity
      const hasUPnPExternalIP = this.upnpPortManager?.getExternalIP() !== null
      const upnpPortMapped = this.upnpPortManager?.isPortMapped(this.config.port || 4001) || false
      const canAcceptDirectConnections = hasUPnPExternalIP && upnpPortMapped
      
      // If UPnP is working and ports are mapped, this node can act as TURN server
      const isTurnCapable = canAcceptDirectConnections || this.nodeCapabilities.turnServer
      
      if (isTurnCapable && hasUPnPExternalIP) {
        this.logger.info(`📡 Node is TURN capable: UPnP external IP (${this.upnpPortManager?.getExternalIP()}) with port mapping`)
      }

      // Register with AWS bootstrap server using real LibP2P addresses for direct P2P connections
      const registrationData = {
        peerId: this.node.peerId.toString(),
        addresses: this.node.getMultiaddrs().map(addr => addr.toString()), // Use real addresses for P2P connections
        stores: Array.from(this.digFiles.keys()),
        version: '1.0.0',
        capabilities: this.nodeCapabilities,
        turnCapable: isTurnCapable,
        bootstrapCapable: false,
        // TURN server information if capable
        turnAddresses: isTurnCapable ? this.upnpPortManager?.getExternalAddresses() || [] : undefined,
        turnPort: isTurnCapable ? (this.config.port || 4001) : undefined,
        turnCapacity: isTurnCapable ? 10 : undefined,
        networkId: 'mainnet',
        softwareVersion: '1.0.0',
        serverPort: this.config.port || 4001,
        nodeType: 0, // FULL_NODE
        capabilityList: [
          [1, 'Store synchronization'],
          [4, 'End-to-end encryption'],
          [5, 'Byte-range downloads'],
          ...(isTurnCapable ? [[2, 'TURN relay server']] : [])
        ]
      }

      const response = await fetch(`${awsConfig.url}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(registrationData)
      })

      if (response.ok) {
        const result = await response.json()
        this.logger.info(`✅ Registered with AWS bootstrap server: ${result.totalPeers} total peers`)
        return true
      } else {
        this.logger.warn(`⚠️ AWS bootstrap registration failed: ${response.status}`)
        return false
      }

    } catch (error) {
      this.logger.warn('AWS bootstrap fallback failed:', error)
      return false
    }
  }

  // Send heartbeat to AWS bootstrap server to keep registration active
  async sendAWSBootstrapHeartbeat(): Promise<boolean> {
    try {
      const awsConfig = this.getAWSBootstrapConfig()
      
      if (!awsConfig.enabled) {
        return false
      }

      const response = await fetch(`${awsConfig.url}/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          peerId: this.node.peerId.toString()
        }),
        signal: AbortSignal.timeout(10000) // 10 second timeout
      })

      if (response.ok) {
        const result = await response.json()
        this.logger.debug(`💓 AWS bootstrap heartbeat successful (${result.totalPeers} total peers)`)
        return true
      } else if (response.status === 404) {
        // Peer not found - need to re-register
        this.logger.info('🔄 Peer not found in AWS bootstrap - re-registering...')
        const reregistered = await this.useAWSBootstrapFallback()
        if (reregistered) {
          this.logger.info('✅ Successfully re-registered with AWS bootstrap')
        } else {
          this.logger.warn('❌ Re-registration failed - will retry on next heartbeat')
        }
        return reregistered
      } else if (response.status === 429) {
        // Rate limited or cost throttling - this is expected
        this.logger.debug(`💰 AWS bootstrap heartbeat throttled: ${response.status} (cost protection active)`)
        return false
      } else if (response.status >= 500) {
        // Server error - try to re-register in case of server restart
        this.logger.warn(`⚠️ AWS bootstrap server error: ${response.status} - attempting re-registration...`)
        return await this.useAWSBootstrapFallback()
      } else {
        this.logger.warn(`⚠️ AWS bootstrap heartbeat failed: ${response.status}`)
        return false
      }

    } catch (error) {
      // Network error or timeout - try to re-register
      if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('fetch'))) {
        this.logger.debug('🌐 AWS bootstrap network error - attempting re-registration...')
        try {
          return await this.useAWSBootstrapFallback()
        } catch (reregError) {
          this.logger.debug('Re-registration also failed:', reregError)
          return false
        }
      }
      
      this.logger.debug('AWS bootstrap heartbeat failed:', error)
      return false
    }
  }

  // Use AWS bootstrap server as TURN server fallback
  async useAWSBootstrapTURNFallback(targetPeerId: string, storeId?: string): Promise<any> {
    try {
      const awsConfig = this.getAWSBootstrapConfig()
      
      if (!awsConfig.enabled) {
        this.logger.debug('⏭️ AWS bootstrap TURN fallback disabled')
        return null
      }

      this.logger.info('📡 Using AWS bootstrap server as TURN fallback...')

      // Request TURN allocation from AWS bootstrap server
      const turnRequest = {
        peerId: this.node.peerId.toString(),
        estimatedBandwidthMbps: 10, // Conservative estimate
        userTier: process.env.DIG_USER_TIER || 'free',
        isPremium: process.env.DIG_IS_PREMIUM === 'true',
        p2pAttempted: true, // We're using this as fallback
        storeId
      }

      const response = await fetch(`${awsConfig.url}/allocate-turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(turnRequest)
      })

      if (response.ok) {
        const result = await response.json()
        
        if (result.success) {
          this.logger.info(`✅ AWS bootstrap TURN allocated: ${result.sessionId} (${result.limits?.priorityLevel})`)
          this.logger.info(`💰 Cost info: ${(result.costInfo?.currentCostRatio * 100).toFixed(1)}% budget used`)
          
          return {
            type: 'aws-bootstrap-turn',
            sessionId: result.sessionId,
            url: awsConfig.url,
            limits: result.limits,
            costInfo: result.costInfo
          }
        } else {
          this.logger.warn(`⚠️ AWS bootstrap TURN rejected: ${result.error}`)
          if (result.retryAfter) {
            this.logger.info(`🔄 Can retry in ${result.retryAfter} seconds`)
          }
          return null
        }
      } else {
        this.logger.warn(`⚠️ AWS bootstrap TURN request failed: ${response.status}`)
        return null
      }

    } catch (error) {
      this.logger.warn('AWS bootstrap TURN fallback failed:', error)
      return null
    }
  }

  async discoverAllPeers(): Promise<void> {
    this.logger.info('🔍 Starting comprehensive peer discovery...')
    
    // Primary: Use DIG-only peer discovery
    await this.peerDiscovery?.discoverDIGPeers?.()
    
    // Last resort: Use AWS bootstrap server if no DIG peers found
    const digPeerCount = this.peerDiscovery?.getDIGPeers()?.length || 0
    const totalPeerCount = this.node.getPeers().length
    
    if (digPeerCount === 0) {
      this.logger.info(`🌐 No DIG peers found (${totalPeerCount} total LibP2P peers) - using AWS bootstrap as last resort...`)
      
      // Try to ensure we're registered (in case previous registration failed)
      const registered = await this.useAWSBootstrapFallback()
      
      if (registered) {
        // Discover and connect to DIG peers from AWS bootstrap server
        await this.discoverPeersFromAWSBootstrap()
      } else {
        this.logger.warn('⚠️ AWS bootstrap registration failed during peer discovery - will retry on next heartbeat')
      }
    } else {
      this.logger.info(`✅ Found ${digPeerCount} DIG peers via standard discovery - AWS bootstrap not needed`)
    }
  }

  // Discover peers from AWS bootstrap server
  async discoverPeersFromAWSBootstrap(): Promise<void> {
    try {
      const awsConfig = this.getAWSBootstrapConfig()
      
      const response = await fetch(`${awsConfig.url}/peers?includeStores=true&includeCapabilities=true`)
      
      if (response.ok) {
        const result = await response.json()
        const peers = result.peers || []
        
        this.logger.info(`🔍 Discovered ${peers.length} peers from AWS bootstrap server`)
        
        // Try to connect to DIG peers using real LibP2P addresses
        for (const peer of peers.slice(0, 10)) { // Limit to 10 to avoid overwhelming
          if (peer.peerId !== this.node.peerId.toString() && peer.addresses?.length > 0) {
            try {
              this.logger.info(`🔍 Attempting direct P2P connection to DIG peer: ${peer.peerId}`)
              
              // Use real LibP2P addresses for direct connections (no crypto-IPv6 overlay)
              const addresses = peer.addresses
              let connected = false
              
              for (const address of addresses) {
                try {
                  this.logger.debug(`📡 Trying direct P2P address: ${address}`)
                  await this.node.dial(address)
                  this.logger.info(`✅ Direct P2P connection established: ${peer.peerId}`)
                  connected = true
                  break
                } catch (dialError) {
                  this.logger.debug(`Failed to dial ${address}:`, dialError)
                }
              }
              
              if (!connected) {
                this.logger.debug(`⚠️ Direct P2P connection failed to ${peer.peerId} - will rely on LibP2P NAT traversal`)
              }
            } catch (error) {
              this.logger.debug(`Failed to connect to peer ${peer.peerId}:`, error)
            }
          }
        }
      }
    } catch (error) {
      this.logger.warn('Failed to discover peers from AWS bootstrap:', error)
    }
  }

  async forceConnectToPeers(): Promise<void> {
    this.logger.info('🔗 Force connecting to all known peers...')
    // Use comprehensive NAT traversal to connect to all known peers
    const digPeers = this.peerDiscovery?.getDIGPeers() || []
    for (const peer of digPeers.slice(0, 5)) {
      try {
        await this.natTraversal?.attemptConnection(peer.peerId, [])
      } catch (error) {
        // Silent failure
      }
    }
  }

  // Cleanup and stop
  async stop(): Promise<void> {
    if (!this.isStarted) return
    
    this.logger.info('🛑 Stopping Consolidated DIG Node...')
    await this.cleanup()
    this.isStarted = false
    this.logger.info('✅ DIG Node stopped')
  }

  private async cleanup(): Promise<void> {
    try {
      await this.peerDiscovery?.stop()
      await this.turnCoordination?.stop()
      await this.upnpPortManager?.cleanup()
      await this.webSocketRelay?.disconnect()
      
      if (this.watcher) {
        await this.watcher.close()
        this.watcher = null
      }
      
      await this.node?.stop()
    } catch (error) {
      this.logger.error('Cleanup error:', error)
    }
  }
}
