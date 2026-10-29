/**
 * The Tiptap pieces of the chip input: the inline `dataChip` atom (one data
 * token, drawn by `DataChipView`) and the keys that make the editor behave
 * like a field (Enter, Backspace on a chip).
 */
import { Extension, mergeAttributes, Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { CHIP_NODE } from './chip-model';
import { DataChipView } from './data-chip';

function readFilters(element: HTMLElement): unknown[] {
  try {
    const parsed: unknown = JSON.parse(element.getAttribute('data-filters') ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** One data token, as an atom: the caret steps over it and Backspace removes it whole. */
export const DataChip = Node.create({
  name: CHIP_NODE,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      raw: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-raw') ?? '',
        renderHTML: (attributes) => ({ 'data-raw': attributes.raw }),
      },
      path: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-path') ?? '',
        renderHTML: (attributes) => ({ 'data-path': attributes.path }),
      },
      filters: {
        default: [],
        parseHTML: readFilters,
        renderHTML: (attributes) => ({ 'data-filters': JSON.stringify(attributes.filters ?? []) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-data-chip]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes({ 'data-data-chip': '' }, HTMLAttributes), node.attrs.raw];
  },

  // Copying text out of a field keeps the token, so pasting it into another
  // field brings the chip back.
  renderText({ node }) {
    return String(node.attrs.raw ?? '');
  },

  addNodeView() {
    return ReactNodeViewRenderer(DataChipView, { as: 'span', className: 'pg-chip-view' });
  },
});

export interface ChipKeysOptions {
  multiline: boolean;
}

/**
 * Field keys: Enter never splits the field into blocks (one line refuses it,
 * several lines get a line break), and Backspace or Delete next to a chip
 * removes the whole chip.
 */
export const ChipKeys = Extension.create<ChipKeysOptions>({
  name: 'chipKeys',
  priority: 1000,

  addOptions() {
    return { multiline: false };
  },

  addKeyboardShortcuts() {
    const lineBreak = () => (this.options.multiline ? this.editor.commands.setHardBreak() : true);
    const removeChip = (direction: 'before' | 'after') => () => {
      const { state, view } = this.editor;
      const { selection } = state;
      if (!selection.empty) return false;
      const $pos = selection.$from;
      const node = direction === 'before' ? $pos.nodeBefore : $pos.nodeAfter;
      if (node?.type.name !== CHIP_NODE) return false;
      const from = direction === 'before' ? $pos.pos - node.nodeSize : $pos.pos;
      view.dispatch(state.tr.delete(from, from + node.nodeSize));
      return true;
    };
    return {
      Enter: lineBreak,
      'Shift-Enter': lineBreak,
      'Mod-Enter': lineBreak,
      Backspace: removeChip('before'),
      Delete: removeChip('after'),
    };
  },
});
