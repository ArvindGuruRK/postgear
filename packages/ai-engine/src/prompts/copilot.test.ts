import { buildCopilotSystemPrompt, decodeToolResult, encodeToolResult } from './copilot';

describe('buildCopilotSystemPrompt', () => {
  const context = {
    workspaceName: 'Acme Marketing',
    today: '2026-10-14',
    channelSummary: 'Acme Marketing (LinkedIn, connected)',
  };

  it('carries the workspace, the date, the channels and the tools', () => {
    const prompt = buildCopilotSystemPrompt(context, [
      { name: 'list_channels', description: 'List channels', readOnly: true },
      { name: 'draft_post', description: 'Draft a post', readOnly: false },
    ]);
    expect(prompt).toContain('Workspace: Acme Marketing');
    expect(prompt).toContain('Today: 2026-10-14');
    expect(prompt).toContain('Acme Marketing (LinkedIn, connected)');
    expect(prompt).toContain('- list_channels (read-only): List channels');
    expect(prompt).toContain('- draft_post: Draft a post');
  });

  it('says so when no tools are available', () => {
    const prompt = buildCopilotSystemPrompt({ ...context, channelSummary: '' }, []);
    expect(prompt).toContain('No tools are available');
    expect(prompt).toContain('(none connected)');
  });
});

describe('tool result envelope', () => {
  it('round-trips success and failure', () => {
    expect(decodeToolResult(encodeToolResult({ ok: true, output: { a: 1 } }))).toEqual({
      ok: true,
      output: { a: 1 },
    });
    expect(
      decodeToolResult(encodeToolResult({ ok: false, error: 'nope', issues: ['x: required'] })),
    ).toEqual({ ok: false, error: 'nope', issues: ['x: required'] });
  });

  it('returns null for anything that is not an envelope', () => {
    expect(decodeToolResult('not json')).toBeNull();
    expect(decodeToolResult('{"output":1}')).toBeNull();
  });
});
