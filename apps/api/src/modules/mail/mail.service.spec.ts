/**
 * The workspace invitation email (Settings > Team, 2026-10-19). The other
 * messages are covered by the auth flows that send them.
 */
import type { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

function consoleTransport(): { service: MailService; sent: jest.Mock } {
  const config = {
    get: (key: string, fallback?: unknown) => (key === 'WEB_URL' ? 'http://web.test' : fallback),
  } as unknown as ConfigService;
  const service = new MailService(config);
  // `send` is private; spying on it captures the composed message without
  // printing it to the test output.
  const sent = jest.fn().mockResolvedValue(true);
  (service as unknown as { send: jest.Mock }).send = sent;
  return { service, sent };
}

const invitation = {
  workspaceName: 'Acme Social',
  inviterName: 'Grace Hopper',
  role: 'USER' as const,
  link: 'http://web.test/invite/abc.def',
  expiresAt: new Date('2026-10-26T12:00:00Z'),
};

describe('MailService.sendWorkspaceInvitation', () => {
  it('names the inviter, the workspace and the role, and carries the link and expiry', async () => {
    const { service, sent } = consoleTransport();

    await expect(service.sendWorkspaceInvitation('ada@example.com', invitation)).resolves.toBe(
      true,
    );

    const [message] = sent.mock.calls[0] as [{ to: string; subject: string; text: string }];
    expect(message.to).toBe('ada@example.com');
    expect(message.subject).toBe('Grace Hopper invited you to Acme Social on PostGear');
    expect(message.text).toContain(
      'Grace Hopper invited you to join Acme Social on PostGear as a member.',
    );
    expect(message.text).toContain('http://web.test/invite/abc.def');
    expect(message.text).toContain('expires on 26 October 2026 (UTC)');
    expect(message.text).toContain('works once');
  });

  it('says "an admin" for the admin role', async () => {
    const { service, sent } = consoleTransport();

    await service.sendWorkspaceInvitation('ada@example.com', { ...invitation, role: 'ADMIN' });

    expect((sent.mock.calls[0][0] as { text: string }).text).toContain('as an admin.');
  });

  it('keeps the subject on one line whatever the names contain', async () => {
    const { service, sent } = consoleTransport();

    await service.sendWorkspaceInvitation('ada@example.com', {
      ...invitation,
      workspaceName: 'Acme\r\nBcc: victim@example.com',
      inviterName: '  Grace\n Hopper ',
    });

    const { subject } = sent.mock.calls[0][0] as { subject: string };
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject).toBe('Grace Hopper invited you to Acme Bcc: victim@example.com on PostGear');
  });

  it('says nothing about whether the address has an account', async () => {
    const { service, sent } = consoleTransport();

    await service.sendWorkspaceInvitation('ada@example.com', invitation);

    const { text } = sent.mock.calls[0][0] as { text: string };
    expect(text).toContain('sign in or create an account');
    expect(text).not.toMatch(/already have an account|your account/i);
  });
});
