#!/bin/bash

# Deploy Cost-Aware Bootstrap Server to AWS Elastic Beanstalk
# This script deploys the enhanced bootstrap server with cost monitoring

set -e

echo "🚀 Deploying Cost-Aware DIG Bootstrap Server to AWS Elastic Beanstalk"
echo "=================================================================="

# Configuration
APP_NAME="dig-bootstrap-server"
ENV_NAME="dig-bootstrap-production"
REGION="us-east-1"
MONTHLY_BUDGET="${MONTHLY_BUDGET:-800}"

# Build the application
echo "📦 Building application..."
npm install
npm run build

# Create deployment package
echo "📦 Creating deployment package..."
zip -r bootstrap-app-cost-aware.zip . -x "node_modules/*" "src/*" "*.log" ".git/*" "*.md"

# Check if EB CLI is installed
if ! command -v eb &> /dev/null; then
    echo "❌ EB CLI not found. Please install it first:"
    echo "   pip install awsebcli"
    exit 1
fi

# Check if application exists
if ! aws elasticbeanstalk describe-applications --application-names $APP_NAME --region $REGION &> /dev/null; then
    echo "🆕 Creating Elastic Beanstalk application..."
    eb init $APP_NAME --platform node.js --region $REGION
fi

# Deploy or create environment
if aws elasticbeanstalk describe-environments --application-name $APP_NAME --environment-names $ENV_NAME --region $REGION &> /dev/null; then
    echo "🔄 Updating existing environment..."
    eb deploy $ENV_NAME
else
    echo "🆕 Creating new environment..."
    eb create $ENV_NAME --instance-type t3.small
fi

# Set environment variables for cost management
echo "⚙️  Setting cost-aware environment variables..."
eb setenv MONTHLY_BUDGET=$MONTHLY_BUDGET \
         AWS_REGION=$REGION \
         NODE_ENV=production \
         COST_WARNING_THRESHOLD=0.70 \
         COST_THROTTLE_THRESHOLD=0.85 \
         COST_EMERGENCY_THRESHOLD=0.95 \
         COST_SHUTDOWN_THRESHOLD=0.98

# Get the environment URL
ENV_URL=$(eb status $ENV_NAME | grep "CNAME" | awk '{print $2}')

echo ""
echo "✅ Deployment completed successfully!"
echo "🌐 Application URL: http://$ENV_URL"
echo "💰 Monthly Budget: \$$MONTHLY_BUDGET"
echo ""
echo "📊 Monitor your deployment:"
echo "   Health: http://$ENV_URL/health"
echo "   Cost Stats: http://$ENV_URL/cost-stats"
echo ""
echo "🚨 Important Setup Steps:"
echo "1. Configure IAM role permissions for Cost Explorer and CloudWatch"
echo "2. Set up CloudWatch alarms for cost thresholds"
echo "3. Configure SNS notifications for budget alerts"
echo ""
echo "📖 See COST_CONFIGURATION.md for detailed setup instructions"

# Create CloudWatch alarms
echo "📊 Setting up CloudWatch alarms..."

# Budget Warning Alarm (70%)
aws cloudwatch put-metric-alarm \
    --alarm-name "DIG-Bootstrap-Budget-Warning" \
    --alarm-description "DIG Bootstrap server budget usage warning" \
    --metric-name "CostRatio" \
    --namespace "DIG/Bootstrap/Costs" \
    --statistic "Average" \
    --period 300 \
    --threshold 0.70 \
    --comparison-operator "GreaterThanThreshold" \
    --evaluation-periods 1 \
    --region $REGION || echo "⚠️  CloudWatch alarm creation requires proper permissions"

# Budget Critical Alarm (85%)
aws cloudwatch put-metric-alarm \
    --alarm-name "DIG-Bootstrap-Budget-Critical" \
    --alarm-description "DIG Bootstrap server budget usage critical" \
    --metric-name "CostRatio" \
    --namespace "DIG/Bootstrap/Costs" \
    --statistic "Average" \
    --period 300 \
    --threshold 0.85 \
    --comparison-operator "GreaterThanThreshold" \
    --evaluation-periods 1 \
    --region $REGION || echo "⚠️  CloudWatch alarm creation requires proper permissions"

# Emergency Mode Alarm (95%)
aws cloudwatch put-metric-alarm \
    --alarm-name "DIG-Bootstrap-Budget-Emergency" \
    --alarm-description "DIG Bootstrap server budget emergency mode" \
    --metric-name "CostRatio" \
    --namespace "DIG/Bootstrap/Costs" \
    --statistic "Average" \
    --period 300 \
    --threshold 0.95 \
    --comparison-operator "GreaterThanThreshold" \
    --evaluation-periods 1 \
    --region $REGION || echo "⚠️  CloudWatch alarm creation requires proper permissions"

echo ""
echo "🎯 Next Steps:"
echo "1. Test the cost-aware features: curl http://$ENV_URL/cost-stats"
echo "2. Monitor AWS billing console for actual costs"
echo "3. Adjust MONTHLY_BUDGET if needed: eb setenv MONTHLY_BUDGET=new_amount"
echo "4. Set up premium user authentication in your DIG clients"
echo ""
echo "💡 Pro Tips:"
echo "- Start with a conservative budget (80% of your actual limit)"
echo "- Monitor the /cost-stats endpoint daily"
echo "- Set up premium user tiers to ensure revenue during throttling"
echo "- Always encourage P2P connections first to minimize costs"

# Cleanup
rm -f bootstrap-app-cost-aware.zip

echo ""
echo "🎉 Cost-Aware Bootstrap Server deployment complete!"
echo "💰 Your AWS costs are now protected with intelligent throttling"
