export const mockPlan = {
    before: `
  resource "aws_ecs_service" "api" {
    name = "orders-api"
    desired_count = 1
    ...
  }
  `,
    after: `
  resource "aws_ecs_service" "api" {
    name = "orders-api"
    desired_count = 2
    ...
  }
  `,
    changes: ['Update desired_count from 1 → 2'],
  }
  