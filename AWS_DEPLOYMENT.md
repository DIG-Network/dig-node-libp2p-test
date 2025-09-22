# 🌍 AWS Deployment Guide - DIG Network Bootstrap Server

## Complete deployment to AWS Elastic Beanstalk with Route53 DNS

### 📋 Prerequisites

1. **AWS Account** with `dig.net` domain already configured
2. **AWS CLI** configured with appropriate permissions
3. **Terraform** installed (v1.0+)
4. **Docker** installed and running
5. **jq** for JSON parsing (optional, for scripts)

### 🔧 Required AWS Permissions

Your AWS user/role needs these permissions:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "elasticbeanstalk:*",
        "ec2:*",
        "iam:*",
        "route53:*",
        "ecr:*",
        "logs:*",
        "cloudwatch:*"
      ],
      "Resource": "*"
    }
  ]
}
```

### 🚀 Deployment Steps

#### 1. Prepare Configuration

```bash
# Clone repository
git clone <your-repo>
cd dig-network-node

# Copy and customize Terraform variables
cp terraform/terraform.tfvars.example terraform/terraform.tfvars

# Edit terraform.tfvars
vim terraform/terraform.tfvars
```

#### 2. Configure AWS

```bash
# Set AWS region (cheapest)
export AWS_REGION=us-east-1

# Verify AWS configuration
aws sts get-caller-identity
aws route53 list-hosted-zones --query 'HostedZones[?Name==`dig.net.`]'
```

#### 3. Deploy Everything

```bash
# Run the complete deployment
./scripts/deploy.sh
```

This script will:
- ✅ Build optimized Docker image
- ✅ Create ECR repository
- ✅ Push image to ECR
- ✅ Deploy Elastic Beanstalk application
- ✅ Configure Route53 DNS records
- ✅ Set up health checks and monitoring

#### 4. Verify Deployment

```bash
# Verify DNS and connectivity
./scripts/verify-dns.sh

# Manual verification
curl http://bootstrap.dig.net/health
curl http://bootstrap.dig.net/stats
```

### 🏗️ Infrastructure Details

#### AWS Resources Created

1. **Elastic Beanstalk Application**
   - Platform: Node.js 20 on Amazon Linux 2023
   - Instance: t3.nano (cheapest at $3.80/month)
   - Spot instances enabled (up to 90% savings)
   - Auto-scaling: 1-2 instances

2. **Route53 DNS Records**
   - `bootstrap.dig.net` → CNAME to EB environment
   - `bootstrap` → Alias for redundancy
   - Health check monitoring

3. **Security & Networking**
   - Security group with ports 80, 443, 3000
   - Default VPC (free tier)
   - Application Load Balancer

4. **Monitoring**
   - CloudWatch logs (7-day retention)
   - Route53 health checks
   - CloudWatch alarms

#### Cost Breakdown (Monthly)
- **EC2 t3.nano**: $3.80
- **Elastic Beanstalk**: Free
- **Route53 hosted zone**: $0.50
- **Route53 health check**: $0.50
- **Data transfer**: ~$0.20
- **Total**: ~$5.00/month

### 🔧 Configuration Options

#### Terraform Variables (`terraform.tfvars`)

```hcl
# Basic configuration
aws_region = "us-east-1"
environment = "prod"
domain_name = "bootstrap.dig.net"

# Cost optimization
instance_type = "t3.nano"          # Cheapest option
enable_spot_instances = true       # 90% savings
spot_max_price = "0.005"          # $0.005/hour max

# Scaling
min_instances = 1
max_instances = 2

# Monitoring
log_retention_days = 7            # Cost optimization
```

#### Alternative Instance Types
```hcl
# Free tier eligible (first 12 months)
instance_type = "t3.micro"        # $0/month (free tier)

# Slightly more expensive but more reliable
instance_type = "t3.small"        # $15.18/month
```

### 🌐 DNS Configuration Details

The Terraform configuration creates:

1. **Primary Record**: `bootstrap.dig.net`
   ```
   bootstrap.dig.net. 300 IN CNAME dig-bootstrap-prod.us-east-1.elasticbeanstalk.com
   ```

2. **Alias Record**: `bootstrap`
   ```
   bootstrap. 300 IN CNAME dig-bootstrap-prod.us-east-1.elasticbeanstalk.com
   ```

3. **Health Check**
   - Monitors: `http://bootstrap.dig.net/health`
   - Interval: 30 seconds
   - Failure threshold: 3 attempts

### 📊 Monitoring & Health Checks

#### CloudWatch Metrics
- Application health
- Request count
- Response times
- Error rates

#### Health Check Endpoints
- `GET /health` - Server health status
- `GET /stats` - Peer statistics
- `GET /topology` - Network topology

#### Log Monitoring
```bash
# View application logs
aws logs tail /aws/elasticbeanstalk/dig-bootstrap-prod/var/log/eb-docker/containers/eb-current-app --follow
```

### 🔧 Post-Deployment Configuration

#### 1. Update DIG Nodes

Update your global discovery configuration:

```typescript
const node = new DIGNode({
  port: 4001,
  discoveryServers: ['http://bootstrap.dig.net:3000'],
  enableGlobalDiscovery: true,
  enableMdns: true,
  enableDht: true
});
```

#### 2. Test Global Discovery

```bash
# Start node with global discovery
npm run global

# Verify connection to bootstrap server
curl http://localhost:8080/connections
```

#### 3. Monitor Network Growth

```bash
# Check bootstrap server stats
curl http://bootstrap.dig.net/stats

# View network topology
curl http://bootstrap.dig.net/topology
```

### 🧪 Testing the Deployment

#### 1. DNS Resolution Test
```bash
nslookup bootstrap.dig.net
dig bootstrap.dig.net
```

#### 2. HTTP Connectivity Test
```bash
curl -v http://bootstrap.dig.net/health
curl http://bootstrap.dig.net/stats
```

#### 3. Peer Registration Test
```bash
curl -X POST http://bootstrap.dig.net/register \
  -H "Content-Type: application/json" \
  -d '{
    "peerId": "test-peer-123",
    "addresses": ["/ip4/1.2.3.4/tcp/4001/p2p/test-peer-123"],
    "cryptoIPv6": "fd00:1234:5678:90ab:cdef:1234:5678:90ab",
    "stores": ["abc123", "def456"]
  }'
```

### 🔄 Updates and Maintenance

#### Update Application
```bash
# Make code changes
# Run deployment script again
./scripts/deploy.sh
```

#### Scale Resources
```bash
cd terraform
terraform apply -var="instance_type=t3.micro"  # Upgrade instance
terraform apply -var="max_instances=5"         # Scale out
```

#### Monitor Costs
```bash
# Check AWS billing
aws ce get-cost-and-usage --time-period Start=2024-01-01,End=2024-01-31 --granularity MONTHLY --metrics BlendedCost
```

### 🚨 Troubleshooting

#### DNS Issues
1. **Check Route53 hosted zone**: Ensure `dig.net` zone exists
2. **Verify DNS propagation**: Use `dig` or online DNS checkers
3. **Check TTL settings**: Wait for TTL expiration (300 seconds)

#### Application Issues
1. **Check EB environment health**: AWS Console → Elastic Beanstalk
2. **View application logs**: CloudWatch Logs
3. **Check security groups**: Ensure ports are open

#### Connection Issues
1. **Firewall**: Ensure port 3000 is accessible
2. **Load balancer**: Check ALB target health
3. **Health checks**: Verify `/health` endpoint responds

### 🎯 Success Criteria

After successful deployment:

- ✅ `http://bootstrap.dig.net/health` returns `{"status": "ok"}`
- ✅ DNS resolves from multiple locations
- ✅ DIG nodes can register and discover peers
- ✅ Global peer synchronization works
- ✅ Monthly cost under $5

### 🌟 Final Result

Your DIG Network will have:
- **Global peer discovery** via `bootstrap.dig.net`
- **Automatic store synchronization** worldwide
- **Resilient infrastructure** on AWS
- **Cost-optimized deployment** (~$5/month)
- **Health monitoring** and alerting

**Nodes anywhere in the world can now discover each other and share .dig files automatically!** 🌍
