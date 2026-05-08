// Simple concurrency limiter. Runs up to `limit` async tasks at a time.
// Each task is a function returning a Promise. Resolves to the array of
// results in input order. Errors don't stop other tasks — they're returned
// as-is so the caller can decide whether to surface or aggregate.
export async function parallelLimit(tasks, limit = 5) {
  const results = new Array(tasks.length)
  let nextIndex = 0

  async function worker() {
    while (true) {
      const i = nextIndex++
      if (i >= tasks.length) return
      try {
        results[i] = await tasks[i]()
      } catch (e) {
        results[i] = { __error: e }
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker)
  await Promise.all(workers)
  return results
}
