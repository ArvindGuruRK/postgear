import * as path from 'node:path';
import { jsRuntimeArg, ToolPathError, toolPaths } from './paths';

describe('toolPaths', () => {
  it('uses the names on PATH when nothing is set', () => {
    expect(toolPaths({})).toEqual({
      ffmpeg: 'ffmpeg',
      ffprobe: 'ffprobe',
      ytDlp: 'yt-dlp',
      jsRuntime: 'deno',
    });
  });

  it('reads each variable, trimmed, and treats blank as unset', () => {
    const abs = path.resolve('/opt/tools/ffmpeg');
    expect(
      toolPaths({
        FFMPEG_PATH: ` ${abs} `,
        FFPROBE_PATH: '',
        YTDLP_PATH: 'yt-dlp_linux',
        YTDLP_JS_RUNTIME: 'node:/usr/bin/node',
      }),
    ).toEqual({
      ffmpeg: abs,
      ffprobe: 'ffprobe',
      ytDlp: 'yt-dlp_linux',
      jsRuntime: 'node:/usr/bin/node',
    });
  });

  it('turns the runtime off with none', () => {
    expect(toolPaths({ YTDLP_JS_RUNTIME: 'none' }).jsRuntime).toBeNull();
    expect(toolPaths({ YTDLP_JS_RUNTIME: 'OFF' }).jsRuntime).toBeNull();
  });

  it('refuses a relative path with folders, naming the variable and not the value', () => {
    expect(() => toolPaths({ FFMPEG_PATH: './bin/ffmpeg' })).toThrow(ToolPathError);
    expect(() => toolPaths({ FFMPEG_PATH: './bin/ffmpeg' })).toThrow('FFMPEG_PATH');
    expect(() => toolPaths({ YTDLP_PATH: 'tools\\yt-dlp.exe' })).toThrow(/YTDLP_PATH/);
    expect(() => toolPaths({ YTDLP_JS_RUNTIME: 'deno:bin/deno' })).toThrow(/YTDLP_JS_RUNTIME/);
  });

  it('refuses control characters', () => {
    expect(() => toolPaths({ FFPROBE_PATH: 'ffprobe\nrm' })).toThrow(ToolPathError);
  });
});

describe('jsRuntimeArg', () => {
  it('builds the --js-runtimes value', () => {
    expect(jsRuntimeArg('deno')).toBe('deno:deno');
    expect(jsRuntimeArg('/usr/local/bin/deno')).toBe('deno:/usr/local/bin/deno');
    expect(jsRuntimeArg('node:/usr/bin/node')).toBe('node:/usr/bin/node');
  });
});
