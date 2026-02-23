import diff3Merge from "diff3"
import { gh } from "@/lib/github/client"

type Request = {
  targetOwner: string
  targetRepo: string
  branchName: string
  prNumber?: number
}

const owner = (r: Request) => r.targetOwner
const repo = (r: Request) => r.targetRepo

async function fetchFileAtRef(
  token: string,
  request: Request,
  path: string,
  ref: string
): Promise<string> {
  const res = await gh(
    token,
    `/repos/${owner(request)}/${repo(request)}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`
  )
  const json = (await res.json()) as { content?: string; encoding?: string }
  if (json.content && json.encoding === "base64") {
    return Buffer.from(json.content, "base64").toString("utf8")
  }
  return ""
}

/** Remove Git conflict markers and keep only one side so we never persist <<<<<<< / ======= / >>>>>>> into resolved file. */
function stripConflictMarkers(content: string, side: "head" | "base"): string {
  if (!content.includes("<<<<<<<") || !content.includes("=======") || !content.includes(">>>>>>>")) {
    return content
  }
  const lines = content.split("\n")
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith("<<<<<<<")) {
      const start = i + 1
      let sep = -1
      let end = -1
      for (let j = start; j < lines.length; j++) {
        if (lines[j].startsWith("=======")) {
          sep = j
          break
        }
      }
      for (let k = (sep >= 0 ? sep : start) + 1; k < lines.length; k++) {
        if (lines[k].startsWith(">>>>>>>")) {
          end = k
          break
        }
      }
      if (sep >= 0 && end >= 0) {
        if (side === "head") {
          for (let j = start; j < sep; j++) out.push(lines[j])
        } else {
          for (let j = sep + 1; j < end; j++) out.push(lines[j])
        }
        i = end + 1
        continue
      }
      // Malformed conflict (e.g. no =======): skip entire region, optionally keep head
      if (end >= 0) {
        if (side === "head") {
          for (let j = start; j < end; j++) out.push(lines[j])
        }
        i = end + 1
        continue
      }
    }
    out.push(line)
    i++
  }
  return out.join("\n")
}

/** Remove any remaining conflict-marker lines so we never persist them into the repo. */
function ensureNoConflictMarkers(content: string): string {
  return content
    .split("\n")
    .filter((line) => {
      const t = line.trimStart()
      return (
        !t.startsWith("<<<<<<<") &&
        !t.startsWith("=======") &&
        !t.startsWith(">>>>>>>")
      )
    })
    .join("\n")
}

/** Match a single tfpilot block: # --- tfpilot:begin:req_XXX --- ... # --- tfpilot:end:req_XXX --- */
const TFPILOT_BLOCK_REGEX = /# --- tfpilot:begin:(req_\S+) ---[\s\S]*?# --- tfpilot:end:\1 ---/

function parseTfPilotBlocks(content: string): { header: string; blocks: Array<{ id: string; text: string }>; footer: string } {
  const headerMatch = content.match(/^[\s\S]*?(?=# --- tfpilot:begin:)/)
  const header = headerMatch ? headerMatch[0] : ""
  const rest = content.slice(header.length)
  const blocks: Array<{ id: string; text: string }> = []
  let remaining = rest
  while (remaining.length > 0) {
    const match = remaining.match(TFPILOT_BLOCK_REGEX)
    if (!match) break
    const full = match[0]
    const id = match[1]
    blocks.push({ id, text: full })
    remaining = remaining.slice(remaining.indexOf(full) + full.length)
  }
  const footer = remaining
  return { header, blocks, footer }
}

/**
 * Merge base (main) and head (PR) for TfPilot-managed files: union of blocks by request id,
 * base order first then PR-only blocks in PR order. Avoids duplicates and broken markers.
 */
function resolveTfPilotMerge(baseContent: string, headContent: string): string {
  const baseParsed = parseTfPilotBlocks(baseContent)
  const headParsed = parseTfPilotBlocks(headContent)
  const baseIds = new Set(baseParsed.blocks.map((b) => b.id))
  const baseBlockById = new Map(baseParsed.blocks.map((b) => [b.id, b.text]))
  const headBlockById = new Map(headParsed.blocks.map((b) => [b.id, b.text]))
  const ordered: string[] = []
  for (const { id } of baseParsed.blocks) {
    ordered.push(baseBlockById.get(id)!)
  }
  const addedHeadIds = new Set<string>()
  for (const { id } of headParsed.blocks) {
    if (!baseIds.has(id) && !addedHeadIds.has(id)) {
      addedHeadIds.add(id)
      ordered.push(headBlockById.get(id)!)
    }
  }
  const header = (baseParsed.header.trim() ? baseParsed.header : headParsed.header).trimEnd()
  // Use only base (main) footer so we don't append PR's orphan end markers (e.g. leftover # --- tfpilot:end:req_XXX ---)
  const footer = baseParsed.footer.trimStart()
  const parts: string[] = []
  if (header) parts.push(header + "\n")
  // Ensure each block ends with exactly one newline so blocks don't run together (---# ---)
  parts.push(...ordered.map((block) => block.trimEnd() + "\n"))
  if (footer) parts.push("\n" + footer)
  return parts.join("").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n"
}

function resolveAcceptAll(baseContent: string, commonContent: string, headContent: string): string {
  if (
    baseContent.includes("# --- tfpilot:begin:") &&
    headContent.includes("# --- tfpilot:begin:")
  ) {
    return resolveTfPilotMerge(baseContent, headContent)
  }
  const a = baseContent.split("\n")
  const o = commonContent.split("\n")
  const b = headContent.split("\n")
  const result = diff3Merge(a, o, b) as Array<
    | { ok: string[] }
    | { conflict: Record<string, string[]> }
  >
  const lines: string[] = []
  for (const chunk of result) {
    if ("ok" in chunk) {
      lines.push(...chunk.ok)
    } else {
      const c = chunk.conflict
      const keys = Object.keys(c).filter((k) => Array.isArray(c[k])).sort()
      const preferredOrder = ["a", "b"]
      const ordered = [
        ...preferredOrder.filter((k) => keys.includes(k)),
        ...keys.filter((k) => !preferredOrder.includes(k)),
      ]
      for (const k of ordered) {
        lines.push(...(c[k] as string[]))
      }
    }
  }
  return lines.join("\n")
}

async function resolveMergeConflictAcceptBoth(
  token: string,
  request: Request,
  baseBranch: string,
  _prBranch: string
): Promise<string> {
  const { targetOwner, targetRepo, branchName: prBranchName } = request
  const compareRes = await gh(
    token,
    `/repos/${targetOwner}/${targetRepo}/compare/${baseBranch}...${prBranchName}`
  )
  const compareJson = (await compareRes.json()) as {
    merge_base_commit?: { sha?: string }
    files?: Array<{ filename: string }>
  }
  const mergeBaseSha = compareJson.merge_base_commit?.sha
  if (!mergeBaseSha) {
    throw new Error("Could not get merge base")
  }

  const compareBaseRes = await gh(
    token,
    `/repos/${targetOwner}/${targetRepo}/compare/${mergeBaseSha}...${baseBranch}`
  )
  const compareBaseJson = (await compareBaseRes.json()) as { files?: Array<{ filename: string }> }
  const compareHeadRes = await gh(
    token,
    `/repos/${targetOwner}/${targetRepo}/compare/${mergeBaseSha}...${prBranchName}`
  )
  const compareHeadJson = (await compareHeadRes.json()) as { files?: Array<{ filename: string }> }

  const filesBase = new Set((compareBaseJson.files ?? []).map((f) => f.filename))
  const filesHead = new Set((compareHeadJson.files ?? []).map((f) => f.filename))
  const conflictedPaths = [...filesBase].filter((p) => filesHead.has(p))
  const prOnlyPaths = [...filesHead].filter((p) => !filesBase.has(p))

  const resolvedContentByPath: Record<string, string> = {}
  for (const path of conflictedPaths) {
    const [commonContent, baseContent, headRaw] = await Promise.all([
      fetchFileAtRef(token, request, path, mergeBaseSha).catch(() => ""),
      fetchFileAtRef(token, request, path, baseBranch).catch(() => ""),
      fetchFileAtRef(token, request, path, prBranchName).catch(() => ""),
    ])
    // Strip conflict markers from PR branch (safe to run again if branch still had markers from a previous merge attempt)
    const headContent = stripConflictMarkers(headRaw, "head")
    let resolved = resolveAcceptAll(baseContent, commonContent, headContent)
    // If resolution left any markers (e.g. diff3 edge case), strip again keeping head
    if (resolved.includes("<<<<<<<")) {
      resolved = stripConflictMarkers(resolved, "head")
    }
    resolvedContentByPath[path] = resolved
  }

  // Use base (main) commit as parent so PR branch becomes linear (main + one commit); avoids GitHub showing stale "conflicting"
  const baseCommitRes = await gh(
    token,
    `/repos/${targetOwner}/${targetRepo}/commits/${baseBranch}`
  )
  const baseCommitJson = (await baseCommitRes.json()) as {
    sha?: string
    commit?: { tree?: { sha?: string } }
  }
  const baseCommitSha = baseCommitJson.sha
  const baseTreeSha = baseCommitJson.commit?.tree?.sha
  if (!baseCommitSha || !baseTreeSha) {
    throw new Error("Could not get base branch commit or tree")
  }

  const blobShasByPath: Record<string, string> = {}
  for (const path of conflictedPaths) {
    const content = ensureNoConflictMarkers(resolvedContentByPath[path])
    const blobRes = await gh(token, `/repos/${targetOwner}/${targetRepo}/git/blobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: Buffer.from(content, "utf8").toString("base64"),
        encoding: "base64",
      }),
    })
    const blobJson = (await blobRes.json()) as { sha?: string }
    if (blobJson.sha) blobShasByPath[path] = blobJson.sha
  }
  for (const path of prOnlyPaths) {
    const headRaw = await fetchFileAtRef(token, request, path, prBranchName).catch(() => "")
    const content = ensureNoConflictMarkers(stripConflictMarkers(headRaw, "head"))
    const blobRes = await gh(token, `/repos/${targetOwner}/${targetRepo}/git/blobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: Buffer.from(content, "utf8").toString("base64"),
        encoding: "base64",
      }),
    })
    const blobJson = (await blobRes.json()) as { sha?: string }
    if (blobJson.sha) blobShasByPath[path] = blobJson.sha
  }

  const treeEntries = [...conflictedPaths, ...prOnlyPaths]
    .filter((path) => blobShasByPath[path])
    .map((path) => ({
      path,
      mode: "100644" as const,
      type: "blob" as const,
      sha: blobShasByPath[path],
    }))

  // Base tree = main's tree so result is "main + resolved changes" (linear history)
  const treeCreateRes = await gh(token, `/repos/${targetOwner}/${targetRepo}/git/trees`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
  })
  const treeCreateJson = (await treeCreateRes.json()) as { sha?: string }
  const newTreeSha = treeCreateJson.sha
  if (!newTreeSha) {
    throw new Error("Failed to create tree")
  }

  // Single parent = base (main) so PR is rebased onto main
  const commitRes = await gh(token, `/repos/${targetOwner}/${targetRepo}/git/commits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `Merge ${baseBranch} into ${prBranchName} (resolve conflicts - accept both)`,
      tree: newTreeSha,
      parents: [baseCommitSha],
    }),
  })
  const commitJson = (await commitRes.json()) as { sha?: string }
  const newCommitSha = commitJson.sha
  if (!newCommitSha) {
    throw new Error("Failed to create commit")
  }

  // Force-push so PR branch = main + this commit (clears conflicting state)
  await gh(
    token,
    `/repos/${targetOwner}/${targetRepo}/git/refs/heads/${encodeURIComponent(prBranchName)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sha: newCommitSha, force: true }),
    }
  )

  return newCommitSha
}

export type UpdateBranchResult =
  | { ok: true; alreadyUpToDate?: boolean; sha?: string; resolvedConflicts?: boolean }
  | { ok: false; error: string; status?: number }

/**
 * Back-merge the base branch into the PR branch. Use when PR is not mergeable (state=dirty).
 * On 409 merge conflict, resolves by "accept all" and pushes a new commit.
 */
export async function runUpdateBranch(
  token: string,
  request: Request
): Promise<UpdateBranchResult> {
  const prBranch = request.branchName
  let baseBranch: string

  if (request.prNumber) {
    const prRes = await gh(
      token,
      `/repos/${request.targetOwner}/${request.targetRepo}/pulls/${request.prNumber}`
    )
    const prJson = (await prRes.json()) as { base?: { ref?: string } }
    baseBranch = prJson.base?.ref ?? "main"
  } else {
    const repoRes = await gh(
      token,
      `/repos/${request.targetOwner}/${request.targetRepo}`
    )
    const repoJson = (await repoRes.json()) as { default_branch?: string }
    baseBranch = repoJson.default_branch ?? "main"
  }

  try {
    const mergeRes = await gh(
      token,
      `/repos/${request.targetOwner}/${request.targetRepo}/merges`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base: prBranch,
          head: baseBranch,
          commit_message: `Merge ${baseBranch} into ${prBranch} (update branch)`,
        }),
      }
    )

    if (mergeRes.status === 204) {
      return { ok: true, alreadyUpToDate: true }
    }

    const mergeJson = (await mergeRes.json()) as { sha?: string; message?: string }
    if (mergeJson.message && !mergeJson.sha) {
      return { ok: false, error: mergeJson.message || "Update branch failed", status: 400 }
    }

    return { ok: true, sha: mergeJson.sha }
  } catch (mergeError: unknown) {
    const status = (mergeError as { status?: number })?.status
    const message = mergeError instanceof Error ? mergeError.message : ""
    const isConflict = status === 409 || message.includes("409") || message.includes("Merge conflict")
    if (isConflict) {
      console.log("[TfPilot updateBranch] Merge conflict (409), resolving and pushing resolved commit…")
      try {
        const newSha = await resolveMergeConflictAcceptBoth(
          token,
          request,
          baseBranch,
          prBranch
        )
        console.log("[TfPilot updateBranch] Resolved and pushed commit:", newSha)
        return { ok: true, sha: newSha, resolvedConflicts: true }
      } catch (resolveErr) {
        console.error("[TfPilot updateBranch] Resolve failed:", resolveErr)
        return {
          ok: false,
          error:
            "Merge conflict — resolve on GitHub (open the PR and use “Update branch” or resolve conflicts there), then try again.",
          status: 409,
        }
      }
    }
    return {
      ok: false,
      error: mergeError instanceof Error ? mergeError.message : "Update branch failed",
      status: status && status >= 400 && status < 600 ? status : 500,
    }
  }
}
