// lib/imagePaths.ts
// Pure, dependency-free helper for the image-cell format shared by the server
// (Agent 3 writes it) and the client (the dashboard reads it). Kept in its own
// module — with NO Node-only imports (fs, path, logger) — so client components
// can import it without pulling server code into the browser bundle.

// Parse an image-cell value that may be a JSON array of paths or a single path.
// "[...]"  -> the parsed string[] (bad JSON -> []).
// "/x.png" -> ["/x.png"]. ""/whitespace -> [].
export function parseImagePaths(value: string): string[] {
  const v = value.trim();
  if (v.length === 0) return [];
  if (v.startsWith("[")) {
    try {
      const arr = JSON.parse(v) as unknown;
      return Array.isArray(arr)
        ? arr.filter((x): x is string => typeof x === "string")
        : [];
    } catch {
      return [];
    }
  }
  return [v];
}
