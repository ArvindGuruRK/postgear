# Motion And Interaction Principles

Adopted 2026-11-27 for the whole app. Every new screen, component and revamp follows these, and an older screen picks them up when it is next touched. This doc says *why* and *when* to move something. The tokens it uses (durations, easings, keyframes) live in `packages/config/tailwind.css`, and [`design-system-rules.md`](design-system-rules.md) §8 (interaction states) and §16 (motion) say *how* components wire them up. If the two ever disagree, fix whichever one is out of date. Don't pick one quietly.

The short version: **motion has to explain something.** It shows where a thing came from, what just happened, or where to look next. If an animation explains nothing, cut it.

---

## 0. House rules (apply to every principle below)

PostGear is neobrutalist: thick borders, hard shadows, things that *snap*. So motion here is **short, firm and purposeful**, never floaty.

**Duration budget.** Use the times already in the system. Don't invent new ones.

| Time | Use |
|---|---|
| 100 ms | The press, toggle thumbs, label colour flips. Feels physical. |
| 150 ms | Tooltips, small icon swaps. |
| 200 ms | Fades, overlays, collapses, exits. The default. |
| 250 to 350 ms | Morphs: an element growing into a bigger one, a wipe entrance, a toast arriving, a success pulse. |
| 400 ms | The ceiling for any UI movement a person waits on (see §16, the Doherty threshold). The GSAP hover fill's 0.4 s grow is the longest. |

Decorative loops (stripes, the welcome page's floating stickers) are not waited on, so they sit outside this budget. They still stop under reduced motion.

**Easing.** Things that arrive *ease out* (fast start, soft landing): `cubic-bezier(0.16, 1, 0.3, 1)` (toast, tooltip) or `cubic-bezier(0.33, 1, 0.68, 1)` (accordion, digit tick). Things that leave *ease in* and go faster than they came. Never `linear` for movement (only for loops like the progress stripes). Never a long `ease-in-out` drift.

**Only cheap properties.** Animate `transform`/`translate`/`scale`, `opacity`, `filter` and `clip-path`. Never animate `width`, `height`, `top`, `left` or `margin` directly (it makes the browser redo the layout every frame and it stutters). For "grow" use a FLIP (measure first, then last, then animate the difference with `transform`) or a `grid-template-rows: 0fr` to `1fr` trick. The Radix accordion's height keyframe is the one allowed exception.

**Reduced motion always wins.** Every animation sits behind `motion-safe:` or `@media (prefers-reduced-motion: no-preference)`, the way `.pg-float` in `globals.css` does and the GSAP fill does. With reduced motion on, the end state still shows (the tick still appears, the panel still opens, the dimmed background still dims), it just appears instantly. Meaning must never depend on movement alone.

**Where to put it.** CSS keyframes go in `packages/config/tailwind.css` as an `--animate-*` token with a comment explaining why (`design-system-rules.md` §17). Motion CSS can't do (morphs, pointer-following, springs) uses GSAP, imported from `@postgear/ui`, never from `gsap` directly. Clickable icons animate through `MotionIcon`.

---

## 1. Pulse to confirm success 💚

**Rule.** When an action succeeds, don't just *say* "Saved". Make the person *feel* it: the thing they acted on gives one short pulse.

**Why.** A toast in the corner is easy to miss, because the eye is on the button, not the corner. A pulse right where the person is looking confirms the action without them hunting for it.

**How in PostGear.**
- One pulse, about 300 ms: the control scales to roughly 1.04 and back, or its border or fill flashes `brutal-success` and settles. Never loop it, never bounce it more than once.
- The button's own label or icon changes to the result (Save becomes a check plus "Saved" for about 1.5 s, then returns), crossfaded with a blur (§3).
- Keep the toast for things that happen *away* from the pointer (a post published by the worker, an export finished). For things the person just clicked, the pulse is the confirmation and a toast is optional.
- Errors never pulse green. A failed save shakes nothing and flashes nothing cheerful: it shows the design-system `Alert` or the field error, as it does today.

**Where it fits.** Save in settings and the composer, Schedule and Add To Queue, Copy Link, Connect A Channel finishing, Activate on a workflow, a clip export landing in the list.

---

## 2. Expand the same element, don't swap it out 🔍

**Rule.** When a small thing opens into a bigger thing, **grow the element itself** so the eye never loses it. Don't make the small one vanish and a new one appear somewhere else.

**Why.** A hard swap makes the person re-find their place. A grow shows a clear "this became that", so they keep their bearings.

**How in PostGear.**
- Animate from the trigger's box to the open box (FLIP with `transform`, 250 to 350 ms, ease out). Content inside fades in during the last half, so text never squashes.
- Closing runs the same path backwards, a bit faster (about 200 ms).
- Popovers, dropdowns and tooltips should open *from* the side of their trigger (the tooltip already does this through `--pg-tooltip-x/y`), not pop up from nowhere.

**Where it fits.** A post card in the calendar or Queue opening into its preview, a step card in the Workflows builder opening its settings panel, a Media tile opening the viewer, a collapsed composer box growing into the full editor, a Discover result growing into its detail.

---

## 3. Crossfade icons with a blur ✨

**Rule.** When one icon turns into another (copy to check, play to pause, chevron to close, sun to moon), crossfade them with a short blur. Never hard-swap.

**Why.** A hard swap looks like a glitch. A blur hides the in-between frames, so the change reads as one icon *morphing* into the next.

**How in PostGear.**
- Both icons sit in the same spot. The old one goes to `opacity: 0`, `blur(4px)`, `scale(0.8)` while the new one comes from the same values to normal, about 150 to 200 ms.
- The same trick works for a label changing ("Save" to "Saved", "Follow" to "Following") and for numbers that are not counting up.
- `MotionIcon` keeps its own hover animation. This crossfade is only for when the icon itself *changes*.

**Where it fits.** Copy buttons, the theme toggle, play and pause in the Clips editor and the Studio preview, bookmark and like states, the password show and hide eye, collapse and expand toggles.

---

## 4. Rubber band past the edge 🪀

**Rule.** When someone drags or scrolls past the end of something, let it stretch a little with resistance, then spring back. Never stop dead.

**Why.** A hard stop feels broken ("did it freeze?"). Resistance feels real: it tells the person "this is the end" in a way the hand understands.

**How in PostGear.**
- Past the edge, the content moves a *fraction* of the drag distance (start at about a third, shrinking the further you pull), then springs back over about 300 ms with ease out when released.
- Native scrolling on macOS and iOS already does this: don't fight it, and don't add it twice.
- Build it for things we drag ourselves: canvases, timelines, sliders, sheets, carousels.

**Where it fits.** Panning past the content in the Workflows builder and the Design Studio canvas, the Clips timeline and trim handles at the clip's start and end, horizontal template or sticker rails, slider thumbs at min and max, pulling a sheet past fully open.

---

## 5. Review with masks (wipe entrances) 🎭

**Rule.** Fades are fine, but for content that *arrives* (a panel, an image, a result), a **mask wipe** makes it a real entrance.

**Why.** A fade only says "this exists now". A wipe shows a direction ("this came in from the left") and feels deliberate, which suits the brutalist look far better than a soft fade.

**How in PostGear.**
- Animate `clip-path: inset(...)` from fully hidden to fully shown (for example `inset(0 100% 0 0)` to `inset(0 0 0 0)`), 250 to 350 ms, ease out. Hard edge, no feathering.
- Wipe in the direction the content came from: a side panel wipes from its edge, a list item wipes downward, a generated image wipes top to bottom.
- Keep `animate-fadeIn` for small overlays (tooltips, popovers, dialogs). Use the wipe for bigger moments, not every box on the page.

**Where it fits.** AI Copilot's answer or image arriving, a Studio design or Clips render appearing when done, an SEO report's score panel, Discover results landing, a newly created post card appearing in the calendar.

---

## 6. Stage the focus 🎯

**Rule.** If everything is loud, nothing is. At any moment, **one thing** gets the motion and the attention. Everything else stays still, or gets quieter.

**Why.** Many things moving at once fight for the eye and the person doesn't know where to look. One moving thing leads the eye straight to it.

**How in PostGear.**
- One animated thing per moment. If a toast, a pulse and a panel would all move at once, keep the one closest to the pointer and make the rest instant.
- Stagger lists only lightly (30 to 50 ms between items, at most about 6 items, then the rest appear together), so a long list never takes seconds to arrive.
- Only one blue `primary` button per area (already a rule in `design-system-rules.md` §7) is the same idea in colour.

---

## 7. Dim the rest 🌗

**Rule.** When the person focuses on one thing, dim everything around it.

**Why.** Dimming tells the eye "not this, that" without moving anything. It is the quietest way to stage the focus.

**How in PostGear.**
- Dialogs and sheets already dim with their overlay. Use the same overlay token everywhere; don't invent a new tint.
- Inside a canvas, dim the unselected items instead of covering the page: in Workflows, the steps not on the selected path drop to around 40 to 50% opacity; in Studio, editing a layer inside a group dims the others.
- While dragging, dim the drop targets that won't accept the item, and leave the ones that will at full strength.
- Fade the dim in and out over 200 ms. Never dim so far that the person loses where they are.

---

## 8. Frequency of use: the more it's used, the less it moves 🔁

**Rule.** How much something animates depends on how often people see it. Daily actions are instant; rare moments can celebrate.

**Why.** A lovely 400 ms animation is a joy the first time and a tax the hundredth time. Power users feel every millisecond.

**How in PostGear.**

| How often | Examples | Motion |
|---|---|---|
| Many times a minute | Typing, nav rail, tabs, global search (`Cmd+K`), canvas zoom and pan, keyboard shortcuts, menu items | None or almost none. Instant, at most 100 to 150 ms. |
| A few times a session | Saving, scheduling a post, opening a dialog, switching views | Short and functional: the pulse, the grow, 200 to 300 ms. |
| Rarely | Finishing onboarding, first channel connected, first post published, a plan upgrade, a day streak milestone | Allowed to celebrate: the Lottie flame, a bigger wipe, a confetti burst. Still under reduced motion. |

Anything opened from the keyboard (shortcuts, the palette) shows up instantly: someone using the keyboard is already in a hurry.

---

## 9. Fitts's law: big and close beats tiny and far 🎯

**Rule.** The time to hit a target depends on how *big* it is and how *far* it is. Make the things people click often large, and put them near where the pointer already is.

**How in PostGear.**
- Click targets are at least 36 px (`sm`, `h-9`); the main action uses `md` (44 px, `h-11`) or bigger. An icon-only control gets a full-size hit area even if the icon is 16 px.
- Put the next action next to the last one: Save sits beside the field you just edited, a dialog's main button is near where the pointer lands, row actions sit on the row.
- Screen edges and corners are "infinitely deep" targets for a mouse, so the rail and the top bar sit on the edges.
- Destructive actions (red, solid) should be harder to hit by accident: not next to the main action, and behind a confirm as they already are.
- Right-click menus and the command palette open *at* the pointer or the centre, so the choice is zero distance away.

---

## 10. Hick's law: every extra choice slows people down ✂️

**Rule.** The more options on show, the longer a decision takes. **Cut the menu.**

**How in PostGear.**
- Show the 3 to 5 common choices first; put the rest behind "More" or in the global search.
- A menu longer than about 7 items gets groups with `type-label` headings, or it gets split.
- Good defaults beat options: preselect the most likely channel, time slot and format so the common case is one click.
- One question per screen in onboarding (already how it works) is Hick's law in action.
- Before adding a setting, ask "could we just pick the right answer?" If yes, don't add it.

---

## 11. Doherty threshold: answer in under 400 ms ⚡

**Rule.** The app has to *respond* to every action within 400 ms, or it starts to feel broken. (The rule is named after Walter Doherty of IBM, 1982. Sometimes it gets misheard as "Dorothy".)

**Why.** Under about 400 ms people stay in flow. Above it they wonder whether the click worked, click again, or switch away.

**How in PostGear.**
- **Respond at once, finish later.** The press (100 ms) and the hover fill already answer instantly. Every click must change *something* on screen within 100 ms, even if the work takes longer.
- **Optimistic updates** for things that almost always succeed (reorder, mark read, like, toggle, rename): show the result straight away, roll back with an error if the server says no.
- **Loading feedback by wait time**:
  - Under 400 ms: show nothing extra (a flashing spinner is worse than none).
  - 400 ms to about 2 s: a `Skeleton` in the same footprint, or a `Spinner` inside the button (sizes preserved, no reflow, see `design-system-rules.md` §8).
  - Over about 2 s (AI, SEO crawls, renders, imports): show progress, streamed text (SSE) or steps, never a frozen spinner.
- Animations themselves stay inside the 400 ms ceiling (§0), so motion never becomes the reason something feels slow.

---

## 12. Review checklist ✅

Run through this before calling a UI change done:

- [ ] Every animation explains something (where it came from, what changed, where to look). Decorative ones are cut.
- [ ] Times come from the §0 table, nothing over 400 ms that a person waits on.
- [ ] Arrivals ease out; exits are faster and ease in.
- [ ] Only `transform`, `opacity`, `filter` and `clip-path` are animated (accordion height excepted).
- [ ] It works with reduced motion on: the end state still appears, just instantly.
- [ ] Success on a clicked control pulses where the eye is (§1).
- [ ] Opening something grows the same element, no swap (§2).
- [ ] Icon and label changes crossfade with a blur (§3).
- [ ] Dragged things rubber band at their edges (§4).
- [ ] Big arrivals use a wipe; small overlays keep the fade (§5).
- [ ] Only one thing moves at a time, the rest is dimmed if needed (§6, §7).
- [ ] High-frequency actions are instant (§8).
- [ ] Click targets are at least 36 px and the next action is close (§9).
- [ ] No menu shows more than it needs to (§10).
- [ ] Every click shows a response in under 100 ms, and loading follows the §11 ladder.
