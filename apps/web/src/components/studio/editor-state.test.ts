import {
  addSlide,
  applyTheme,
  type DesignDocument,
  documentFromPreset,
  moveSlide,
  removeSlide,
  type SlotId,
  updateElement,
} from '@postgear/design-engine';
import {
  canRedoEdit,
  canUndoEdit,
  changedSlide,
  createEditorState,
  documentOf,
  type EditorState,
  editorReducer,
  issuesBySlide,
  nudge,
  restoreSlide,
  sameDocument,
  slideIndexOf,
  slotAfterHiding,
  withOffset,
  withText,
} from './editor-state';

/**
 * Tips Steps (Ink), portrait: s1 cover (headline, optional eyebrow and
 * subheadline, brand name, handle, page number), s2 numbered list, s3 content,
 * s4 statistic, s5 closing call to action.
 */
function design(): DesignDocument {
  let next = 0;
  return documentFromPreset({
    presetId: 'tips-steps-ink',
    format: 'portrait',
    newId: () => `s${++next}`,
  });
}

function typed(state: EditorState, slideId: string, text: string): EditorState {
  return editorReducer(state, {
    type: 'change',
    change: (document) => withText(document, slideId, 'headline', text),
    coalesceKey: `text:${slideId}:headline`,
  });
}

describe('createEditorState', () => {
  it('opens on the slide the design was last edited on, within range', () => {
    expect(createEditorState(design(), 2).slideId).toBe('s3');
    expect(createEditorState(design(), 40).slideId).toBe('s5');
    expect(createEditorState(design(), -1).slideId).toBe('s1');
  });
});

describe('editorReducer', () => {
  it('records an edit as an undo step, and drops one that changes nothing', () => {
    const start = createEditorState(design());
    const headline = documentOf(start).slides[0]?.elements.headline?.text ?? '';

    const same = typed(start, 's1', headline);
    expect(same).toBe(start);
    expect(canUndoEdit(same)).toBe(false);

    const edited = typed(start, 's1', 'Five habits');
    expect(documentOf(edited).slides[0]?.elements.headline?.text).toBe('Five habits');
    expect(canUndoEdit(edited)).toBe(true);
  });

  it('makes a burst of typing one undo step', () => {
    const start = createEditorState(design());
    const original = documentOf(start).slides[0]?.elements.headline?.text;
    let state = start;
    for (const text of ['F', 'Fi', 'Fiv', 'Five']) state = typed(state, 's1', text);

    const undone = editorReducer(state, { type: 'undo' });
    expect(documentOf(undone)).toBe(documentOf(start));
    expect(documentOf(undone).slides[0]?.elements.headline?.text).toBe(original);
    expect(canUndoEdit(undone)).toBe(false);
    expect(canRedoEdit(undone)).toBe(true);
  });

  it('brings the slide an undo changes into view', () => {
    let state = createEditorState(design());
    state = typed(state, 's3', 'Write it down');
    state = editorReducer(state, { type: 'showSlide', slideId: 's1' });

    const undone = editorReducer(state, { type: 'undo' });
    expect(undone.slideId).toBe('s3');

    const redone = editorReducer(editorReducer(undone, { type: 'showSlide', slideId: 's5' }), {
      type: 'redo',
    });
    expect(redone.slideId).toBe('s3');
  });

  it('shows the neighbour of a deleted slide, and the slide again when the delete is undone', () => {
    let state = createEditorState(design(), 1);
    state = editorReducer(state, {
      type: 'change',
      change: (document) => removeSlide(document, 's2'),
    });

    expect(state.slideId).toBe('s3');
    expect(documentOf(state).slides).toHaveLength(4);

    state = editorReducer(state, { type: 'undo' });
    expect(state.slideId).toBe('s2');
    expect(documentOf(state).slides).toHaveLength(5);
  });

  it('shows a slide that was just added', () => {
    const state = editorReducer(createEditorState(design()), {
      type: 'change',
      change: (document) =>
        addSlide(document, { role: 'quote', after: 's1', newId: () => 'added' }),
      showSlide: 'added',
    });

    expect(state.slideId).toBe('added');
    expect(slideIndexOf(state)).toBe(1);
  });

  it('keeps the slide on the canvas when slides are reordered', () => {
    let state = createEditorState(design(), 2);
    state = editorReducer(state, {
      type: 'change',
      change: (document) => moveSlide(document, 2, 0),
    });

    expect(state.slideId).toBe('s3');
    expect(slideIndexOf(state)).toBe(0);
  });

  it('clears the selection when the slide changes', () => {
    let state = createEditorState(design());
    state = editorReducer(state, { type: 'select', slot: 'headline' });
    expect(state.selected).toBe('headline');

    state = editorReducer(state, { type: 'showSlide', slideId: 's2' });
    expect(state.selected).toBeNull();
  });

  it('types only into a text element that is selected and shown', () => {
    let state = createEditorState(design());

    state = editorReducer(state, { type: 'edit', slot: 'headline' });
    expect(state).toMatchObject({ selected: 'headline', editing: 'headline' });

    // A logo is selected, never typed into.
    state = editorReducer(state, { type: 'edit', slot: 'logo' });
    expect(state).toMatchObject({ selected: 'logo', editing: null });

    // A slide number is counted, not typed.
    state = editorReducer(state, { type: 'edit', slot: 'pageNumber' });
    expect(state.editing).toBeNull();

    // An element this layout does not have cannot be selected.
    state = editorReducer(state, { type: 'select', slot: 'stat' });
    expect(state.selected).toBeNull();
  });

  it('lets go of an element that is hidden', () => {
    let state = createEditorState(design());
    state = editorReducer(state, { type: 'select', slot: 'eyebrow' });
    state = editorReducer(state, {
      type: 'change',
      change: (document) => updateElement(document, 's1', 'eyebrow', { hidden: true }),
    });

    expect(state.selected).toBeNull();
  });

  it('starts over from a reloaded design without an undo into the old one', () => {
    let state = typed(createEditorState(design(), 3), 's1', 'Mine');
    const server = applyTheme(design(), 'midnight');

    state = editorReducer(state, { type: 'load', document: server });

    expect(documentOf(state)).toBe(server);
    // The slide in view is still there, so it stays in view.
    expect(state.slideId).toBe('s4');
    expect(canUndoEdit(state)).toBe(false);

    const shorter = removeSlide(server, 's4');
    expect(editorReducer(state, { type: 'load', document: shorter }).slideId).toBe('s1');
  });
});

describe('withText', () => {
  it("edits the design's brand name and handle from any slide", () => {
    const document = design();
    const first = withText(document, 's1', 'handle', '@postgear');
    expect(first.handle).toBe('@postgear');

    const named = withText(first, 's2', 'brandName', 'PostGear');
    expect(named.brand.name).toBe('PostGear');
  });

  it('never types a slide number', () => {
    const document = design();
    expect(withText(document, 's1', 'pageNumber', '9')).toBe(document);
  });
});

describe('restoreSlide', () => {
  it('puts a deleted slide back in its place, once', () => {
    const document = design();
    const deleted = document.slides[1];
    if (!deleted) throw new Error('The preset has a second slide.');

    const without = removeSlide(document, 's2');
    const restored = restoreSlide(without, deleted, 1);

    expect(restored.slides.map((slide) => slide.id)).toEqual(['s1', 's2', 's3', 's4', 's5']);
    expect(restoreSlide(restored, deleted, 1)).toBe(restored);
  });
});

describe('nudge', () => {
  it('moves an element inside its area and stops at the edge, saying which', () => {
    const document = design();

    // The cover headline spans its area's full width: it cannot move sideways.
    const sideways = nudge(document, 's1', 'headline', { x: 5, y: 0 });
    expect(sideways.edge.x).toBe('end');
    expect(sideways.document.slides[0]?.elements.headline?.offset).toBeUndefined();

    const down = nudge(document, 's1', 'headline', { x: 0, y: 5 });
    expect(down.edge).toEqual({ x: null, y: null });
    expect(down.document.slides[0]?.elements.headline?.offset).toEqual({ x: 0, y: 5 });

    // 14% above it in its area, and no further.
    const up = nudge(document, 's1', 'headline', { x: 0, y: -20 });
    expect(up.edge.y).toBe('start');
    expect(up.document.slides[0]?.elements.headline?.offset).toEqual({ x: 0, y: -14 });
  });

  it('stores a position back where it started as no position', () => {
    const moved = withOffset(design(), 's1', 'headline', { x: 0, y: 5 });
    const back = withOffset(moved, 's1', 'headline', { x: 0, y: 0 });

    expect(back.slides[0]?.elements.headline?.offset).toBeUndefined();
    expect(withOffset(back, 's1', 'headline', { x: 0, y: 0 })).toBe(back);
  });
});

describe('issuesBySlide', () => {
  it('names each slide with a problem, including text too long to fit', () => {
    let document = design();
    document = updateElement(document, 's3', 'headline', { colorRole: 'background' });

    const issues = issuesBySlide(document, () => true, { s2: ['headline'] });

    expect(issues.get('s2')).toEqual(['Slide 2: the headline is too long for its space.']);
    expect(issues.get('s3')).toEqual(['Slide 3: the headline is hard to read on its background.']);
    expect(issues.has('s1')).toBe(false);
  });
});

describe('changedSlide', () => {
  it('stays on the slide in view for a change to the whole design', () => {
    const before = design();
    expect(changedSlide(before, applyTheme(before, 'midnight'), 's4')).toBe('s4');
  });
});

describe('slotAfterHiding', () => {
  const slots: SlotId[] = ['eyebrow', 'headline', 'subheadline', 'brandName', 'handle'];
  const all = () => true;

  it('moves on to the next element still shown, or the one before it at the end', () => {
    expect(slotAfterHiding(slots, (slot) => slot !== 'subheadline', 'subheadline')).toBe(
      'brandName',
    );
    expect(
      slotAfterHiding(
        slots,
        (slot) => slot !== 'subheadline' && slot !== 'brandName',
        'subheadline',
      ),
    ).toBe('handle');
    expect(slotAfterHiding(slots, (slot) => slot !== 'handle', 'handle')).toBe('brandName');
    expect(
      slotAfterHiding(slots, (slot) => slot === 'eyebrow' || slot === 'headline', 'handle'),
    ).toBe('headline');
  });

  it('says when nothing else is shown, and copes with an element the layout lacks', () => {
    expect(slotAfterHiding(slots, () => false, 'eyebrow')).toBeNull();
    expect(slotAfterHiding(slots, all, 'image')).toBe('eyebrow');
    expect(slotAfterHiding([], all, 'eyebrow')).toBeNull();
  });
});

describe('sameDocument', () => {
  it('compares what a design says, not how it was built', () => {
    const document = design();
    const rebuilt = updateElement(document, 's1', 'headline', {
      text: document.slides[0]?.elements.headline?.text ?? '',
    });

    expect(rebuilt).not.toBe(document);
    expect(sameDocument(document, rebuilt)).toBe(true);
    expect(sameDocument(document, applyTheme(document, 'midnight'))).toBe(false);
  });
});
