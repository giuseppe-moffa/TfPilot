terraform {
  required_version = ">= 1.5.0"
}

module "requested" {
  source = "../../terraform-modules/s3-bucket"
  bucket_name = "dev-s3-bucket"
  versioning_enabled = true
  encryption_enabled = false
  block_public_access = true
  region = "eu-west-2"
}
