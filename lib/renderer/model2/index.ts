/**
 * Model 2 renderer + cleanup — staged, NOT enabled.
 * Do not import from request routes until Phase 5 cutover.
 * One file per request: envs/<key>/<slug>/tfpilot/requests/req_<id>.tf
 * Module source: ../../../modules/<module>
 */

export {
  computeRequestTfPath,
  MODULE_SOURCE_PREFIX,
  getModuleSource,
} from "./paths"
export {
  renderModuleBlock,
  renderRequestTfContent,
  generateModel2RequestFile,
  type RequestForRender,
} from "./renderer"
export {
  getCleanupPath,
  assertCleanupPathSafe,
  type AssertCleanupPathSafeResult,
} from "./cleanup"
