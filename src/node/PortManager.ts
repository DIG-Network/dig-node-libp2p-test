/**
 * Port Manager for DIG Network
 * 
 * Handles port allocation and conflict resolution:
 * - Detects port conflicts
 * - Finds available ports dynamically
 * - Manages port lifecycle
 * - Integrates with UPnP for external access
 */

import { createServer } from 'net'
import { Logger } from './logger.js'

export class PortManager {
  private logger = new Logger('PortManager')
  private allocatedPorts = new Map<string, number>()
  
  // Use UPnP-safe ports for Google Nest WiFi compatibility
  private readonly SAFE_PORTS = {
    HTTP: 8080,        // Standard HTTP alternate (universally allowed)
    WEBSOCKET: 8081,   // WebSocket (commonly allowed)
    LIBP2P: 8082,      // LibP2P main (safe range)
    TURN: 3478         // Standard TURN/STUN port (RFC 5766)
  }
  
  private portRangeStart = 8080
  private portRangeEnd = 8090

  constructor() {
    this.logger.info('🔧 Port manager initialized')
  }

  // Find available port starting from preferred port
  async findAvailablePort(preferredPort: number, purpose: string): Promise<number> {
    try {
      // First try the preferred port
      const isAvailable = await this.isPortAvailable(preferredPort)
      if (isAvailable) {
        this.allocatedPorts.set(purpose, preferredPort)
        this.logger.info(`✅ Port allocated: ${preferredPort} for ${purpose}`)
        return preferredPort
      }

      this.logger.warn(`⚠️ Port ${preferredPort} in use, finding alternative for ${purpose}`)

      // Search for alternative port in range
      for (let port = this.portRangeStart; port <= this.portRangeEnd; port++) {
        if (port === preferredPort) continue // Already tested

        const available = await this.isPortAvailable(port)
        if (available) {
          this.allocatedPorts.set(purpose, port)
          this.logger.info(`✅ Alternative port allocated: ${port} for ${purpose}`)
          return port
        }
      }

      throw new Error(`No available ports in range ${this.portRangeStart}-${this.portRangeEnd}`)

    } catch (error) {
      this.logger.error(`Failed to find available port for ${purpose}:`, error)
      throw error
    }
  }

  // Check if port is available
  private async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = createServer()
      
      server.listen(port, '0.0.0.0', () => {
        server.close(() => {
          resolve(true) // Port is available
        })
      })

      server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          resolve(false) // Port is in use
        } else {
          resolve(false) // Other error, assume unavailable
        }
      })
    })
  }

  // Get allocated port for purpose
  getAllocatedPort(purpose: string): number | null {
    return this.allocatedPorts.get(purpose) || null
  }

  // Get all allocated ports
  getAllocatedPorts(): Map<string, number> {
    return new Map(this.allocatedPorts)
  }

  // Release allocated port
  releasePort(purpose: string): void {
    const port = this.allocatedPorts.get(purpose)
    if (port) {
      this.allocatedPorts.delete(purpose)
      this.logger.info(`🧹 Released port: ${port} (${purpose})`)
    }
  }

  // Release all allocated ports
  releaseAllPorts(): void {
    const count = this.allocatedPorts.size
    this.allocatedPorts.clear()
    this.logger.info(`🧹 Released ${count} allocated ports`)
  }

  // Generate LibP2P address configuration with UPnP-safe ports
  async generateLibP2PAddressConfig(preferredPort: number, isAWS: boolean): Promise<any> {
    try {
      // Use safe ports for Google Nest WiFi compatibility, but ensure uniqueness
      const mainPort = await this.findAvailablePort(preferredPort || this.SAFE_PORTS.LIBP2P, 'libp2p-main')
      
      // Use next available port for WebSocket
      const wsPort = await this.findAvailablePort(mainPort + 1, 'libp2p-websocket')

      // Generate address configuration
      const addresses = {
        listen: isAWS ? [
          `/ip4/0.0.0.0/tcp/${mainPort}`,
          `/ip4/0.0.0.0/tcp/${wsPort}/ws`
        ] : [
          `/ip4/0.0.0.0/tcp/${mainPort}`,
          `/ip6/::/tcp/${mainPort}`,
          `/ip4/0.0.0.0/tcp/${wsPort}/ws`
        ]
      }

      this.logger.info(`🔧 Generated LibP2P address config: main=${mainPort}, ws=${wsPort}`)
      return { addresses, mainPort, wsPort }

    } catch (error) {
      this.logger.error('Failed to generate LibP2P address config:', error)
      throw error
    }
  }

  // Get port status summary
  getPortStatus(): PortStatus {
    return {
      allocatedPorts: Object.fromEntries(this.allocatedPorts),
      portRangeStart: this.portRangeStart,
      portRangeEnd: this.portRangeEnd,
      totalAllocated: this.allocatedPorts.size
    }
  }
}

// Port status information
interface PortStatus {
  allocatedPorts: Record<string, number>
  portRangeStart: number
  portRangeEnd: number
  totalAllocated: number
}
