export type ModuleType = "ecs" | "s3" | "sqs" | "misc"

export function getModuleType(moduleName: string, category?: string): ModuleType {
  const name = moduleName.toLowerCase()
  const cat = category?.toLowerCase()

  if (cat?.includes("ecs")) return "ecs"
  if (cat?.includes("compute") && name.includes("ecs")) return "ecs"

  if (cat?.includes("s3")) return "s3"
  if (cat?.includes("storage") && name.includes("s3")) return "s3"

  if (cat?.includes("sqs")) return "sqs"
  if (cat?.includes("queue") && name.includes("sqs")) return "sqs"

  if (name.includes("ecs")) return "ecs"
  if (name.includes("s3")) return "s3"
  if (name.includes("sqs")) return "sqs"
  return "misc"
}

export function getEnvTargetFile(envPath: string, type: ModuleType) {
  return `${envPath}/tfpilot.${type}.tf`
}
