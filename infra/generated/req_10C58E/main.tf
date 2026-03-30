terraform {
  required_version = ">= 1.5.0"
}

module "requested" {
  source = "../../terraform-modules/s3-bucket"
  bucket_name = "dev-s3-bucket"
  region = "eu-west-2"
  versioning_enabled = true
  block_public_access = false
  server_side_encryption_enabled = false
}
