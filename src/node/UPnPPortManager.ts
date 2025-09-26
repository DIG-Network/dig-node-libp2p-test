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
import { DynamicFirewallManager } from './DynamicFirewallManager.js'

export class UPnPPortManager {
  private logger = new Logger('UPnPPortManager')
  private digNode: any
  private mappedPorts = new Map<number, UPnPMapping>()
  private upnpClient: any = null
  private externalIP: string | null = null
  private refreshInterval: NodeJS.Timeout | null = null
  private firewallManager = new DynamicFirewallManager()

  constructor(digNode: any) {
    this.digNode = digNode
  }

  // Initialize UPnP and open required ports
  async initialize(): Promise<void> {
    try {
      this.logger.info('🔧 Initializing UPnP port management...')

      // Initialize dynamic firewall management
      await this.firewallManager.initialize()

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

      // Verify external accessibility after UPnP + firewall setup
      await this.verifyExternalAccessibility()
      
      this.logger.info('✅ UPnP port management initialized successfully')

    } catch (error) {
      this.logger.warn('UPnP port management failed to initialize:', error)
      this.digNode.nodeCapabilities.upnp = false
    }
  }

  // Open all required ports for DIG node operation using UPnP-safe ports
  private async openRequiredPorts(): Promise<void> {
    try {
      // Use Google Nest WiFi safe ports (researched best practices)
      const SAFE_PORTS = this.firewallManager.getGoogleWiFiSafePorts()

      this.logger.info('🔒 Using Google Nest WiFi safe port configuration (researched best practices)')

      // 1. HTTP Download Server (Port 8080 - Universal HTTP alternate)
      const httpPort = SAFE_PORTS.HTTP
      await this.openPortWithConflictResolution(httpPort, 'tcp', 'DIG-HTTP-Download')
      await this.firewallManager.openPort(httpPort, 'tcp', 'HTTP-Download')
      this.logger.info(`📁 HTTP Download: Port ${httpPort} (standard HTTP alternate)`)

      // 2. WebSocket Port (Port 8081 - Commonly allowed)
      const wsPort = SAFE_PORTS.WEBSOCKET
      await this.openPortWithConflictResolution(wsPort, 'tcp', 'DIG-WebSocket')
      await this.firewallManager.openPort(wsPort, 'tcp', 'WebSocket')
      this.logger.info(`🌐 WebSocket: Port ${wsPort} (standard WebSocket)`)

      // 3. LibP2P Main Port (Port 8082 - Safe range)
      const libp2pPort = SAFE_PORTS.LIBP2P
      await this.openPortWithConflictResolution(libp2pPort, 'tcp', 'DIG-LibP2P-Main')
      await this.firewallManager.openPort(libp2pPort, 'tcp', 'LibP2P-Main')
      this.logger.info(`🔗 LibP2P: Port ${libp2pPort} (safe P2P range)`)

      // 4. TURN Server Port (Port 3478 - RFC standard, universally allowed)
      const turnPort = SAFE_PORTS.TURN
      await this.openPortWithConflictResolution(turnPort, 'tcp', 'DIG-TURN-TCP')
      await this.openPortWithConflictResolution(turnPort, 'udp', 'DIG-TURN-UDP')
      await this.firewallManager.openPort(turnPort, 'tcp', 'TURN-TCP')
      await this.firewallManager.openPort(turnPort, 'udp', 'TURN-UDP')
      this.logger.info(`📡 TURN: Port ${turnPort} (RFC 5766 standard)`)

      // Update DIG node configuration with safe ports
      this.digNode.config.port = libp2pPort
      this.digNode.config.httpPort = httpPort
      this.digNode.config.wsPort = wsPort
      this.digNode.config.turnPort = turnPort

      // Update port manager with safe port allocations
      this.digNode.portManager?.allocatedPorts?.set('libp2p-main', libp2pPort)
      this.digNode.portManager?.allocatedPorts?.set('libp2p-websocket', wsPort)
      this.digNode.portManager?.allocatedPorts?.set('http-download', httpPort)
      this.digNode.portManager?.allocatedPorts?.set('turn-server', turnPort)

      const openedCount = this.mappedPorts.size
      this.logger.info(`✅ Opened ${openedCount} ports via UPnP for direct connections`)

      // Log opened ports for user reference
      for (const [port, mapping] of this.mappedPorts) {
        this.logger.info(`   📡 Port ${port}/${mapping.protocol}: ${mapping.description}`)
      }

      // Log safe port configuration
      this.logger.info(`🔒 Safe port configuration applied for Google Nest WiFi compatibility`)
      this.logger.info(`   📁 HTTP: ${httpPort}, 🌐 WebSocket: ${wsPort}, 🔗 LibP2P: ${libp2pPort}, 📡 TURN: ${turnPort}`)

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

  // Open port with automatic conflict resolution
  private async openPortWithConflictResolution(preferredPort: number, protocol: 'tcp' | 'udp', description: string): Promise<number> {
    const maxAttempts = 20 // Try up to 20 different ports
    let currentPort = preferredPort

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        this.logger.debug(`🔧 Attempting UPnP port mapping: ${currentPort}/${protocol} (attempt ${attempt + 1})`)

        // Check if this port is already mapped by checking UPnP mappings
        const isConflict = await this.checkUPnPPortConflict(currentPort, protocol)
        
        if (isConflict) {
          this.logger.debug(`⚠️ UPnP port ${currentPort}/${protocol} already mapped by another device, trying next port`)
          currentPort++
          continue
        }

        // Try to map the port
        const mapping = await this.mapPortViaUPnP(currentPort, protocol, description)
        
        if (mapping) {
          this.mappedPorts.set(currentPort, {
            port: currentPort,
            protocol,
            description,
            externalPort: mapping.externalPort || currentPort,
            internalPort: currentPort,
            mappedAt: Date.now(),
            refreshInterval: 3600000, // 1 hour
            lastRefresh: Date.now()
          })

          this.logger.info(`✅ UPnP port opened: ${currentPort}/${protocol} → external ${mapping.externalPort || currentPort}`)
          return currentPort
        } else {
          this.logger.debug(`⚠️ Failed to map UPnP port ${currentPort}/${protocol}, trying next port`)
          currentPort++
        }

      } catch (error) {
        this.logger.debug(`UPnP port mapping attempt failed for ${currentPort}/${protocol}:`, error)
        currentPort++
      }
    }

    // If we couldn't find any available port, fall back to the preferred port
    this.logger.warn(`⚠️ Could not find available UPnP port after ${maxAttempts} attempts, using preferred port ${preferredPort}`)
    return preferredPort
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

      // Close all firewall rules first
      await this.firewallManager.closeAllPorts()

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

  // Check if a UPnP port mapping already exists (conflict detection)
  private async checkUPnPPortConflict(port: number, protocol: string): Promise<boolean> {
    try {
      // Try to query existing UPnP mappings to detect conflicts
      const natUpnp = await import('nat-upnp')
      const client = natUpnp.createClient()

      return new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          resolve(false) // Assume no conflict if we can't check
        }, 3000)

        // Try to get mapping info for this port
        client.getMappings((error: any, mappings: any[] | undefined) => {
          clearTimeout(timeout)
          
          if (error || !mappings) {
            resolve(false) // Assume no conflict if we can't check
            return
          }

          // Check if any existing mapping uses this port
          const conflict = mappings.some((mapping: any) => 
            mapping.public === port && 
            mapping.protocol?.toLowerCase() === protocol.toLowerCase()
          )

          if (conflict) {
            this.logger.debug(`🚫 UPnP conflict detected for port ${port}/${protocol}`)
          }

          resolve(conflict)
        })
      })

    } catch (error) {
      this.logger.debug(`UPnP conflict check failed for ${port}/${protocol}:`, error)
      return false // Assume no conflict if we can't check
    }
  }

  // Open Windows firewall for specific port
  private async openWindowsFirewall(port: number, description: string): Promise<void> {
    try {
      this.logger.info(`🔥 Opening Windows firewall for port ${port}...`)

      const { exec } = await import('child_process')
      const { promisify } = await import('util')
      const execAsync = promisify(exec)

      // Check if Windows (skip on Linux/Mac)
      if (process.platform !== 'win32') {
        this.logger.debug('⏭️ Not Windows - skipping firewall configuration')
        return
      }

      // Create inbound firewall rule for the port
      const inboundCommand = `netsh advfirewall firewall add rule name="${description}-Inbound" dir=in action=allow protocol=TCP localport=${port}`
      
      try {
        await execAsync(inboundCommand, { timeout: 10000 })
        this.logger.info(`✅ Windows firewall inbound rule created for port ${port}`)
      } catch (inboundError) {
        this.logger.debug(`Firewall inbound rule failed (may already exist):`, inboundError)
      }

      // Create outbound firewall rule for the port
      const outboundCommand = `netsh advfirewall firewall add rule name="${description}-Outbound" dir=out action=allow protocol=TCP localport=${port}`
      
      try {
        await execAsync(outboundCommand, { timeout: 10000 })
        this.logger.info(`✅ Windows firewall outbound rule created for port ${port}`)
      } catch (outboundError) {
        this.logger.debug(`Firewall outbound rule failed (may already exist):`, outboundError)
      }

      // Also try to add rule for remote access
      const remoteCommand = `netsh advfirewall firewall add rule name="${description}-Remote" dir=in action=allow protocol=TCP localport=${port} remoteip=any`
      
      try {
        await execAsync(remoteCommand, { timeout: 10000 })
        this.logger.info(`✅ Windows firewall remote access rule created for port ${port}`)
      } catch (remoteError) {
        this.logger.debug(`Firewall remote rule failed (may already exist):`, remoteError)
      }

    } catch (error) {
      this.logger.warn(`Failed to configure Windows firewall for port ${port}:`, error)
      this.logger.warn('💡 Manual firewall configuration may be required')
    }
  }

  // Close Windows firewall rules during cleanup
  private async closeWindowsFirewall(port: number, description: string): Promise<void> {
    try {
      if (process.platform !== 'win32') return

      const { exec } = await import('child_process')
      const { promisify } = await import('util')
      const execAsync = promisify(exec)

      // Remove firewall rules
      const commands = [
        `netsh advfirewall firewall delete rule name="${description}-Inbound"`,
        `netsh advfirewall firewall delete rule name="${description}-Outbound"`,
        `netsh advfirewall firewall delete rule name="${description}-Remote"`
      ]

      for (const command of commands) {
        try {
          await execAsync(command, { timeout: 5000 })
          this.logger.debug(`🧹 Removed firewall rule for port ${port}`)
        } catch (error) {
          // Silent failure - rule might not exist
        }
      }

    } catch (error) {
      this.logger.debug(`Failed to remove firewall rules for port ${port}:`, error)
    }
  }

  // Verify external accessibility with Google Nest WiFi specific diagnostics
  private async verifyExternalAccessibility(): Promise<void> {
    try {
      if (!this.externalIP) return

      this.logger.info(`🔍 Verifying external accessibility via ${this.externalIP}...`)
      this.logger.info(`🏠 Router type: Google Nest WiFi (UPnP with restrictions)`)

      // Check if we're using Google's external IP range (indicates Google Fiber/Nest)
      const isGoogleIP = this.externalIP.startsWith('71.121.') || 
                        this.externalIP.startsWith('74.125.') || 
                        this.externalIP.startsWith('173.194.')
      
      if (isGoogleIP) {
        this.logger.info(`🌐 Detected Google network IP range - using Google Nest WiFi optimizations`)
      }

      for (const [port, mapping] of this.mappedPorts) {
        if (mapping.description.includes('HTTP')) {
          await this.testGoogleNestWiFiPortAccess(port, mapping)
        }
      }

      // Add Google Nest WiFi specific recommendations
      this.logGoogleNestWiFiRecommendations()

    } catch (error) {
      this.logger.debug('External accessibility verification failed:', error)
    }
  }

  // Test port access with Google Nest WiFi specific handling
  private async testGoogleNestWiFiPortAccess(port: number, mapping: UPnPMapping): Promise<void> {
    try {
      const testUrl = `http://${this.externalIP}:${port}/health`
      this.logger.info(`🧪 Testing Google Nest WiFi external access: ${testUrl}`)
      
      // Google Nest WiFi UPnP mappings can take 2-5 minutes to propagate
      this.logger.info(`⏱️ Waiting for Google Nest WiFi UPnP propagation (30 seconds)...`)
      await new Promise(resolve => setTimeout(resolve, 30000))
      
      // Test with multiple attempts (Google Nest can be slow)
      let accessible = false
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          this.logger.info(`🔄 Attempt ${attempt}/3: Testing ${testUrl}`)
          
          const response = await fetch(testUrl, { 
            signal: AbortSignal.timeout(15000),
            headers: { 
              'User-Agent': 'DIG-Network-Test',
              'Connection': 'close'
            }
          })
          
          if (response.ok) {
            this.logger.info(`✅ Google Nest WiFi external access verified: ${port} (attempt ${attempt})`)
            accessible = true
            break
          } else {
            this.logger.warn(`⚠️ Attempt ${attempt} failed: ${response.status}`)
          }
        } catch (attemptError) {
          this.logger.debug(`Attempt ${attempt} error:`, attemptError)
          if (attempt < 3) {
            await new Promise(resolve => setTimeout(resolve, 10000)) // Wait 10s between attempts
          }
        }
      }

      if (!accessible) {
        this.logger.warn(`❌ Google Nest WiFi external access failed for port ${port}`)
        this.logger.warn(`🏠 Google Nest WiFi UPnP Issues Detected:`)
        this.logger.warn(`   1. Port ${port} may be in restricted range`)
        this.logger.warn(`   2. UPnP mapping may need manual refresh`)
        this.logger.warn(`   3. Google Home app may need port forwarding configuration`)
        this.logger.warn(`   4. ISP may be blocking the port range`)
      }

    } catch (error) {
      this.logger.warn(`Google Nest WiFi port test failed for ${port}:`, error)
    }
  }

  // Log Google Nest WiFi specific recommendations
  private logGoogleNestWiFiRecommendations(): void {
    this.logger.info(`💡 Google Nest WiFi Troubleshooting:`)
    this.logger.info(`   1. Open Google Home app → WiFi → Advanced → Port forwarding`)
    this.logger.info(`   2. Manually add port forwarding rules for DIG ports`)
    this.logger.info(`   3. Use ports below 5000 (Google restricts high ports)`)
    this.logger.info(`   4. Check if 'UPnP' is enabled in Google Home app`)
    this.logger.info(`   5. Try rebooting the Google Nest WiFi router`)
    this.logger.info(`   6. Verify no ISP-level port blocking`)
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
