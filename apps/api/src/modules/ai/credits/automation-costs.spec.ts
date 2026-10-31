/**
 * The workflow catalog prices its AI steps from `AI_STEP_CREDITS` (it lives
 * in `@postgear/automation`, which cannot import the API). The ledger
 * charges `AI_CREDIT_COSTS`. This pins the two together, so the estimate a
 * person sees before turning a workflow on is what the run is charged.
 */
import { AI_STEP_CREDITS, getDefinition } from '@postgear/automation';
import { AI_CREDIT_COSTS, generateCost } from './credits.policy';

describe('workflow AI step prices', () => {
  it('equal the ledger costs', () => {
    expect(AI_STEP_CREDITS).toEqual({
      text: AI_CREDIT_COSTS.generate_post,
      image: AI_CREDIT_COSTS.generate_image,
      snippet: AI_CREDIT_COSTS.generate_snippet,
    });
    expect(AI_CREDIT_COSTS.generate_post).toBe(5);
    expect(AI_CREDIT_COSTS.generate_image).toBe(10);
    expect(AI_CREDIT_COSTS.generate_snippet).toBe(2);
  });

  it('give each AI step the charge its gateway route makes', () => {
    const credits = (type: string, config: Record<string, unknown> = {}) => {
      const definition = getDefinition(type);
      return definition?.credits?.({ ...definition.defaultConfig, ...config } as never);
    };

    expect(credits('ai.generateText', { withImage: false })).toBe(generateCost(false));
    expect(credits('ai.generateText', { withImage: true })).toBe(generateCost(true));
    expect(generateCost(true)).toBe(15);
    expect(credits('ai.generateImage')).toBe(AI_CREDIT_COSTS.generate_image);
    expect(credits('ai.generateHashtags')).toBe(AI_CREDIT_COSTS.generate_snippet);
    expect(credits('ai.rewriteInBrandVoice')).toBe(AI_CREDIT_COSTS.generate_snippet);
  });
});
