# DIG Network Bootstrap Server - AWS Elastic Beanstalk Deployment
# Configured for cheapest possible EC2 instance

terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# Configure AWS Provider
provider "aws" {
  region = var.aws_region
}

# Data sources
data "aws_availability_zones" "available" {
  state = "available"
}

# Elastic Beanstalk Application
resource "aws_elastic_beanstalk_application" "dig_bootstrap" {
  name        = "dig-network-bootstrap"
  description = "DIG Network Bootstrap Server for global peer discovery"

  appversion_lifecycle {
    service_role          = aws_iam_role.eb_service_role.arn
    max_count             = 5
    delete_source_from_s3 = true
  }

  tags = {
    Name        = "DIG Bootstrap Server"
    Environment = var.environment
    Project     = "DIG Network"
  }
}

# S3 bucket for application versions
resource "aws_s3_bucket" "eb_bucket" {
  bucket        = "elasticbeanstalk-us-east-1-752233440971"
  force_destroy = true
}

# Application version
resource "aws_elastic_beanstalk_application_version" "dig_bootstrap_version" {
  name         = "v1.0.6"
  application  = aws_elastic_beanstalk_application.dig_bootstrap.name
  description  = "Unified DIG Node v1.0.6 - P2P + Bootstrap + TURN + E2E Encryption"
  bucket       = aws_s3_bucket.eb_bucket.bucket
  key          = "bootstrap-app-v7.zip"

  depends_on = [aws_s3_bucket.eb_bucket]
}

# Elastic Beanstalk Environment
resource "aws_elastic_beanstalk_environment" "dig_bootstrap_env" {
  name                = "dig-bootstrap-${var.environment}"
  application         = aws_elastic_beanstalk_application.dig_bootstrap.name
  solution_stack_name = "64bit Amazon Linux 2023 v4.7.1 running Docker"
  version_label       = aws_elastic_beanstalk_application_version.dig_bootstrap_version.name
  tier                = "WebServer"

  # Use cheapest possible instance type
  setting {
    namespace = "aws:autoscaling:launchconfiguration"
    name      = "InstanceType"
    value     = "t3.nano" # Cheapest: 2 vCPU, 0.5 GB RAM, $3.80/month
  }

  # Instance profile
  setting {
    namespace = "aws:autoscaling:launchconfiguration"
    name      = "IamInstanceProfile"
    value     = aws_iam_instance_profile.eb_ec2_profile.name
  }

  # Minimum configuration for cost optimization
  setting {
    namespace = "aws:autoscaling:asg"
    name      = "MinSize"
    value     = "1"
  }

  setting {
    namespace = "aws:autoscaling:asg"
    name      = "MaxSize"
    value     = "2" # Allow scaling to 2 instances if needed
  }

  # Health check configuration
  setting {
    namespace = "aws:elasticbeanstalk:healthreporting:system"
    name      = "SystemType"
    value     = "enhanced"
  }

  setting {
    namespace = "aws:elasticbeanstalk:application"
    name      = "Application Healthcheck URL"
    value     = "/health"
  }

  # Environment variables
  setting {
    namespace = "aws:elasticbeanstalk:application:environment"
    name      = "NODE_ENV"
    value     = "production"
  }

  setting {
    namespace = "aws:elasticbeanstalk:application:environment"
    name      = "PORT"
    value     = "3000"
  }

  setting {
    namespace = "aws:elasticbeanstalk:application:environment"
    name      = "DIG_LOG_LEVEL"
    value     = "INFO"
  }

  # Load balancer configuration
  setting {
    namespace = "aws:elasticbeanstalk:environment"
    name      = "LoadBalancerType"
    value     = "application"
  }

  # VPC configuration (use default VPC for cost savings)
  setting {
    namespace = "aws:ec2:vpc"
    name      = "VPCId"
    value     = aws_default_vpc.default.id
  }

  setting {
    namespace = "aws:ec2:vpc"
    name      = "Subnets"
    value     = join(",", aws_default_subnet.default[*].id)
  }

  setting {
    namespace = "aws:ec2:vpc"
    name      = "ELBSubnets"
    value     = join(",", aws_default_subnet.default[*].id)
  }

  # Security group for the bootstrap server
  setting {
    namespace = "aws:autoscaling:launchconfiguration"
    name      = "SecurityGroups"
    value     = aws_security_group.dig_bootstrap.id
  }

  # Enable spot instances for even cheaper costs (optional)
  setting {
    namespace = "aws:ec2:instances"
    name      = "EnableSpot"
    value     = "true"
  }

  setting {
    namespace = "aws:ec2:instances"
    name      = "SpotMaxPrice"
    value     = "0.005" # Max $0.005/hour (very cheap)
  }

  # Rolling updates configuration
  setting {
    namespace = "aws:elasticbeanstalk:command"
    name      = "DeploymentPolicy"
    value     = "Rolling"
  }

  setting {
    namespace = "aws:elasticbeanstalk:command"
    name      = "BatchSizeType"
    value     = "Fixed"
  }

  setting {
    namespace = "aws:elasticbeanstalk:command"
    name      = "BatchSize"
    value     = "1"
  }

  tags = {
    Name        = "DIG Bootstrap Environment"
    Environment = var.environment
    Project     = "DIG Network"
  }
}

# Default VPC (free tier eligible)
resource "aws_default_vpc" "default" {
  tags = {
    Name = "Default VPC"
  }
}

# Default subnets in each AZ
resource "aws_default_subnet" "default" {
  count             = min(length(data.aws_availability_zones.available.names), 3)
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = {
    Name = "Default subnet for ${data.aws_availability_zones.available.names[count.index]}"
  }
}

# Security Group for Bootstrap Server
resource "aws_security_group" "dig_bootstrap" {
  name_prefix = "dig-bootstrap-"
  description = "Security group for DIG Network Bootstrap Server"
  vpc_id      = aws_default_vpc.default.id

  # HTTP traffic from load balancer
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # HTTPS traffic from load balancer
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Bootstrap server port
  ingress {
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # TURN server port for NAT traversal
  ingress {
    from_port   = 3478
    to_port     = 3478
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # TURN server UDP port
  ingress {
    from_port   = 3478
    to_port     = 3478
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # SSH access (optional, for debugging)
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"] # Restrict this in production
  }

  # All outbound traffic
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "DIG Bootstrap Security Group"
  }
}

# IAM Role for Elastic Beanstalk Service
resource "aws_iam_role" "eb_service_role" {
  name = "dig-bootstrap-eb-service-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "elasticbeanstalk.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name = "DIG Bootstrap EB Service Role"
  }
}

# Attach managed policy to service role
resource "aws_iam_role_policy_attachment" "eb_service_role_policy" {
  role       = aws_iam_role.eb_service_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSElasticBeanstalkService"
}

# IAM Role for EC2 instances
resource "aws_iam_role" "eb_ec2_role" {
  name = "dig-bootstrap-eb-ec2-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name = "DIG Bootstrap EB EC2 Role"
  }
}

# Attach managed policies to EC2 role
resource "aws_iam_role_policy_attachment" "eb_ec2_role_web_tier" {
  role       = aws_iam_role.eb_ec2_role.name
  policy_arn = "arn:aws:iam::aws:policy/AWSElasticBeanstalkWebTier"
}

resource "aws_iam_role_policy_attachment" "eb_ec2_role_worker_tier" {
  role       = aws_iam_role.eb_ec2_role.name
  policy_arn = "arn:aws:iam::aws:policy/AWSElasticBeanstalkWorkerTier"
}

resource "aws_iam_role_policy_attachment" "eb_ec2_role_multicontainer_docker" {
  role       = aws_iam_role.eb_ec2_role.name
  policy_arn = "arn:aws:iam::aws:policy/AWSElasticBeanstalkMulticontainerDocker"
}

# Add ECR permissions for private repository access
resource "aws_iam_role_policy_attachment" "eb_ec2_role_ecr" {
  role       = aws_iam_role.eb_ec2_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

# Instance profile for EC2
resource "aws_iam_instance_profile" "eb_ec2_profile" {
  name = "dig-bootstrap-eb-ec2-profile"
  role = aws_iam_role.eb_ec2_role.name
}

# Note: Using default Elastic Beanstalk URL instead of custom domain
# The bootstrap server will be available at: 
# http://dig-bootstrap-{environment}.{region}.elasticbeanstalk.com

# CloudWatch Log Group for application logs
resource "aws_cloudwatch_log_group" "dig_bootstrap_logs" {
  name              = "/aws/elasticbeanstalk/dig-bootstrap-${var.environment}/var/log/eb-docker/containers/eb-current-app"
  retention_in_days = 7 # Keep logs for 1 week (cost optimization)

  tags = {
    Name        = "DIG Bootstrap Logs"
    Environment = var.environment
  }
}
