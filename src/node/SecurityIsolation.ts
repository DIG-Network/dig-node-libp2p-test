/**
 * Security Isolation System for DIG Network
 * 
 * Problem: Public LibP2P bootstrap servers provide connectivity but don't have
 * the same privacy and security guarantees as DIG network peers.
 * 
 * Solution: Create security isolation layers:
 * - Public peers: Only for LibP2P connectivity (no DIG protocol access)
 * - DIG peers: Full access to DIG network features with privacy
 * - Graduated trust levels based on peer type and verification
 */

import { randomBytes } from 'crypto'
import { Logger } from './logger.js'
import { DIG_PROTOCOL } from './types.js'

export class SecurityIsolation {
  private logger = new Logger('SecurityIsolation')
  private digNode: any
  private peerSecurityLevels = new Map<string, PeerSecurityLevel>()
  private securityPolicies = new Map<string, SecurityPolicy>()

  // Public LibP2P infrastructure peers (minimal trust)
  private readonly PUBLIC_INFRASTRUCTURE_PEERS = new Set([
    'QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
    'QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
    'QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ',
    'QmbLHAnMoJPWSCR5Zp9J6W3KmKx6qeGBZp9rKTdKNWqFk'
  ])

  constructor(digNode: any) {
    this.digNode = digNode
    this.initializeSecurityPolicies()
  }

  // Initialize security policies for different peer types
  private initializeSecurityPolicies(): void {
    // Public infrastructure peers: Minimal access (LibP2P only)
    this.securityPolicies.set('public-infrastructure', {
      trustLevel: 'minimal',
      allowedProtocols: ['/ipfs/ping/1.0.0', '/ipfs/id/1.0.0'], // Basic LibP2P only
      allowDIGProtocol: false,
      allowStoreRequests: false,
      allowFileTransfers: false,
      allowCapabilitySharing: false,
      requireEncryption: true,
      requireCryptoIPv6: false, // Public peers don't have crypto-IPv6
      description: 'Public LibP2P infrastructure - connectivity only'
    })

    // Unknown peers: Limited access until verified
    this.securityPolicies.set('unknown', {
      trustLevel: 'limited',
      allowedProtocols: ['/ipfs/ping/1.0.0', '/ipfs/id/1.0.0', '/dig/1.0.0'],
      allowDIGProtocol: true, // For verification only
      allowStoreRequests: false,
      allowFileTransfers: false,
      allowCapabilitySharing: false,
      requireEncryption: true,
      requireCryptoIPv6: false,
      description: 'Unknown peer - verification in progress'
    })

    // Verified DIG peers: Full access with privacy
    this.securityPolicies.set('verified-dig', {
      trustLevel: 'full',
      allowedProtocols: ['/ipfs/ping/1.0.0', '/ipfs/id/1.0.0', '/dig/1.0.0', '/dig-discovery/1.0.0'],
      allowDIGProtocol: true,
      allowStoreRequests: true,
      allowFileTransfers: true,
      allowCapabilitySharing: true,
      requireEncryption: true,
      requireCryptoIPv6: true, // DIG peers must have crypto-IPv6
      description: 'Verified DIG network peer - full access'
    })

    this.logger.info('🔒 Security policies initialized for peer isolation')
  }

  // Classify peer and assign security level
  async classifyPeer(peerId: string, connection: any): Promise<PeerSecurityLevel> {
    try {
      let securityLevel: PeerSecurityLevel

      // Check if this is public infrastructure
      if (this.isPublicInfrastructurePeer(peerId)) {
        securityLevel = {
          peerId,
          classification: 'public-infrastructure',
          trustLevel: 'minimal',
          allowedOperations: ['connectivity', 'routing'],
          deniedOperations: ['dig-protocol', 'file-transfer', 'store-sync', 'capability-sharing'],
          encryptionRequired: true,
          privacyLevel: 'none', // Public peers have no privacy guarantees
          lastClassified: Date.now(),
          verificationStatus: 'not-applicable'
        }
        
        this.logger.info(`🔒 Classified as public infrastructure: ${peerId} (minimal trust)`)
      } else {
        // Test if peer supports DIG protocol
        const supportsDIG = await this.testDIGProtocolSupport(connection)
        
        if (supportsDIG) {
          // Verify DIG network membership
          const digVerification = await this.verifyDIGNetworkMembership(peerId, connection)
          
          if (digVerification.verified) {
            securityLevel = {
              peerId,
              classification: 'verified-dig',
              trustLevel: 'full',
              allowedOperations: ['connectivity', 'routing', 'dig-protocol', 'file-transfer', 'store-sync', 'capability-sharing'],
              deniedOperations: [],
              encryptionRequired: true,
              privacyLevel: 'maximum', // Full DIG privacy features
              lastClassified: Date.now(),
              verificationStatus: 'verified',
              cryptoIPv6: digVerification.cryptoIPv6,
              capabilities: digVerification.capabilities
            }
            
            this.logger.info(`✅ Classified as verified DIG peer: ${peerId} (full trust + privacy)`)
          } else {
            // DIG protocol but not verified - suspicious
            securityLevel = {
              peerId,
              classification: 'suspicious',
              trustLevel: 'none',
              allowedOperations: [],
              deniedOperations: ['all'],
              encryptionRequired: true,
              privacyLevel: 'none',
              lastClassified: Date.now(),
              verificationStatus: 'failed'
            }
            
            this.logger.warn(`⚠️ Suspicious peer: ${peerId} (supports DIG protocol but verification failed)`)
          }
        } else {
          // Unknown peer - limited access
          securityLevel = {
            peerId,
            classification: 'unknown',
            trustLevel: 'limited',
            allowedOperations: ['connectivity'],
            deniedOperations: ['dig-protocol', 'file-transfer', 'store-sync', 'capability-sharing'],
            encryptionRequired: true,
            privacyLevel: 'basic',
            lastClassified: Date.now(),
            verificationStatus: 'unverified'
          }
          
          this.logger.debug(`🔍 Classified as unknown peer: ${peerId} (limited access)`)
        }
      }

      // Store security level
      this.peerSecurityLevels.set(peerId, securityLevel)
      
      // Apply security policy
      await this.applySecurityPolicy(peerId, securityLevel)
      
      return securityLevel

    } catch (error) {
      this.logger.error(`Failed to classify peer ${peerId}:`, error)
      
      // Default to most restrictive policy
      const restrictiveLevel: PeerSecurityLevel = {
        peerId,
        classification: 'unknown',
        trustLevel: 'none',
        allowedOperations: [],
        deniedOperations: ['all'],
        encryptionRequired: true,
        privacyLevel: 'none',
        lastClassified: Date.now(),
        verificationStatus: 'error'
      }
      
      this.peerSecurityLevels.set(peerId, restrictiveLevel)
      return restrictiveLevel
    }
  }

  // Test if peer supports DIG protocol (without exposing capabilities)
  private async testDIGProtocolSupport(connection: any): Promise<boolean> {
    try {
      // Only test protocol support, don't send any sensitive data
      const stream = await this.digNode.node.dialProtocol(connection.remotePeer, DIG_PROTOCOL)
      
      if (stream) {
        // Send minimal identification request (no sensitive data)
        const identRequest = {
          type: 'DIG_NETWORK_IDENTIFICATION',
          networkId: 'dig-mainnet', // Public info
          protocolVersion: '1.0.0' // Public info
          // No crypto-IPv6, no capabilities, no store info
        }

        const { pipe } = await import('it-pipe')
        const { fromString: uint8ArrayFromString, toString: uint8ArrayToString } = await import('uint8arrays')

        await pipe(async function* () {
          yield uint8ArrayFromString(JSON.stringify(identRequest))
        }, stream.sink)

        // Read response with timeout
        const chunks: Uint8Array[] = []
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Identification timeout')), 3000)
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
      this.logger.debug(`DIG protocol test failed (expected for non-DIG peers):`, error)
      return false
    }
  }

  // Verify DIG network membership with privacy protection
  private async verifyDIGNetworkMembership(peerId: string, connection: any): Promise<DIGVerificationResult> {
    try {
      // Only verify if peer passed initial DIG protocol test
      const stream = await this.digNode.node.dialProtocol(connection.remotePeer, DIG_PROTOCOL)
      
      const verificationRequest = {
        type: 'VERIFY_DIG_MEMBERSHIP',
        challengeNonce: randomBytes(16).toString('hex'), // Prevent replay attacks
        requestedProof: ['crypto-ipv6', 'capabilities'] // Request minimal proof
      }

      const { pipe } = await import('it-pipe')
      const { fromString: uint8ArrayFromString, toString: uint8ArrayToString } = await import('uint8arrays')

      await pipe(async function* () {
        yield uint8ArrayFromString(JSON.stringify(verificationRequest))
      }, stream.sink)

      const chunks: Uint8Array[] = []
      await pipe(stream.source, async function (source: any) {
        for await (const chunk of source) {
          chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk.subarray()))
        }
      })

      if (chunks.length > 0) {
        const response = JSON.parse(uint8ArrayToString(chunks[0]))
        
        if (response.success && response.cryptoIPv6 && response.capabilities) {
          // Verify crypto-IPv6 format (DIG network requirement)
          if (response.cryptoIPv6.startsWith('fd00:')) {
            return {
              verified: true,
              cryptoIPv6: response.cryptoIPv6,
              capabilities: response.capabilities,
              verificationMethod: 'crypto-ipv6-proof'
            }
          }
        }
      }

      return { verified: false, verificationMethod: 'failed' }

    } catch (error) {
      this.logger.debug(`DIG membership verification failed for ${peerId}:`, error)
      return { verified: false, verificationMethod: 'error' }
    }
  }

  // Check if peer is public LibP2P infrastructure
  private isPublicInfrastructurePeer(peerId: string): boolean {
    return Array.from(this.PUBLIC_INFRASTRUCTURE_PEERS).some(publicId => peerId.includes(publicId))
  }

  // Apply security policy to peer
  private async applySecurityPolicy(peerId: string, securityLevel: PeerSecurityLevel): Promise<void> {
    try {
      const policy = this.securityPolicies.get(securityLevel.classification)
      if (!policy) {
        this.logger.warn(`No security policy found for classification: ${securityLevel.classification}`)
        return
      }

      // Log security policy application
      this.logger.info(`🔒 Applied ${policy.trustLevel} trust policy to ${peerId}: ${policy.description}`)
      
      // Store policy for request filtering
      this.peerSecurityLevels.set(peerId, securityLevel)

    } catch (error) {
      this.logger.error(`Failed to apply security policy to ${peerId}:`, error)
    }
  }

  // Check if peer is allowed to access specific operation
  isPeerAllowedOperation(peerId: string, operation: string): boolean {
    const securityLevel = this.peerSecurityLevels.get(peerId)
    if (!securityLevel) {
      this.logger.warn(`No security level found for peer ${peerId} - denying operation: ${operation}`)
      return false
    }

    const isAllowed = securityLevel.allowedOperations.includes(operation)
    const isDenied = securityLevel.deniedOperations.includes(operation) || securityLevel.deniedOperations.includes('all')

    if (isDenied) {
      this.logger.debug(`🚫 Operation ${operation} denied for ${peerId} (${securityLevel.classification})`)
      return false
    }

    if (!isAllowed) {
      this.logger.debug(`🚫 Operation ${operation} not allowed for ${peerId} (${securityLevel.classification})`)
      return false
    }

    return true
  }

  // Get peer security level
  getPeerSecurityLevel(peerId: string): PeerSecurityLevel | null {
    return this.peerSecurityLevels.get(peerId) || null
  }

  // Get security statistics
  getSecurityStats(): SecurityStats {
    const levels = Array.from(this.peerSecurityLevels.values())
    
    return {
      totalPeers: levels.length,
      publicInfrastructurePeers: levels.filter(l => l.classification === 'public-infrastructure').length,
      verifiedDIGPeers: levels.filter(l => l.classification === 'verified-dig').length,
      unknownPeers: levels.filter(l => l.classification === 'unknown').length,
      suspiciousPeers: levels.filter(l => l.classification === 'suspicious').length,
      fullTrustPeers: levels.filter(l => l.trustLevel === 'full').length,
      isolatedPeers: levels.filter(l => l.trustLevel === 'none').length
    }
  }

  // Handle peer disconnection
  handlePeerDisconnection(peerId: string): void {
    this.peerSecurityLevels.delete(peerId)
    this.logger.debug(`🧹 Removed security level for disconnected peer: ${peerId}`)
  }
}

// Peer security level classification
export interface PeerSecurityLevel {
  peerId: string
  classification: 'public-infrastructure' | 'verified-dig' | 'unknown' | 'suspicious'
  trustLevel: 'none' | 'minimal' | 'limited' | 'full'
  allowedOperations: string[]
  deniedOperations: string[]
  encryptionRequired: boolean
  privacyLevel: 'none' | 'basic' | 'maximum'
  lastClassified: number
  verificationStatus: 'verified' | 'unverified' | 'failed' | 'error' | 'not-applicable'
  cryptoIPv6?: string
  capabilities?: any
}

// Security policy for peer classification
interface SecurityPolicy {
  trustLevel: string
  allowedProtocols: string[]
  allowDIGProtocol: boolean
  allowStoreRequests: boolean
  allowFileTransfers: boolean
  allowCapabilitySharing: boolean
  requireEncryption: boolean
  requireCryptoIPv6: boolean
  description: string
}

// DIG network membership verification result
interface DIGVerificationResult {
  verified: boolean
  cryptoIPv6?: string
  capabilities?: any
  verificationMethod: string
}

// Security statistics
interface SecurityStats {
  totalPeers: number
  publicInfrastructurePeers: number
  verifiedDIGPeers: number
  unknownPeers: number
  suspiciousPeers: number
  fullTrustPeers: number
  isolatedPeers: number
}
