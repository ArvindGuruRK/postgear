/**
 * The preset allowlist. The ids are duplicated in the web registry and the
 * generator script (see the header of `avatar.presets.ts`), so this pins the
 * shape every copy must share: each id becomes `/avatars/<id>.svg`.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AVATAR_PRESET_ID_PATTERN, AVATAR_PRESET_IDS, isAvatarPresetId } from './avatar.presets';

describe('avatar presets', () => {
  it('are well-formed slugs, short enough to be a filename', () => {
    for (const id of AVATAR_PRESET_IDS) {
      expect(id).toMatch(AVATAR_PRESET_ID_PATTERN);
      expect(id.length).toBeLessThanOrEqual(32);
    }
  });

  it('are unique', () => {
    expect(new Set(AVATAR_PRESET_IDS).size).toBe(AVATAR_PRESET_IDS.length);
  });

  it('each have a generated SVG in the web app', () => {
    const directory = join(__dirname, '../../../../web/public/avatars');

    for (const id of AVATAR_PRESET_IDS) {
      expect(existsSync(join(directory, `${id}.svg`))).toBe(true);
    }
  });

  it('accept only listed ids', () => {
    expect(isAvatarPresetId('notionists-01')).toBe(true);
    for (const value of ['notionists-99', '../logo', 'NOTIONISTS-01', '', 'notionists-01.svg']) {
      expect(isAvatarPresetId(value)).toBe(false);
    }
  });
});
