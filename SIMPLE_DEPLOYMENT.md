# 🚀 Simple AWS Deployment - DIG Network Bootstrap Server

## Quick deployment to AWS Elastic Beanstalk (no custom DNS needed)

### 📋 Prerequisites

1. **AWS CLI** configured: `aws configure`
2. **Docker** installed and running
3. **Terraform** installed

### 🚀 One-Command Deployment

```bash
# Deploy everything to AWS
npm run deploy
```

This will:
- ✅ Build optimized Docker image
- ✅ Create ECR repository  
- ✅ Push image to ECR
- ✅ Deploy Elastic Beanstalk app
- ✅ Output bootstrap server URL

### 📊 Expected Output

After deployment, you'll get:
```
🎉 Deployment completed successfully!

📋 Bootstrap Server Information:
   - URL: http://dig-bootstrap-prod.us-east-1.elasticbeanstalk.com
   - Health: http://dig-bootstrap-prod.us-east-1.elasticbeanstalk.com/health
   - Stats: http://dig-bootstrap-prod.us-east-1.elasticbeanstalk.com/stats

🔧 Configure your DIG nodes with:
   discoveryServers: ['http://dig-bootstrap-prod.us-east-1.elasticbeanstalk.com']
```

### 🔧 Configure Your DIG Nodes

Use the bootstrap server URL in your node configuration:

```typescript
const node = new DIGNode({
  port: 4001,
  discoveryServers: ['http://dig-bootstrap-prod.us-east-1.elasticbeanstalk.com'],
  enableGlobalDiscovery: true,
  enableMdns: true,
  enableDht: true
});
```

### 🧪 Test the Deployment

```bash
# Test bootstrap server
curl http://dig-bootstrap-prod.us-east-1.elasticbeanstalk.com/health
curl http://dig-bootstrap-prod.us-east-1.elasticbeanstalk.com/stats

# Start your DIG nodes
npm run global
```

### 💰 Cost

- **t3.nano EC2**: $3.80/month
- **Elastic Beanstalk**: Free
- **ECR storage**: ~$0.10/month
- **Data transfer**: Minimal
- **Total**: ~$4/month

### 🔧 Manual Steps (if needed)

#### 1. Build Docker Image
```bash
npm run docker:build
```

#### 2. Deploy with Terraform
```bash
cd terraform
terraform init
terraform plan
terraform apply
```

#### 3. Get Bootstrap URL
```bash
terraform output bootstrap_url
```

### 🌍 **Result**

Your two machines (and any future nodes) will now:
- ✅ **Discover each other globally** via the bootstrap server
- ✅ **Automatically sync all .dig files** 
- ✅ **Connect directly via P2P** after discovery
- ✅ **Maintain global network** state

**The bootstrap server acts as the global meeting point for worldwide peer discovery!** 🌟
