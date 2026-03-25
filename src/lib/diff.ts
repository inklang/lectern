/**
 * Shared diff computation for package versions.
 * Computes diffs for dependencies (JSON deep-diff), readme, and description (line-by-line).
 */

export interface DependencyChanges {
  added: Array<{ name: string; version: string }>
  removed: Array<{ name: string; version: string }>
  changed: Array<{ name: string; oldVersion: string; newVersion: string }>
}

export interface TextDiffLine {
  type: 'added' | 'removed' | 'context'
  content: string
  lineNumber?: number
}

export interface TextDiff {
  lines: TextDiffLine[]
  hasCollapsedRegions: boolean
}

export interface DescriptionDiff {
  diff: TextDiff
  isEmpty: boolean
}

export interface DiffResult {
  dependencies: DependencyChanges
  readme: TextDiff
  description: TextDiff
}

/**
 * Compute dependency changes between two versions.
 * Returns added, removed, and changed keys grouped.
 */
export function diffDependencies(
  v1Deps: Record<string, string>,
  v2Deps: Record<string, string>
): DependencyChanges {
  const keys1 = Object.keys(v1Deps)
  const keys2 = Object.keys(v2Deps)
  const set1 = new Set(keys1)
  const set2 = new Set(keys2)

  const added: DependencyChanges['added'] = []
  const removed: DependencyChanges['removed'] = []
  const changed: DependencyChanges['changed'] = []

  for (const key of keys2) {
    if (!set1.has(key)) {
      added.push({ name: key, version: v2Deps[key] })
    }
  }

  for (const key of keys1) {
    if (!set2.has(key)) {
      removed.push({ name: key, version: v1Deps[key] })
    }
  }

  for (const key of keys1) {
    if (set2.has(key) && v1Deps[key] !== v2Deps[key]) {
      changed.push({ name: key, oldVersion: v1Deps[key], newVersion: v2Deps[key] })
    }
  }

  // Sort alphabetically
  added.sort((a, b) => a.name.localeCompare(b.name))
  removed.sort((a, b) => a.name.localeCompare(b.name))
  changed.sort((a, b) => a.name.localeCompare(b.name))

  return { added, removed, changed }
}

/**
 * Compute a line-by-line diff between two text strings.
 * Uses a simple LCS (Longest Common Subsequence) algorithm.
 * For long files (>500 lines), collapsed regions are marked.
 */
export function diffText(
  text1: string | null,
  text2: string | null,
  maxLinesBeforeCollapse = 500
): TextDiff {
  const t1 = text1 ?? ''
  const t2 = text2 ?? ''

  const lines1 = t1.split('\n')
  const lines2 = t2.split('\n')

  // Build LCS matrix
  const m = lines1.length
  const n = lines2.length

  // For very long files, use a smarter approach to avoid O(mn) memory
  if (m > maxLinesBeforeCollapse * 2 || n > maxLinesBeforeCollapse * 2) {
    return diffTextLarge(lines1, lines2, maxLinesBeforeCollapse)
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (lines1[i - 1] === lines2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // Backtrack to find the diff
  const diff: TextDiffLine[] = []
  let i = m
  let j = n
  const operations: Array<{ type: 'added' | 'removed' | 'context'; content: string; li?: number; lj?: number }> = []

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && lines1[i - 1] === lines2[j - 1]) {
      operations.unshift({ type: 'context', content: lines1[i - 1], li: i - 1, lj: j - 1 })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      operations.unshift({ type: 'added', content: lines2[j - 1], lj: j - 1 })
      j--
    } else if (i > 0) {
      operations.unshift({ type: 'removed', content: lines1[i - 1], li: i - 1 })
      i--
    }
  }

  // Convert to diff lines with line numbers
  let lineNum1 = 1
  let lineNum2 = 1
  for (const op of operations) {
    if (op.type === 'context') {
      diff.push({ type: 'context', content: op.content, lineNumber: lineNum1 })
      lineNum1++
      lineNum2++
    } else if (op.type === 'removed') {
      diff.push({ type: 'removed', content: op.content, lineNumber: lineNum1 })
      lineNum1++
    } else {
      diff.push({ type: 'added', content: op.content, lineNumber: lineNum2 })
      lineNum2++
    }
  }

  return { lines: diff, hasCollapsedRegions: false }
}

/**
 * Diff for large files - collapses unchanged regions.
 */
function diffTextLarge(
  lines1: string[],
  lines2: string[],
  maxLinesBeforeCollapse: number
): TextDiff {
  // For large files, just do a simple line-by-line diff without full LCS
  // This is a simplified approach that marks added/removed lines
  const diff: TextDiffLine[] = []
  const maxLen = Math.max(lines1.length, lines2.length)
  let hasCollapsedRegions = false

  // Simple approach: iterate and compare
  let i = 0
  let j = 0
  let lineNum1 = 1
  let lineNum2 = 1

  while (i < lines1.length || j < lines2.length) {
    if (i >= lines1.length) {
      // Remaining lines are added
      diff.push({ type: 'added', content: lines2[j], lineNumber: lineNum2 })
      j++
      lineNum2++
    } else if (j >= lines2.length) {
      // Remaining lines are removed
      diff.push({ type: 'removed', content: lines1[i], lineNumber: lineNum1 })
      i++
      lineNum1++
    } else if (lines1[i] === lines2[j]) {
      // Check if we should collapse
      if (diff.length > 0 && diff[diff.length - 1].type !== 'context') {
        // Look ahead to see if there are many consecutive context lines
        let lookahead = 0
        let k1 = i + 1
        let k2 = j + 1
        while (k1 < lines1.length && k2 < lines2.length && lines1[k1] === lines2[k2]) {
          lookahead++
          k1++
          k2++
        }

        if (lookahead > maxLinesBeforeCollapse) {
          // Collapse
          hasCollapsedRegions = true
          diff.push({
            type: 'context',
            content: `... ${lookahead} lines hidden ...`,
            lineNumber: lineNum1,
          })
          i = k1
          j = k2
          lineNum1 += lookahead
          lineNum2 += lookahead
          continue
        }
      }

      diff.push({ type: 'context', content: lines1[i], lineNumber: lineNum1 })
      i++
      j++
      lineNum1++
      lineNum2++
    } else {
      // Lines differ - mark as removed + added pair if both exist in sequence
      const nextI = i + 1 < lines1.length ? lines1[i + 1] : null
      const nextJ = j + 1 < lines2.length ? lines2[j + 1] : null

      // Prefer to show removed first if the next line in v2 matches current in v1
      if (nextJ !== null && nextJ === lines1[i]) {
        diff.push({ type: 'added', content: lines2[j], lineNumber: lineNum2 })
        j++
        lineNum2++
      } else {
        diff.push({ type: 'removed', content: lines1[i], lineNumber: lineNum1 })
        i++
        lineNum1++
      }
    }
  }

  return { lines: diff, hasCollapsedRegions }
}

/**
 * Compute full diff between two package version rows.
 */
export function computeDiff(
  v1: { dependencies: Record<string, string>; readme: string | null; description: string | null },
  v2: { dependencies: Record<string, string>; readme: string | null; description: string | null }
): DiffResult {
  const dependencies = diffDependencies(v1.dependencies ?? {}, v2.dependencies ?? {})

  const readme = diffText(v1.readme, v2.readme)
  const description = diffText(v1.description, v2.description)

  return { dependencies, readme, description }
}

/**
 * Check if a diff result has any changes.
 */
export function hasChanges(diff: TextDiff): boolean {
  return diff.lines.some(line => line.type !== 'context')
}

export function hasDependencyChanges(changes: DependencyChanges): boolean {
  return changes.added.length > 0 || changes.removed.length > 0 || changes.changed.length > 0
}
