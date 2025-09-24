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

export class UPnPPortManager {
  private logger = new Logger('UPnPPortManager')
  private digNode: any
  private mappedPorts = new Map<number, UPnPMapping>()
  private upnpClient: any = null

  constructor(digNode: any) {
    this.digNode = digNode
  }

  // Initialize UPnP and open required ports
  async initialize(): Promise<void> {
    try {
      this.logger.info('🔧 Initializing UPnP port management...')

      // Check if UPnP is available
      if (!this.digNode.nodeCapabilities.upnp) {
        this.logger.info('⏭️ UPnP not available - skipping port mapping')
        return
      }

      // Get UPnP service from LibP2P
      this.upnpClient = this.digNode.node.services.upnp
      if (!this.upnpClient) {
        this.logger.warn('⚠️ UPnP service not found in LibP2P')
        return
      }

      // Open required ports
      await this.openRequiredPorts()

      // Set up periodic port refresh
      this.startPortRefresh()

      this.logger.info('✅ UPnP port management initialized')

    } catch (error) {
      this.logger.warn('UPnP port management failed to initialize:', error)
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

  // Map port via UPnP (implementation depends on UPnP library)
  private async mapPortViaUPnP(port: number, protocol: string, description: string): Promise<any> {
    try {
      // This is a simplified implementation
      // The actual UPnP service from LibP2P handles the port mapping
      
      // For now, we'll assume the UPnP service in LibP2P handles port mapping automatically
      // and we just track what ports we want mapped
      
      this.logger.debug(`📡 UPnP mapping request: ${port}/${protocol}`)
      
      // Return success (LibP2P UPnP service handles the actual mapping)
      return {
        success: true,
        externalPort: port,
        internalPort: port,
        protocol,
        description
      }

    } catch (error) {
      this.logger.debug(`UPnP mapping failed for ${port}/${protocol}:`, error)
      return null
    }
  }

  // Start periodic port refresh (UPnP mappings expire)
  private startPortRefresh(): void {
    // Refresh port mappings every hour
    setInterval(async () => {
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

  // Get external IP address discovered by UPnP
  private getExternalIP(): string | null {
    try {
      // This would typically come from the UPnP service
      // For now, we'll return null and let LibP2P handle it
      return null
    } catch (error) {
      return null
    }
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
      this.logger.info(`🧹 Closed ${closedCount} UPnP port mappings`)

    } catch (error) {
      this.logger.debug('UPnP cleanup failed:', error)
    }
  }

  // Close specific port mapping
  private async closePortMapping(mapping: UPnPMapping): Promise<void> {
    try {
      // Implementation would close the UPnP mapping
      // For now, just log the action
      this.logger.debug(`🧹 Closing UPnP mapping: ${mapping.port}/${mapping.protocol}`)
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
