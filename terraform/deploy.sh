#!/bin/bash
set -e

echo "🚀 Deploying Unified DIG Node to AWS Elastic Beanstalk..."

# Build the application
echo "📦 Building application..."
cd ..
npm run build

# Create deployment package
echo "📦 Creating deployment package..."
rm -f bootstrap-app-v11.zip

# Create a temporary directory for the deployment package
mkdir -p deploy-temp
cp -r dist/ deploy-temp/
cp package.json deploy-temp/
cp package-lock.json deploy-temp/
cp Dockerfile deploy-temp/
cp Dockerrun.aws.json deploy-temp/
cp -r .ebextensions/ deploy-temp/ 2>/dev/null || echo "No .ebextensions directory found"

# Create the zip file
cd deploy-temp
zip -r ../bootstrap-app-v11.zip . -x "*.git*" "node_modules/*" "*.log" "*.tmp"
cd ..
rm -rf deploy-temp

echo "✅ Created bootstrap-app-v11.zip ($(du -h bootstrap-app-v11.zip | cut -f1))"

# Upload to S3 (assuming AWS CLI is configured)
echo "☁️ Uploading to S3..."
aws s3 cp bootstrap-app-v11.zip s3://elasticbeanstalk-us-east-1-752233440971/bootstrap-app-v11.zip

# Apply Terraform changes
echo "🏗️ Applying Terraform configuration..."
cd terraform
terraform apply -auto-approve

echo "🎉 Deployment complete!"
echo "🌐 Bootstrap server URL: $(terraform output bootstrap_url)"
