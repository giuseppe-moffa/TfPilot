terraform {
  required_version = ">= 1.5.0"
}

module "requested" {
  source = "../../terraform-modules/sqs-queue"
  name = "dev-sqs.fifo"
  region = "eu-west-2"
  fifo_queue = true
  message_retention_seconds = 60
  visibility_timeout_seconds = 20
}
