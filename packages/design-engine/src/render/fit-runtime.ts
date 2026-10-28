/**
 * The text fitter that runs inside the page, in the editor and at export.
 *
 * ## Why it is written as one self-contained function
 *
 * The promise Studio makes is that what you edit is what gets exported. That
 * only holds if the same code decides every font size, and the export runs in
 * a headless Chromium with nothing but the HTML it is handed. So `fitSlots`
 * takes no imports and closes over nothing: the editor calls it directly, and
 * the exporter serialises this very function into a `<script>` with
 * `fitSlots.toString()`. There is literally one implementation, and no way for
 * the two to drift.
 *
 * Because it is serialised, its body avoids anything a compiler might lower
 * into a call to a helper defined elsewhere in the bundle (`for...of`, spread,
 * classes): the copy in the export page would find the helper missing.
 *
 * ## What it measures
 *
 * Every fitted slot is two boxes: the slot itself (`[data-fit]`), a fixed
 * rectangle with `overflow: hidden`, and its content (`[data-fit-content]`),
 * which is as tall as its words need. The search compares the two. It never
 * asks the slot for its `scrollHeight`: a slot that sits its text at the
 * bottom or the middle lets taller text spill *upwards*, and `scrollHeight`
 * does not count overflow on that side, so a bottom-aligned headline would
 * report that it fits with its first line cut off.
 *
 * ## What it does
 *
 * While the content is taller or wider than the slot, the font size steps
 * down. Markers, gaps and rules inside a slot are sized in `em`, so they
 * shrink with it. At the floor (`data-fit-min`, a fraction of the full size)
 * it stops and marks the slot `data-overflow="true"` instead of shrinking
 * further, and reports the slot. Nothing is ever clipped quietly (DS-4.4).
 *
 * A linear walk down twelve steps rather than a binary search: wrapping is not
 * monotone (a word hops a line and the height jumps), so a binary search can
 * settle on a size that fits while a larger one would have fitted too.
 */

/** The steps the search tries. Mirrored in `fit.ts` for the headless model. */
export const FIT_STEPS = 12;

/**
 * Fits every `[data-fit]` slot under `root`, and returns the `data-slot` ids
 * of the ones that still overflow at the floor.
 *
 * Read the note above before editing: this body is copied into the export
 * page as text.
 */
export function fitSlots(root: ParentNode): string[] {
  const slots = root.querySelectorAll('[data-fit]');
  const overflowing: string[] = [];

  for (let index = 0; index < slots.length; index++) {
    const slot = slots[index] as HTMLElement;
    const content = slot.querySelector('[data-fit-content]') as HTMLElement | null;
    const base = Number(slot.getAttribute('data-fit'));
    const requestedMin = Number(slot.getAttribute('data-fit-min'));
    const min = requestedMin > 0 && requestedMin <= 1 ? requestedMin : 0.62;
    const steps = 12;

    if (!content || !(base > 0)) continue;

    let fitted = false;

    for (let step = 0; step < steps; step++) {
      const scale = 1 - ((1 - min) * step) / (steps - 1);
      slot.style.fontSize = `${base * scale}px`;

      // One pixel of slack: sub-pixel rounding otherwise reports a box that
      // visually fits as overflowing, and the text shrinks for no reason.
      if (
        content.offsetHeight <= slot.clientHeight + 1 &&
        content.scrollWidth <= slot.clientWidth + 1
      ) {
        fitted = true;
        break;
      }
    }

    if (fitted) {
      slot.removeAttribute('data-overflow');
    } else {
      slot.setAttribute('data-overflow', 'true');
      overflowing.push(slot.getAttribute('data-slot') || '');
    }
  }

  return overflowing;
}

/**
 * The export page's script: the function above, and the code that runs it
 * once the page is really ready.
 *
 * "Ready" is three things, waited for explicitly rather than assumed:
 *
 * 1. **Every font face is loaded.** `document.fonts.ready` alone is not
 *    enough: a face is only fetched once laid-out text asks for it, so a
 *    script that runs early can find nothing pending, get a resolved promise
 *    and measure the fallback face, which is a different width. Each face is
 *    loaded by name first.
 * 2. **Every picture is decoded**, so the screenshot never catches a slide
 *    with its photo still blank.
 * 3. **The fit has run.** `window.__pgFitDone` is what the exporter waits on;
 *    `window.__pgOverflow` holds the overflowing slot ids, and
 *    `window.__pgFontsMissing` any face that failed to load, which the
 *    exporter treats as its own error rather than shipping the fallback.
 *
 * `fontLoads` are CSS font shorthands (`800 16px "Sora"`), one per face.
 */
export function fitScriptSource(fontLoads: readonly string[]): string {
  // `<` is escaped so no font name can close the script element early.
  const specs = JSON.stringify(fontLoads).replace(/</g, '\\u003c');

  return [
    `${fitSlots.toString()};`,
    '(function () {',
    `  var specs = ${specs};`,
    '  window.__pgFitDone = false;',
    '  window.__pgOverflow = null;',
    '  window.__pgFontsMissing = [];',
    '  function finish() {',
    '    var fonts = document.fonts;',
    '    if (fonts && fonts.check) {',
    '      window.__pgFontsMissing = specs.filter(function (spec) { return !fonts.check(spec); });',
    '    }',
    '    try { window.__pgOverflow = fitSlots(document); }',
    '    catch (error) { window.__pgFitError = String(error); }',
    '    window.__pgFitDone = true;',
    '  }',
    '  var waits = [];',
    '  var fonts = document.fonts;',
    '  if (fonts && fonts.load) {',
    '    for (var i = 0; i < specs.length; i++) {',
    '      waits.push(fonts.load(specs[i]).catch(function () { return []; }));',
    '    }',
    '  }',
    '  var images = document.images;',
    '  for (var j = 0; j < images.length; j++) {',
    '    if (images[j].decode) waits.push(images[j].decode().catch(function () {}));',
    '  }',
    '  Promise.all(waits)',
    '    .then(function () { return fonts && fonts.ready ? fonts.ready : null; })',
    '    .then(finish, finish);',
    '})();',
  ].join('\n');
}
