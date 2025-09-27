/**
 * Dedicated LibP2P Bootstrap Server for DIG Network
 * 
 * Full LibP2P compliant bootstrap server that:
 * - Acts as a stable connection point for DIG nodes
 * - Provides DHT bootstrap functionality
 * - Handles peer discovery and routing
 * - Maintains connection stability
 * - Replaces public LibP2P bootstrap servers
 */

import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { kadDHT } from '@libp2p/kad-dht'
import { ping } from '@libp2p/ping'
import { identify } from '@libp2p/identify'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { circuitRelayServer } from '@libp2p/circuit-relay-v2'
import type { Libp2p } from 'libp2p'

export class LibP2PBootstrapServer {
  private node!: Libp2p
  private isStarted = false
  private connectedPeers = new Set<string>()
  private digPeers = new Map<string, { peerId: string, stores: string[], addresses: string[], lastSeen: number }>()
  
  // Standard LibP2P bootstrap port
  private readonly BOOTSTRAP_PORT = 4001
  
  // DIG Network protocol
  private readonly DIG_PROTOCOL = '/dig-simple/1.0.0'
  private readonly DIG_GOSSIP_TOPIC = 'dig-network-simple-v1'

  constructor() {
    console.log('🚀 Initializing dedicated LibP2P bootstrap server for DIG Network')
  }

  // Start the LibP2P bootstrap server
  async start(): Promise<void> {
    if (this.isStarted) return

    try {
      console.log('🔗 Creating LibP2P bootstrap server...')

      this.node = await createLibp2p({
        addresses: {
          listen: [
            `/ip4/0.0.0.0/tcp/${this.BOOTSTRAP_PORT}`,
            `/ip6/::/tcp/${this.BOOTSTRAP_PORT}`
          ]
        },
        transports: [tcp()],
        connectionEncryption: [noise()],
        streamMuxers: [yamux()],
        services: {
          ping: ping(),
          identify: identify(),
          dht: kadDHT(),
          gossipsub: gossipsub({ 
            emitSelf: false
          }),
          circuitRelay: circuitRelayServer()
        },
        connectionManager: {
          maxConnections: 1000,  // Support many DIG nodes
          dialTimeout: 30000,
          maxParallelDials: 50
        }
      })

      // Set up connection monitoring
      this.setupConnectionMonitoring()

      // Set up DIG network support
      await this.setupDIGNetworkSupport()

      console.log(`✅ LibP2P bootstrap server started`)
      console.log(`🆔 Peer ID: ${this.node.peerId.toString()}`)
      console.log(`📍 Addresses: ${this.node.getMultiaddrs().map(addr => addr.toString()).join(', ')}`)

      this.isStarted = true

      // Start periodic announcements and cleanup
      this.startPeriodicMaintenance()

    } catch (error) {
      console.error('❌ Failed to start LibP2P bootstrap server:', error)
      throw error
    }
  }

  // Set up connection monitoring
  private setupConnectionMonitoring(): void {
    this.node.addEventListener('peer:connect', (event) => {
      const peerId = event.detail.toString()
      this.connectedPeers.add(peerId)
      console.log(`🤝 Peer connected: ${peerId.substring(0, 20)}... (${this.connectedPeers.size} total)`)
    })

    this.node.addEventListener('peer:disconnect', (event) => {
      const peerId = event.detail.toString()
      this.connectedPeers.delete(peerId)
      this.digPeers.delete(peerId)
      console.log(`👋 Peer disconnected: ${peerId.substring(0, 20)}... (${this.connectedPeers.size} total)`)
    })
  }

  // Set up DIG network support
  private async setupDIGNetworkSupport(): Promise<void> {
    try {
      // Subscribe to DIG gossip topic to track DIG nodes
      const gossipsub = this.node.services.gossipsub as any
      if (gossipsub) {
        await gossipsub.subscribe('dig-network-simple-v1')
        
        gossipsub.addEventListener('message', (evt: any) => {
          if (evt.detail.topic === 'dig-network-simple-v1') {
            this.handleDIGNetworkMessage(evt.detail.data)
          }
        })

        console.log('✅ Subscribed to DIG network gossip topic')
      }

    } catch (error) {
      console.warn('Failed to setup DIG network support:', error)
    }
  }

  // Handle DIG network messages
  private handleDIGNetworkMessage(data: Uint8Array): void {
    try {
      const { toString: uint8ArrayToString } = require('uint8arrays/to-string')
      const message = JSON.parse(uint8ArrayToString(data))
      
      if (message.type === 'dig_node_announcement') {
        this.digPeers.set(message.peerId, {
          peerId: message.peerId,
          stores: message.stores || [],
          addresses: message.addresses || [],
          lastSeen: Date.now()
        })
        console.log(`🎯 DIG node registered: ${message.peerId.substring(0, 20)}... (${message.stores?.length || 0} stores)`)
      }

    } catch (error) {
      // Silent failure for message parsing
    }
  }

  // Start periodic maintenance
  private startPeriodicMaintenance(): void {
    // Log status every 30 seconds
    setInterval(() => {
      console.log(`📊 Bootstrap Status: ${this.connectedPeers.size} peers connected, ${this.digPeers.size} DIG nodes`)
    }, 30000)

    // Cleanup stale peer tracking every 5 minutes
    setInterval(() => {
      const connectedPeerIds = new Set(this.node.getPeers().map(p => p.toString()))
      
      // Remove disconnected peers from tracking
      for (const peerId of this.connectedPeers) {
        if (!connectedPeerIds.has(peerId)) {
          this.connectedPeers.delete(peerId)
          this.digPeers.delete(peerId)
        }
      }
    }, 5 * 60000)
  }

  // Get bootstrap server status
  getStatus(): any {
    return {
      isStarted: this.isStarted,
      peerId: this.node?.peerId?.toString(),
      addresses: this.node ? this.node.getMultiaddrs().map(addr => addr.toString()) : [],
      connectedPeers: this.connectedPeers.size,
      digNodes: this.digPeers.size,
      uptime: this.isStarted ? Date.now() - this.startTime : 0
    }
  }

  private startTime = Date.now()

  // Stop the bootstrap server
  async stop(): Promise<void> {
    if (!this.isStarted) return
    
    console.log('🛑 Stopping LibP2P bootstrap server...')
    await this.node?.stop()
    this.isStarted = false
    console.log('✅ LibP2P bootstrap server stopped')
  }
}
