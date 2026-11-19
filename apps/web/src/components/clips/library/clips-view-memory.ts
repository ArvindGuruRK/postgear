/**
 * Grid or list for clip lists, remembered per browser: the Clips tab
 * (Module 07) and the composer's Select A Clip (Module 17) share it. Kept on
 * its own so the composer's picker imports nothing else of the Clips tab.
 */
export const VIEW_STORAGE_KEY = 'postgear.clips.view';

export type ClipsView = 'grid' | 'list';

export function readClipsView(): ClipsView {
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

export function writeClipsView(view: ClipsView) {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // A blocked storage only means the choice is not remembered.
  }
}
