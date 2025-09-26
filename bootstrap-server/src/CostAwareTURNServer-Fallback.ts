/**
 * Cost-Aware TURN Server - Fallback Implementation
 * 
 * This is a simplified version that works without AWS API access.
 * It provides cost-aware throttling based on configurable thresholds
 * and session tracking without real-time AWS cost monitoring.
 */

import { Logger } from './logger.js'

interface CostThresholds {
  warning: number
  throttle: number
  emergency: number
  shutdown: number
}

interface UserTier {
  name: string
  priority: number
  maxBandwidthMbps: number
  maxConcurrentSessions: number
  costWeight: number
}

interface SessionInfo {
  sessionId: string
  peerId: string
  userTier: UserTier
  startTime: number
  estimatedBandwidthMbps: number
  actualBytesTransferred: number
  isActive: boolean
  isPremium: boolean
}

export class CostAwareTURNServerFallback {
  private logger = new Logger('CostAwareTURNServer')
  
  // Cost configuration
  private monthlyBudget = parseFloat(process.env.MONTHLY_BUDGET || '800')
  private costThresholds: CostThresholds = {
    warning: 0.70,
    throttle: 0.85,
    emergency: 0.95,
    shutdown: 0.98
  }

  // Simulated cost ratio (will be replaced with real monitoring)
  private simulatedCostRatio = 0.0
  private activeSessions = new Map<string, SessionInfo>()
  private emergencyMode = false
  private shutdownMode = false

  // User tiers
  private userTiers: Map<string, UserTier> = new Map([
    ['premium', {
      name: 'Premium',
      priority: 1,
      maxBandwidthMbps: 100,
      maxConcurrentSessions: 10,
      costWeight: 10
    }],
    ['standard', {
      name: 'Standard',
      priority: 2,
      maxBandwidthMbps: 50,
      maxConcurrentSessions: 5,
      costWeight: 5
    }],
    ['basic', {
      name: 'Basic',
      priority: 3,
      maxBandwidthMbps: 10,
      maxConcurrentSessions: 2,
      costWeight: 1
    }],
    ['free', {
      name: 'Free',
      priority: 4,
      maxBandwidthMbps: 5,
      maxConcurrentSessions: 1,
      costWeight: 0.1
    }]
  ])

  constructor() {
    this.logger.info(`💰 Cost-Aware TURN Server (Fallback) initialized`)
    this.logger.info(`💰 Monthly budget: $${this.monthlyBudget}`)
  }

  async initialize(): Promise<void> {
    try {
      this.logger.info('💰 Initializing cost monitoring (fallback mode)...')

      // Start with conservative cost estimation
      this.simulatedCostRatio = 0.6 // Start at 60% to be conservative

      // Set up session cleanup
      setInterval(() => {
        this.cleanupInactiveSessions()
      }, 60 * 1000)

      // Gradually increase cost ratio simulation (for testing)
      setInterval(() => {
        this.updateSimulatedCosts()
      }, 10 * 60 * 1000) // Every 10 minutes

      this.logger.info('✅ Cost-Aware TURN Server (Fallback) initialized')

    } catch (error) {
      this.logger.error('Failed to initialize cost monitoring:', error)
    }
  }

  // Simulate cost increases for testing
  private updateSimulatedCosts(): void {
    const sessionCount = this.activeSessions.size
    const costIncrease = sessionCount * 0.02 // 2% per active session
    this.simulatedCostRatio = Math.min(this.simulatedCostRatio + costIncrease, 0.95)
    
    this.logger.debug(`💰 Simulated cost ratio: ${(this.simulatedCostRatio * 100).toFixed(1)}%`)
  }

  async handleAllocationRequest(request: any): Promise<any> {
    try {
      const costRatio = this.simulatedCostRatio
      
      this.logger.debug(`💰 Allocation request: cost ratio ${(costRatio * 100).toFixed(1)}%`)

      if (costRatio > this.costThresholds.shutdown || this.shutdownMode) {
        return this.shutdownResponse(request)
      }

      if (costRatio > this.costThresholds.emergency || this.emergencyMode) {
        return this.handleEmergencyMode(request)
      }

      if (costRatio > this.costThresholds.throttle) {
        return this.handleAggressiveThrottling(request)
      }

      if (costRatio > this.costThresholds.warning) {
        return this.handleWarningMode(request)
      }

      return this.handleNormalOperation(request)

    } catch (error) {
      this.logger.error('Allocation request failed:', error)
      return {
        success: false,
        error: 'Internal server error',
        retryAfter: 60
      }
    }
  }

  private handleEmergencyMode(request: any): any {
    if (request.sessionId && this.activeSessions.has(request.sessionId)) {
      const session = this.activeSessions.get(request.sessionId)!
      if (session.isPremium) {
        return this.allowWithLimits(request, {
          maxBandwidthMbps: 5,
          maxDurationMinutes: 5,
          priorityLevel: 'emergency'
        })
      }
    }

    return this.rejectWithMessage(request, 'Emergency mode: Only existing premium sessions allowed', 300)
  }

  private handleAggressiveThrottling(request: any): any {
    if (!request.isPremium) {
      return this.rejectWithMessage(request, 'Budget throttling: Premium users only', 180)
    }

    if (request.estimatedBandwidthMbps > 20) {
      return this.rejectWithMessage(request, 'Budget throttling: Bandwidth limit exceeded', 120)
    }

    const premiumSessions = Array.from(this.activeSessions.values())
      .filter(s => s.isPremium && s.isActive).length

    if (premiumSessions >= 5) {
      return this.rejectWithMessage(request, 'Budget throttling: Premium session limit reached', 60)
    }

    return this.allowWithLimits(request, {
      maxBandwidthMbps: 20,
      maxDurationMinutes: 10,
      priorityLevel: 'throttled'
    })
  }

  private handleWarningMode(request: any): any {
    if (request.p2pAttempted !== true) {
      return {
        success: false,
        error: 'Budget conservation: Please try P2P connection first',
        retryAfter: 30,
        suggestion: 'attempt_p2p_first'
      }
    }

    const userTier = this.getUserTier(request.userTier)
    const tierSessions = Array.from(this.activeSessions.values())
      .filter(s => s.userTier.name === userTier.name && s.isActive).length

    if (tierSessions >= userTier.maxConcurrentSessions) {
      return this.rejectWithMessage(request, `Tier limit: Max ${userTier.maxConcurrentSessions} concurrent sessions`, 45)
    }

    return this.allowWithLimits(request, {
      maxBandwidthMbps: Math.min(userTier.maxBandwidthMbps, 50),
      maxDurationMinutes: 15,
      priorityLevel: 'warning'
    })
  }

  private handleNormalOperation(request: any): any {
    const userTier = this.getUserTier(request.userTier)
    
    const tierSessions = Array.from(this.activeSessions.values())
      .filter(s => s.userTier.name === userTier.name && s.isActive).length

    if (tierSessions >= userTier.maxConcurrentSessions) {
      return this.rejectWithMessage(request, `Tier limit: Max ${userTier.maxConcurrentSessions} concurrent sessions`, 30)
    }

    return this.allowWithLimits(request, {
      maxBandwidthMbps: userTier.maxBandwidthMbps,
      maxDurationMinutes: 30,
      priorityLevel: 'normal'
    })
  }

  private allowWithLimits(request: any, limits: any): any {
    const sessionId = request.sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const userTier = this.getUserTier(request.userTier)

    const session: SessionInfo = {
      sessionId,
      peerId: request.peerId,
      userTier,
      startTime: Date.now(),
      estimatedBandwidthMbps: Math.min(request.estimatedBandwidthMbps, limits.maxBandwidthMbps),
      actualBytesTransferred: 0,
      isActive: true,
      isPremium: request.isPremium || false
    }

    this.activeSessions.set(sessionId, session)

    this.logger.info(`✅ TURN allocation granted: ${sessionId} (${limits.priorityLevel})`)

    return {
      success: true,
      sessionId,
      limits: {
        maxBandwidthMbps: limits.maxBandwidthMbps,
        maxDurationSeconds: limits.maxDurationMinutes * 60,
        priorityLevel: limits.priorityLevel
      },
      costInfo: {
        currentCostRatio: this.simulatedCostRatio,
        projectedMonthlyCost: this.simulatedCostRatio * this.monthlyBudget,
        budgetRemaining: this.monthlyBudget - (this.simulatedCostRatio * this.monthlyBudget)
      }
    }
  }

  private rejectWithMessage(request: any, message: string, retryAfter: number): any {
    this.logger.warn(`❌ TURN allocation rejected: ${message}`)
    
    return {
      success: false,
      error: message,
      retryAfter,
      costInfo: {
        currentCostRatio: this.simulatedCostRatio,
        projectedMonthlyCost: this.simulatedCostRatio * this.monthlyBudget,
        budgetRemaining: this.monthlyBudget - (this.simulatedCostRatio * this.monthlyBudget)
      }
    }
  }

  private shutdownResponse(request: any): any {
    this.shutdownMode = true
    this.logger.error('🚨 CRITICAL: Budget exceeded - entering shutdown mode')
    
    return {
      success: false,
      error: 'Service temporarily unavailable due to budget constraints',
      retryAfter: 3600,
      shutdown: true
    }
  }

  private getUserTier(tierName?: string): UserTier {
    return this.userTiers.get(tierName || 'free') || this.userTiers.get('free')!
  }

  updateSessionBandwidth(sessionId: string, bytesTransferred: number): void {
    const session = this.activeSessions.get(sessionId)
    if (session) {
      session.actualBytesTransferred += bytesTransferred
    }
  }

  getCostStatistics(): any {
    const activeSessions = Array.from(this.activeSessions.values()).filter(s => s.isActive)
    
    return {
      costMetrics: {
        currentSpend: this.simulatedCostRatio * this.monthlyBudget,
        projectedMonthlySpend: this.simulatedCostRatio * this.monthlyBudget,
        budgetLimit: this.monthlyBudget,
        costRatio: this.simulatedCostRatio,
        lastUpdated: Date.now(),
        mode: 'fallback'
      },
      sessionStats: {
        total: activeSessions.length,
        premium: activeSessions.filter(s => s.isPremium).length,
        byTier: Object.fromEntries(
          Array.from(this.userTiers.keys()).map(tier => [
            tier,
            activeSessions.filter(s => s.userTier.name.toLowerCase() === tier).length
          ])
        )
      },
      mode: {
        emergency: this.emergencyMode,
        shutdown: this.shutdownMode,
        currentThreshold: this.getCurrentThresholdName()
      }
    }
  }

  private getCurrentThresholdName(): string {
    const ratio = this.simulatedCostRatio
    
    if (ratio > this.costThresholds.shutdown) return 'shutdown'
    if (ratio > this.costThresholds.emergency) return 'emergency'
    if (ratio > this.costThresholds.throttle) return 'throttle'
    if (ratio > this.costThresholds.warning) return 'warning'
    return 'normal'
  }

  private cleanupInactiveSessions(): void {
    const now = Date.now()
    const maxSessionAge = 30 * 60 * 1000 // 30 minutes
    let cleanedCount = 0

    for (const [sessionId, session] of this.activeSessions) {
      if (!session.isActive || (now - session.startTime) > maxSessionAge) {
        this.activeSessions.delete(sessionId)
        cleanedCount++
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug(`🧹 Cleaned up ${cleanedCount} inactive sessions`)
    }
  }

  async cleanup(): Promise<void> {
    this.logger.info('✅ Cost-Aware TURN Server (Fallback) cleaned up')
  }
}
