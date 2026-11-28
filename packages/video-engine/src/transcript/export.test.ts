import { captionWords } from '../captions/map';
import { createClipDocument } from '../document';
import {
  SRT_LINE_CHARS,
  srtLines,
  srtTime,
  transcriptCues,
  transcriptFile,
  writeSrt,
  writeTranscriptText,
} from './export';

const w = (start: number, end: number, text: string) => ({ start, end, text });

describe('Export The Transcript (Module 17 item 10)', () => {
  it('writes the SRT clock with hours, commas and three-digit milliseconds', () => {
    expect(srtTime(0)).toBe('00:00:00,000');
    expect(srtTime(1_234)).toBe('00:00:01,234');
    expect(srtTime(3_723_045)).toBe('01:02:03,045');
    expect(srtTime(-5)).toBe('00:00:00,000');
  });

  it('ends a cue at a sentence end and at a pause', () => {
    const cues = transcriptCues([
      w(0, 300, 'Hello'),
      w(300, 600, 'there.'),
      w(700, 900, 'This'),
      w(900, 1_100, 'is'),
      w(2_500, 2_800, 'later'),
    ]);
    expect(cues.map((cue) => cue.text)).toEqual(['Hello there.', 'This is', 'later']);
    expect(cues[0]).toMatchObject({ start: 0, end: 600 });
    expect(cues[2]).toMatchObject({ start: 2_500, end: 2_800 });
  });

  it('keeps a cue under the character and time limits, and its times never go backwards', () => {
    const many = Array.from({ length: 40 }, (_, index) =>
      w(index * 200, index * 200 + 250, 'word'),
    );
    const cues = transcriptCues(many);
    for (const cue of cues) {
      expect(cue.text.length).toBeLessThanOrEqual(SRT_LINE_CHARS * 2);
      expect(cue.end - cue.start).toBeLessThanOrEqual(7_000);
    }
    for (let index = 1; index < cues.length; index += 1) {
      expect((cues[index] as { start: number }).start).toBeGreaterThanOrEqual(
        (cues[index - 1] as { end: number }).end,
      );
    }
    expect(cues.flatMap((cue) => cue.text.split(' '))).toHaveLength(40);
  });

  it('splits a long cue into two lines at the space nearest the middle', () => {
    const text = 'one two three four five six seven eight nine ten eleven twelve';
    const lines = srtLines(text).split('\n');
    expect(lines).toHaveLength(2);
    expect(lines.join(' ')).toBe(text);
    expect(Math.abs((lines[0] as string).length - (lines[1] as string).length)).toBeLessThan(8);
    expect(srtLines('short line')).toBe('short line');
  });

  it('writes numbered SRT cues with a blank line between them', () => {
    expect(writeSrt(transcriptCues([w(0, 500, 'Hi.'), w(600, 1_000, 'Bye.')]))).toBe(
      '1\n00:00:00,000 --> 00:00:00,500\nHi.\n\n2\n00:00:00,600 --> 00:00:01,000\nBye.\n',
    );
  });

  it('never lets a word break the file: no control characters, no arrow, no blank lines', () => {
    const { body } = transcriptFile([w(0, 400, 'a\n\nb'), w(400, 800, 'x-->y.')], 'srt');
    expect(body).toBe('1\n00:00:00,000 --> 00:00:00,800\na b x->y.\n');
  });

  it('writes the text file one sentence a line, and nothing for no words', () => {
    expect(
      writeTranscriptText([w(0, 300, 'First'), w(300, 600, 'one.'), w(700, 900, 'Second.')]),
    ).toBe('First one.\nSecond.\n');
    expect(transcriptFile([], 'txt')).toEqual({ body: '', words: 0, cues: 0 });
    expect(transcriptFile([w(0, 1, '  ')], 'srt')).toEqual({ body: '', words: 0, cues: 0 });
  });

  it('keeps Tamil and Hindi words whole and sentence ends in their own script', () => {
    const { body } = transcriptFile(
      [w(0, 400, 'வணக்கம்'), w(400, 800, 'நண்பர்களே.'), w(900, 1_300, 'नमस्ते।')],
      'txt',
    );
    expect(body).toBe('வணக்கம் நண்பர்களே.\nनमस्ते।\n');
  });

  it("writes a clip's words on the clip's clock: words outside it are left out, a fast part is shorter", () => {
    const doc = createClipDocument({
      videoId: '7b0c1c5e-5f8e-4a51-9a43-1f7c8a1d2e02',
      fromMs: 10_000,
      toMs: 16_000,
      ratio: '9:16',
    });
    const segment = doc.segments[0] as (typeof doc.segments)[number];
    const fast = { ...doc, segments: [{ ...segment, speed: 2 as typeof segment.speed }] };
    const transcript = {
      words: [
        { i: 0, start: 10_000, end: 10_500, text: 'Kept', sure: 1 },
        { i: 1, start: 10_500, end: 11_000, text: 'words.', sure: 1 },
        { i: 2, start: 20_000, end: 20_500, text: 'Outside', sure: 1 },
      ],
    };
    const shown = { edits: { '1': { text: 'changed.' } } };
    expect(transcriptFile(captionWords(doc, shown, transcript), 'srt').body).toBe(
      '1\n00:00:00,000 --> 00:00:01,000\nKept changed.\n',
    );
    expect(transcriptFile(captionWords(fast, { edits: {} }, transcript), 'srt').body).toBe(
      '1\n00:00:00,000 --> 00:00:00,500\nKept words.\n',
    );
  });
});
