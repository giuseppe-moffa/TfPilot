export type ModuleType = "s3" | "ecr" | "ec2" | "misc"

export function getModuleType(moduleName: string, category?: string): ModuleType {
  const name = moduleName.toLowerCase()
  const cat = category?.toLowerCase()

  if (cat?.includes("s3")) return "s3"
  if (cat?.includes("storage") && name.includes("s3")) return "s3"

  if (cat?.includes("ecr") || cat?.includes("container")) return "ecr"
  if (name.includes("ecr")) return "ecr"

  if (name.includes("ec2") || (cat?.includes("compute") && name.includes("instance"))) return "ec2"

  if (name.includes("s3")) return "s3"
  return "misc"
}

export function getEnvTargetFile(envPath: string, type: ModuleType) {
  return `${envPath}/tfpilot.${type}.tf`
}
