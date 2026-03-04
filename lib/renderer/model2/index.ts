/**
 * Model 2 renderer + cleanup — staged, NOT enabled.
 * Do not import from request routes until Phase 5 cutover.
 * One file per request: envs/<key>/<slug>/tfpilot/requests/req_<id>.tf
 * Module source: ../../../modules/<module>
 */

export {
  computeRequestTfPath,
  MODULE_SOURCE_PREFIX,
  getModuleSourceV2,
} from "./paths"
export {
  renderModuleBlockV2,
  renderRequestTfContent,
  generateModel2RequestFile,
  type RequestForRender,
} from "./renderer_v2"
export {
  getCleanupPathV2,
  assertCleanupPathSafe,
  type AssertCleanupPathSafeResult,
} from "./cleanup_v2"
