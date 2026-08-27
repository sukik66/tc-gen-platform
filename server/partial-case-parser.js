/**
 * Extract only fully closed case objects from a truncated {"cases":[...]} payload.
 * Braces inside strings and nested objects do not affect case boundaries.
 */
export function extractCompleteCaseObjects(text) {
  const source = String(text ?? '')
  const match = /"cases"\s*:\s*\[/g.exec(source)
  if (!match) return []

  const objects = []
  let objectStart = -1
  let objectDepth = 0
  let arrayDepth = 1
  let inString = false
  let escaped = false

  for (let index = match.index + match[0].length; index < source.length; index++) {
    const char = source[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }
    if (char === '[') arrayDepth++
    else if (char === ']') {
      arrayDepth--
      if (arrayDepth === 0) break
    }

    if (char === '{') {
      if (objectDepth === 0) objectStart = index
      objectDepth++
      continue
    }
    if (char !== '}' || objectDepth === 0) continue

    objectDepth--
    if (objectDepth !== 0 || objectStart < 0) continue
    const block = source.slice(objectStart, index + 1)
    try {
      const parsed = JSON.parse(block)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) objects.push(parsed)
    } catch {
      // Balanced but invalid JSON is not repaired because its fields are untrusted.
    }
    objectStart = -1
  }

  return objects
}
