/**
 * Reserved for Sprint 13 (speech to text). Exported so a Sprint 13 document
 * type-checks here; nothing in Sprint 12 writes or reads one.
 */
export interface TranscriptWord {
  start: number;
  end: number;
  word: string;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  words: TranscriptWord[];
}

export interface Transcript {
  language: string;
  segments: TranscriptSegment[];
}
