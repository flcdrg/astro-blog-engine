export const indexWordThreshold = 100;

export function countWords(body: string | undefined): number {
  return body ? body.trim().split(/\s+/).filter(Boolean).length : 0;
}

export function isBelowIndexWordThreshold(wordCount: number | undefined): boolean {
  return wordCount !== undefined && wordCount < indexWordThreshold;
}

export function isPostFrom2025Onwards(date: string): boolean {
  const postYear = Number(date.slice(0, 4));
  return Number.isFinite(postYear) && postYear >= 2025;
}

export function isPostNoindex(
  data: { date: string; index?: boolean | undefined },
  wordCount: number | undefined,
): boolean {
  return isBelowIndexWordThreshold(wordCount) && !isPostFrom2025Onwards(data.date) && !data.index;
}
