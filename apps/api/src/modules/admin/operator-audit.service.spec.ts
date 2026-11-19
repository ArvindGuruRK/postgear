/**
 * The owner mail per operator save (Module 19 section 7): printed to the API
 * console outside production (a laptop's `.env` may hold a real mail key),
 * sent in production, and a failed send never fails the save.
 */
import type { ConfigService } from '@nestjs/config';
import type { MailService } from '../mail/mail.service';
import { OperatorAuditService } from './operator-audit.service';

const actor = { id: 'op-1', email: 'demo@postgear.local' };
const record = {
  action: 'plans.saved',
  summary: '1 plan value',
  lines: ['Clips Storage, Free: 3 GB to 4 GB'],
  reason: 'More room for the demo.',
};

function build(env: Record<string, string | undefined>) {
  const mail = { sendPlain: jest.fn(async () => true) };
  const service = new OperatorAuditService(
    mail as unknown as MailService,
    { get: (key: string) => env[key] } as unknown as ConfigService,
  );
  return { service, mail };
}

describe('OperatorAuditService', () => {
  it('never sends the owner mail outside production', async () => {
    const { service, mail } = build({ NODE_ENV: 'development', OWNER_EMAIL: 'owner@rkay.in' });
    await service.record(actor, record);
    expect(mail.sendPlain).not.toHaveBeenCalled();
  });

  it('sends one mail to OWNER_EMAIL in production, with the reason and who', async () => {
    const { service, mail } = build({ NODE_ENV: 'production', OWNER_EMAIL: 'owner@rkay.in' });
    await service.record(actor, record);
    expect(mail.sendPlain).toHaveBeenCalledTimes(1);
    expect(mail.sendPlain).toHaveBeenCalledWith(
      'owner@rkay.in',
      'Operator change: 1 plan value',
      expect.arrayContaining([
        'Clips Storage, Free: 3 GB to 4 GB',
        'Reason: More room for the demo.',
        'By: demo@postgear.local',
      ]),
    );
  });

  it('a failed send is logged, never thrown (the save is already committed)', async () => {
    const { service, mail } = build({ NODE_ENV: 'production', OWNER_EMAIL: 'owner@rkay.in' });
    mail.sendPlain.mockRejectedValueOnce(new Error('mail away'));
    await expect(service.record(actor, record)).resolves.toBeUndefined();
  });

  it('sends nothing when no owner address is set', async () => {
    const { service, mail } = build({ NODE_ENV: 'production' });
    await service.record(actor, record);
    expect(mail.sendPlain).not.toHaveBeenCalled();
  });
});
