/**
 * `npm run clips:doctor`: checks FFmpeg, ffprobe, yt-dlp and its runtime,
 * prints one plain line per check, and exits with 1 when video work cannot
 * run (FFmpeg or ffprobe missing, or a render check failing). A missing
 * yt-dlp is only a warning: uploads and exports still work without it.
 */
import { formatDoctorReport, runDoctor } from '../src/doctor';
import { createRunTool } from '../src/run/runner';
import { toolPaths } from '../src/run/paths';

async function main(): Promise<number> {
  const paths = toolPaths(process.env);
  const report = await runDoctor(createRunTool(paths), paths);
  for (const line of formatDoctorReport(report)) {
    process.stdout.write(`${line}\n`);
  }
  return report.ok ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(
      `The doctor could not run: ${error instanceof Error ? error.message : 'unknown error'}\n`,
    );
    process.exitCode = 1;
  },
);
