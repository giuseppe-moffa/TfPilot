export type MockRequest = {
  id: string
  project: string
  environment: string
  status: "pending" | "planned" | "approved" | "applied"
  updatedAt: string
  createdAt: string
  config?: { name?: string }
  plan?: { diff: string }
}

export const mockRequests: MockRequest[] = [
  {
    id: "req_ABC123",
    project: "payments",
    environment: "prod",
    status: "planned",
    updatedAt: "2026-02-07T10:30:00Z",
    createdAt: "2026-02-07T10:00:00Z",
    config: { name: "payments-api" },
    plan: { diff: "+ aws_ecs_service.api" },
  },
  {
    id: "req_DEF456",
    project: "core",
    environment: "dev",
    status: "approved",
    updatedAt: "2026-02-06T18:00:00Z",
    createdAt: "2026-02-06T17:50:00Z",
    config: { name: "core-shared" },
    plan: { diff: "+ aws_s3_bucket.core" },
  },
  {
    id: "req_GHI789",
    project: "core",
    environment: "dev",
    status: "planned",
    updatedAt: "2026-02-05T15:10:00Z",
    createdAt: "2026-02-05T15:00:00Z",
    config: { name: "core-db" },
    plan: { diff: "+ module.database.aws_rds_instance.db" },
  },
]
