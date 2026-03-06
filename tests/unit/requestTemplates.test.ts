/**
 * Unit tests: request-templates config (getRequestTemplate helper and API path).
 */

import { getRequestTemplate } from "@/config/request-templates"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

const mockTemplates = [
  {
    id: "blank",
    label: "Blank",
    moduleKey: "",
    environment: "",
    defaultConfig: {},
  },
  {
    id: "ec2-baseline",
    label: "EC2 Baseline",
    moduleKey: "ec2-instance",
    environment: "dev",
    defaultConfig: { name: "my-instance" },
  },
]

export const tests = [
  {
    name: "getRequestTemplate: returns template by id",
    fn: () => {
      const t = getRequestTemplate(mockTemplates as Parameters<typeof getRequestTemplate>[0], "ec2-baseline")
      assert(t != null, "template found")
      assert(t!.id === "ec2-baseline", "correct id")
      assert(t!.moduleKey === "ec2-instance", "correct moduleKey")
    },
  },
  {
    name: "getRequestTemplate: returns undefined for unknown id",
    fn: () => {
      const t = getRequestTemplate(mockTemplates as Parameters<typeof getRequestTemplate>[0], "unknown")
      assert(t === undefined, "unknown id returns undefined")
    },
  },
  {
    name: "getRequestTemplate: returns blank template",
    fn: () => {
      const t = getRequestTemplate(mockTemplates as Parameters<typeof getRequestTemplate>[0], "blank")
      assert(t != null && t.id === "blank", "blank template found")
      assert(t!.moduleKey === "", "blank has empty moduleKey")
    },
  },
  {
    name: "request-templates: new-request page fetches from correct API",
    fn: () => {
      const { readFileSync } = require("node:fs")
      const { join } = require("node:path")
      const content = readFileSync(
        join(process.cwd(), "app/requests/new/page.tsx"),
        "utf8"
      )
      assert(
        content.includes('fetch("/api/request-templates")'),
        "new-request page must fetch from /api/request-templates"
      )
    },
  },
  {
    name: "request-templates: catalogue pages use /api/request-templates",
    fn: () => {
      const { readFileSync } = require("node:fs")
      const { join } = require("node:path")
      const catalogueRequestsPage = readFileSync(
        join(process.cwd(), "app/catalogue/requests/page.tsx"),
        "utf8"
      )
      const catalogueIdPage = readFileSync(
        join(process.cwd(), "app/catalogue/[id]/page.tsx"),
        "utf8"
      )
      assert(
        catalogueRequestsPage.includes("/api/request-templates"),
        "catalogue requests page must use /api/request-templates"
      )
      assert(
        catalogueIdPage.includes("/api/request-templates"),
        "catalogue [id] page must use /api/request-templates"
      )
    },
  },
]
