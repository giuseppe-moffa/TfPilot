import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses"
import { env } from "@/lib/config/env"

const ses = new SESClient({ region: env.TFPILOT_DEFAULT_REGION })

export async function sendAdminNotification(subject: string, body: string): Promise<void> {
  const recipients = env.TFPILOT_ADMIN_EMAILS
  if (recipients.length === 0) {
    return // No-op if no recipients configured
  }

  try {
    await ses.send(
      new SendEmailCommand({
        Source: env.TFPILOT_EMAIL_FROM,
        Destination: {
          ToAddresses: recipients,
        },
        Message: {
          Subject: {
            Data: subject,
            Charset: "UTF-8",
          },
          Body: {
            Text: {
              Data: body,
              Charset: "UTF-8",
            },
          },
        },
      })
    )
  } catch (error) {
    // Log errors but don't throw - notifications shouldn't break workflows
    console.error("[notifications/email] failed to send admin notification", {
      error,
      subject,
      recipientCount: recipients.length,
    })
  }
}

export function formatRequestNotification(
  event: "apply_failed" | "destroy_failed" | "plan_failed" | "apply_success" | "destroy_success",
  request: any,
  actor: string,
  runUrl?: string
): { subject: string; body: string } {
  const eventLabels: Record<string, string> = {
    apply_failed: "Apply Failed",
    destroy_failed: "Destroy Failed",
    plan_failed: "Plan Failed",
    apply_success: "Apply Succeeded",
    destroy_success: "Destroy Succeeded",
  }

  const subject = `TfPilot: ${eventLabels[event]} - ${request.id}`

  const body = [
    `${eventLabels[event]}`,
    "",
    `Request ID: ${request.id}`,
    `Project: ${request.project}`,
    `Environment: ${request.environment}`,
    `Module: ${request.module}`,
    `Actor: ${actor}`,
    request.targetOwner && request.targetRepo
      ? `Target Repo: ${request.targetOwner}/${request.targetRepo}`
      : null,
    runUrl ? `Workflow Run: ${runUrl}` : null,
    "",
    `Timestamp: ${new Date().toISOString()}`,
  ]
    .filter(Boolean)
    .join("\n")

  return { subject, body }
}
