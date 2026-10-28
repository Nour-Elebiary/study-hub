/**
 * A small line diff for the version comparison screen (spec section 6:
 * "show a text diff"). Pure TypeScript, no dependency — notes are plain
 * Markdown text and a line-level diff is what reviewers need.
 */

export type DiffLine = {
  kind: "same" | "added" | "removed";
  text: string;
};

/**
 * Longest-common-subsequence diff over lines. Notes are at most a few
 * hundred lines, so the O(n·m) table is fine.
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  // An empty text is zero lines (comparing against "nothing written yet").
  const a = oldText === "" ? [] : oldText.split("\n");
  const b = newText === "" ? [] : newText.split("\n");
  const n = a.length;
  const m = b.length;

  // lcs[i][j] = length of the LCS of a[i..] and b[j..]
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      result.push({ kind: "same", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      result.push({ kind: "removed", text: a[i] });
      i++;
    } else {
      result.push({ kind: "added", text: b[j] });
      j++;
    }
  }
  while (i < n) {
    result.push({ kind: "removed", text: a[i] });
    i++;
  }
  while (j < m) {
    result.push({ kind: "added", text: b[j] });
    j++;
  }
  return result;
}
