/**
 * Simple DIG Node Implementation
 * 
 * Clean, minimal implementation that actually works:
 * - Basic LibP2P with stable configuration
 * - Simple .dig file sharing via custom protocol
 * - Uses public LibP2P infrastructure for connectivity
 * - Automatic peer discovery and file synchronization
 * - No complex layers, just core functionality
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
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { pipe } from 'it-pipe'
import { toString as uint8ArrayToString } from 'uint8arrays/to-string'
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string'
import { readFile, readdir, writeFile } from 'fs/promises'
import { join, basename } from 'path'
import { homedir } from 'os'
import type { Stream } from '@libp2p/interface'
import type { Libp2p } from 'libp2p'

// Simple types
interface DIGFile {
  storeId: string
  content: Buffer
  size: number
}

interface DIGPeer {
  peerId: string
  stores: string[]
  lastSeen: number
}

export class SimpleDIGNode {
  private node!: Libp2p
  private digFiles = new Map<string, DIGFile>()
  private digPeers = new Map<string, DIGPeer>()
  private digPath: string
  private isStarted = false

  // DIG Network protocol
  private readonly DIG_PROTOCOL = '/dig-simple/1.0.0'
  
  // Direct IP bootstrap server (more reliable than DNS)
  // Bootstrap servers for peer discovery - DIG-aware dedicated server
  private readonly BOOTSTRAP_SERVERS: string[] = [
    '/dns4/dig-bootstrap-v2-prod.eba-vfishzna.us-east-1.elasticbeanstalk.com/tcp/4001/p2p/12D3KooWQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa'
  ]
  
  // DIG Network gossip topic for peer announcements
  private readonly DIG_GOSSIP_TOPIC = 'dig-network-simple-v1'

  constructor(private port: number = 0) {
    this.digPath = join(homedir(), '.dig')
    console.log(`🚀 Simple DIG Node initializing on port ${port || 'auto'}`)
  }

  // Start the node
  async start(): Promise<void> {
    if (this.isStarted) return

    try {
      console.log('🔗 Creating LibP2P node...')
      
      // Create simple, stable LibP2P configuration
      this.node = await createLibp2p({
        addresses: {
          listen: [
            `/ip4/0.0.0.0/tcp/${this.port}`, // Let LibP2P choose port if 0
          ]
        },
        transports: [tcp()], // Simple TCP only
        connectionEncrypters: [noise()],
        streamMuxers: [yamux()],
        peerDiscovery: [
          bootstrap({
            list: this.BOOTSTRAP_SERVERS,
            timeout: 10000,
            tagName: 'bootstrap'
          }),
          mdns({
            interval: 5000, // More frequent mDNS announcements
            serviceTag: 'dig-network' // Specific service tag for DIG nodes
          }) // Local network discovery for same-network nodes
        ],
        services: {
          ping: ping(),
          identify: identify(),
          dht: kadDHT({ 
            clientMode: false,
            validators: {},
            selectors: {}
          }), // Enable DHT for peer discovery
          gossipsub: gossipsub({ emitSelf: false }) // Enable gossip for DIG announcements
        },
        connectionManager: {
          maxConnections: 10, // Conservative limit
          dialTimeout: 10000  // 10 second timeout
        }
      })

      // Set up DIG protocol handler
      await this.node.handle(this.DIG_PROTOCOL, this.handleDIGRequest.bind(this))

      console.log(`✅ LibP2P node started: ${this.node.peerId.toString()}`)
      console.log(`📍 Listening on: ${this.node.getMultiaddrs().map(addr => addr.toString()).join(', ')}`)
      console.log(`🔗 Bootstrap servers: ${this.BOOTSTRAP_SERVERS.length} configured`)
      
      // Monitor initial connection to bootstrap
      setTimeout(() => {
        const peers = this.node.getPeers()
        console.log(`📊 After 15s: Connected to ${peers.length} LibP2P peers`)
        if (peers.length === 0) {
          console.log('⚠️ Not connected to bootstrap server - checking connectivity...')
        }
      }, 15000)

      // Load local .dig files
      await this.loadDIGFiles()

      // Set up peer discovery
      this.setupPeerDiscovery()

      // Start periodic sync
      this.startPeriodicSync()

      // Announce our stores to the network
      await this.announceStores()

      // Set up DIG network announcements for peer discovery
      setTimeout(async () => {
        try {
          await this.waitForServicesToStart()
          await this.setupDIGNetworkAnnouncements()
          await this.searchForDIGPeersInDHT()
        } catch (servicesError) {
          console.warn('⚠️ DHT/Gossip services failed, using direct peer testing only')
        }
        
        // Always test all currently connected peers for DIG protocol
        await this.testAllConnectedPeersForDIG()
        
        // Set up periodic peer testing for new connections
        this.startPeriodicPeerTesting()
        
      }, 30000) // Wait 30 seconds for LibP2P, DHT, and gossipsub to fully stabilize

      this.isStarted = true
      console.log('✅ Simple DIG Node started successfully')

    } catch (error) {
      console.error('❌ Failed to start Simple DIG Node:', error)
      throw error
    }
  }

  // Load .dig files from local directory
  private async loadDIGFiles(): Promise<void> {
    try {
      const files = await readdir(this.digPath).catch(() => [])
      
      for (const file of files) {
        if (file.endsWith('.dig')) {
          const storeId = basename(file, '.dig')
          const filePath = join(this.digPath, file)
          const content = await readFile(filePath)
          
          this.digFiles.set(storeId, {
            storeId,
            content,
            size: content.length
          })
        }
      }

      console.log(`📁 Loaded ${this.digFiles.size} .dig files`)

    } catch (error) {
      console.warn('⚠️ Failed to load .dig files:', error)
    }
  }

  // Set up peer discovery and connection handling
  private setupPeerDiscovery(): void {
    // Handle new peer connections
    this.node.addEventListener('peer:connect', async (event) => {
      const peerId = event.detail.toString()
      // Don't log regular LibP2P connections - only DIG peers matter
      
      // Test if this peer supports DIG protocol IMMEDIATELY
      setTimeout(async () => {
        await this.testPeerForDIG(peerId)
      }, 100) // Test almost immediately
    })

    // Handle peer disconnections
    this.node.addEventListener('peer:disconnect', (event) => {
      const peerId = event.detail.toString()
      
      // Only log if this was a DIG peer
      if (this.digPeers.has(peerId)) {
        console.log(`👋 DIG peer disconnected: ${peerId.substring(0, 20)}...`)
        this.digPeers.delete(peerId)
      }
    })
  }

  // Test if peer supports DIG protocol
  private async testPeerForDIG(peerId: string): Promise<void> {
    try {
      const peer = this.node.getPeers().find(p => p.toString() === peerId)
      if (!peer) return

      // Try to open DIG protocol stream
      const stream = await this.node.dialProtocol(peer, this.DIG_PROTOCOL)
      
      // Send store list request
      const request = { type: 'list_stores' }
      await pipe([uint8ArrayFromString(JSON.stringify(request))], stream.sink)

      // Read response
      const chunks: Uint8Array[] = []
      await pipe(stream.source, async function (source: any) {
        for await (const chunk of source) {
          chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk.subarray()))
        }
      })

      if (chunks.length > 0) {
        const response = JSON.parse(uint8ArrayToString(chunks[0]))
        if (response.success && response.stores) {
          // This is a DIG peer!
          this.digPeers.set(peerId, {
            peerId,
            stores: response.stores,
            lastSeen: Date.now()
          })
          
          console.log(`🎉 DIG PEER CONNECTED: ${peerId.substring(0, 20)}... (${response.stores.length} stores)`)
          console.log(`📊 Total DIG peers: ${this.digPeers.size}`)
          
          // Start syncing missing stores
          await this.syncMissingStores(peerId, response.stores)
        }
      }

    } catch (error) {
      // Not a DIG peer, ignore
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
            try {
              if (!chunk || chunk.length === 0) continue
              const chunkData = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk.subarray())
              const request = JSON.parse(uint8ArrayToString(chunkData))
            
              if (request.type === 'list_stores') {
                // Return list of available stores
                const response = {
                  success: true,
                  stores: Array.from(self.digFiles.keys()),
                  peerId: self.node.peerId.toString()
                }
                yield uint8ArrayFromString(JSON.stringify(response))
                
              } else if (request.type === 'get_store' && request.storeId) {
                // Return specific store content
                const digFile = self.digFiles.get(request.storeId)
                if (digFile) {
                  const response = {
                    success: true,
                    storeId: request.storeId,
                    size: digFile.size
                  }
                  yield uint8ArrayFromString(JSON.stringify(response) + '\n')
                  
                  // Send file content in chunks
                  const CHUNK_SIZE = 64 * 1024
                  for (let i = 0; i < digFile.content.length; i += CHUNK_SIZE) {
                    yield digFile.content.subarray(i, i + CHUNK_SIZE)
                  }
                } else {
                  const response = { success: false, error: 'Store not found' }
                  yield uint8ArrayFromString(JSON.stringify(response))
                }
              }
            } catch (chunkError) {
              console.debug('Failed to process chunk:', chunkError)
            }
            break
          }
        },
        stream
      )
    } catch (error) {
      console.error('DIG request handling failed:', error)
    }
  }

  // Sync missing stores from a peer
  private async syncMissingStores(peerId: string, peerStores: string[]): Promise<void> {
    try {
      const missingStores = peerStores.filter(storeId => !this.digFiles.has(storeId))
      
      if (missingStores.length === 0) {
        console.log(`✅ All stores already synced from ${peerId.substring(0, 20)}...`)
        return
      }

      console.log(`📥 Syncing ${missingStores.length} missing stores from ${peerId.substring(0, 20)}...`)

      const peer = this.node.getPeers().find(p => p.toString() === peerId)
      if (!peer) return

      // Download missing stores one by one
      for (const storeId of missingStores.slice(0, 5)) { // Limit to 5 concurrent
        try {
          await this.downloadStore(peer, storeId)
        } catch (error) {
          console.warn(`⚠️ Failed to download store ${storeId}:`, error)
        }
      }

    } catch (error) {
      console.error(`Store sync failed from ${peerId}:`, error)
    }
  }

  // Download a specific store from a peer
  private async downloadStore(peer: any, storeId: string): Promise<void> {
    try {
      console.log(`📥 Downloading store: ${storeId}`)

      const stream = await this.node.dialProtocol(peer, this.DIG_PROTOCOL)
      
      // Request the store
      const request = { type: 'get_store', storeId }
      await pipe([uint8ArrayFromString(JSON.stringify(request))], stream.sink)

      // Collect response
      const chunks: Uint8Array[] = []
      await pipe(stream.source, async function (source: any) {
        for await (const chunk of source) {
          chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk.subarray()))
        }
      })

      if (chunks.length === 0) {
        throw new Error('No response received')
      }

      // Parse header
      const firstChunk = uint8ArrayToString(chunks[0])
      const lines = firstChunk.split('\n')
      const header = JSON.parse(lines[0])

      if (!header.success) {
        throw new Error(header.error || 'Download failed')
      }

      // Assemble file content
      let content: Uint8Array
      if (lines.length > 1) {
        // Header and content in same chunk
        const headerLength = Buffer.from(lines[0] + '\n').length
        const firstChunkContent = chunks[0].subarray(headerLength)
        const restChunks = chunks.slice(1)
        
        const totalLength = firstChunkContent.length + restChunks.reduce((sum, chunk) => sum + chunk.length, 0)
        content = new Uint8Array(totalLength)
        content.set(firstChunkContent, 0)
        
        let offset = firstChunkContent.length
        for (const chunk of restChunks) {
          content.set(chunk, offset)
          offset += chunk.length
        }
      } else {
        // Content in subsequent chunks
        const totalLength = chunks.slice(1).reduce((sum, chunk) => sum + chunk.length, 0)
        content = new Uint8Array(totalLength)
        
        let offset = 0
        for (const chunk of chunks.slice(1)) {
          content.set(chunk, offset)
          offset += chunk.length
        }
      }

      // Save the downloaded store
      const filePath = join(this.digPath, `${storeId}.dig`)
      await writeFile(filePath, content)
      
      // Add to our store map
      this.digFiles.set(storeId, {
        storeId,
        content: Buffer.from(content),
        size: content.length
      })

      console.log(`✅ Downloaded and saved store: ${storeId} (${content.length} bytes)`)

    } catch (error) {
      console.error(`Failed to download store ${storeId}:`, error)
      throw error
    }
  }


  // Start periodic sync with discovered peers
  private startPeriodicSync(): void {
    // Sync every 30 seconds
    setInterval(async () => {
      await this.syncWithAllPeers()
    }, 30000)

    // Initial sync after 10 seconds
    setTimeout(async () => {
      await this.syncWithAllPeers()
    }, 10000)
  }

  // Sync with all known DIG peers
  private async syncWithAllPeers(): Promise<void> {
    try {
      const activePeers = Array.from(this.digPeers.values())
        .filter(peer => Date.now() - peer.lastSeen < 300000) // Active in last 5 minutes

      if (activePeers.length === 0) {
        console.log('🔍 No active DIG peers found for sync')
        return
      }

      console.log(`🔄 Syncing with ${activePeers.length} DIG peers...`)

      for (const digPeer of activePeers) {
        try {
          await this.syncMissingStores(digPeer.peerId, digPeer.stores)
        } catch (error) {
          console.warn(`Sync failed with ${digPeer.peerId}:`, error)
        }
      }

    } catch (error) {
      console.error('Periodic sync failed:', error)
    }
  }

  // Get node status
  getStatus(): any {
    return {
      isStarted: this.isStarted,
      peerId: this.node?.peerId?.toString(),
      stores: Array.from(this.digFiles.keys()),
      storeCount: this.digFiles.size,
      connectedPeers: this.node ? this.node.getPeers().length : 0,
      digPeers: this.digPeers.size,
      listeningAddresses: this.node ? this.node.getMultiaddrs().map(addr => addr.toString()) : []
    }
  }

  // Get DIG peers
  getDIGPeers(): DIGPeer[] {
    return Array.from(this.digPeers.values())
  }

  // Wait for DHT and Gossipsub services to be fully started
  private async waitForServicesToStart(): Promise<void> {
    console.log('⏱️ Waiting for LibP2P services to start properly...')
    
    // First, wait for basic LibP2P connectivity
    let connectionAttempts = 0
    while (connectionAttempts < 20) {
      const peers = this.node.getPeers()
      if (peers.length > 0) {
        console.log(`✅ LibP2P connected to ${peers.length} peers`)
        break
      }
      console.log(`⏱️ Waiting for LibP2P connections... (${connectionAttempts + 1}/20)`)
      await new Promise(resolve => setTimeout(resolve, 3000))
      connectionAttempts++
    }
    
    // Now wait for services to be ready
    let serviceAttempts = 0
    const maxServiceAttempts = 15
    
    while (serviceAttempts < maxServiceAttempts) {
      const dht = this.node.services.dht as any
      const gossipsub = this.node.services.gossipsub as any
      
      // Check if services exist and are started
      const dhtExists = !!dht
      const gossipExists = !!gossipsub
      const dhtReady = dht && typeof dht.isStarted === 'function' ? dht.isStarted() : false
      const gossipReady = gossipsub && typeof gossipsub.isStarted === 'function' ? gossipsub.isStarted() : false
      
      console.log(`🔍 Service status - DHT: exists=${dhtExists}, ready=${dhtReady} | Gossip: exists=${gossipExists}, ready=${gossipReady}`)
      
      if (dhtExists && gossipExists && dhtReady && gossipReady) {
        console.log('✅ All services are ready!')
        return
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000))
      serviceAttempts++
    }
    
    // If services still not ready, proceed without DHT/Gossip
    console.warn('⚠️ DHT/Gossip services not ready - will use direct connections only')
    throw new Error('Services failed to start properly')
  }

  // Start periodic peer testing to continuously look for DIG peers
  private startPeriodicPeerTesting(): void {
    console.log('🔄 Starting periodic peer testing for DIG protocol...')
    
    setInterval(async () => {
      await this.testAllConnectedPeersForDIG()
    }, 15000) // Test every 15 seconds
  }

  // Test all currently connected peers for DIG protocol
  private async testAllConnectedPeersForDIG(): Promise<void> {
    try {
      const connectedPeers = this.node.getPeers()
      if (connectedPeers.length > 0) {
        console.log(`🔍 Testing ${connectedPeers.length} connected peers for DIG protocol...`)
        
        for (const peer of connectedPeers) {
          const peerId = peer.toString()
          // Only test peers we haven't already identified as DIG peers
          if (!this.digPeers.has(peerId)) {
            await this.testPeerForDIG(peerId)
          }
        }
      }
      
    } catch (error) {
      console.error('Failed to test connected peers:', error)
    }
  }

  // Ensure direct connection to a discovered peer
  private async ensureDirectConnection(peerId: string): Promise<void> {
    try {
      const { peerIdFromString } = await import('@libp2p/peer-id')
      const peerIdObj = peerIdFromString(peerId)
      const connections = this.node.getConnections(peerIdObj)
      
      if (connections.length === 0) {
        // No direct connection, try to establish one using PeerId
        console.log(`🔗 Ensuring direct connection to: ${peerId.substring(0, 20)}...`)
        await this.node.dial(peerIdObj)
        console.log(`✅ Direct connection established to: ${peerId.substring(0, 20)}...`)
      }
    } catch (error) {
      console.debug(`Direct connection attempt failed for ${peerId.substring(0, 20)}...`, error)
    }
  }

  // Manual connection to remote DIG node
  async connectToRemote(address: string): Promise<void> {
    try {
      console.log(`🔗 Connecting to remote DIG node: ${address}`)
      const { multiaddr } = await import('@multiformats/multiaddr')
      const addr = multiaddr(address)
      await this.node.dial(addr)
      console.log('✅ Connected to remote node!')
      
      // Wait for DIG protocol testing
      setTimeout(() => {
        const digPeers = this.getDIGPeers()
        console.log(`🎯 DIG peers after connection: ${digPeers.length}`)
      }, 3000)
      
    } catch (error) {
      console.error('❌ Failed to connect to remote:', error)
    }
  }

  // Manual sync trigger
  async syncNow(): Promise<void> {
    console.log('🔄 Manual sync triggered...')
    await this.syncWithAllPeers()
  }

  // Set up DIG network announcements via gossip and DHT
  private async setupDIGNetworkAnnouncements(): Promise<void> {
    try {
      console.log('📡 Setting up DIG network announcements...')

      // Check if gossipsub service is available and started
      const gossipsub = this.node.services.gossipsub as any
      if (gossipsub && gossipsub.isStarted && gossipsub.isStarted()) {
        try {
          await gossipsub.subscribe(this.DIG_GOSSIP_TOPIC)
          
          // Handle DIG peer announcements
          gossipsub.addEventListener('message', (evt: any) => {
            if (evt.detail.topic === this.DIG_GOSSIP_TOPIC) {
              this.handleDIGGossipMessage(evt.detail.data)
            }
          })

          console.log(`✅ Subscribed to DIG gossip topic: ${this.DIG_GOSSIP_TOPIC}`)
          
          // Wait a bit for subscription to propagate, then announce
          setTimeout(async () => {
            await this.announceDIGNodeViaGossip()
          }, 5000)
          
        } catch (subscribeError) {
          console.debug('Gossip subscription failed:', subscribeError)
        }
      } else {
        console.debug('Gossipsub service not ready yet')
      }

    } catch (error) {
      console.warn('Failed to setup DIG announcements:', error)
    }
  }

  // Announce DIG node via gossip
  private async announceDIGNodeViaGossip(): Promise<void> {
    try {
      const gossipsub = this.node.services.gossipsub as any
      if (!gossipsub) return

      const announcement = {
        type: 'dig_node_announcement',
        peerId: this.node.peerId.toString(),
        stores: Array.from(this.digFiles.keys()),
        addresses: this.node.getMultiaddrs().map(addr => addr.toString()),
        timestamp: Date.now()
      }

      // Check if there are any peers subscribed to the topic
      const peers = gossipsub.getSubscribers(this.DIG_GOSSIP_TOPIC)
      if (peers && peers.length > 0) {
        await gossipsub.publish(
          this.DIG_GOSSIP_TOPIC,
          uint8ArrayFromString(JSON.stringify(announcement))
        )
        console.log(`📡 Announced DIG node via gossip to ${peers.length} peers (${this.digFiles.size} stores)`)
      } else {
        console.debug(`📡 No peers subscribed to gossip topic yet, announcement queued`)
        // Retry announcement later when peers might be available
        setTimeout(() => this.announceDIGNodeViaGossip(), 30000)
      }

    } catch (error) {
      console.debug('Gossip announcement failed:', error)
      // Retry on failure
      setTimeout(() => this.announceDIGNodeViaGossip(), 15000)
    }
  }

  // Handle DIG gossip messages
  private async handleDIGGossipMessage(data: Uint8Array): Promise<void> {
    try {
      const message = JSON.parse(uint8ArrayToString(data))
      
      if (message.type === 'dig_node_announcement' && 
          message.peerId !== this.node.peerId.toString()) {
        
        console.log(`📡 Received DIG node announcement: ${message.peerId.substring(0, 20)}... (${message.stores.length} stores)`)
        
        // Add to DIG peers
        this.digPeers.set(message.peerId, {
          peerId: message.peerId,
          stores: message.stores || [],
          lastSeen: Date.now()
        })

        // Try to connect to this DIG peer
        await this.connectToDIGPeer(message.peerId, message.addresses)
      }

    } catch (error) {
      console.debug('Failed to handle gossip message:', error)
    }
  }

  // Search for DIG peers in DHT
  private async searchForDIGPeersInDHT(): Promise<void> {
    try {
      console.log('🔍 Searching for DIG peers in DHT...')
      
      const dht = this.node.services.dht as any
      if (!dht) return

      // Search for DIG nodes in DHT
      const searchKey = uint8ArrayFromString('/dig-simple/nodes')
      
      try {
        for await (const event of dht.get(searchKey)) {
          if (event.name === 'VALUE') {
            try {
              const peerInfo = JSON.parse(uint8ArrayToString(event.value))
              if (peerInfo.peerId !== this.node.peerId.toString()) {
                console.log(`🔍 Found DIG peer in DHT: ${peerInfo.peerId.substring(0, 20)}...`)
                
                this.digPeers.set(peerInfo.peerId, {
                  peerId: peerInfo.peerId,
                  stores: peerInfo.stores || [],
                  lastSeen: Date.now()
                })

                // Try to connect
                await this.connectToDIGPeer(peerInfo.peerId, peerInfo.addresses)
              }
            } catch (parseError) {
              // Silent parse failure
            }
          }
        }
      } catch (searchError) {
        console.debug('DHT search failed (expected during bootstrap):', searchError)
      }

    } catch (error) {
      console.debug('DHT search failed:', error)
    }
  }

  // Try to connect to a DIG peer
  private async connectToDIGPeer(peerId: string, addresses: string[]): Promise<void> {
    try {
      // Check if already connected
      const existingPeer = this.node.getPeers().find(p => p.toString() === peerId)
      if (existingPeer) {
        console.log(`✅ Already connected to DIG peer: ${peerId.substring(0, 20)}...`)
        return
      }

      // Try to connect using provided addresses
      if (addresses && addresses.length > 0) {
        for (const address of addresses.slice(0, 2)) { // Try first 2 addresses
          try {
            const { multiaddr } = await import('@multiformats/multiaddr')
            const addr = multiaddr(address)
            await this.node.dial(addr)
            console.log(`✅ Connected to DIG peer: ${peerId.substring(0, 20)}...`)
            return
          } catch (dialError) {
            console.debug(`Failed to dial ${address}:`, dialError)
          }
        }
      }

    } catch (error) {
      console.debug(`Failed to connect to DIG peer ${peerId}:`, error)
    }
  }

  // Enhanced store announcements to DHT
  private async announceStores(): Promise<void> {
    try {
      const dht = this.node.services.dht as any
      if (!dht) return

      // Announce individual stores
      for (const storeId of this.digFiles.keys()) {
        try {
          const key = uint8ArrayFromString(`/dig-simple/store/${storeId}`)
          const value = uint8ArrayFromString(JSON.stringify({
            peerId: this.node.peerId.toString(),
            storeId,
            timestamp: Date.now()
          }))
          
          await dht.put(key, value)
        } catch (error) {
          // Silent failure for individual store announcements
        }
      }

      // Announce our node in DHT
      try {
        const nodeKey = uint8ArrayFromString('/dig-simple/nodes')
        const nodeValue = uint8ArrayFromString(JSON.stringify({
          peerId: this.node.peerId.toString(),
          stores: Array.from(this.digFiles.keys()),
          addresses: this.node.getMultiaddrs().map(addr => addr.toString()),
          timestamp: Date.now()
        }))
        
        await dht.put(nodeKey, nodeValue)
        console.log(`📡 Announced DIG node to DHT (${this.digFiles.size} stores)`)
      } catch (nodeError) {
        console.debug('DHT node announcement failed:', nodeError)
      }

    } catch (error) {
      console.debug('Store announcement failed:', error)
    }
  }

  // Stop the node
  async stop(): Promise<void> {
    if (!this.isStarted) return
    
    console.log('🛑 Stopping Simple DIG Node...')
    await this.node?.stop()
    this.isStarted = false
    console.log('✅ Simple DIG Node stopped')
  }
}

// Export for testing
export { DIGFile, DIGPeer }
