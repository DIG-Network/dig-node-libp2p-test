/**
 * Cost-Aware TURN Server for AWS Elastic Beanstalk
 * 
 * Monitors AWS costs and implements intelligent throttling to prevent
 * runaway costs while maintaining essential bootstrap/TURN services.
 * 
 * Features:
 * - Real-time AWS cost monitoring via Cost Explorer API
 * - Multi-tier throttling (warning, throttle, emergency)
 * - User tier prioritization
 * - Bandwidth limiting
 * - Session management
 * - Cost projection and alerts
 */

import { CostExplorerClient, GetCostAndUsageCommand } from "@aws-sdk/client-cost-explorer"
import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch"
import { Logger } from './logger.js'

interface CostThresholds {
  warning: number    // 70% of budget - start preferring P2P
  throttle: number   // 85% of budget - aggressive throttling
  emergency: number  // 95% of budget - emergency mode
  shutdown: number   // 98% of budget - shutdown non-essential services
}

interface UserTier {
  name: string
  priority: number
  maxBandwidthMbps: number
  maxConcurrentSessions: number
  costWeight: number // Higher weight = higher priority during throttling
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

interface CostMetrics {
  currentSpend: number
  projectedMonthlySpend: number
  budgetLimit: number
  costRatio: number
  lastUpdated: number
  dataTransferCosts: number
  computeCosts: number
  storageCosts: number
}

export class CostAwareTURNServer {
  private logger = new Logger('CostAwareTURNServer')
  private costExplorer: CostExplorerClient
  private cloudWatch: CloudWatchClient
  
  // Cost configuration
  private monthlyBudget = parseFloat(process.env.MONTHLY_BUDGET || '800') // $800/month limit
  private costThresholds: CostThresholds = {
    warning: 0.70,    // $560
    throttle: 0.85,   // $680
    emergency: 0.95,  // $760
    shutdown: 0.98    // $784
  }

  // User tiers for prioritization
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

  // Runtime state
  private currentCostMetrics: CostMetrics = {
    currentSpend: 0,
    projectedMonthlySpend: 0,
    budgetLimit: this.monthlyBudget,
    costRatio: 0,
    lastUpdated: 0,
    dataTransferCosts: 0,
    computeCosts: 0,
    storageCosts: 0
  }

  private activeSessions = new Map<string, SessionInfo>()
  private costUpdateInterval: NodeJS.Timeout | null = null
  private emergencyMode = false
  private shutdownMode = false

  constructor() {
    this.costExplorer = new CostExplorerClient({ 
      region: process.env.AWS_REGION || 'us-east-1' 
    })
    this.cloudWatch = new CloudWatchClient({ 
      region: process.env.AWS_REGION || 'us-east-1' 
    })

    this.logger.info(`💰 Cost-Aware TURN Server initialized`)
    this.logger.info(`💰 Monthly budget: $${this.monthlyBudget}`)
    this.logger.info(`💰 Warning threshold: $${(this.monthlyBudget * this.costThresholds.warning).toFixed(2)}`)
    this.logger.info(`💰 Throttle threshold: $${(this.monthlyBudget * this.costThresholds.throttle).toFixed(2)}`)
    this.logger.info(`💰 Emergency threshold: $${(this.monthlyBudget * this.costThresholds.emergency).toFixed(2)}`)
  }

  // Initialize cost monitoring
  async initialize(): Promise<void> {
    try {
      this.logger.info('💰 Initializing cost monitoring...')

      // Initial cost check
      await this.updateCostMetrics()

      // Set up periodic cost monitoring (every 5 minutes)
      this.costUpdateInterval = setInterval(async () => {
        await this.updateCostMetrics()
        await this.evaluateThrottlingNeeds()
      }, 5 * 60 * 1000)

      // Set up session cleanup (every minute)
      setInterval(() => {
        this.cleanupInactiveSessions()
      }, 60 * 1000)

      this.logger.info('✅ Cost-Aware TURN Server initialized successfully')

    } catch (error) {
      this.logger.error('Failed to initialize cost monitoring:', error)
      // Continue without cost monitoring if AWS APIs are unavailable
      this.logger.warn('⚠️ Continuing without cost monitoring - using conservative defaults')
    }
  }

  // Main entry point for all allocation requests
  async handleAllocationRequest(request: TurnAllocationRequest): Promise<TurnAllocationResponse> {
    try {
      const costRatio = await this.getCurrentCostRatio()
      
      this.logger.debug(`💰 Allocation request: cost ratio ${(costRatio * 100).toFixed(1)}%`)

      // Emergency shutdown mode
      if (costRatio > this.costThresholds.shutdown || this.shutdownMode) {
        return this.shutdownResponse(request)
      }

      // Emergency mode - only existing sessions
      if (costRatio > this.costThresholds.emergency || this.emergencyMode) {
        return this.handleEmergencyMode(request)
      }

      // Aggressive throttling mode
      if (costRatio > this.costThresholds.throttle) {
        return this.handleAggressiveThrottling(request)
      }

      // Warning mode - prefer P2P
      if (costRatio > this.costThresholds.warning) {
        return this.handleWarningMode(request)
      }

      // Normal operation
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

  // Update cost metrics from AWS
  private async updateCostMetrics(): Promise<void> {
    try {
      const now = new Date()
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0)

      const command = new GetCostAndUsageCommand({
        TimePeriod: {
          Start: startOfMonth.toISOString().split('T')[0],
          End: now.toISOString().split('T')[0]
        },
        Granularity: 'DAILY',
        Metrics: ['BlendedCost'],
        GroupBy: [{
          Type: 'TAG',
          Key: 'elasticbeanstalk:environment-name'
        }],
        Filter: {
          Tags: {
            Key: 'elasticbeanstalk:environment-name',
            Values: ['dig-bootstrap-v2-prod'],
            MatchOptions: ['EQUALS']
          }
        }
      })

      const response = await this.costExplorer.send(command)
      
      if (response.ResultsByTime && response.ResultsByTime.length > 0) {
        let totalCost = 0
        let dataTransferCost = 0
        let computeCost = 0

        // Sum costs across all days for this month
        for (const dailyResult of response.ResultsByTime) {
          if (dailyResult.Groups) {
            for (const group of dailyResult.Groups) {
              const environmentName = group.Keys?.[0] || ''
              
              // Only include costs for our specific environment
              if (environmentName === 'dig-bootstrap-v2-prod') {
                const cost = parseFloat(group.Metrics?.BlendedCost?.Amount || '0')
                totalCost += cost

                // For Elastic Beanstalk, most costs are compute
                computeCost += cost
              }
            }
          } else if (dailyResult.Total) {
            // If no groups, use total (filtered by our environment)
            const cost = parseFloat(dailyResult.Total.BlendedCost?.Amount || '0')
            totalCost += cost
            computeCost += cost
          }
        }

        // Calculate projected monthly spend
        const daysInMonth = endOfMonth.getDate()
        const daysPassed = now.getDate()
        const projectedMonthlySpend = totalCost * (daysInMonth / daysPassed)

        this.currentCostMetrics = {
          currentSpend: totalCost,
          projectedMonthlySpend,
          budgetLimit: this.monthlyBudget,
          costRatio: projectedMonthlySpend / this.monthlyBudget,
          lastUpdated: Date.now(),
          dataTransferCosts: dataTransferCost,
          computeCosts: computeCost,
          storageCosts: totalCost - dataTransferCost - computeCost
        }

        this.logger.info(`💰 EB App cost update: $${totalCost.toFixed(2)} spent, $${projectedMonthlySpend.toFixed(2)} projected (${(this.currentCostMetrics.costRatio * 100).toFixed(1)}% of EB budget)`)

        // Send metrics to CloudWatch
        await this.sendCostMetrics()

      } else {
        // Fallback: Use conservative EB-only estimate
        this.logger.warn('⚠️ No EB-specific cost data found, using conservative estimate')
        await this.useElasticBeanstalkCostEstimate()
      }
    } catch (error) {
      this.logger.error('Failed to update cost metrics:', error)
      // Use conservative EB estimate if API fails
      await this.useElasticBeanstalkCostEstimate()
    }
  }

  // Use conservative Elastic Beanstalk cost estimate
  private async useElasticBeanstalkCostEstimate(): Promise<void> {
    try {
      // Conservative estimate for t3.small EB environment:
      // - EC2 instance: ~$15-20/month
      // - Load balancer: ~$20-25/month  
      // - Data transfer: ~$5-15/month (depending on usage)
      // Total estimated: $40-60/month for typical usage

      const now = new Date()
      const dayOfMonth = now.getDate()
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
      
      // Conservative daily cost estimate: $2/day = ~$60/month
      const estimatedDailyCost = 2.0
      const estimatedCurrentSpend = dayOfMonth * estimatedDailyCost
      const estimatedMonthlySpend = daysInMonth * estimatedDailyCost

      this.currentCostMetrics = {
        currentSpend: estimatedCurrentSpend,
        projectedMonthlySpend: estimatedMonthlySpend,
        budgetLimit: this.monthlyBudget,
        costRatio: estimatedMonthlySpend / this.monthlyBudget,
        lastUpdated: Date.now(),
        dataTransferCosts: estimatedCurrentSpend * 0.2, // ~20% data transfer
        computeCosts: estimatedCurrentSpend * 0.7, // ~70% compute
        storageCosts: estimatedCurrentSpend * 0.1 // ~10% storage
      }

      this.logger.info(`💰 EB Conservative estimate: $${estimatedCurrentSpend.toFixed(2)} spent, $${estimatedMonthlySpend.toFixed(2)} projected (${(this.currentCostMetrics.costRatio * 100).toFixed(1)}% of budget)`)

    } catch (error) {
      this.logger.error('Failed to create cost estimate:', error)
    }
  }

  // Send cost metrics to CloudWatch
  private async sendCostMetrics(): Promise<void> {
    try {
      const putMetricCommand = new PutMetricDataCommand({
        Namespace: 'DIG/Bootstrap/Costs',
        MetricData: [
          {
            MetricName: 'CurrentSpend',
            Value: this.currentCostMetrics.currentSpend,
            Unit: 'None',
            Timestamp: new Date()
          },
          {
            MetricName: 'ProjectedMonthlySpend',
            Value: this.currentCostMetrics.projectedMonthlySpend,
            Unit: 'None',
            Timestamp: new Date()
          },
          {
            MetricName: 'CostRatio',
            Value: this.currentCostMetrics.costRatio,
            Unit: 'Percent',
            Timestamp: new Date()
          },
          {
            MetricName: 'ActiveSessions',
            Value: this.activeSessions.size,
            Unit: 'Count',
            Timestamp: new Date()
          }
        ]
      })

      await this.cloudWatch.send(putMetricCommand)
    } catch (error) {
      this.logger.debug('Failed to send CloudWatch metrics:', error)
    }
  }

  // Get current cost ratio with fallback
  private async getCurrentCostRatio(): Promise<number> {
    if (Date.now() - this.currentCostMetrics.lastUpdated > 10 * 60 * 1000) {
      await this.updateCostMetrics()
    }
    return this.currentCostMetrics.costRatio
  }

  // Handle emergency mode (95%+ of budget)
  private async handleEmergencyMode(request: TurnAllocationRequest): Promise<TurnAllocationResponse> {
    this.emergencyMode = true
    
    // Only allow existing premium sessions
    if (request.sessionId && this.activeSessions.has(request.sessionId)) {
      const session = this.activeSessions.get(request.sessionId)!
      if (session.isPremium) {
        return this.allowWithLimits(request, {
          maxBandwidthMbps: 5, // Severely limited
          maxDurationMinutes: 5,
          priorityLevel: 'emergency'
        })
      }
    }

    return this.rejectWithMessage(request, 'Emergency mode: Only existing premium sessions allowed', 300)
  }

  // Handle aggressive throttling (85%+ of budget)
  private async handleAggressiveThrottling(request: TurnAllocationRequest): Promise<TurnAllocationResponse> {
    // Prioritize by user tier and session importance
    if (!request.isPremium) {
      return this.rejectWithMessage(request, 'Budget throttling: Premium users only', 180)
    }

    if (request.estimatedBandwidthMbps > 20) {
      return this.rejectWithMessage(request, 'Budget throttling: Bandwidth limit exceeded', 120)
    }

    // Count premium sessions
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

  // Handle warning mode (70%+ of budget)
  private async handleWarningMode(request: TurnAllocationRequest): Promise<TurnAllocationResponse> {
    // Prefer P2P connections more aggressively
    if (request.p2pAttempted !== true) {
      return {
        success: false,
        error: 'Budget conservation: Please try P2P connection first',
        retryAfter: 30,
        suggestion: 'attempt_p2p_first'
      }
    }

    // Apply user tier limits
    const userTier = this.getUserTier(request.userTier)
    const tierSessions = Array.from(this.activeSessions.values())
      .filter(s => s.userTier.name === userTier.name && s.isActive).length

    if (tierSessions >= userTier.maxConcurrentSessions) {
      return this.rejectWithMessage(request, `Tier limit: Max ${userTier.maxConcurrentSessions} concurrent sessions`, 45)
    }

    if (request.estimatedBandwidthMbps > userTier.maxBandwidthMbps) {
      return this.rejectWithMessage(request, `Tier limit: Max ${userTier.maxBandwidthMbps} Mbps bandwidth`, 30)
    }

    return this.allowWithLimits(request, {
      maxBandwidthMbps: Math.min(userTier.maxBandwidthMbps, 50),
      maxDurationMinutes: 15,
      priorityLevel: 'warning'
    })
  }

  // Handle normal operation
  private async handleNormalOperation(request: TurnAllocationRequest): Promise<TurnAllocationResponse> {
    const userTier = this.getUserTier(request.userTier)
    
    // Standard tier-based limits
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

  // Allow request with specific limits
  private allowWithLimits(request: TurnAllocationRequest, limits: AllocationLimits): TurnAllocationResponse {
    const sessionId = request.sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const userTier = this.getUserTier(request.userTier)

    // Create session info
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

    this.logger.info(`✅ TURN allocation granted: ${sessionId} (${limits.priorityLevel}) - ${session.estimatedBandwidthMbps} Mbps for ${limits.maxDurationMinutes}min`)

    return {
      success: true,
      sessionId,
      limits: {
        maxBandwidthMbps: limits.maxBandwidthMbps,
        maxDurationSeconds: limits.maxDurationMinutes * 60,
        priorityLevel: limits.priorityLevel
      },
      costInfo: {
        currentCostRatio: this.currentCostMetrics.costRatio,
        projectedMonthlyCost: this.currentCostMetrics.projectedMonthlySpend,
        budgetRemaining: this.monthlyBudget - this.currentCostMetrics.projectedMonthlySpend
      }
    }
  }

  // Reject request with message
  private rejectWithMessage(request: TurnAllocationRequest, message: string, retryAfter: number): TurnAllocationResponse {
    this.logger.warn(`❌ TURN allocation rejected: ${message} (retry in ${retryAfter}s)`)
    
    return {
      success: false,
      error: message,
      retryAfter,
      costInfo: {
        currentCostRatio: this.currentCostMetrics.costRatio,
        projectedMonthlyCost: this.currentCostMetrics.projectedMonthlySpend,
        budgetRemaining: this.monthlyBudget - this.currentCostMetrics.projectedMonthlySpend
      }
    }
  }

  // Shutdown response for critical budget overrun
  private shutdownResponse(request: TurnAllocationRequest): TurnAllocationResponse {
    this.shutdownMode = true
    this.logger.error('🚨 CRITICAL: Budget exceeded - entering shutdown mode')
    
    return {
      success: false,
      error: 'Service temporarily unavailable due to budget constraints',
      retryAfter: 3600, // 1 hour
      shutdown: true
    }
  }

  // Get user tier with fallback
  private getUserTier(tierName?: string): UserTier {
    return this.userTiers.get(tierName || 'free') || this.userTiers.get('free')!
  }

  // Evaluate if throttling adjustments are needed
  private async evaluateThrottlingNeeds(): Promise<void> {
    const costRatio = this.currentCostMetrics.costRatio

    if (costRatio > this.costThresholds.emergency && !this.emergencyMode) {
      this.logger.warn('🚨 Entering emergency mode due to high costs')
      this.emergencyMode = true
      await this.terminateNonPremiumSessions()
    } else if (costRatio < this.costThresholds.warning && this.emergencyMode) {
      this.logger.info('✅ Exiting emergency mode - costs under control')
      this.emergencyMode = false
    }

    if (costRatio > this.costThresholds.shutdown) {
      this.logger.error('🚨 CRITICAL: Entering shutdown mode')
      this.shutdownMode = true
      await this.terminateAllSessions()
    }
  }

  // Terminate non-premium sessions during emergency
  private async terminateNonPremiumSessions(): Promise<void> {
    let terminatedCount = 0
    
    for (const [sessionId, session] of this.activeSessions) {
      if (!session.isPremium && session.isActive) {
        session.isActive = false
        terminatedCount++
        this.logger.info(`🚨 Emergency termination: ${sessionId}`)
      }
    }

    this.logger.warn(`🚨 Emergency mode: Terminated ${terminatedCount} non-premium sessions`)
  }

  // Terminate all sessions during shutdown
  private async terminateAllSessions(): Promise<void> {
    let terminatedCount = 0
    
    for (const [sessionId, session] of this.activeSessions) {
      if (session.isActive) {
        session.isActive = false
        terminatedCount++
      }
    }

    this.logger.error(`🚨 Shutdown mode: Terminated ${terminatedCount} sessions`)
  }

  // Clean up inactive sessions
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

  // Update session bandwidth usage
  updateSessionBandwidth(sessionId: string, bytesTransferred: number): void {
    const session = this.activeSessions.get(sessionId)
    if (session) {
      session.actualBytesTransferred += bytesTransferred
    }
  }

  // Get current cost and session statistics
  getCostStatistics(): CostStatistics {
    const activeSessions = Array.from(this.activeSessions.values()).filter(s => s.isActive)
    
    return {
      costMetrics: { ...this.currentCostMetrics },
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

  // Get current threshold name
  private getCurrentThresholdName(): string {
    const ratio = this.currentCostMetrics.costRatio
    
    if (ratio > this.costThresholds.shutdown) return 'shutdown'
    if (ratio > this.costThresholds.emergency) return 'emergency'
    if (ratio > this.costThresholds.throttle) return 'throttle'
    if (ratio > this.costThresholds.warning) return 'warning'
    return 'normal'
  }

  // Cleanup on shutdown
  async cleanup(): Promise<void> {
    if (this.costUpdateInterval) {
      clearInterval(this.costUpdateInterval)
    }
    await this.terminateAllSessions()
    this.logger.info('✅ Cost-Aware TURN Server cleaned up')
  }
}

// Type definitions
interface TurnAllocationRequest {
  peerId: string
  sessionId?: string
  estimatedBandwidthMbps: number
  userTier?: string
  isPremium?: boolean
  p2pAttempted?: boolean
  storeId?: string
  rangeStart?: number
  rangeEnd?: number
}

interface TurnAllocationResponse {
  success: boolean
  sessionId?: string
  error?: string
  retryAfter?: number
  limits?: {
    maxBandwidthMbps: number
    maxDurationSeconds: number
    priorityLevel: string
  }
  costInfo?: {
    currentCostRatio: number
    projectedMonthlyCost: number
    budgetRemaining: number
  }
  suggestion?: string
  shutdown?: boolean
}

interface AllocationLimits {
  maxBandwidthMbps: number
  maxDurationMinutes: number
  priorityLevel: string
}

interface CostStatistics {
  costMetrics: CostMetrics
  sessionStats: {
    total: number
    premium: number
    byTier: Record<string, number>
  }
  mode: {
    emergency: boolean
    shutdown: boolean
    currentThreshold: string
  }
}

export { TurnAllocationRequest, TurnAllocationResponse, CostStatistics }
