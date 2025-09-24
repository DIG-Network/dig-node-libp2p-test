/**
 * Local Network Discovery for DIG Network
 * 
 * Problem: Hotel networks often block mDNS and isolate devices
 * Solution: Active local network scanning and manual peer exchange
 * 
 * Methods:
 * - Direct IP range scanning for DIG nodes
 * - Manual peer exchange via known addresses
 * - Local network broadcast (if allowed)
 * - Port scanning for DIG services
 */

import { Logger } from './logger.js'

export class LocalNetworkDiscovery {
  private logger = new Logger('LocalNetworkDiscovery')
  private digNode: any
  private localDIGPeers = new Map<string, LocalDIGPeer>()
  private scanInterval: NodeJS.Timeout | null = null

  // Common local network ranges
  private readonly LOCAL_NETWORK_RANGES = [
    '192.168.1.0/24',   // Most common home network
    '192.168.0.0/24',   // Alternative home network
    '10.0.0.0/24',      // Corporate/hotel networks
    '172.16.0.0/24',    // Docker/corporate networks
    '192.168.43.0/24',  // Mobile hotspot
    '192.168.137.0/24'  // Windows hotspot
  ]

  constructor(digNode: any) {
    this.digNode = digNode
  }

  // Start local network discovery
  async start(): Promise<void> {
    try {
      this.logger.info('🏠 Starting local network discovery for hotel/corporate networks...')

      // 1. Get our local IP address
      const localIP = await this.getLocalIPAddress()
      if (localIP) {
        this.logger.info(`🔍 Local IP detected: ${localIP}`)
        
        // 2. Determine network range
        const networkRange = this.determineNetworkRange(localIP)
        this.logger.info(`🌐 Scanning network range: ${networkRange}`)
        
        // 3. Scan for DIG nodes in local network
        await this.scanLocalNetworkForDIGNodes(networkRange)
      } else {
        this.logger.warn('⚠️ Could not determine local IP - limited local discovery')
      }

      // 4. Start periodic local scanning
      this.startPeriodicLocalScanning()

      // 5. Set up manual peer exchange
      this.setupManualPeerExchange()

      this.logger.info('✅ Local network discovery started')

    } catch (error) {
      this.logger.error('Failed to start local network discovery:', error)
    }
  }

  // Get our local IP address
  private async getLocalIPAddress(): Promise<string | null> {
    try {
      const { networkInterfaces } = await import('os')
      const interfaces = networkInterfaces()
      
      for (const [name, addresses] of Object.entries(interfaces)) {
        if (!addresses) continue
        
        for (const addr of addresses) {
          // Look for IPv4 addresses that are not loopback
          if (addr.family === 'IPv4' && !addr.internal) {
            // Prefer private network addresses (local networks)
            if (addr.address.startsWith('192.168.') || 
                addr.address.startsWith('10.') || 
                addr.address.startsWith('172.16.')) {
              this.logger.debug(`🔍 Found local network IP: ${addr.address} (${name})`)
              return addr.address
            }
          }
        }
      }

      this.logger.debug('No local network IP found')
      return null

    } catch (error) {
      this.logger.debug('Failed to get local IP:', error)
      return null
    }
  }

  // Determine network range from local IP
  private determineNetworkRange(localIP: string): string {
    const parts = localIP.split('.')
    
    if (localIP.startsWith('192.168.')) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`
    } else if (localIP.startsWith('10.')) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`
    } else if (localIP.startsWith('172.16.')) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`
    }
    
    // Default to /24 subnet
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`
  }

  // Scan local network for DIG nodes
  private async scanLocalNetworkForDIGNodes(networkRange: string): Promise<void> {
    try {
      this.logger.info(`🔍 Scanning ${networkRange} for DIG nodes...`)

      const baseIP = networkRange.split('/')[0].split('.').slice(0, 3).join('.')
      const scanPromises: Promise<void>[] = []

      // Scan IP range for DIG nodes (limit to avoid overwhelming network)
      for (let i = 1; i <= 254; i++) {
        const targetIP = `${baseIP}.${i}`
        
        // Skip our own IP
        const localIP = await this.getLocalIPAddress()
        if (targetIP === localIP) continue

        // Limit concurrent scans to avoid overwhelming hotel network
        if (scanPromises.length >= 10) {
          await Promise.race(scanPromises)
        }

        const scanPromise = this.scanSingleIPForDIGNode(targetIP)
        scanPromises.push(scanPromise)
      }

      // Wait for all scans to complete
      await Promise.allSettled(scanPromises)

      const foundCount = this.localDIGPeers.size
      this.logger.info(`🔍 Local network scan complete: ${foundCount} DIG nodes found`)

    } catch (error) {
      this.logger.debug('Local network scan failed:', error)
    }
  }

  // Scan single IP for DIG node
  private async scanSingleIPForDIGNode(targetIP: string): Promise<void> {
    try {
      // Common DIG node ports to try
      const portsToTry = [4001, 4002, 4003, 4004, 4005, 4010, 4020]
      
      for (const port of portsToTry) {
        try {
          // Try to connect to potential DIG node
          const { multiaddr } = await import('@multiformats/multiaddr')
          const addr = multiaddr(`/ip4/${targetIP}/tcp/${port}`)
          
          const connection = await Promise.race([
            this.digNode.node.dial(addr),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Local scan timeout')), 3000)
            )
          ])

          if (connection) {
            // Test if this is a DIG node
            const isDIGNode = await this.testDIGProtocolSupport(connection)
            
            if (isDIGNode) {
              this.logger.info(`✅ Found local DIG node: ${targetIP}:${port}`)
              
              const peerId = connection.remotePeer.toString()
              const digPeerInfo = await this.getDIGPeerInfo(peerId, connection)
              
              if (digPeerInfo) {
                this.localDIGPeers.set(peerId, {
                  ...digPeerInfo,
                  localIP: targetIP,
                  localPort: port,
                  discoveredVia: 'local-scan'
                })
                
                // Notify main discovery system
                this.notifyMainDiscoverySystem(digPeerInfo)
              }
              
              return // Found DIG node on this IP, no need to try other ports
            } else {
              // Not a DIG node, disconnect
              await this.digNode.node.hangUp(connection.remotePeer)
            }
          }
        } catch (error) {
          // Silent failure - IP/port not reachable
        }
      }

    } catch (error) {
      // Silent failure for IP scanning
    }
  }

  // Test if connection supports DIG protocol
  private async testDIGProtocolSupport(connection: any): Promise<boolean> {
    try {
      const stream = await this.digNode.node.dialProtocol(connection.remotePeer, '/dig/1.0.0')
      
      if (stream) {
        // Send minimal identification
        const identRequest = {
          type: 'DIG_NETWORK_IDENTIFICATION',
          networkId: 'dig-mainnet',
          protocolVersion: '1.0.0'
        }

        const { pipe } = await import('it-pipe')
        const { fromString: uint8ArrayFromString, toString: uint8ArrayToString } = await import('uint8arrays')

        await pipe(async function* () {
          yield uint8ArrayFromString(JSON.stringify(identRequest))
        }, stream.sink)

        const chunks: Uint8Array[] = []
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Identification timeout')), 2000)
        )

        await Promise.race([
          pipe(stream.source, async function (source: any) {
            for await (const chunk of source) {
              chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk.subarray()))
            }
          }),
          timeoutPromise
        ])

        if (chunks.length > 0) {
          const response = JSON.parse(uint8ArrayToString(chunks[0]))
          return response.networkId === 'dig-mainnet' && response.isDIGNode === true
        }
      }

      return false

    } catch (error) {
      return false
    }
  }

  // Get DIG peer information
  private async getDIGPeerInfo(peerId: string, connection: any): Promise<any> {
    try {
      const stream = await this.digNode.node.dialProtocol(connection.remotePeer, '/dig/1.0.0')
      
      const infoRequest = {
        type: 'GET_PEER_INFO',
        requestedInfo: ['stores', 'capabilities', 'cryptoIPv6']
      }

      const { pipe } = await import('it-pipe')
      const { fromString: uint8ArrayFromString, toString: uint8ArrayToString } = await import('uint8arrays')

      await pipe(async function* () {
        yield uint8ArrayFromString(JSON.stringify(infoRequest))
      }, stream.sink)

      const chunks: Uint8Array[] = []
      await pipe(stream.source, async function (source: any) {
        for await (const chunk of source) {
          chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk.subarray()))
        }
      })

      if (chunks.length > 0) {
        const response = JSON.parse(uint8ArrayToString(chunks[0]))
        if (response.success) {
          return {
            peerId,
            cryptoIPv6: response.cryptoIPv6,
            stores: response.stores || [],
            capabilities: response.capabilities || {},
            lastSeen: Date.now()
          }
        }
      }

      return null

    } catch (error) {
      this.logger.debug(`Failed to get peer info for ${peerId}:`, error)
      return null
    }
  }

  // Notify main discovery system about found local DIG peer
  private notifyMainDiscoverySystem(digPeerInfo: any): void {
    try {
      // Add to main DIG peer discovery system
      if (this.digNode.peerDiscovery && this.digNode.peerDiscovery.digPeers) {
        this.digNode.peerDiscovery.digPeers.set(digPeerInfo.peerId, {
          ...digPeerInfo,
          discoveredVia: 'local-network-scan',
          verified: true
        })
        
        this.logger.info(`📡 Notified main discovery system about local DIG peer: ${digPeerInfo.peerId}`)
      }
    } catch (error) {
      this.logger.debug('Failed to notify main discovery system:', error)
    }
  }

  // Start periodic local scanning
  private startPeriodicLocalScanning(): void {
    // Scan every 5 minutes for new local DIG nodes
    this.scanInterval = setInterval(async () => {
      const localIP = await this.getLocalIPAddress()
      if (localIP) {
        const networkRange = this.determineNetworkRange(localIP)
        await this.scanLocalNetworkForDIGNodes(networkRange)
      }
    }, 5 * 60000) // Every 5 minutes

    this.logger.debug('🔄 Periodic local network scanning enabled (every 5 minutes)')
  }

  // Set up manual peer exchange for hotel networks
  private setupManualPeerExchange(): void {
    try {
      // Listen for manual peer announcements on local network
      const gossipsub = this.digNode.node.services.gossipsub
      if (gossipsub) {
        // Subscribe to local network topic
        gossipsub.subscribe('dig-local-network-discovery')
        
        gossipsub.addEventListener('message', (evt: any) => {
          if (evt.detail.topic === 'dig-local-network-discovery') {
            this.handleLocalPeerAnnouncement(evt.detail.data)
          }
        })

        // Announce ourselves on local network
        this.announceToLocalNetwork()
        
        // Periodic local announcements
        setInterval(() => {
          this.announceToLocalNetwork()
        }, 30000) // Every 30 seconds
      }
    } catch (error) {
      this.logger.debug('Manual peer exchange setup failed:', error)
    }
  }

  // Announce to local network
  private async announceToLocalNetwork(): Promise<void> {
    try {
      const gossipsub = this.digNode.node.services.gossipsub
      if (!gossipsub) return

      const localAnnouncement = {
        peerId: this.digNode.node.peerId.toString(),
        networkId: 'dig-mainnet',
        cryptoIPv6: this.digNode.cryptoIPv6,
        localIP: await this.getLocalIPAddress(),
        ports: this.digNode.portManager?.getAllocatedPorts() || new Map(),
        stores: this.digNode.getAvailableStores(),
        timestamp: Date.now(),
        discoveryMethod: 'local-network-broadcast'
      }

      const { fromString: uint8ArrayFromString } = await import('uint8arrays')
      await gossipsub.publish(
        'dig-local-network-discovery',
        uint8ArrayFromString(JSON.stringify(localAnnouncement))
      )

      this.logger.debug('📡 Announced to local network')

    } catch (error) {
      this.logger.debug('Local network announcement failed:', error)
    }
  }

  // Handle local peer announcements
  private async handleLocalPeerAnnouncement(data: Uint8Array): Promise<void> {
    try {
      const { toString: uint8ArrayToString } = await import('uint8arrays')
      const announcement = JSON.parse(uint8ArrayToString(data))
      
      if (announcement.networkId === 'dig-mainnet' && 
          announcement.peerId !== this.digNode.node.peerId.toString()) {
        
        this.logger.info(`📡 Received local DIG peer announcement: ${announcement.peerId}`)
        
        // Try to connect to local DIG peer
        if (announcement.localIP && announcement.ports) {
          await this.connectToLocalDIGPeer(announcement)
        }
      }

    } catch (error) {
      this.logger.debug('Failed to handle local peer announcement:', error)
    }
  }

  // Connect to local DIG peer
  private async connectToLocalDIGPeer(announcement: any): Promise<void> {
    try {
      const { peerId, localIP, ports } = announcement
      
      // Try different port combinations
      const portsToTry = []
      
      if (ports && typeof ports === 'object') {
        // Use announced ports
        for (const [purpose, port] of Object.entries(ports)) {
          if (typeof port === 'number') {
            portsToTry.push(port)
          }
        }
      }
      
      // Add common DIG ports as fallback
      portsToTry.push(4001, 4002, 4003, 4004, 4005)

      for (const port of portsToTry.slice(0, 5)) { // Limit attempts
        try {
          const { multiaddr } = await import('@multiformats/multiaddr')
          const addr = multiaddr(`/ip4/${localIP}/tcp/${port}/p2p/${peerId}`)
          
          this.logger.debug(`🔗 Attempting local connection: ${localIP}:${port}`)
          
          const connection = await Promise.race([
            this.digNode.node.dial(addr),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Local connection timeout')), 5000)
            )
          ])

          if (connection) {
            this.logger.info(`✅ Connected to local DIG peer: ${peerId} at ${localIP}:${port}`)
            
            // Add to local DIG peers
            this.localDIGPeers.set(peerId, {
              peerId,
              cryptoIPv6: announcement.cryptoIPv6,
              stores: announcement.stores || [],
              capabilities: {},
              localIP,
              localPort: port,
              lastSeen: Date.now(),
              discoveredVia: 'local-announcement'
            })
            
            return // Success
          }
        } catch (error) {
          // Try next port
        }
      }

      this.logger.debug(`❌ Failed to connect to local DIG peer: ${peerId}`)

    } catch (error) {
      this.logger.debug('Local DIG peer connection failed:', error)
    }
  }

  // Manual peer connection for hotel networks
  async manualConnectToPeer(peerAddress: string): Promise<boolean> {
    try {
      this.logger.info(`🔗 Manual connection attempt: ${peerAddress}`)
      
      const { multiaddr } = await import('@multiformats/multiaddr')
      const addr = multiaddr(peerAddress)
      
      const connection = await this.digNode.node.dial(addr)
      if (connection) {
        const isDIGNode = await this.testDIGProtocolSupport(connection)
        
        if (isDIGNode) {
          this.logger.info(`✅ Manual connection successful to DIG peer: ${peerAddress}`)
          return true
        } else {
          this.logger.warn(`⚠️ Connected peer is not a DIG node: ${peerAddress}`)
          await this.digNode.node.hangUp(connection.remotePeer)
          return false
        }
      }
      
      return false

    } catch (error) {
      this.logger.debug(`Manual connection failed to ${peerAddress}:`, error)
      return false
    }
  }

  // Get local DIG peers
  getLocalDIGPeers(): LocalDIGPeer[] {
    return Array.from(this.localDIGPeers.values())
  }

  // Get local network status
  getLocalNetworkStatus(): LocalNetworkStatus {
    return {
      localDIGPeers: this.localDIGPeers.size,
      lastScanTime: Date.now(), // Simplified
      scanningEnabled: !!this.scanInterval,
      localIP: this.getLocalIPAddress(),
      networkRange: 'auto-detected'
    }
  }

  // Stop local network discovery
  async stop(): Promise<void> {
    if (this.scanInterval) {
      clearInterval(this.scanInterval)
      this.scanInterval = null
    }
    this.logger.info('🛑 Local network discovery stopped')
  }
}

// Local DIG peer information
interface LocalDIGPeer {
  peerId: string
  cryptoIPv6: string
  stores: string[]
  capabilities: any
  localIP: string
  localPort: number
  lastSeen: number
  discoveredVia: 'local-scan' | 'local-announcement'
}

// Local network status
interface LocalNetworkStatus {
  localDIGPeers: number
  lastScanTime: number
  scanningEnabled: boolean
  localIP: Promise<string | null>
  networkRange: string
}
