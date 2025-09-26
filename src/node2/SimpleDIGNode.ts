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
  
  // Single reliable bootstrap server (both nodes connect to same network)
  private readonly BOOTSTRAP_SERVER = '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN'
  
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
          bootstrap({ list: [this.BOOTSTRAP_SERVER] }), // Single server for reliability
          mdns() // Local network discovery
        ],
        services: {
          ping: ping(),
          identify: identify(),
          dht: kadDHT({ clientMode: false }), // Enable DHT for peer discovery
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
        await this.setupDIGNetworkAnnouncements()
        await this.searchForDIGPeersInDHT()
      }, 10000) // Wait 10 seconds for LibP2P to stabilize

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
      console.log(`🤝 Connected to peer: ${peerId.substring(0, 20)}...`)
      
      // Test if this peer supports DIG protocol
      setTimeout(async () => {
        await this.testPeerForDIG(peerId)
      }, 2000) // Wait for connection to stabilize
    })

    // Handle peer disconnections
    this.node.addEventListener('peer:disconnect', (event) => {
      const peerId = event.detail.toString()
      console.log(`👋 Disconnected from peer: ${peerId.substring(0, 20)}...`)
      this.digPeers.delete(peerId)
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
          
          console.log(`🎯 DIG peer found: ${peerId.substring(0, 20)}... (${response.stores.length} stores)`)
          
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
            const request = JSON.parse(uint8ArrayToString(chunk))
            
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
            break
          }
        }.bind(this),
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

  // Manual sync trigger
  async syncNow(): Promise<void> {
    console.log('🔄 Manual sync triggered...')
    await this.syncWithAllPeers()
  }

  // Set up DIG network announcements via gossip and DHT
  private async setupDIGNetworkAnnouncements(): Promise<void> {
    try {
      console.log('📡 Setting up DIG network announcements...')

      // Subscribe to DIG gossip topic
      const gossipsub = this.node.services.gossipsub as any
      if (gossipsub) {
        await gossipsub.subscribe(this.DIG_GOSSIP_TOPIC)
        
        // Handle DIG peer announcements
        gossipsub.addEventListener('message', (evt: any) => {
          if (evt.detail.topic === this.DIG_GOSSIP_TOPIC) {
            this.handleDIGGossipMessage(evt.detail.data)
          }
        })

        // Announce ourselves via gossip
        await this.announceDIGNodeViaGossip()
        
        console.log(`✅ Subscribed to DIG gossip topic: ${this.DIG_GOSSIP_TOPIC}`)
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

      await gossipsub.publish(
        this.DIG_GOSSIP_TOPIC,
        uint8ArrayFromString(JSON.stringify(announcement))
      )

      console.log(`📡 Announced DIG node via gossip (${this.digFiles.size} stores)`)

    } catch (error) {
      console.debug('Gossip announcement failed:', error)
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
