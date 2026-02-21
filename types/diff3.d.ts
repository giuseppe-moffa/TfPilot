declare module "diff3" {
  type ConflictChunk = { conflict: true; a: string[]; o: string[]; b: string[] }
  type OkChunk = { ok: string[] }
  type Chunk = OkChunk | ConflictChunk

  function diff3Merge(
    a: string[],
    o: string[],
    b: string[]
  ): Chunk[]

  export default diff3Merge
}
