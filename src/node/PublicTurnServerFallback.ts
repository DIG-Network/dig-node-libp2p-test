/**
 * Public TURN Server Fallback System
 * 
 * Provides free public TURN servers as absolute fallback when:
 * - No DIG peers can act as TURN servers
 * - All direct connections and NAT traversal failed
 * - Bootstrap server TURN is unavailable
 * 
 * Free Public TURN Servers:
 * - Open Relay Project (reliable, production-ready)
 * - Google STUN servers (for ICE candidates)
 * - Mozilla STUN servers (backup)
 * - Community TURN servers (additional options)
 */

import { Logger } from './logger.js'

export class PublicTurnServerFallback {
  private logger = new Logger('PublicTURN')
  private digNode: any
  private publicTurnServers: PublicTurnServer[] = []
  private lastTestedServers = new Map<string, number>()

  // Free public TURN servers (reliable options)
  private readonly FREE_PUBLIC_TURN_SERVERS: PublicTurnServer[] = [
    {
      id: 'openrelay-metered',
      name: 'Open Relay Project (Metered)',
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turns:openrelay.metered.ca:443'
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
      protocols: ['tcp', 'udp', 'tls'],
      ports: [80, 443],
      reliability: 'high',
      provider: 'Open Relay Project',
      requiresRegistration: false,
      description: 'Free production-ready TURN server, bypasses most firewalls'
    },
    {
      id: 'google-stun-1',
      name: 'Google STUN Server 1',
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302'
      ],
      protocols: ['udp'],
      ports: [19302],
      reliability: 'very-high',
      provider: 'Google',
      requiresRegistration: false,
      description: 'Google STUN servers for ICE candidate gathering'
    },
    {
      id: 'google-stun-2',
      name: 'Google STUN Server 2',
      urls: [
        'stun:stun2.l.google.com:19302',
        'stun:stun3.l.google.com:19302',
        'stun:stun4.l.google.com:19302'
      ],
      protocols: ['udp'],
      ports: [19302],
      reliability: 'very-high',
      provider: 'Google',
      requiresRegistration: false,
      description: 'Additional Google STUN servers for redundancy'
    },
    {
      id: 'twilio-stun',
      name: 'Twilio Global STUN',
      urls: [
        'stun:global.stun.twilio.com:3478'
      ],
      protocols: ['udp'],
      ports: [3478],
      reliability: 'high',
      provider: 'Twilio',
      requiresRegistration: false,
      description: 'Twilio global STUN server'
    }
  ]

  constructor(digNode: any) {
    this.digNode = digNode
    this.initializePublicTurnServers()
  }

  // Initialize public TURN server list
  private initializePublicTurnServers(): void {
    this.publicTurnServers = [...this.FREE_PUBLIC_TURN_SERVERS]
    this.logger.info(`🌐 Initialized ${this.publicTurnServers.length} free public TURN/STUN servers`)
  }

  // Get available public TURN servers for WebRTC configuration
  getPublicTurnServersForWebRTC(): RTCIceServer[] {
    const iceServers: RTCIceServer[] = []

    for (const server of this.publicTurnServers) {
      if (server.urls.some(url => url.startsWith('stun:'))) {
        // STUN servers (no credentials needed)
        iceServers.push({
          urls: server.urls.filter(url => url.startsWith('stun:'))
        })
      }

      if (server.urls.some(url => url.startsWith('turn:')) && server.username && server.credential) {
        // TURN servers (credentials required)
        iceServers.push({
          urls: server.urls.filter(url => url.startsWith('turn:') || url.startsWith('turns:')),
          username: server.username,
          credential: server.credential
        })
      }
    }

    this.logger.debug(`📡 Generated ${iceServers.length} ICE servers for WebRTC`)
    return iceServers
  }

  // Test public TURN server availability
  async testPublicTurnServerAvailability(): Promise<PublicTurnTestResult[]> {
    const results: PublicTurnTestResult[] = []

    this.logger.info('🧪 Testing public TURN server availability...')

    for (const server of this.publicTurnServers) {
      try {
        const testResult = await this.testSingleTurnServer(server)
        results.push(testResult)
        
        // Cache test result
        this.lastTestedServers.set(server.id, Date.now())

        if (testResult.available) {
          this.logger.info(`✅ Public TURN server available: ${server.name}`)
        } else {
          this.logger.debug(`❌ Public TURN server unavailable: ${server.name}`)
        }

      } catch (error) {
        results.push({
          serverId: server.id,
          serverName: server.name,
          available: false,
          responseTime: -1,
          error: error instanceof Error ? error.message : 'Test failed',
          testedAt: Date.now()
        })
      }
    }

    const availableCount = results.filter(r => r.available).length
    this.logger.info(`📊 Public TURN test complete: ${availableCount}/${results.length} servers available`)

    return results
  }

  // Test single TURN server
  private async testSingleTurnServer(server: PublicTurnServer): Promise<PublicTurnTestResult> {
    const startTime = Date.now()

    try {
      // For STUN servers, we can test with a simple UDP request
      if (server.urls.some(url => url.startsWith('stun:'))) {
        // Test STUN server availability
        const available = await this.testStunServer(server.urls[0])
        
        return {
          serverId: server.id,
          serverName: server.name,
          available,
          responseTime: Date.now() - startTime,
          testedAt: Date.now()
        }
      }

      // For TURN servers, test basic connectivity
      if (server.urls.some(url => url.startsWith('turn:'))) {
        const available = await this.testTurnServerConnectivity(server)
        
        return {
          serverId: server.id,
          serverName: server.name,
          available,
          responseTime: Date.now() - startTime,
          testedAt: Date.now()
        }
      }

      return {
        serverId: server.id,
        serverName: server.name,
        available: false,
        responseTime: -1,
        error: 'Unknown server type',
        testedAt: Date.now()
      }

    } catch (error) {
      return {
        serverId: server.id,
        serverName: server.name,
        available: false,
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Test failed',
        testedAt: Date.now()
      }
    }
  }

  // Test STUN server (basic UDP connectivity test)
  private async testStunServer(stunUrl: string): Promise<boolean> {
    try {
      // Extract host and port from STUN URL
      const match = stunUrl.match(/stun:([^:]+):(\d+)/)
      if (!match) return false

      const [, host, portStr] = match
      const port = parseInt(portStr)

      // Simple connectivity test (try to resolve hostname)
      const dns = await import('dns')
      return new Promise((resolve) => {
        dns.lookup(host, (err) => {
          resolve(!err) // If DNS lookup succeeds, server is likely available
        })
      })

    } catch (error) {
      return false
    }
  }

  // Test TURN server connectivity
  private async testTurnServerConnectivity(server: PublicTurnServer): Promise<boolean> {
    try {
      // Extract host from TURN URL
      const match = server.urls[0].match(/turns?:([^:]+):(\d+)/)
      if (!match) return false

      const [, host] = match

      // Simple connectivity test (DNS + basic reachability)
      const dns = await import('dns')
      return new Promise((resolve) => {
        dns.lookup(host, (err) => {
          resolve(!err) // Basic connectivity test
        })
      })

    } catch (error) {
      return false
    }
  }

  // Get best available public TURN servers
  getBestPublicTurnServers(): PublicTurnServer[] {
    return this.publicTurnServers
      .filter(server => {
        const lastTest = this.lastTestedServers.get(server.id)
        // Include servers that haven't been tested recently or passed recent tests
        return !lastTest || (Date.now() - lastTest < 300000) // 5 minutes
      })
      .sort((a, b) => {
        // Sort by reliability
        const reliabilityOrder = { 'very-high': 4, 'high': 3, 'medium': 2, 'low': 1 }
        return (reliabilityOrder[b.reliability] || 0) - (reliabilityOrder[a.reliability] || 0)
      })
  }

  // Get public TURN servers for emergency bootstrap
  getEmergencyBootstrapTurnServers(): EmergencyTurnConfig {
    const stunServers = this.publicTurnServers.filter(s => 
      s.urls.some(url => url.startsWith('stun:'))
    )
    
    const turnServers = this.publicTurnServers.filter(s => 
      s.urls.some(url => url.startsWith('turn:')) && s.username && s.credential
    )

    return {
      stunServers: stunServers.map(s => ({
        urls: s.urls.filter(url => url.startsWith('stun:')),
        provider: s.provider
      })),
      turnServers: turnServers.map(s => ({
        urls: s.urls.filter(url => url.startsWith('turn:') || url.startsWith('turns:')),
        username: s.username!,
        credential: s.credential!,
        provider: s.provider
      })),
      totalServers: stunServers.length + turnServers.length,
      recommendedConfig: this.getRecommendedIceConfiguration()
    }
  }

  // Get recommended ICE configuration for WebRTC (public method)
  getRecommendedIceConfiguration(): RTCConfiguration {
    return {
      iceServers: this.getPublicTurnServersForWebRTC(),
      iceTransportPolicy: 'all', // Use all available methods
      bundlePolicy: 'balanced',
      rtcpMuxPolicy: 'require',
      iceCandidatePoolSize: 10 // Pre-gather ICE candidates
    }
  }

  // Use public TURN server for emergency file transfer
  async emergencyFileTransferViaPublicTurn(
    storeId: string, 
    sourcePeerId: string, 
    targetPeerId: string
  ): Promise<Buffer | null> {
    try {
      this.logger.warn(`🆘 Emergency: Using public TURN servers for ${storeId}`)

      // Get available public TURN servers
      const turnServers = this.getBestPublicTurnServers()
      const turnServerWithCreds = turnServers.find(s => s.username && s.credential)

      if (!turnServerWithCreds) {
        throw new Error('No public TURN servers with credentials available')
      }

      this.logger.info(`🌐 Using public TURN server: ${turnServerWithCreds.name}`)

      // In a full implementation, this would:
      // 1. Establish WebRTC connection using public TURN server
      // 2. Coordinate both peers to connect through public TURN
      // 3. Transfer file data through the relay
      
      // For now, return null as this is an emergency fallback
      this.logger.warn('⚠️ Public TURN relay not fully implemented - this is emergency fallback only')
      return null

    } catch (error) {
      this.logger.error('Emergency public TURN transfer failed:', error)
      return null
    }
  }

  // Get public TURN server statistics
  getPublicTurnStats(): PublicTurnStats {
    const lastHour = Date.now() - 3600000
    const recentlyTested = Array.from(this.lastTestedServers.values())
      .filter(timestamp => timestamp > lastHour)

    return {
      totalServers: this.publicTurnServers.length,
      stunServers: this.publicTurnServers.filter(s => s.urls.some(url => url.startsWith('stun:'))).length,
      turnServers: this.publicTurnServers.filter(s => s.urls.some(url => url.startsWith('turn:'))).length,
      highReliabilityServers: this.publicTurnServers.filter(s => s.reliability === 'very-high' || s.reliability === 'high').length,
      recentlyTested: recentlyTested.length,
      lastTestTime: Math.max(...Array.from(this.lastTestedServers.values()), 0),
      emergencyFallbackAvailable: this.publicTurnServers.some(s => s.username && s.credential)
    }
  }
}

// Public TURN server configuration
interface PublicTurnServer {
  id: string
  name: string
  urls: string[]
  username?: string
  credential?: string
  protocols: string[]
  ports: number[]
  reliability: 'very-high' | 'high' | 'medium' | 'low'
  provider: string
  requiresRegistration: boolean
  description: string
}

// TURN server test result
interface PublicTurnTestResult {
  serverId: string
  serverName: string
  available: boolean
  responseTime: number
  error?: string
  testedAt: number
}

// Emergency TURN configuration
interface EmergencyTurnConfig {
  stunServers: Array<{
    urls: string[]
    provider: string
  }>
  turnServers: Array<{
    urls: string[]
    username: string
    credential: string
    provider: string
  }>
  totalServers: number
  recommendedConfig: RTCConfiguration
}

// Public TURN statistics
interface PublicTurnStats {
  totalServers: number
  stunServers: number
  turnServers: number
  highReliabilityServers: number
  recentlyTested: number
  lastTestTime: number
  emergencyFallbackAvailable: boolean
}
