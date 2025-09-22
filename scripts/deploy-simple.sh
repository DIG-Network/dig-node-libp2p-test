#!/bin/bash

# Simplified DIG Network Bootstrap Server Deployment
# No custom DNS - uses default Elastic Beanstalk URL

set -e

echo "🚀 DIG Network Bootstrap Server - Simple Deployment"
echo "==================================================="

# Check if required tools are installed
command -v docker >/dev/null 2>&1 || { echo "❌ Docker is required but not installed. Aborting." >&2; exit 1; }
command -v terraform >/dev/null 2>&1 || { echo "❌ Terraform is required but not installed. Aborting." >&2; exit 1; }
command -v aws >/dev/null 2>&1 || { echo "❌ AWS CLI is required but not installed. Aborting." >&2; exit 1; }

# Configuration
AWS_REGION=${AWS_REGION:-us-east-1}
DOCKER_IMAGE_NAME="dig-bootstrap"
ECR_REPOSITORY_NAME="dig-network/bootstrap"

echo "📋 Configuration:"
echo "   - AWS Region: $AWS_REGION"
echo "   - Docker Image: $DOCKER_IMAGE_NAME"
echo "   - ECR Repository: $ECR_REPOSITORY_NAME"

# Step 1: Build Docker image
echo ""
echo "🔨 Step 1: Building Docker image..."
docker build -t $DOCKER_IMAGE_NAME:latest .
echo "✅ Docker image built successfully"

# Step 2: Create ECR repository and push
echo ""
echo "📦 Step 2: Setting up ECR and pushing image..."
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URI="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPOSITORY_NAME"

# Create ECR repository
aws ecr describe-repositories --repository-names $ECR_REPOSITORY_NAME --region $AWS_REGION >/dev/null 2>&1 || {
    echo "Creating ECR repository..."
    aws ecr create-repository --repository-name $ECR_REPOSITORY_NAME --region $AWS_REGION
}

# Login to ECR
echo "🔐 Logging into ECR..."
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_URI

# Tag and push
echo "📤 Pushing Docker image..."
docker tag $DOCKER_IMAGE_NAME:latest $ECR_URI:latest
docker push $ECR_URI:latest
echo "✅ Docker image pushed to ECR"

# Step 3: Update Dockerrun.aws.json
echo ""
echo "📝 Step 3: Updating Dockerrun.aws.json..."
cp Dockerrun.aws.json Dockerrun.aws.json.bak
sed "s|dig-bootstrap:latest|$ECR_URI:latest|g" Dockerrun.aws.json.bak > Dockerrun.aws.json
echo "✅ Dockerrun.aws.json updated with ECR URI"

# Step 4: Deploy with Terraform
echo ""
echo "🏗️  Step 4: Deploying to AWS with Terraform..."
cd terraform

# Initialize Terraform
terraform init

# Plan deployment
echo "📋 Planning Terraform deployment..."
terraform plan -var="aws_region=$AWS_REGION"

# Apply deployment
echo "🚀 Applying Terraform deployment..."
terraform apply -auto-approve -var="aws_region=$AWS_REGION"

# Get the bootstrap URL
BOOTSTRAP_URL=$(terraform output -raw bootstrap_url)

echo ""
echo "📊 Deployment Results:"
terraform output

cd ..

echo ""
echo "🎉 Deployment completed successfully!"
echo ""
echo "📋 Bootstrap Server Information:"
echo "   - URL: $BOOTSTRAP_URL"
echo "   - Health: $BOOTSTRAP_URL/health"
echo "   - Stats: $BOOTSTRAP_URL/stats"
echo "   - Peers: $BOOTSTRAP_URL/peers"
echo ""
echo "🔧 Configure your DIG nodes with:"
echo "   discoveryServers: ['$BOOTSTRAP_URL']"
echo ""
echo "📝 Example DIG node configuration:"
echo "   const node = new DIGNode({"
echo "     port: 4001,"
echo "     discoveryServers: ['$BOOTSTRAP_URL'],"
echo "     enableGlobalDiscovery: true"
echo "   });"
echo ""
echo "🧪 Test the deployment:"
echo "   curl $BOOTSTRAP_URL/health"
echo "   curl $BOOTSTRAP_URL/stats"
echo ""
echo "💰 Estimated monthly cost: ~$3.80 (t3.nano spot instance)"
