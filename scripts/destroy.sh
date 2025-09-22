#!/bin/bash

# DIG Network Bootstrap Server Destruction Script

set -e

echo "🗑️  DIG Network Bootstrap Server Destruction"
echo "==========================================="

echo "⚠️  WARNING: This will destroy all AWS resources!"
echo "This includes:"
echo "   - Elastic Beanstalk application and environment"
echo "   - ECR repository and Docker images"
echo "   - Route53 DNS records"
echo "   - Security groups and IAM roles"
echo ""

read -p "Are you sure you want to proceed? (type 'yes' to confirm): " confirm

if [ "$confirm" != "yes" ]; then
    echo "❌ Destruction cancelled"
    exit 0
fi

AWS_REGION=${AWS_REGION:-us-east-1}
ECR_REPOSITORY_NAME="dig-network/bootstrap"

echo ""
echo "🏗️  Destroying infrastructure with Terraform..."
cd terraform

# Destroy infrastructure
terraform destroy -auto-approve -var="aws_region=$AWS_REGION"

cd ..

echo ""
echo "📦 Cleaning up ECR repository..."
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Delete ECR repository
aws ecr delete-repository --repository-name $ECR_REPOSITORY_NAME --region $AWS_REGION --force >/dev/null 2>&1 || {
    echo "ℹ️  ECR repository not found or already deleted"
}

echo ""
echo "🧹 Cleaning up local Docker images..."
docker rmi dig-bootstrap:latest >/dev/null 2>&1 || echo "ℹ️  Local Docker image not found"

echo ""
echo "✅ Destruction completed successfully!"
echo ""
echo "💰 All AWS resources have been destroyed - no more charges will occur"
