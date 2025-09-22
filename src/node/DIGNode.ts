import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { kadDHT } from '@libp2p/kad-dht'
import { bootstrap } from '@libp2p/bootstrap'
import { mdns } from '@libp2p/mdns'
import { ping } from '@libp2p/ping'
import { identify } from '@libp2p/identify'
import { pipe } from 'it-pipe'
import { multiaddr } from '@multiformats/multiaddr'
import { uPnPNAT } from '@libp2p/upnp-nat'
import { autoNAT } from '@libp2p/autonat'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { webRTC } from '@libp2p/webrtc'
import { webSockets } from '@libp2p/websockets'
import { all } from '@libp2p/websockets/filters'
import { toString as uint8ArrayToString } from 'uint8arrays/to-string'
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string'
import { randomBytes } from 'crypto'
import { readFile, readdir, stat, watch, writeFile } from 'fs/promises'
import { join, basename } from 'path'
import { homedir } from 'os'
// Removed JSZip import - we're serving .dig files as binary data
import type { Stream } from '@libp2p/interface'
import type { Libp2p } from 'libp2p'

import { 
  DIGFile, 
  DIGNodeConfig, 
  DIGRequest, 
  DIGResponse, 
  DiscoveryRequest, 
  DiscoveryResponse,
  DIG_PROTOCOL, 
  DIG_DISCOVERY_PROTOCOL 
} from './types'
import { generateCryptoIPv6, parseURN, guessMimeType } from './utils'
import { Logger } from './logger'
import { GlobalDiscovery } from './GlobalDiscovery'

export class DIGNode {
  private node!: Libp2p
  private digFiles = new Map<string, DIGFile>()
  private digPath: string
  private cryptoIPv6!: string
  private watcher: any = null
  private syncInterval: NodeJS.Timeout | null = null
  private discoveredPeers = new Set<string>()
  private peerStores = new Map<string, Set<string>>() // peerId -> Set of storeIds
  private syncInProgress = false
  private isStarted = false
  private logger = new Logger('DIGNode')
  private startTime: number = 0
  private globalDiscovery!: GlobalDiscovery
  private requestCounts = new Map<string, { count: number; lastReset: number }>()
  private readonly MAX_REQUESTS_PER_MINUTE = 100
  private metrics = {
    filesLoaded: 0,
    filesShared: 0,
    peersConnected: 0,
    syncAttempts: 0,
    syncSuccesses: 0,
    downloadAttempts: 0,
    downloadSuccesses: 0,
    errors: 0
  }
  
  constructor(private config: DIGNodeConfig = {}) {
    // Validate and set configuration
    this.validateConfig(config)
    this.digPath = config.digPath || join(homedir(), '.dig')
  }

  async start(): Promise<void> {
    if (this.isStarted) {
      throw new Error('DIG Node is already started')
    }

    try {
      this.startTime = Date.now()
      const publicKey = this.config.publicKey || randomBytes(32).toString('hex')
      this.cryptoIPv6 = generateCryptoIPv6(publicKey)

      this.logger.info(`🚀 Starting DIG Node...`)
      this.logger.info(`🌐 Crypto IPv6: ${this.cryptoIPv6}`)
      this.logger.info(`📁 DIG Path: ${this.digPath}`)
      this.logger.debug(`🔧 Config:`, this.config)

    const peerDiscoveryServices = []
    
    // Add bootstrap discovery if configured
    if (this.config.bootstrapPeers && this.config.bootstrapPeers.length > 0) {
      peerDiscoveryServices.push(bootstrap({
        list: this.config.bootstrapPeers
      }))
    } else {
      // Add default LibP2P bootstrap nodes for relay discovery
      peerDiscoveryServices.push(bootstrap({
        list: [
          '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
          '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa'
        ]
      }))
    }
    
    // Add mDNS for local network discovery (can be disabled)
    if (this.config.enableMdns !== false) {
      peerDiscoveryServices.push(mdns())
    }

    const services: any = {
      ping: ping(),
      identify: identify()
    }
    
    // Add DHT service if enabled (default: true)
    if (this.config.enableDht !== false) {
      services.dht = kadDHT({
        clientMode: false, // Run as DHT server
        validators: {},
        selectors: {}
      })
    }

    this.node = await createLibp2p({
      addresses: {
        listen: [
          `/ip4/0.0.0.0/tcp/${this.config.port || 0}`,
          `/ip6/::/tcp/${this.config.port || 0}`,
          `/ip4/0.0.0.0/tcp/${(this.config.port || 0) + 1}/ws` // WebSocket for NAT traversal
        ]
      },
      transports: [
        tcp(),
        webSockets({ filter: all }), // WebSockets for NAT traversal
        webRTC({
          rtcConfiguration: {
            iceServers: [
              { urls: ['stun:stun.l.google.com:19302'] },
              { urls: ['stun:stun1.l.google.com:19302'] },
              { urls: ['stun:stun2.l.google.com:19302'] },
              { urls: ['stun:global.stun.twilio.com:3478'] }
            ]
          }
        }), // WebRTC with STUN servers for NAT traversal
        circuitRelayTransport() // Circuit relay for fallback
      ],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      peerDiscovery: peerDiscoveryServices,
      services: {
        ...services,
        upnp: uPnPNAT(), // UPnP NAT traversal
        autonat: autoNAT() // Automatic NAT detection
      },
      connectionManager: {
        maxConnections: 100,
        dialTimeout: 60000, // Increase to 60s for NAT traversal
        maxParallelDials: 10
      }
    })

    await this.node.handle(DIG_PROTOCOL, this.handleDIGRequest.bind(this))
    await this.node.handle(DIG_DISCOVERY_PROTOCOL, this.handleDiscoveryRequest.bind(this))

      await this.scanDIGFiles()
      await this.announceStores()
      await this.startFileWatcher()
      this.startPeerDiscovery()
      this.startStoreSync()
      await this.startGlobalDiscovery()
      await this.connectToConfiguredPeers()

      this.isStarted = true
      console.log(`✅ DIG Node started successfully`)
      console.log(`🆔 Peer ID: ${this.node.peerId.toString()}`)
      console.log(`📁 Available stores: ${this.digFiles.size}`)
      console.log(`🔄 Peer discovery and store sync enabled`)
    } catch (error) {
      this.metrics.errors++
      console.error(`❌ Failed to start DIG Node:`, error)
      await this.cleanup()
      throw error
    }
  }

  async stop(): Promise<void> {
    if (!this.isStarted) {
      console.warn('DIG Node is not started')
      return
    }

    console.log('🛑 Stopping DIG Node...')
    await this.cleanup()
    this.isStarted = false
    console.log('✅ DIG Node stopped successfully')
  }

  private async cleanup(): Promise<void> {
    if (this.syncInterval) {
      clearInterval(this.syncInterval)
      this.syncInterval = null
    }
    
    if (this.globalDiscovery) {
      try {
        await this.globalDiscovery.stop()
      } catch (error) {
        this.logger.warn('Error stopping global discovery:', error)
      }
    }
    
    if (this.watcher) {
      try {
        await this.watcher.close()
      } catch (error) {
        // Watcher might not have a close method or might already be closed
        console.log('📁 File watcher closed')
      }
      this.watcher = null
    }
    
    if (this.node) {
      try {
        await this.node.stop()
      } catch (error) {
        console.error('Error stopping LibP2P node:', error)
      }
    }
  }

  // Validate configuration
  private validateConfig(config: DIGNodeConfig): void {
    if (config.port && (config.port < 1 || config.port > 65535)) {
      throw new Error('Port must be between 1 and 65535')
    }
    
    if (config.publicKey && !/^[a-fA-F0-9]+$/.test(config.publicKey)) {
      throw new Error('Public key must be a valid hex string')
    }
    
    if (config.privateKey && !/^[a-fA-F0-9]+$/.test(config.privateKey)) {
      throw new Error('Private key must be a valid hex string')
    }
    
    if (config.bootstrapPeers && !Array.isArray(config.bootstrapPeers)) {
      throw new Error('Bootstrap peers must be an array')
    }
  }

  // Validate store ID format
  private validateStoreId(storeId: string): boolean {
    return typeof storeId === 'string' && 
           /^[a-fA-F0-9]+$/.test(storeId) && 
           storeId.length >= 32 && 
           storeId.length <= 128
  }

  // Sanitize file path to prevent directory traversal
  private sanitizeFilePath(filePath: string): string {
    if (!filePath || typeof filePath !== 'string') {
      return ''
    }
    
    // Remove any directory traversal attempts
    return filePath.replace(/\.\./g, '').replace(/[\\\/]/g, '/').replace(/^\/+/, '')
  }

  // Get node metrics
  getMetrics(): any {
    return {
      ...this.metrics,
      uptime: this.isStarted ? Date.now() - this.startTime : 0,
      storesCount: this.digFiles.size,
      peersCount: this.discoveredPeers.size,
      isStarted: this.isStarted,
      successRate: this.metrics.downloadAttempts > 0 ? 
        (this.metrics.downloadSuccesses / this.metrics.downloadAttempts) * 100 : 0,
      syncSuccessRate: this.metrics.syncAttempts > 0 ? 
        (this.metrics.syncSuccesses / this.metrics.syncAttempts) * 100 : 0
    }
  }

  // Get detailed node status
  getStatus(): any {
    return {
      isStarted: this.isStarted,
      peerId: this.node?.peerId?.toString(),
      cryptoIPv6: this.cryptoIPv6,
      digPath: this.digPath,
      stores: Array.from(this.digFiles.keys()),
      connectedPeers: this.node ? this.node.getPeers().map(p => p.toString()) : [],
      discoveredPeers: Array.from(this.discoveredPeers),
      metrics: this.getMetrics(),
      addresses: this.node ? this.node.getMultiaddrs().map(addr => addr.toString()) : []
    }
  }

  // Scan ~/.dig directory for .dig files
  private async scanDIGFiles(): Promise<void> {
    try {
      const files = await readdir(this.digPath)
      
      for (const file of files) {
        if (file.endsWith('.dig')) {
          await this.loadDIGFile(join(this.digPath, file))
        }
      }
      
      console.log(`Loaded ${this.digFiles.size} .dig files`)
    } catch (error) {
      console.warn(`Could not scan DIG directory ${this.digPath}:`, error)
    }
  }

  private async loadDIGFile(filePath: string): Promise<void> {
    try {
      const storeId = basename(filePath, '.dig')
      const fileContent = await readFile(filePath)
      const fileStats = await stat(filePath)
      
      const metadata = {
        name: storeId,
        size: fileContent.length,
        created: fileStats.birthtime.toISOString(),
        mimeType: 'application/x-dig-archive'
      }

      this.digFiles.set(storeId, {
        storeId,
        filePath,
        content: fileContent,
        metadata
      })

      this.metrics.filesLoaded++
      console.log(`✅ Loaded DIG file: ${storeId} (${metadata.size} bytes)`)
    } catch (error) {
      this.metrics.errors++
      console.error(`❌ Failed to load .dig file ${filePath}:`, error)
    }
  }

  // Rate limiting for peer requests
  private isRateLimited(peerId: string): boolean {
    const now = Date.now()
    const peerData = this.requestCounts.get(peerId)
    
    if (!peerData) {
      this.requestCounts.set(peerId, { count: 1, lastReset: now })
      return false
    }
    
    // Reset counter every minute
    if (now - peerData.lastReset > 60000) {
      peerData.count = 1
      peerData.lastReset = now
      return false
    }
    
    peerData.count++
    return peerData.count > this.MAX_REQUESTS_PER_MINUTE
  }

  // Handle DIG protocol requests
  private async handleDIGRequest({ stream }: { stream: Stream }): Promise<void> {
    const self = this;
    const peerId = stream.id || 'unknown'
    
    // Rate limiting
    if (this.isRateLimited(peerId)) {
      this.logger.warn(`Rate limited peer: ${peerId}`)
      try {
        await stream.close()
      } catch (error) {
        // Ignore close errors
      }
      return
    }
    
    try {
      await pipe(
        stream,
        async function* (source: any) {
          for await (const chunk of source) {
            let request: any
            try {
              request = JSON.parse(uint8ArrayToString(chunk.subarray()))
            } catch (parseError) {
              self.logger.warn(`Invalid JSON request from peer ${peerId}`)
              return
            }
            
            // Validate request structure
            if (!request.type || typeof request.type !== 'string') {
              self.logger.warn(`Invalid request type from peer ${peerId}`)
              return
            }
            
            if (request.type === 'GET_FILE') {
              const { storeId, filePath } = request
              if (self.validateStoreId(storeId) && filePath) {
                yield* self.serveFileFromStore(storeId, filePath)
              } else {
                self.logger.warn(`Invalid GET_FILE request from peer ${peerId}`)
              }
            } else if (request.type === 'GET_URN') {
              const { urn } = request
              if (urn && typeof urn === 'string') {
                yield* self.serveFileFromURN(urn)
              } else {
                self.logger.warn(`Invalid GET_URN request from peer ${peerId}`)
              }
            } else if (request.type === 'GET_STORE_CONTENT') {
              const { storeId } = request
              if (self.validateStoreId(storeId)) {
                yield* self.serveFileFromStore(storeId, '')
              } else {
                self.logger.warn(`Invalid GET_STORE_CONTENT request from peer ${peerId}`)
              }
            } else if (request.type === 'GET_STORE_FILES') {
              const { storeId } = request
              if (storeId) {
                const digFile = self.digFiles.get(storeId)
                
                if (digFile) {
                  const response: DIGResponse = {
                    success: true,
                    storeId,
                    files: [storeId + '.dig'], // The store contains the single .dig file
                    metadata: digFile.metadata
                  }
                  yield uint8ArrayFromString(JSON.stringify(response))
                } else {
                  const response: DIGResponse = {
                    success: false,
                    error: 'Store not found'
                  }
                  yield uint8ArrayFromString(JSON.stringify(response))
                }
              }
            }
            break
          }
        },
        stream
      )
    } catch (error) {
      console.error('Error handling DIG request:', error)
    }
  }

  // Serve file from URN
  private async *serveFileFromURN(urn: string): AsyncGenerator<Uint8Array> {
    const parsed = parseURN(urn)
    if (!parsed) {
      const response: DIGResponse = {
        success: false,
        error: 'Invalid URN format. Expected: urn:dig:chia:{storeID}:{optional roothash}/{optional resource key}'
      }
      yield uint8ArrayFromString(JSON.stringify(response))
      return
    }
    
    const { storeId, filePath, rootHash } = parsed
    
    if (!this.digFiles.has(storeId)) {
      const response: DIGResponse = {
        success: false,
        error: `Store not found: ${storeId}`
      }
      yield uint8ArrayFromString(JSON.stringify(response))
      return
    }
    
    // TODO: Implement rootHash version checking
    if (rootHash) {
      console.warn(`Root hash versioning not yet implemented. Serving latest version of store ${storeId}`)
    }
    
    yield* this.serveFileFromStore(storeId, filePath)
  }

  // Serve file from store - serves the entire .dig file as binary data
  private async *serveFileFromStore(storeId: string, filePath: string): AsyncGenerator<Uint8Array> {
    const digFile = this.digFiles.get(storeId)
    
    if (!digFile) {
      const response: DIGResponse = {
        success: false,
        error: 'Store not found'
      }
      yield uint8ArrayFromString(JSON.stringify(response))
      return
    }

    // For .dig files, we serve the entire file regardless of the requested filePath
    // The filePath is ignored since we're serving the complete .dig archive
    try {
      const content = digFile.content
      const mimeType = digFile.metadata.mimeType
      
      // Send metadata first
      const response: DIGResponse = {
        success: true,
        size: content.length,
        mimeType
      }
      yield uint8ArrayFromString(JSON.stringify(response))
      
      // Send file content in chunks
      const CHUNK_SIZE = 64 * 1024
      for (let i = 0; i < content.length; i += CHUNK_SIZE) {
        yield content.subarray(i, i + CHUNK_SIZE)
      }
    } catch (error) {
      const response: DIGResponse = {
        success: false,
        error: `Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
      yield uint8ArrayFromString(JSON.stringify(response))
    }
  }

  private async handleDiscoveryRequest({ stream }: { stream: Stream }): Promise<void> {
    const self = this;
    try {
      await pipe(
        stream,
        async function* (source: any) {
          for await (const chunk of source) {
            const request: any = JSON.parse(uint8ArrayToString(chunk.subarray()))
            
            if (request.type === 'FIND_STORE') {
              const { storeId } = request
              
              const response: DiscoveryResponse = {
                success: true,
                peerId: self.node.peerId.toString(),
                cryptoIPv6: self.cryptoIPv6,
                hasStore: self.digFiles.has(storeId)
              }
              yield uint8ArrayFromString(JSON.stringify(response))
            } else if (request.type === 'LIST_STORES') {
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
      console.error('Error handling discovery request:', error)
    }
  }

  private async announceStores(): Promise<void> {
    for (const storeId of this.digFiles.keys()) {
      await this.announceStore(storeId)
    }
  }

  private async announceStore(storeId: string): Promise<void> {
    try {
      const key = uint8ArrayFromString(`/dig-store/${storeId}`)
      const value = uint8ArrayFromString(JSON.stringify({
        peerId: this.node.peerId.toString(),
        cryptoIPv6: this.cryptoIPv6,
        timestamp: Date.now()
      }))
      
      const dht = this.node.services.dht as any;
      if (dht && dht.put) {
        await dht.put(key, value)
      }
    } catch (error) {
      console.error(`Failed to announce store ${storeId}:`, error)
    }
  }

  // Public API methods
  getAvailableStores(): string[] {
    return Array.from(this.digFiles.keys())
  }

  hasStore(storeId: string): boolean {
    return this.digFiles.has(storeId)
  }

  getCryptoIPv6(): string {
    return this.cryptoIPv6
  }

  getNode(): Libp2p {
    return this.node
  }

  async rescanDIGFiles(): Promise<void> {
    if (!this.isStarted) {
      throw new Error('DIG Node is not started')
    }
    
    this.logger.info('🔄 Rescanning DIG files...')
    const oldCount = this.digFiles.size
    this.digFiles.clear()
    await this.scanDIGFiles()
    await this.announceStores()
    
    const newCount = this.digFiles.size
    this.logger.info(`✅ Rescan complete: ${oldCount} -> ${newCount} stores`)
  }

  // Health check
  isHealthy(): boolean {
    return this.isStarted && 
           this.node !== undefined && 
           this.cryptoIPv6 !== undefined
  }

  // Get network health
  getNetworkHealth(): any {
    const connectedPeers = this.node ? this.node.getPeers().length : 0
    const totalPeersDiscovered = this.discoveredPeers.size
    
    return {
      isHealthy: this.isHealthy(),
      connectedPeers,
      totalPeersDiscovered,
      storesShared: this.digFiles.size,
      syncInProgress: this.syncInProgress,
      lastSyncSuccess: this.metrics.syncSuccesses > 0,
      errorRate: this.metrics.errors / Math.max(1, this.metrics.syncAttempts + this.metrics.downloadAttempts)
    }
  }

  async findStorePeers(storeId: string): Promise<any[]> {
    try {
      const key = uint8ArrayFromString(`/dig-store/${storeId}`)
      const peers = []
      
      const dht = this.node.services.dht as any;
      if (dht && dht.get) {
        for await (const event of dht.get(key)) {
          if (event.name === 'VALUE') {
            try {
              const peerInfo = JSON.parse(uint8ArrayToString(event.value))
              peers.push(peerInfo)
            } catch (error) {
              console.warn('Failed to parse peer info:', error)
            }
          }
        }
      }
      
      return peers
    } catch (error) {
      console.error(`Failed to find peers for store ${storeId}:`, error)
      return []
    }
  }

  // Start watching the .dig directory for changes
  private async startFileWatcher(): Promise<void> {
    try {
      console.log(`🔍 Starting file watcher for ${this.digPath}`)
      
      this.watcher = watch(this.digPath, { recursive: false })
      
      // Run watcher in background without blocking
      this.runFileWatcher()
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        console.warn(`📁 DIG directory ${this.digPath} does not exist, creating it...`)
        try {
          const { mkdir } = await import('fs/promises')
          await mkdir(this.digPath, { recursive: true })
          console.log(`✅ Created DIG directory: ${this.digPath}`)
          // Restart watcher after creating directory
          await this.startFileWatcher()
        } catch (mkdirError) {
          console.error(`❌ Failed to create DIG directory:`, mkdirError)
        }
      } else {
        console.error(`❌ File watcher error:`, error)
      }
    }
  }

  // Run the file watcher loop in background
  private async runFileWatcher(): Promise<void> {
    try {
      for await (const event of this.watcher) {
        await this.handleFileSystemEvent(event)
      }
    } catch (error) {
      if (this.watcher) {
        console.error(`❌ File watcher loop error:`, error)
        // Try to restart watcher after a delay
        setTimeout(() => this.startFileWatcher(), 5000)
      }
    }
  }

  // Handle file system events
  private async handleFileSystemEvent(event: any): Promise<void> {
    if (!event.filename || !event.filename.endsWith('.dig')) {
      return // Only process .dig files
    }

    const filePath = join(this.digPath, event.filename)
    const storeId = basename(event.filename, '.dig')

    try {
      if (event.eventType === 'rename') {
        // File was added or removed
        try {
          await stat(filePath)
          // File exists, so it was added or modified
          await this.addOrUpdateStore(filePath, storeId)
        } catch (statError) {
          // File doesn't exist, so it was removed
          await this.removeStore(storeId)
        }
      } else if (event.eventType === 'change') {
        // File was modified
        try {
          await stat(filePath)
          await this.addOrUpdateStore(filePath, storeId)
        } catch (statError) {
          // File might have been deleted during modification
          await this.removeStore(storeId)
        }
      }
    } catch (error) {
      console.error(`❌ Error handling file system event for ${event.filename}:`, error)
    }
  }

  // Add or update a store
  private async addOrUpdateStore(filePath: string, storeId: string): Promise<void> {
    const wasExisting = this.digFiles.has(storeId)
    await this.loadDIGFile(filePath)
    
    if (this.digFiles.has(storeId)) {
      await this.announceStore(storeId)
      
      if (wasExisting) {
        console.log(`🔄 Updated store: ${storeId}`)
      } else {
        console.log(`➕ Added new store: ${storeId}`)
      }
    }
  }

  // Remove a store
  private async removeStore(storeId: string): Promise<void> {
    if (this.digFiles.has(storeId)) {
      this.digFiles.delete(storeId)
      console.log(`➖ Removed store: ${storeId}`)
      
      // TODO: Announce removal to DHT (if supported by the protocol)
      // For now, we just remove it locally and it will naturally expire from DHT
    }
  }

  // Start peer discovery
  private startPeerDiscovery(): void {
    console.log(`🔍 Starting peer discovery...`)
    
    // Listen for peer connection events
    this.node.addEventListener('peer:connect', (event) => {
      const peerId = event.detail.toString()
      this.discoveredPeers.add(peerId)
      this.metrics.peersConnected++
      this.logger.info(`🤝 Connected to peer: ${peerId}`)
      this.logger.info(`📊 Total connected peers: ${this.node.getPeers().length}`)
      
      // Discover stores from this peer
      this.discoverPeerStores(peerId).catch(error => {
        this.metrics.errors++
        this.logger.warn(`❌ Failed to discover stores from peer ${peerId}:`, error)
      })
    })

    this.node.addEventListener('peer:disconnect', (event) => {
      const peerId = event.detail.toString()
      this.discoveredPeers.delete(peerId)
      this.peerStores.delete(peerId)
      this.logger.info(`👋 Disconnected from peer: ${peerId}`)
      this.logger.info(`📊 Remaining connected peers: ${this.node.getPeers().length}`)
    })
  }

  // Start store synchronization
  private startStoreSync(): void {
    console.log(`🔄 Starting store synchronization (every 30 seconds)...`)
    
    // Run initial sync after 5 seconds
    setTimeout(() => this.syncStores(), 5000)
    
    // Run periodic sync every 30 seconds
    this.syncInterval = setInterval(() => {
      this.syncStores().catch(error => {
        console.error(`Sync error:`, error)
      })
    }, 30000)
  }

  // Discover stores from a specific peer
  private async discoverPeerStores(peerId: string): Promise<void> {
    try {
      const peer = this.node.getPeers().find(p => p.toString() === peerId)
      if (!peer) return

      // Try to open a stream to the peer for discovery
      const stream = await this.node.dialProtocol(peer, DIG_DISCOVERY_PROTOCOL)
      
      const request = {
        type: 'LIST_STORES'
      }

      // Send discovery request
      const self = this;
      await pipe(
        [uint8ArrayFromString(JSON.stringify(request))],
        stream,
        async function (source: any) {
          const chunks: Uint8Array[] = []
          for await (const chunk of source) {
            chunks.push(chunk)
          }
          
          if (chunks.length > 0) {
            try {
              const response = JSON.parse(uint8ArrayToString(chunks[0]))
              if (response.success && response.stores) {
                const peerStores = new Set<string>(response.stores)
                self.peerStores.set(peerId, peerStores)
                console.log(`📋 Peer ${peerId} has ${response.stores.length} stores`)
              }
            } catch (parseError) {
              console.warn(`Failed to parse peer stores response:`, parseError)
            }
          }
        }
      )
    } catch (error) {
      console.warn(`Failed to discover stores from peer ${peerId}:`, error)
    }
  }

  // Synchronize stores with all peers
  private async syncStores(): Promise<void> {
    if (this.syncInProgress) {
      console.log(`⏳ Sync already in progress, skipping...`)
      return
    }

    this.syncInProgress = true
    this.metrics.syncAttempts++
    console.log(`🔄 Starting store synchronization...`)

    try {
      const connectedPeers = this.node.getPeers()
      console.log(`👥 Connected to ${connectedPeers.length} peers`)

      // Discover stores from all connected peers
      for (const peer of connectedPeers) {
        await this.discoverPeerStores(peer.toString())
      }

      // Find missing stores
      const allRemoteStores = new Set<string>()
      for (const [peerId, stores] of this.peerStores) {
        for (const storeId of stores) {
          allRemoteStores.add(storeId)
        }
      }

      const missingStores = Array.from(allRemoteStores).filter(
        storeId => !this.digFiles.has(storeId)
      )

      if (missingStores.length > 0) {
        console.log(`📥 Found ${missingStores.length} missing stores to download`)
        
        // Download missing stores
        for (const storeId of missingStores) {
          await this.downloadStoreFromPeers(storeId)
        }
        this.metrics.syncSuccesses++
      } else {
        console.log(`✅ All stores synchronized (${this.digFiles.size} total)`)
        this.metrics.syncSuccesses++
      }

    } catch (error) {
      this.metrics.errors++
      console.error(`❌ Store sync error:`, error)
    } finally {
      this.syncInProgress = false
    }
  }

  // Download a store from any available peer
  private async downloadStoreFromPeers(storeId: string): Promise<void> {
    this.metrics.downloadAttempts++
    console.log(`📥 Downloading store: ${storeId}`)

    // Find peers that have this store
    const availablePeers = []
    for (const [peerId, stores] of this.peerStores) {
      if (stores.has(storeId)) {
        const peer = this.node.getPeers().find(p => p.toString() === peerId)
        if (peer) {
          availablePeers.push({ peerId, peer })
        }
      }
    }

    if (availablePeers.length === 0) {
      console.warn(`❌ No peers available for store ${storeId}`)
      return
    }

    // Try to download from the first available peer
    for (const { peerId, peer } of availablePeers) {
      try {
        console.log(`📡 Downloading ${storeId} from peer ${peerId}`)
        
        const stream = await this.node.dialProtocol(peer, DIG_PROTOCOL)
        
        const request = {
          type: 'GET_STORE_CONTENT',
          storeId: storeId
        }

        const chunks: Uint8Array[] = []
        let metadata: any = null
        let isFirstChunk = true

        await pipe(
          [uint8ArrayFromString(JSON.stringify(request))],
          stream,
          async function (source: any) {
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
                  // If parsing fails, treat as binary data
                  chunks.push(chunk)
                }
              } else {
                chunks.push(chunk)
              }
            }
          }
        )

        if (chunks.length > 0) {
          // Combine all chunks
          const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
          const content = new Uint8Array(totalLength)
          let offset = 0
          for (const chunk of chunks) {
            content.set(chunk, offset)
            offset += chunk.length
          }

          // Save the downloaded store
          const filePath = join(this.digPath, `${storeId}.dig`)
          await writeFile(filePath, Buffer.from(content))
          
          // Load it into our stores
          await this.loadDIGFile(filePath)
          
          if (this.digFiles.has(storeId)) {
            await this.announceStore(storeId)
            this.metrics.downloadSuccesses++
            this.metrics.filesShared++
            console.log(`✅ Downloaded and loaded store: ${storeId} (${content.length} bytes)`)
            return // Success, no need to try other peers
          }
        }
        
      } catch (error) {
        console.warn(`❌ Failed to download ${storeId} from peer ${peerId}:`, error)
        // Continue to try next peer
      }
    }
    
    console.warn(`❌ Failed to download store ${storeId} from all available peers`)
  }

  // Start global discovery system
  private async startGlobalDiscovery(): Promise<void> {
    try {
      const addresses = this.node.getMultiaddrs().map(addr => addr.toString())
      
      this.globalDiscovery = new GlobalDiscovery(
        this.node.peerId.toString(),
        addresses,
        this.cryptoIPv6,
        () => this.getAvailableStores(),
        this.config.discoveryServers
      )
      
      await this.globalDiscovery.start()
      
      // Also announce to DHT for global discovery
      const dht = this.node.services.dht as any
      if (dht) {
        await this.globalDiscovery.announceToGlobalDHT(dht)
      }
      
      this.logger.info('🌍 Global discovery started')
      
      // Periodically try to connect to discovered peers
      setInterval(async () => {
        try {
          await this.connectToDiscoveredPeers()
        } catch (error) {
          this.logger.debug('Periodic peer connection failed:', error)
        }
      }, 30000) // Every 30 seconds (more frequent)

      // Also try connecting immediately after discovery
      setTimeout(async () => {
        try {
          await this.connectToDiscoveredPeers()
        } catch (error) {
          this.logger.debug('Initial peer connection failed:', error)
        }
      }, 10000) // After 10 seconds
      
    } catch (error) {
      this.logger.warn('Failed to start global discovery:', error)
    }
  }

  // Connect to peers discovered through global discovery
  private async connectToDiscoveredPeers(): Promise<void> {
    if (!this.globalDiscovery) return
    
    const knownAddresses = this.globalDiscovery.getKnownPeerAddresses()
    const currentPeers = new Set(this.node.getPeers().map(p => p.toString()))
    
    this.logger.debug(`🔍 Attempting to connect to ${knownAddresses.length} discovered addresses`)
    
    // Try to connect to new peers
    for (const address of knownAddresses.slice(0, 5)) { // Reduce to 5 attempts per round
      try {
        this.logger.debug(`🔗 Attempting connection to: ${address}`)
        
        // Extract peer ID from address string (multiaddr format: .../p2p/PEER_ID)
        const peerIdMatch = address.match(/\/p2p\/([^\/]+)$/)
        const peerIdFromAddr = peerIdMatch ? peerIdMatch[1] : null
        
        // Skip if we're already connected to this peer
        if (peerIdFromAddr && currentPeers.has(peerIdFromAddr)) {
          this.logger.debug(`⏭️ Already connected to peer: ${peerIdFromAddr}`)
          continue
        }
        
        // Attempt connection with multiple strategies for NAT traversal
        this.logger.info(`🔗 Dialing peer: ${peerIdFromAddr} at ${address}`)
        
        const addr = multiaddr(address)
        let connection: any = null
        
        try {
          // Direct connection attempt with longer timeout for NAT
          connection = await Promise.race([
            this.node.dial(addr),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Connection timeout after 30s')), 30000)
            )
          ])
        } catch (directError) {
          this.logger.warn(`Direct connection failed: ${directError instanceof Error ? directError.message : directError}`)
          // Connection will be null, handled below
        }
        
        if (!connection || typeof connection !== 'object' || !('remotePeer' in connection)) {
          throw new Error('All connection attempts failed - NAT traversal unsuccessful')
        }
        
        const typedConnection = connection as { remotePeer: { toString(): string } }
        
        const peerIdFromConn = typedConnection.remotePeer.toString()
        this.logger.info(`🌍 Successfully connected to discovered peer: ${peerIdFromConn}`)
        this.logger.info(`📡 Connection address: ${address}`)
        this.logger.info(`🔗 Connection established, remote peer: ${peerIdFromConn}`)
        
      } catch (error) {
        this.logger.warn(`❌ Failed to connect to ${address}:`, error instanceof Error ? error.message : error)
      }
    }
    
    // Log current connection status
    const connectedCount = this.node.getPeers().length
    this.logger.info(`📊 Currently connected to ${connectedCount} peers`)
  }

  // Connect to manually configured peers
  private async connectToConfiguredPeers(): Promise<void> {
    if (!this.config.connectToPeers || this.config.connectToPeers.length === 0) {
      return
    }

    this.logger.info(`🔗 Connecting to ${this.config.connectToPeers.length} configured peers...`)

    for (const peerAddr of this.config.connectToPeers) {
      try {
        await this.connectToPeer(peerAddr)
      } catch (error) {
        this.logger.warn(`Failed to connect to peer ${peerAddr}:`, error)
      }
    }
  }

  // Manually connect to a peer
  async connectToPeer(peerAddress: string): Promise<void> {
    if (!this.isStarted) {
      throw new Error('DIG Node is not started')
    }

    try {
      this.logger.info(`🔗 Connecting to peer: ${peerAddress}`)
      const addr = multiaddr(peerAddress)
      const connection = await this.node.dial(addr)
      
      if (!connection || typeof connection !== 'object' || !('remotePeer' in connection)) {
        throw new Error('Invalid connection object returned')
      }
      
      const typedConnection = connection as { remotePeer: { toString(): string } }
      this.logger.info(`✅ Connected to peer: ${typedConnection.remotePeer.toString()}`)
    } catch (error) {
      this.logger.error(`❌ Failed to connect to peer ${peerAddress}:`, error)
      throw error
    }
  }

  // Get connection information for debugging
  getConnectionInfo(): any {
    if (!this.node) {
      return { error: 'Node not started' }
    }

    const peers = this.node.getPeers()
    const addresses = this.node.getMultiaddrs()
    const knownAddresses = this.globalDiscovery ? this.globalDiscovery.getKnownPeerAddresses() : []
    
    return {
      listeningAddresses: addresses.map(addr => addr.toString()),
      connectedPeers: peers.map(peer => peer.toString()),
      peerCount: peers.length,
      discoveredPeers: Array.from(this.discoveredPeers),
      knownAddresses: knownAddresses,
      peerStores: Object.fromEntries(
        Array.from(this.peerStores.entries()).map(([peerId, stores]) => [
          peerId, Array.from(stores)
        ])
      ),
      globalDiscoveryStats: this.globalDiscovery ? this.globalDiscovery.getStats() : null
    }
  }

  // Force connection attempts to all known peers
  async forceConnectToPeers(): Promise<void> {
    if (!this.isStarted) {
      throw new Error('DIG Node is not started')
    }

    this.logger.info('🔗 Force connecting to all known peers...')
    await this.connectToDiscoveredPeers()
  }

  // Force peer discovery across the network
  async discoverAllPeers(): Promise<void> {
    if (!this.isStarted) {
      throw new Error('DIG Node is not started')
    }

    this.logger.info('🔍 Starting manual peer discovery...')
    
    try {
      // Use DHT to find peers
      const dht = this.node.services.dht as any
      if (dht && dht.getClosestPeers) {
        const randomKey = randomBytes(32)
        for await (const peer of dht.getClosestPeers(randomKey)) {
          try {
            if (peer.toString() !== this.node.peerId.toString()) {
              await this.node.dial(peer)
              this.logger.info(`🤝 Discovered and connected to peer: ${peer.toString()}`)
            }
          } catch (error) {
            this.logger.debug(`Could not connect to discovered peer ${peer.toString()}:`, error)
          }
        }
      }
    } catch (error) {
      this.logger.warn('DHT peer discovery failed:', error)
    }
  }
}
