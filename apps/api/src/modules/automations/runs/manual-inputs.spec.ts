/**
 * Manual trigger inputs (WF-7.4): laid over the chosen trigger data, typed
 * by the trigger's own fields, required fields checked on the result.
 */
import { applyManualInputs } from './manual-inputs';

const CONFIG = {
  fields: [
    { key: 'topic', label: 'Topic', type: 'text', required: true },
    { key: 'count', label: 'Count', type: 'number' },
    { key: 'tone', label: 'Tone', type: 'choice', options: ['Warm', 'Plain'], required: true },
  ],
};

const BASE = { inputs: { topic: 'Sample topic', count: 3, tone: 'Warm', removed: 'old field' } };

describe('applyManualInputs', () => {
  it('keeps the base for fields not given and drops fields the trigger no longer has', () => {
    expect(applyManualInputs(CONFIG, BASE, { topic: 'Spring' })).toEqual({
      ok: true,
      payload: { inputs: { topic: 'Spring', count: 3, tone: 'Warm' } },
    });
  });

  it('reads numbers typed as text, and clears a field sent blank', () => {
    expect(applyManualInputs(CONFIG, BASE, { count: ' 12.5 ' })).toMatchObject({
      payload: { inputs: { count: 12.5 } },
    });
    expect(applyManualInputs(CONFIG, BASE, { count: '' })).toEqual({
      ok: true,
      payload: { inputs: { topic: 'Sample topic', tone: 'Warm' } },
    });
    expect(applyManualInputs(CONFIG, BASE, { topic: 42 })).toMatchObject({
      payload: { inputs: { topic: '42' } },
    });
  });

  it('refuses a wrong type, an unknown choice, an unknown field and a missing required one', () => {
    expect(applyManualInputs(CONFIG, BASE, { count: '1e3' })).toEqual({
      ok: false,
      message: 'Count must be a number.',
    });
    expect(applyManualInputs(CONFIG, BASE, { tone: 'warm' })).toEqual({
      ok: false,
      message: 'Choose one of the options for Tone.',
    });
    expect(applyManualInputs(CONFIG, BASE, { removed: 'x' })).toMatchObject({ ok: false });
    expect(applyManualInputs(CONFIG, {}, { topic: 'Only this' })).toEqual({
      ok: false,
      message: 'Fill in Tone.',
    });
  });

  it('starts from nothing when the base is not an object', () => {
    expect(applyManualInputs(CONFIG, null, { topic: 'A', tone: 'Plain' })).toEqual({
      ok: true,
      payload: { inputs: { topic: 'A', tone: 'Plain' } },
    });
  });
});
