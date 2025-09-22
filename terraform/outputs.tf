# Outputs for DIG Network Bootstrap Server deployment

output "application_name" {
  description = "Name of the Elastic Beanstalk application"
  value       = aws_elastic_beanstalk_application.dig_bootstrap.name
}

output "environment_name" {
  description = "Name of the Elastic Beanstalk environment"
  value       = aws_elastic_beanstalk_environment.dig_bootstrap_env.name
}

output "environment_url" {
  description = "URL of the Elastic Beanstalk environment"
  value       = "http://${aws_elastic_beanstalk_environment.dig_bootstrap_env.cname}"
}

output "bootstrap_url" {
  description = "Bootstrap server URL (use this in DIG node configurations)"
  value       = "http://${aws_elastic_beanstalk_environment.dig_bootstrap_env.cname}"
}

output "bootstrap_endpoints" {
  description = "Bootstrap server endpoints for DIG nodes"
  value = {
    registration = "http://${aws_elastic_beanstalk_environment.dig_bootstrap_env.cname}/register"
    discovery    = "http://${aws_elastic_beanstalk_environment.dig_bootstrap_env.cname}/peers"
    health       = "http://${aws_elastic_beanstalk_environment.dig_bootstrap_env.cname}/health"
    stats        = "http://${aws_elastic_beanstalk_environment.dig_bootstrap_env.cname}/stats"
    topology     = "http://${aws_elastic_beanstalk_environment.dig_bootstrap_env.cname}/topology"
  }
}

output "instance_type" {
  description = "EC2 instance type being used"
  value       = var.instance_type
}

output "estimated_monthly_cost" {
  description = "Estimated monthly cost in USD"
  value = var.instance_type == "t3.nano" ? "$3.80" : (
    var.instance_type == "t3.micro" ? "$7.59" : (
      var.instance_type == "t2.nano" ? "$4.18" : "$8.35"
    )
  )
}

output "deployment_commands" {
  description = "Commands to deploy the application"
  value = {
    build_docker   = "docker build -t dig-bootstrap ."
    tag_docker     = "docker tag dig-bootstrap:latest <your-ecr-repo>:latest"
    push_docker    = "docker push <your-ecr-repo>:latest"
    deploy_eb      = "eb deploy"
  }
}

output "configuration_for_dig_nodes" {
  description = "Configuration to use in DIG nodes"
  value = {
    discoveryServers = ["http://${aws_elastic_beanstalk_environment.dig_bootstrap_env.cname}"]
    example_config = {
      discoveryServers = ["http://${aws_elastic_beanstalk_environment.dig_bootstrap_env.cname}"]
      enableGlobalDiscovery = true
      enableMdns = true
      enableDht = true
    }
  }
}

output "monitoring_urls" {
  description = "URLs for monitoring the bootstrap server"
  value = {
    health    = "http://${aws_elastic_beanstalk_environment.dig_bootstrap_env.cname}/health"
    stats     = "http://${aws_elastic_beanstalk_environment.dig_bootstrap_env.cname}/stats"
    topology  = "http://${aws_elastic_beanstalk_environment.dig_bootstrap_env.cname}/topology"
    peers     = "http://${aws_elastic_beanstalk_environment.dig_bootstrap_env.cname}/peers"
  }
}
