/**
 * Private key builders and the allowlist that stops a key leaving its prefix.
 */
import {
  assertValidClipKey,
  clipKeys,
  clipKindSegment,
  contentTypeForClipKey,
  isValidClipKey,
  isValidClipPrefix,
} from './clip-keys';

const org = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const video = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const job = 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e';
const hex = '0123456789abcdef0123456789abcdef';

describe('clipKeys', () => {
  it('builds video files under the workspace and video, with a random name', () => {
    const key = clipKeys.videoFile(org, video, 'PROXY', 'mp4');

    expect(key).toMatch(new RegExp(`^clips/${org}/${video}/proxy-[0-9a-f]{32}\\.mp4$`));
    expect(clipKeys.videoFile(org, video, 'PROXY', 'mp4')).not.toBe(key);
    expect(isValidClipKey(key)).toBe(true);
    expect(key.startsWith(clipKeys.videoPrefix(org, video))).toBe(true);
  });

  it('turns asset kinds into key segments, including signal tracks', () => {
    expect(clipKindSegment('ANALYSIS_AUDIO')).toBe('analysis-audio');
    const track = clipKeys.videoFile(org, video, 'track-loudness', 'json.gz');
    expect(track).toMatch(/\/track-loudness-[0-9a-f]{32}\.json\.gz$/);
    expect(contentTypeForClipKey(track)).toBe('application/gzip');
  });

  it('builds job files and prefixes for exports, proofs and downloads', () => {
    expect(clipKeys.exportFile(org, job, 'render', 'mp4')).toBe(
      `clips/${org}/exports/${job}/render.mp4`,
    );
    expect(clipKeys.proofFile(org, job, 'preview', 'mp4')).toBe(
      `clips/${org}/proofs/${job}/preview.mp4`,
    );
    expect(clipKeys.downloadFile(org, job, 'file', 'mp3')).toBe(
      `clips/${org}/downloads/${job}/file.mp3`,
    );
    expect(clipKeys.exportPrefix(org, job)).toBe(`clips/${org}/exports/${job}/`);
    expect(clipKeys.proofPrefix(org, job)).toBe(`clips/${org}/proofs/${job}/`);
    expect(clipKeys.downloadPrefix(org, job)).toBe(`clips/${org}/downloads/${job}/`);
  });

  it('builds workspace library uploads', () => {
    const key = clipKeys.libraryUpload(org, 'png');
    expect(key).toMatch(new RegExp(`^clips/${org}/library/[0-9a-f]{32}\\.png$`));
    expect(key.startsWith(clipKeys.libraryPrefix(org))).toBe(true);
    expect(contentTypeForClipKey(key)).toBe('image/png');
  });

  it("builds the shared library's licence reports outside every workspace", () => {
    expect(clipKeys.libraryReport(job, 'md')).toBe(`ops/library-runs/${job}.md`);
    expect(clipKeys.libraryReport(job, 'json')).toBe(`ops/library-runs/${job}.json`);
    expect(contentTypeForClipKey(`ops/library-runs/${job}.md`)).toBe('text/markdown; charset=utf-8');
    expect(() => clipKeys.libraryReport('../x', 'md')).toThrow(/UUID/);
    expect(() => clipKeys.libraryReport(job, 'html' as 'md')).toThrow(/JSON or Markdown/);
    for (const key of [
      `ops/library-runs/${job}.html`,
      `ops/library-runs/${job}/x.md`,
      `ops/${job}.md`,
      `ops/library-runs/../${job}.md`,
      `clips/${org}/library/${hex}.md`,
    ]) {
      expect(isValidClipKey(key)).toBe(false);
    }
    // No delete may take the reports' folder.
    expect(isValidClipPrefix('ops/library-runs/')).toBe(false);
  });

  it('refuses ids, kinds, names and extensions that could escape', () => {
    expect(() => clipKeys.videoFile('../..', video, 'proxy', 'mp4')).toThrow(/workspace id/);
    expect(() => clipKeys.videoFile(org, `${video}/..`, 'proxy', 'mp4')).toThrow(/UUID/);
    expect(() => clipKeys.videoFile(org.toUpperCase(), video, 'proxy', 'mp4')).toThrow(
      /workspace id/,
    );
    expect(() => clipKeys.videoFile(org, video, '../proxy', 'mp4')).toThrow(/kind/);
    expect(() => clipKeys.videoFile(org, video, 'pro/xy', 'mp4')).toThrow(/kind/);
    expect(() => clipKeys.exportFile(org, job, '../render', 'mp4')).toThrow(/file name/);
    expect(() => clipKeys.exportFile(org, job, 'render.mp4', 'mp4')).toThrow(/file name/);
    expect(() => clipKeys.orgPrefix('')).toThrow(/workspace id/);
    expect(() => clipKeys.videoFile(org, video, 'proxy', 'html' as unknown as 'mp4')).toThrow(
      /extension/,
    );
  });
});

describe('isValidClipKey', () => {
  it('refuses traversal, absolute paths, separators and foreign shapes', () => {
    for (const key of [
      '',
      `../clips/${org}/${video}/proxy-${hex}.mp4`,
      `/clips/${org}/${video}/proxy-${hex}.mp4`,
      `clips/${org}/${video}/../proxy-${hex}.mp4`,
      `clips/${org}/../${org}/${video}/proxy-${hex}.mp4`,
      `clips\\${org}\\${video}\\proxy-${hex}.mp4`,
      `clips/${org}/${video}/proxy-${hex}.html`,
      `clips/${org}/${video}/proxy-${hex}.svg`,
      `clips/${org}/${video}/proxy-${hex.slice(1)}.mp4`,
      `clips/${org}/${video}/PROXY-${hex}.mp4`,
      `clips/${org}/${video}/sub/proxy-${hex}.mp4`,
      `clips/${org}/elsewhere/${job}/render.mp4`,
      `clips/${org}/exports/${job}/../render.mp4`,
      `clips/${org}/library/${hex}.js`,
      `2026/10/${hex}.jpg`,
      `clips/${org}/${video}/proxy-${hex}.mp4\n`,
      `clips/${org}/${video}/proxy-${hex}.mp4%00.html`,
    ]) {
      expect(isValidClipKey(key)).toBe(false);
    }
    expect(() => assertValidClipKey('../x')).toThrow(/did not generate/);
  });
});

describe('isValidClipPrefix', () => {
  it('accepts a whole workspace, video, job, job folder or library', () => {
    for (const prefix of [
      `clips/${org}/`,
      `clips/${org}/${video}/`,
      `clips/${org}/exports/${job}/`,
      `clips/${org}/proofs/`,
      `clips/${org}/library/`,
    ]) {
      expect(isValidClipPrefix(prefix)).toBe(true);
    }
  });

  it('refuses the root, half segments and escapes', () => {
    for (const prefix of [
      '',
      'clips/',
      `clips/${org}`,
      `clips/${org}/${video}`,
      `clips/${org}/${video.slice(0, 8)}`,
      `clips/${org}/../`,
      `clips/${org}/${video}/proxy-`,
      `/clips/${org}/`,
    ]) {
      expect(isValidClipPrefix(prefix)).toBe(false);
    }
  });
});

describe('workspace ids', () => {
  it('accepts the seeded slug ids as well as UUIDs', () => {
    const key = clipKeys.videoFile('seed-demo-org', video, 'PROXY', 'mp4');
    expect(isValidClipKey(key)).toBe(true);
    expect(isValidClipPrefix(clipKeys.orgPrefix('seed-demo-org'))).toBe(true);
    expect(isValidClipKey(clipKeys.exportFile('seed-second-org', job, 'render', 'mp4'))).toBe(true);
  });

  it('refuses workspace ids that could leave the prefix or are not ours', () => {
    for (const bad of [
      '',
      '..',
      'a/b',
      'a.b',
      'A-B',
      '-x',
      'x-',
      'x--y',
      'a b',
      'a\b',
      'x'.repeat(65),
    ]) {
      expect(() => clipKeys.orgPrefix(bad)).toThrow();
      expect(() => clipKeys.videoFile(bad, video, 'PROXY', 'mp4')).toThrow();
    }
  });
});
