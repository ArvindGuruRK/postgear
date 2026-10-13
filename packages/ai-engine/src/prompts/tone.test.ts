import { pronounsFor, toneRules } from './tone';

describe('toneRules', () => {
  it('personal is first person singular', () => {
    const rules = toneRules('personal');
    expect(rules).toContain('first person singular');
    expect(rules).toContain('"I"');
    expect(rules).toContain('Never write as a company');
    expect(rules).not.toContain('first person plural');
  });

  it('company is first person plural with the workspace as the brand', () => {
    const rules = toneRules('company', 'Acme Marketing');
    expect(rules).toContain('first person plural');
    expect(rules).toContain('"we"');
    expect(rules).toContain('as Acme Marketing');
    expect(rules).toContain('Never write as an individual');
    expect(rules).not.toContain('first person singular');
  });

  it('company without a workspace name still has a brand to speak as', () => {
    expect(toneRules('company')).toContain('as the company');
  });
});

describe('pronounsFor', () => {
  it('gives I/me/my and we/us/our', () => {
    expect(pronounsFor('personal')).toMatchObject({ subject: 'I', object: 'me', possessive: 'my' });
    expect(pronounsFor('company', 'Acme')).toMatchObject({
      subject: 'we',
      object: 'us',
      possessive: 'our',
      speakerName: 'Acme',
    });
    expect(pronounsFor('company').speakerName).toBe('our team');
  });
});
