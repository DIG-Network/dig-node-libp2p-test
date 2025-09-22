# Variables for DIG Network Bootstrap Server deployment

variable "aws_region" {
  description = "AWS region for deployment"
  type        = string
  default     = "us-east-1" # Cheapest region
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "prod"
}

# Note: Using default Elastic Beanstalk URL instead of custom domain

variable "instance_type" {
  description = "EC2 instance type (cheapest options)"
  type        = string
  default     = "t3.nano" # $3.80/month, 2 vCPU, 0.5 GB RAM
  
  validation {
    condition = contains([
      "t3.nano",    # $3.80/month - Cheapest
      "t3.micro",   # $7.59/month - Free tier eligible
      "t2.nano",    # $4.18/month - Previous gen
      "t2.micro"    # $8.35/month - Free tier eligible
    ], var.instance_type)
    error_message = "Instance type must be one of the cheapest options: t3.nano, t3.micro, t2.nano, t2.micro."
  }
}

variable "enable_spot_instances" {
  description = "Enable spot instances for even cheaper costs"
  type        = bool
  default     = true
}

variable "spot_max_price" {
  description = "Maximum price for spot instances (USD per hour)"
  type        = string
  default     = "0.005" # Very low price
}

variable "min_instances" {
  description = "Minimum number of instances"
  type        = number
  default     = 1
}

variable "max_instances" {
  description = "Maximum number of instances"
  type        = number
  default     = 2
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 7 # Keep costs low
}

variable "health_check_path" {
  description = "Health check path for load balancer"
  type        = string
  default     = "/health"
}

variable "application_port" {
  description = "Port the application listens on"
  type        = number
  default     = 3000
}

variable "ssl_certificate_arn" {
  description = "ARN of SSL certificate for HTTPS (optional)"
  type        = string
  default     = ""
}

# Tags for all resources
variable "default_tags" {
  description = "Default tags for all resources"
  type        = map(string)
  default = {
    Project     = "DIG Network"
    Component   = "Bootstrap Server"
    ManagedBy   = "Terraform"
    CostCenter  = "Infrastructure"
  }
}
