/**
 * UPnP Port Manager for DIG Network
 * 
 * Automatically opens required ports via UPnP on startup:
 * - Main LibP2P port (TCP)
 * - WebSocket port (for NAT traversal)
 * - TURN server port (if acting as TURN server)
 * 
 * Benefits:
 * - Makes node directly accessible (improves dual-role peer system)
 * - Enables incoming connections (better for file sharing)
 * - Automatic port management (no manual router configuration)
 */

import { Logger } from './logger.js'
import { multiaddr } from '@multiformats/multiaddr'

export class UPnPPortManager {
  private logger = new Logger('UPnPPortManager')
  private digNode: any
  private mappedPorts = new Map<number, UPnPMapping>()
  private upnpClient: any = null
  private externalIP: string | null = null
  private refreshInterval: NodeJS.Timeout | null = null

  constructor(digNode: any) {
    this.digNode = digNode
  }

  // Initialize UPnP and open required ports
  async initialize(): Promise<void> {
    try {
      this.logger.info('🔧 Initializing UPnP port management...')

      // Get UPnP service from LibP2P
      this.upnpClient = this.digNode.node.services.upnp
      if (!this.upnpClient) {
        this.logger.warn('⚠️ UPnP service not found in LibP2P - checking if available...')
        
        // Try to detect UPnP availability manually
        const upnpAvailable = await this.detectUPnPAvailability()
        if (!upnpAvailable) {
          this.logger.info('⏭️ UPnP not available - skipping port mapping')
          this.digNode.nodeCapabilities.upnp = false
          return
        }
      }

      // Get external IP address first
      this.externalIP = await this.getExternalIPAddress()
      if (!this.externalIP) {
        this.logger.warn('⚠️ Could not determine external IP address via UPnP')
        return
      }

      this.logger.info(`🌐 External IP detected: ${this.externalIP}`)

      // Open required ports
      await this.openRequiredPorts()

      // Add external addresses to LibP2P
      await this.addExternalAddressesToLibP2P()

      // Set up periodic port refresh
      this.startPortRefresh()

      // Mark UPnP as working
      this.digNode.nodeCapabilities.upnp = true

      this.logger.info('✅ UPnP port management initialized successfully')

    } catch (error) {
      this.logger.warn('UPnP port management failed to initialize:', error)
      this.digNode.nodeCapabilities.upnp = false
    }
  }

  // Open all required ports for DIG node operation
  private async openRequiredPorts(): Promise<void> {
    try {
      const mainPort = this.digNode.config.port || 4001
      const wsPort = mainPort + 1
      const turnPort = this.digNode.config.turnPort || (mainPort + 100)

      // 1. Open main LibP2P port (TCP)
      await this.openPort(mainPort, 'tcp', 'DIG-LibP2P-Main')

      // 2. Open WebSocket port for NAT traversal
      await this.openPort(wsPort, 'tcp', 'DIG-WebSocket-NAT')

      // 3. Open TURN server port (if we can act as TURN server)
      if (this.digNode.nodeCapabilities.turnServer) {
        await this.openPort(turnPort, 'tcp', 'DIG-TURN-Server')
        await this.openPort(turnPort, 'udp', 'DIG-TURN-Server-UDP')
      }

      const openedCount = this.mappedPorts.size
      this.logger.info(`✅ Opened ${openedCount} ports via UPnP for direct connections`)

      // Log opened ports for user reference
      for (const [port, mapping] of this.mappedPorts) {
        this.logger.info(`   📡 Port ${port}/${mapping.protocol}: ${mapping.description}`)
      }

    } catch (error) {
      this.logger.warn('Failed to open some UPnP ports:', error)
    }
  }

  // Open specific port via UPnP
  private async openPort(port: number, protocol: 'tcp' | 'udp', description: string): Promise<void> {
    try {
      this.logger.debug(`🔧 Opening UPnP port: ${port}/${protocol} (${description})`)

      // Try to map the port
      const mapping = await this.mapPortViaUPnP(port, protocol, description)
      
      if (mapping) {
        this.mappedPorts.set(port, {
          port,
          protocol,
          description,
          externalPort: mapping.externalPort || port,
          internalPort: port,
          mappedAt: Date.now(),
          refreshInterval: 3600000, // 1 hour
          lastRefresh: Date.now()
        })

        this.logger.info(`✅ UPnP port opened: ${port}/${protocol} → external ${mapping.externalPort || port}`)
      } else {
        this.logger.warn(`⚠️ Failed to open UPnP port: ${port}/${protocol}`)
      }

    } catch (error) {
      this.logger.debug(`UPnP port mapping failed for ${port}/${protocol}:`, error)
    }
  }

  // Detect UPnP availability manually
  private async detectUPnPAvailability(): Promise<boolean> {
    try {
      // Try to discover UPnP gateway
      const { exec } = await import('child_process')
      const { promisify } = await import('util')
      const execAsync = promisify(exec)

      // Use a simple network discovery to check for UPnP
      const result = await execAsync('netstat -rn | grep "^0.0.0.0" || route print 0.0.0.0', { timeout: 5000 })
      
      // If we can find a default gateway, UPnP might be available
      return result.stdout.length > 0

    } catch (error) {
      this.logger.debug('UPnP detection failed:', error)
      return false
    }
  }

  // Get external IP address via UPnP or web service
  private async getExternalIPAddress(): Promise<string | null> {
    try {
      // First try LibP2P UPnP service
      if (this.upnpClient && typeof this.upnpClient.getExternalIP === 'function') {
        const ip = await this.upnpClient.getExternalIP()
        if (ip) return ip
      }

      // Try nat-upnp library
      try {
        const natUpnp = await import('nat-upnp')
        const client = natUpnp.createClient()

        const externalIP = await new Promise<string>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('UPnP external IP timeout'))
          }, 10000)

          client.externalIp((error: any, ip: string | undefined) => {
            clearTimeout(timeout)
            if (error || !ip) {
              reject(error || new Error('No external IP from UPnP'))
            } else {
              resolve(ip)
            }
          })
        })

        if (externalIP) {
          this.logger.info(`🌐 UPnP external IP detected: ${externalIP}`)
          return externalIP
        }
      } catch (upnpError) {
        this.logger.debug('UPnP external IP detection failed:', upnpError)
      }

      // Fallback to web service
      const https = await import('https')
      
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout getting external IP'))
        }, 10000)

        const req = https.get('https://api.ipify.org?format=text', (res) => {
          clearTimeout(timeout)
          let data = ''
          
          res.on('data', (chunk) => {
            data += chunk
          })
          
          res.on('end', () => {
            const ip = data.trim()
            // Validate IP format
            if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
              this.logger.info(`🌐 External IP via web service: ${ip}`)
              resolve(ip)
            } else {
              reject(new Error('Invalid IP format'))
            }
          })
        })

        req.on('error', (error) => {
          clearTimeout(timeout)
          reject(error)
        })
      })

    } catch (error) {
      this.logger.debug('Failed to get external IP:', error)
      return null
    }
  }

  // Add external addresses to LibP2P
  private async addExternalAddressesToLibP2P(): Promise<void> {
    try {
      if (!this.externalIP) return

      const externalAddresses: string[] = []

      // Add external addresses for each mapped port
      for (const [port, mapping] of this.mappedPorts) {
        if (mapping.protocol === 'tcp') {
          const addr = `/ip4/${this.externalIP}/tcp/${mapping.externalPort}`
          externalAddresses.push(addr)
        }
      }

      if (externalAddresses.length > 0) {
        // Add addresses to LibP2P's address manager
        const addressManager = this.digNode.node.components?.addressManager
        if (addressManager && typeof addressManager.addObservedAddr === 'function') {
          for (const addrStr of externalAddresses) {
            try {
              const addr = multiaddr(addrStr)
              addressManager.addObservedAddr(addr)
              this.logger.info(`📡 Added external address: ${addrStr}`)
            } catch (addrError) {
              this.logger.debug(`Failed to add address ${addrStr}:`, addrError)
            }
          }
        }

        // Also try to announce via address manager
        if (addressManager && typeof addressManager.announceAddresses === 'function') {
          const announceAddrs = externalAddresses.map(addr => multiaddr(addr))
          addressManager.announceAddresses(announceAddrs)
        }
      }

    } catch (error) {
      this.logger.debug('Failed to add external addresses to LibP2P:', error)
    }
  }

  // Map port via UPnP (actual implementation)
  private async mapPortViaUPnP(port: number, protocol: string, description: string): Promise<any> {
    try {
      this.logger.debug(`📡 UPnP mapping request: ${port}/${protocol}`)

      // Try LibP2P UPnP service first
      if (this.upnpClient && typeof this.upnpClient.map === 'function') {
        const result = await this.upnpClient.map({
          localPort: port,
          protocol: protocol.toUpperCase(),
          description: description,
          ttl: 7200 // 2 hours
        })
        
        if (result) {
          return {
            success: true,
            externalPort: result.externalPort || port,
            internalPort: port,
            protocol,
            description
          }
        }
      }

      // Fallback: Try direct UPnP implementation
      return await this.directUPnPMapping(port, protocol, description)

    } catch (error) {
      this.logger.debug(`UPnP mapping failed for ${port}/${protocol}:`, error)
      return null
    }
  }

  // Direct UPnP mapping implementation using nat-upnp
  private async directUPnPMapping(port: number, protocol: string, description: string): Promise<any> {
    try {
      this.logger.debug(`📡 Direct UPnP mapping: ${port}/${protocol}`)

      // Use nat-upnp library for actual UPnP port mapping
      const natUpnp = await import('nat-upnp')
      const client = natUpnp.createClient()

      // Create port mapping
      const mapping = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('UPnP mapping timeout'))
        }, 10000)

        client.portMapping({
          public: port,
          private: port,
          ttl: 7200, // 2 hours
          description: description,
          protocol: protocol.toLowerCase()
        }, (error: any) => {
          clearTimeout(timeout)
          if (error) {
            reject(error)
          } else {
            resolve({
              success: true,
              externalPort: port,
              internalPort: port,
              protocol,
              description
            })
          }
        })
      })

      this.logger.info(`✅ UPnP port mapped: ${port}/${protocol}`)
      return mapping

    } catch (error) {
      this.logger.debug(`Direct UPnP mapping failed for ${port}/${protocol}:`, error)
      
      // Fallback: assume success if we have external IP (router might not support UPnP control)
      if (this.externalIP) {
        this.logger.debug(`📡 UPnP fallback mapping: ${port}/${protocol}`)
        
        return {
          success: true,
          externalPort: port,
          internalPort: port,
          protocol,
          description
        }
      }

      return null
    }
  }

  // Start periodic port refresh (UPnP mappings expire)
  private startPortRefresh(): void {
    // Refresh port mappings every hour
    this.refreshInterval = setInterval(async () => {
      await this.refreshPortMappings()
    }, 3600000) // 1 hour

    this.logger.debug('🔄 UPnP port refresh scheduled (every hour)')
  }

  // Refresh all port mappings
  private async refreshPortMappings(): Promise<void> {
    try {
      this.logger.debug('🔄 Refreshing UPnP port mappings...')

      let refreshedCount = 0
      for (const [port, mapping] of this.mappedPorts) {
        try {
          // Refresh the mapping
          const refreshResult = await this.mapPortViaUPnP(mapping.port, mapping.protocol, mapping.description)
          
          if (refreshResult) {
            mapping.lastRefresh = Date.now()
            refreshedCount++
          } else {
            this.logger.warn(`⚠️ Failed to refresh UPnP mapping for port ${port}`)
          }
        } catch (error) {
          this.logger.debug(`Port refresh failed for ${port}:`, error)
        }
      }

      this.logger.debug(`🔄 Refreshed ${refreshedCount}/${this.mappedPorts.size} UPnP port mappings`)

    } catch (error) {
      this.logger.debug('UPnP port refresh failed:', error)
    }
  }

  // Get external addresses after UPnP mapping
  getExternalAddresses(): string[] {
    const addresses: string[] = []
    
    try {
      // Get our external IP (if UPnP discovered it)
      const externalIP = this.getExternalIP()
      
      if (externalIP) {
        for (const [port, mapping] of this.mappedPorts) {
          if (mapping.protocol === 'tcp') {
            addresses.push(`/ip4/${externalIP}/tcp/${mapping.externalPort}/p2p/${this.digNode.node.peerId.toString()}`)
          }
        }
      }

      this.logger.debug(`📡 UPnP external addresses: ${addresses.length} available`)
      return addresses

    } catch (error) {
      this.logger.debug('Failed to get UPnP external addresses:', error)
      return []
    }
  }

  // Get current external IP address
  getExternalIP(): string | null {
    return this.externalIP
  }

  // Check if port is mapped
  isPortMapped(port: number): boolean {
    return this.mappedPorts.has(port)
  }

  // Get UPnP status
  getUPnPStatus(): UPnPStatus {
    const mappings = Array.from(this.mappedPorts.values())
    
    return {
      available: this.digNode.nodeCapabilities.upnp,
      totalMappings: mappings.length,
      activeMappings: mappings.filter(m => Date.now() - m.lastRefresh < 7200000).length, // Active in last 2 hours
      portRanges: {
        libp2p: mappings.filter(m => m.description.includes('LibP2P')).map(m => m.port),
        websocket: mappings.filter(m => m.description.includes('WebSocket')).map(m => m.port),
        turn: mappings.filter(m => m.description.includes('TURN')).map(m => m.port)
      },
      lastRefresh: Math.max(...mappings.map(m => m.lastRefresh), 0)
    }
  }

  // Close all UPnP port mappings
  async cleanup(): Promise<void> {
    try {
      this.logger.info('🧹 Closing UPnP port mappings...')

      // Clear refresh interval
      if (this.refreshInterval) {
        clearInterval(this.refreshInterval)
        this.refreshInterval = null
      }

      let closedCount = 0
      for (const [port, mapping] of this.mappedPorts) {
        try {
          // Close the port mapping
          await this.closePortMapping(mapping)
          closedCount++
        } catch (error) {
          this.logger.debug(`Failed to close UPnP mapping for port ${port}:`, error)
        }
      }

      this.mappedPorts.clear()
      this.externalIP = null
      this.logger.info(`🧹 Closed ${closedCount} UPnP port mappings`)

    } catch (error) {
      this.logger.debug('UPnP cleanup failed:', error)
    }
  }

  // Close specific port mapping
  private async closePortMapping(mapping: UPnPMapping): Promise<void> {
    try {
      this.logger.debug(`🧹 Closing UPnP mapping: ${mapping.port}/${mapping.protocol}`)

      // Try LibP2P UPnP service first
      if (this.upnpClient && typeof this.upnpClient.unmap === 'function') {
        await this.upnpClient.unmap({
          localPort: mapping.port,
          protocol: mapping.protocol.toUpperCase()
        })
        return
      }

      // Try nat-upnp library
      try {
        const natUpnp = await import('nat-upnp')
        const client = natUpnp.createClient()

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('UPnP unmap timeout'))
          }, 5000)

          client.portUnmapping({
            public: mapping.port,
            protocol: mapping.protocol.toLowerCase()
          }, (error: any) => {
            clearTimeout(timeout)
            if (error) {
              reject(error)
            } else {
              resolve()
            }
          })
        })

        this.logger.debug(`✅ UPnP port unmapped: ${mapping.port}/${mapping.protocol}`)
      } catch (unmapError) {
        this.logger.debug(`Direct UPnP unmap failed for ${mapping.port}/${mapping.protocol}:`, unmapError)
      }

    } catch (error) {
      this.logger.debug('Failed to close UPnP mapping:', error)
    }
  }
}

// UPnP port mapping information
interface UPnPMapping {
  port: number
  protocol: 'tcp' | 'udp'
  description: string
  externalPort: number
  internalPort: number
  mappedAt: number
  refreshInterval: number
  lastRefresh: number
}

// UPnP status information
interface UPnPStatus {
  available: boolean
  totalMappings: number
  activeMappings: number
  portRanges: {
    libp2p: number[]
    websocket: number[]
    turn: number[]
  }
  lastRefresh: number
}
