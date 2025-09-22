#!/bin/bash

# DIG Network Bootstrap Server Deployment Script

set -e

echo "🚀 DIG Network Bootstrap Server Deployment"
echo "=========================================="

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

# Step 2: Create ECR repository if it doesn't exist
echo ""
echo "📦 Step 2: Setting up ECR repository..."
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

echo "✅ ECR setup complete"

# Step 3: Tag and push Docker image
echo ""
echo "📤 Step 3: Pushing Docker image to ECR..."
docker tag $DOCKER_IMAGE_NAME:latest $ECR_URI:latest
docker push $ECR_URI:latest
echo "✅ Docker image pushed to ECR"

# Step 4: Update Dockerrun.aws.json with ECR URI
echo ""
echo "📝 Step 4: Updating Dockerrun.aws.json..."
sed -i.bak "s|\"Name\": \".*\"|\"Name\": \"$ECR_URI:latest\"|" Dockerrun.aws.json
echo "✅ Dockerrun.aws.json updated"

# Step 5: Deploy infrastructure with Terraform
echo ""
echo "🏗️  Step 5: Deploying infrastructure with Terraform..."
cd terraform

# Initialize Terraform
terraform init

# Plan deployment
echo "📋 Planning Terraform deployment..."
terraform plan -var="aws_region=$AWS_REGION"

# Apply deployment
echo "🚀 Applying Terraform deployment..."
terraform apply -auto-approve -var="aws_region=$AWS_REGION"

# Get outputs
echo ""
echo "📊 Deployment outputs:"
terraform output

echo ""
echo "🌐 DNS Configuration:"
echo "   - Zone: $(terraform output -raw route53_records | jq -r '.zone_name')"
echo "   - Bootstrap FQDN: $(terraform output -raw route53_records | jq -r '.bootstrap_fqdn')"
echo "   - Health Check: $(terraform output -raw health_check | jq -r '.health_check_url')"

cd ..

echo ""
echo "🎉 Deployment completed successfully!"
echo ""
echo "📋 Next steps:"
echo "1. Wait 5-10 minutes for Elastic Beanstalk to deploy"
echo "2. Check health: curl http://bootstrap.dig.net/health"
echo "3. Monitor stats: curl http://bootstrap.dig.net/stats"
echo "4. Configure your DIG nodes to use: http://bootstrap.dig.net:3000"
echo ""
echo "💰 Estimated monthly cost: ~$3.80 (t3.nano) + minimal data transfer"
echo ""
echo "🔧 To update the application:"
echo "   1. Make code changes"
echo "   2. Run this script again"
echo "   3. Elastic Beanstalk will automatically deploy the new version"
