/**
 * Lightweight metrics hook — log markers for counter-style events.
 * No external metrics infra; parseable logs for dashboards/alerts.
 */

import { logInfo } from "@/lib/observability/logger"

export type EnvMetricName =
  | "env.create"
  | "env.destroy.dispatch"
  | "env.destroy.archive"
  | "env.destroy.reconcile.stale"
  | "env.destroy.reconcile.recovered"

export function incrementEnvMetric(name: EnvMetricName, data?: Record<string, unknown>): void {
  logInfo("metric", { metric: name, value: 1, ...data })
}
