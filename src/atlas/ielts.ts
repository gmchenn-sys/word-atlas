import type { Entry } from "./types";
import { MEDIA } from "./types";

/** Keep only the second, IELTS-context example without changing source data. */
export function ieltsMedia(media: number): number {
  return (media & ~(MEDIA.ex | MEDIA.ex2)) | (media & MEDIA.ex2 ? MEDIA.ex : 0);
}

export function ieltsEntry(entry: Entry): Entry {
  return { ...entry, ex: entry.ex.slice(1, 2), m: ieltsMedia(entry.m) };
}
