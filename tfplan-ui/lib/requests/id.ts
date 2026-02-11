import crypto from "node:crypto"

const MODULE_CODE_MAP: Record<string, string> = {
  "s3-bucket": "s3",
  "sqs-queue": "sqs",
  "ecs-service": "ecs",
  "iam-role-app": "iam",
}

const SAFE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no O0I1

function randomCode(length = 6) {
  const bytes = crypto.randomBytes(length * 2)
  let code = ""
  for (let i = 0; i < bytes.length && code.length < length; i++) {
    const idx = bytes[i] % SAFE_ALPHABET.length
    code += SAFE_ALPHABET[idx]
  }
  return code
}

export function moduleTypeToCode(type: string) {
  return MODULE_CODE_MAP[type] ?? type.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toLowerCase()
}

export function generateRequestId(environment: string, moduleType: string) {
  const envPart = environment.toLowerCase()
  const moduleCode = moduleTypeToCode(moduleType)
  const shortId = randomCode(6)
  return `req_${envPart}_${moduleCode}_${shortId}`
}

export const moduleCodeMapping = MODULE_CODE_MAP
