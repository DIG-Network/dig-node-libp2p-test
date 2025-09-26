# Cost-Aware Bootstrap Server Configuration

## Overview

The DIG Bootstrap Server now includes comprehensive cost-aware throttling to prevent runaway AWS costs while maintaining essential bootstrap and TURN services.

## Environment Variables

### Required Configuration

```bash
# Monthly budget limit in USD
MONTHLY_BUDGET=800

# AWS region for cost monitoring
AWS_REGION=us-east-1

# AWS credentials (set in Elastic Beanstalk environment)
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
```

### Optional Configuration

```bash
# Cost thresholds (as percentage of budget)
COST_WARNING_THRESHOLD=0.70    # 70% - start preferring P2P
COST_THROTTLE_THRESHOLD=0.85   # 85% - aggressive throttling
COST_EMERGENCY_THRESHOLD=0.95  # 95% - emergency mode
COST_SHUTDOWN_THRESHOLD=0.98   # 98% - shutdown non-essential

# User tier limits (can be customized)
FREE_TIER_BANDWIDTH_MBPS=5
FREE_TIER_MAX_SESSIONS=1
BASIC_TIER_BANDWIDTH_MBPS=10
BASIC_TIER_MAX_SESSIONS=2
STANDARD_TIER_BANDWIDTH_MBPS=50
STANDARD_TIER_MAX_SESSIONS=5
PREMIUM_TIER_BANDWIDTH_MBPS=100
PREMIUM_TIER_MAX_SESSIONS=10
```

## Cost-Aware Features

### 1. Real-Time Cost Monitoring
- Monitors AWS costs every 5 minutes via Cost Explorer API
- Tracks data transfer, compute, and storage costs separately
- Projects monthly spend based on current usage
- Sends metrics to CloudWatch for dashboards and alerts

### 2. Multi-Tier Throttling

#### Normal Mode (< 70% budget)
- All user tiers operate normally
- Standard tier-based bandwidth and session limits apply
- Full TURN relay functionality available

#### Warning Mode (70-85% budget)
- Encourages P2P connections first
- Applies stricter user tier limits
- Reduces session durations
- Logs cost warnings

#### Throttle Mode (85-95% budget)
- **Premium users only** for new sessions
- Bandwidth limited to 20 Mbps maximum
- Maximum 5 concurrent premium sessions
- Session duration limited to 10 minutes

#### Emergency Mode (95-98% budget)
- **Existing premium sessions only**
- Severely limited bandwidth (5 Mbps)
- Session duration limited to 5 minutes
- All non-premium sessions terminated

#### Shutdown Mode (> 98% budget)
- All new sessions rejected
- All existing sessions terminated
- Only health checks and cost monitoring active
- Manual intervention required to restore service

### 3. User Tier Prioritization

#### Free Tier
- 5 Mbps bandwidth
- 1 concurrent session
- First to be throttled
- Lowest priority during emergencies

#### Basic Tier
- 10 Mbps bandwidth
- 2 concurrent sessions
- Throttled in warning mode
- Limited access during throttle mode

#### Standard Tier
- 50 Mbps bandwidth
- 5 concurrent sessions
- Reduced limits in warning mode
- No access during throttle mode

#### Premium Tier
- 100 Mbps bandwidth
- 10 concurrent sessions
- Maintained through throttle mode
- Priority during emergency mode

## API Endpoints

### Cost-Aware TURN Allocation
```bash
POST /allocate-turn
{
  "peerId": "12D3KooW...",
  "estimatedBandwidthMbps": 25,
  "userTier": "standard",
  "isPremium": false,
  "p2pAttempted": true,
  "storeId": "store123",
  "rangeStart": 0,
  "rangeEnd": 1048576
}
```

### Cost Statistics
```bash
GET /cost-stats
```

Returns:
```json
{
  "costMetrics": {
    "currentSpend": 450.25,
    "projectedMonthlySpend": 675.50,
    "budgetLimit": 800,
    "costRatio": 0.844,
    "dataTransferCosts": 320.15,
    "computeCosts": 130.10
  },
  "sessionStats": {
    "total": 12,
    "premium": 3,
    "byTier": {
      "free": 2,
      "basic": 4,
      "standard": 3,
      "premium": 3
    }
  },
  "mode": {
    "emergency": false,
    "shutdown": false,
    "currentThreshold": "throttle"
  }
}
```

### Enhanced Health Check
```bash
GET /health
```

Now includes cost information:
```json
{
  "status": "healthy",
  "costInfo": {
    "budgetUsed": "84.4%",
    "projectedMonthlyCost": "$675.50",
    "budgetLimit": "$800.00",
    "mode": "throttle",
    "activeSessions": 12
  }
}
```

## Deployment Configuration

### Elastic Beanstalk Environment Variables

Set these in your EB environment configuration:

```bash
MONTHLY_BUDGET=800
AWS_REGION=us-east-1
```

### IAM Permissions

The Elastic Beanstalk instance role needs these permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ce:GetCostAndUsage",
        "ce:GetUsageReport"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "cloudwatch:PutMetricData"
      ],
      "Resource": "*"
    }
  ]
}
```

## Monitoring and Alerts

### CloudWatch Metrics

The server publishes these metrics to `DIG/Bootstrap/Costs`:

- `CurrentSpend`: Current month spend in USD
- `ProjectedMonthlySpend`: Projected full month spend
- `CostRatio`: Percentage of budget used (0-1)
- `ActiveSessions`: Number of active TURN sessions

### Recommended CloudWatch Alarms

1. **Budget Warning (70%)**
   - Metric: `CostRatio`
   - Threshold: `> 0.70`
   - Action: SNS notification

2. **Budget Critical (85%)**
   - Metric: `CostRatio`
   - Threshold: `> 0.85`
   - Action: SNS notification + escalation

3. **Emergency Mode (95%)**
   - Metric: `CostRatio`
   - Threshold: `> 0.95`
   - Action: Immediate notification + auto-scaling restrictions

## Cost Optimization Strategies

### 1. Automatic P2P Preference
- Requests P2P attempts before allowing TURN relay
- Reduces data transfer costs significantly
- Improves performance for direct connections

### 2. Bandwidth-Based Pricing
- Estimates costs based on requested bandwidth
- Prioritizes smaller transfers during high usage
- Implements progressive throttling

### 3. Session Time Limits
- Prevents long-running expensive sessions
- Automatic cleanup of inactive sessions
- Progressive time limit reduction under cost pressure

### 4. User Tier Economics
- Premium users subsidize free tier usage
- Tiered access ensures revenue-generating users get priority
- Emergency mode preserves premium user experience

## Troubleshooting

### Cost API Issues
If AWS Cost Explorer API is unavailable:
- Server continues with conservative throttling
- Uses 90% budget assumption for safety
- Logs warnings about cost monitoring failures

### Emergency Recovery
To recover from shutdown mode:
1. Check AWS costs in billing console
2. If costs are acceptable, restart the service
3. Consider adjusting `MONTHLY_BUDGET` if needed
4. Review cost optimization strategies

### Session Monitoring
Monitor active sessions via `/cost-stats` endpoint:
- High session count may indicate cost issues
- Premium session ratio shows revenue potential
- Tier distribution helps optimize pricing

## Best Practices

1. **Set Conservative Budgets**: Start with 80% of your actual budget limit
2. **Monitor Daily**: Check `/cost-stats` endpoint regularly
3. **Premium Tier Strategy**: Encourage premium upgrades for guaranteed access
4. **P2P First**: Always attempt P2P connections before TURN relay
5. **Alert Setup**: Configure CloudWatch alarms for all thresholds
6. **Regular Review**: Analyze cost patterns monthly and adjust tiers accordingly
