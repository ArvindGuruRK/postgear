# 📋 User Stories: Design Studio (Carousel Generation)

> **Module**: Design Studio, the template-based post and carousel builder
> **Build spec**: [`../sprint-documents/sprint-09-design-studio.md`](../sprint-documents/sprint-09-design-studio.md)
> **Last Updated**: 2026-10-27
> **Format**: `As a [persona], I want [action], so that [benefit]`, then acceptance criteria, priority and story points, the same format as [`../../user_stories.md`](../../user_stories.md)

How to use this document:
- **Section 2** shows how real people will use Studio, start to finish. Read it first: every story below exists to make one of these journeys smooth.
- **Section 3** is the story list. Each acceptance criterion is something you can see or click, so it can be tested by hand.
- **Section 4** is the UX rulebook for this module.
- **Section 6** is the final checklist: tick it at sprint close-out to prove everything shipped.

---

## 1. Personas

| ID | Persona | Who they are | What they want from Studio |
|---|---|---|---|
| 👤 SC | **Solo Creator** | Priya runs a small yoga studio and posts 3 times a week. No design skills, little time. | Good-looking posts in minutes, in her studio's colours, without opening another app. |
| 👤 MM | **Marketing Manager** | Karthik markets a B2B SaaS product. Posts LinkedIn carousels (tips, product updates) and needs them on-brand every time. | Consistent branded carousels, fast, that his manager can look at before they go out. |
| 👤 AO | **Agency Owner** | Meera's agency runs social media for 8 clients, each with their own brand. | One brand kit per client, switch between them, never mix up a client's colours or logo. |
| 👤 TM | **Team Member** | Arun is a junior on Meera's team who makes most of the designs. | Clear templates and guardrails so his work looks professional without a designer checking every slide. |

---

## 2. Real User Journeys

### Journey A: Priya makes her first carousel (first-time user, no website scraping) 🧘

1. Priya signs in on Monday morning and sees **Studio** in the left rail, next to Media. She clicks it.
2. The page is empty apart from a friendly message: "No designs yet. Create your first post or carousel from a template." and a **Create Design** button.
3. Step 1 asks about her brand. Her website is old, so she ignores it and clicks **New Brand Kit**: types "Lotus Flow Yoga", uploads her logo, and picks her teal and peach colours with the colour picker. **Save Brand Kit**.
4. Step 2 shows four format cards. She hovers **Portrait (4:5)** and reads "Instagram and Facebook portrait feed posts". She picks it.
5. Step 3 is the gallery. Every thumbnail is already in teal and peach. She filters **Tips**, picks "5 Simple Steps", and lands in the editor.
6. She clicks the headline on the canvas and types "5 Morning Stretches For Beginners". The text gets smaller to fit. She edits each list slide in the right panel because it is easier on her laptop.
7. She drags the headline a little lower. It stops at the edge of the header area and the area outline shows her why.
8. She deletes slide 6, which she does not need. The top bar says **Saved**.
9. She clicks the eye icon, switches to the Instagram frame, swipes through the slides, and writes the caption there.
10. **Send To Composer**. The slides export (she sees "Rendering slide 3 of 5"), and the composer opens with all five images in order and her caption. She picks her Instagram channel and schedules it for 7:00 tomorrow.

**Time target**: under 10 minutes for a first-time user, under 4 minutes after that.

### Journey B: Karthik builds a carousel from his website brand (marketing manager) 💼

1. Karthik clicks **Create Design**, then **New Brand Kit**, and pastes his company's website address.
2. He clicks **Extract From Website**. After a few seconds a review screen shows the company name, four logo candidates and six colours, each with a suggested role (Primary, Accent, Background...).
3. The suggested background colour is wrong. He swaps it with one click, picks the second logo (the dark one), and saves.
4. He picks **Square** and the "Product Update" template, and fills five slides.
5. He wants his manager to see it before it goes out, so he clicks **Share**, copies the link and pastes it in Slack. His manager opens it on a phone without signing in and sees the slides in a LinkedIn frame with a "Preview" badge.
6. The manager asks for a different headline on slide 2. Karthik edits it, the link shows the new version, and he sends the carousel to the composer.

### Journey C: Meera's team runs 8 client brands (agency) 🏢

1. Meera sets up 8 brand kits, one per client, some from websites and some by hand. They show as a strip on the Studio page.
2. Arun opens **Create Design**, picks the "Bloom Bakery" kit, and the gallery recolours to the bakery's pink and brown. He cannot accidentally use another client's logo, because the logo comes from the chosen kit.
3. He duplicates last week's "Weekly Special" design, changes the text and the photo, and exports it.
4. A month later the bakery changes its brand colour. Meera edits the kit once. New designs use the new colour; Arun can switch an old design to the updated kit in its properties panel.

### Journey D: Something goes wrong, and nothing is lost 🛟

- Priya's Wi-Fi drops while she edits. The top bar says **Offline**; her changes stay on screen. When the connection returns, it says **Saving**, then **Saved**.
- Karthik opens the same design in two tabs and edits both. The second tab says "This design changed in another tab." with **Reload**, instead of silently overwriting his work.
- Meera pastes a client's website that blocks bots. The review screen says "We could not read that site. You can enter the brand details yourself." and the form stays open.
- Arun types a very long headline. The text shrinks to its minimum, then the slot gets a warning ring and the panel says "This text is too long for this space." Nothing is cut off in the export.

---

## 3. User Stories

### Epic DS-1: Discover And Start

#### DS-1.1: Open Studio From The Rail
> **As a** Solo Creator,
> **I want** Studio in the main navigation,
> **So that** I can find the design tool without searching for it.

**Acceptance Criteria:**
- [ ] A **Studio** entry with an animated icon sits in the left rail after Media, and in the mobile tab bar menu
- [ ] The top bar names the page **Design Studio**; there is no extra title on the page itself
- [ ] The active rail tile uses the same pressed style as other pages

**Priority**: P0 | **Story Points**: 1

#### DS-1.2: First-Time Empty State
> **As a** Solo Creator opening Studio for the first time,
> **I want** a clear first step,
> **So that** I know what to do without reading help.

**Acceptance Criteria:**
- [ ] With no designs, the page shows: "No designs yet. Create your first post or carousel from a template." and a **Create Design** button
- [ ] The empty state also shows three example template thumbnails as inspiration, which start the wizard with that template preselected
- [ ] No fake or sample designs are shown as if they were the user's

**Priority**: P0 | **Story Points**: 2

#### DS-1.3: Recent Designs
> **As a** Marketing Manager,
> **I want** to see my recent designs with their status,
> **So that** I can pick up where I left off.

**Acceptance Criteria:**
- [ ] Designs show as cards: thumbnail, title, format badge, slide count, "Updated 2 hours ago", status badge (Draft, Exported, Sent)
- [ ] Newest first; search by title; filter by format
- [ ] Clicking a card opens the editor at the slide last edited
- [ ] Card menu: **Open**, **Duplicate**, **Rename**, **Delete**
- [ ] Delete is a solid red button inside a confirm dialog that names the design; deleted designs disappear at once
- [ ] Every member of the workspace sees the workspace's designs; no other workspace's designs ever appear

**Priority**: P0 | **Story Points**: 3

#### DS-1.4: Duplicate A Design
> **As a** Team Member,
> **I want** to duplicate last week's design,
> **So that** I can reuse a layout I know works.

**Acceptance Criteria:**
- [ ] **Duplicate** creates "{title} (Copy)" and opens it
- [ ] Editing the copy never changes the original

**Priority**: P0 | **Story Points**: 1

---

### Epic DS-2: Brand Kits

#### DS-2.1: Create A Brand Kit By Hand
> **As a** Solo Creator without a good website,
> **I want** to enter my brand name, logo and colours myself,
> **So that** my designs look like my business.

**Acceptance Criteria:**
- [ ] Fields: **Brand Name**, **Website URL** (optional), **Logo** upload, colours for Primary, Secondary, Accent, Background and Text
- [ ] Each colour has a colour picker and a hex field that stay in sync; an invalid hex shows "Enter a colour like #1A2B3C."
- [ ] Placeholders read "Enter your brand name", "Enter your website address"
- [ ] Logo accepts PNG, JPG, SVG and WebP up to 5 MB; anything else gets a one-line reason
- [ ] **Save Brand Kit** is disabled until a name is entered; saving shows a success toast

**Priority**: P0 | **Story Points**: 3

#### DS-2.2: Extract A Brand From A Website
> **As a** Marketing Manager,
> **I want** PostGear to read my brand from my website,
> **So that** I don't have to look up hex codes and download logos.

**Acceptance Criteria:**
- [ ] **Extract From Website** shows a loading state ("Reading your website...") and finishes within about 10 seconds
- [ ] The review screen shows the found name, description, up to 6 logo candidates and up to 8 colours, each colour with a suggested role
- [ ] Every value is editable: pick a different logo, reassign a colour's role, remove a colour, add one by hand
- [ ] Nothing is saved until **Save Brand Kit**; leaving the review screen saves nothing
- [ ] Private, local and internal addresses are refused with "That address is not public."
- [ ] If the site cannot be read, the message says so in one sentence and keeps the form open for manual entry; the user is never stuck

**Priority**: P0 | **Story Points**: 8

#### DS-2.3: Several Brand Kits Per Workspace
> **As an** Agency Owner,
> **I want** one brand kit per client,
> **So that** each client's designs use only their own colours and logo.

**Acceptance Criteria:**
- [ ] The Studio page shows a **Brand Kits** strip: each kit's name, logo and colour swatches
- [ ] Kits can be created, edited, renamed and deleted (delete confirms and explains that existing designs keep their colours)
- [ ] A design is linked to one kit; the logo picker in the editor shows that kit's logo first

**Priority**: P0 | **Story Points**: 3

#### DS-2.4: Skip Brand Setup
> **As a** Solo Creator in a hurry,
> **I want** to skip the brand step,
> **So that** I can try a template right away.

**Acceptance Criteria:**
- [ ] **Skip For Now** goes straight to Format; the template's own colours are used
- [ ] In the editor, the properties panel offers **Apply A Brand Kit** at any time

**Priority**: P0 | **Story Points**: 1

#### DS-2.5: Update A Brand Kit
> **As an** Agency Owner whose client rebranded,
> **I want** to update the kit once,
> **So that** new designs use the new look.

**Acceptance Criteria:**
- [ ] Editing a kit changes new designs only; existing designs are not changed behind the user's back
- [ ] An existing design's properties panel shows "A newer version of this brand kit is available." with **Update Colours**

**Priority**: P1 | **Story Points**: 3

---

### Epic DS-3: Format And Templates

#### DS-3.1: Choose A Format
> **As a** Solo Creator,
> **I want** to choose the shape of my post before I design,
> **So that** it fits the platform I'm posting to.

**Acceptance Criteria:**
- [ ] Four cards: **Square (1:1)**, **Portrait (4:5)**, **Story (9:16)**, **Landscape (16:9)**, each drawn at its real shape
- [ ] Hover or focus shows the export size and where it fits (for example "1080 x 1350. Instagram and Facebook portrait feed posts.")
- [ ] The last format used is preselected next time

**Priority**: P0 | **Story Points**: 2

#### DS-3.2: Browse The Template Gallery
> **As a** Team Member,
> **I want** to browse templates by type,
> **So that** I find a good starting point fast.

**Acceptance Criteria:**
- [ ] At least 40 presets at launch, built so the library can pass 100
- [ ] Filters: category (Tips, Educational, Announcement, Product, Quote, Listicle, Statistic, Case Study, Promotion, Story, Event, Hiring), style (Light, Dark, Colourful), **Favourites**
- [ ] Search by name; no results shows "No templates match. Try another word or clear the filters."
- [ ] Only templates that support the chosen format are shown
- [ ] Each card shows thumbnail, name, category and slide count
- [ ] Thumbnails load as the user scrolls; the gallery stays smooth with 100+ cards

**Priority**: P0 | **Story Points**: 5

#### DS-3.3: See Templates In My Brand
> **As a** Marketing Manager,
> **I want** the gallery thumbnails in my brand colours,
> **So that** I can judge how a template will really look for us.

**Acceptance Criteria:**
- [ ] With a brand kit chosen, every thumbnail uses its colours and logo
- [ ] A **Show Original Colours** switch shows the template's own theme

**Priority**: P0 | **Story Points**: 3

#### DS-3.4: Favourite Templates
> **As an** Agency Owner,
> **I want** to star templates my team uses often,
> **So that** we find them in one click.

**Acceptance Criteria:**
- [ ] A star on each card adds or removes a favourite, shared across the workspace
- [ ] The **Favourites** filter shows only starred templates

**Priority**: P1 | **Story Points**: 2

#### DS-3.5: Start From A Template Or Blank
> **As a** Solo Creator,
> **I want** choosing a template to give me my own copy,
> **So that** I can change anything without breaking the template.

**Acceptance Criteria:**
- [ ] Choosing a template creates a new design and opens the editor in under 2 seconds
- [ ] The design is titled after the template ("5 Simple Steps") and can be renamed
- [ ] **Start From Blank** creates a plain design with the brand's colours
- [ ] The template itself never changes, whatever the user edits

**Priority**: P0 | **Story Points**: 2

---

### Epic DS-4: Edit A Slide

#### DS-4.1: Edit Text On The Canvas
> **As a** Solo Creator,
> **I want** to click text on the slide and type,
> **So that** editing feels direct and natural.

**Acceptance Criteria:**
- [ ] Clicking an eyebrow, headline, subheadline, body or footer puts a cursor in it
- [ ] Typing updates the slide live; Escape or clicking outside finishes editing
- [ ] Pasted text arrives as plain text (no stray fonts or colours from other apps)

**Priority**: P0 | **Story Points**: 5

#### DS-4.2: Edit Text In The Side Panel
> **As a** Team Member on a small laptop,
> **I want** text fields in the side panel too,
> **So that** I can edit precisely without zooming the canvas.

**Acceptance Criteria:**
- [ ] Selecting an element shows its fields in the properties panel; a list element shows one row per item with **Add Item** and remove buttons
- [ ] Canvas and panel always show the same text
- [ ] A character hint appears when a slot has a recommended length

**Priority**: P0 | **Story Points**: 3

#### DS-4.3: Move Elements Within Their Area
> **As a** Marketing Manager,
> **I want** to nudge text into a better position,
> **So that** the slide looks balanced, without breaking the layout.

**Acceptance Criteria:**
- [ ] Dragging an element moves it only inside its area (header, body, footer, or the template's own)
- [ ] While dragging, the area's outline and name show; at the edge the element stops and the edge highlights briefly
- [ ] An element can never be dragged into another area
- [ ] Arrow keys nudge the selected element (Shift for bigger steps), with the same limits

**Priority**: P0 | **Story Points**: 8

#### DS-4.4: Long Text Is Handled Honestly
> **As a** Solo Creator,
> **I want** to know when my text is too long,
> **So that** my post never goes out with cut-off words.

**Acceptance Criteria:**
- [ ] Text shrinks automatically down to the slot's minimum size
- [ ] Past that, the slot shows a warning ring and the panel says "This text is too long for this space."
- [ ] Export and Send warn if any slide still has a too-long slot, and say which slide

**Priority**: P0 | **Story Points**: 5

#### DS-4.5: Change Colours Safely
> **As a** Solo Creator,
> **I want** to change colours without making text unreadable,
> **So that** my posts stay easy to read.

**Acceptance Criteria:**
- [ ] Each element and background can use a brand colour role or a custom colour (picker plus hex)
- [ ] If text falls below readable contrast, the panel says "This text is hard to read on this background." with **Fix Contrast**
- [ ] **Fix Contrast** switches to the theme's light or dark text in one click
- [ ] **Theme** in the design panel swaps the whole colour and font theme on every slide

**Priority**: P0 | **Story Points**: 5

#### DS-4.6: Logo And Images
> **As an** Agency Owner,
> **I want** to place my client's logo and photos,
> **So that** every post is clearly theirs.

**Acceptance Criteria:**
- [ ] The logo slot offers the brand kit's logo first, then the Media library
- [ ] Where the template allows, the logo can move between header, footer and centre placements
- [ ] Image slots open the existing media picker dialog; images fill the slot without stretching
- [ ] A background can be a colour or a photo with an adjustable darkening overlay

**Priority**: P0 | **Story Points**: 5

#### DS-4.7: Size, Alignment And Optional Elements
> **As a** Team Member,
> **I want** a few simple style options,
> **So that** I can adjust a slide without design skills.

**Acceptance Criteria:**
- [ ] Headlines offer three sizes (S, M, L) and left, centre or right alignment where the template allows
- [ ] Optional elements (eyebrow, subheadline, footer, logo) can be hidden and shown again
- [ ] Options a template does not support are not shown at all, rather than shown disabled

**Priority**: P0 | **Story Points**: 3

#### DS-4.8: Undo, Redo And Reset
> **As a** Solo Creator who experiments,
> **I want** to undo mistakes and go back to the original,
> **So that** I'm never afraid to try things.

**Acceptance Criteria:**
- [ ] **Undo** and **Redo** buttons plus Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z; at least 50 steps
- [ ] **Reset Slide** restores the current slide to the template after a confirm
- [ ] **Reset Design** restores every slide after a confirm that says it cannot be undone after leaving the editor

**Priority**: P0 | **Story Points**: 3

---

### Epic DS-5: Carousel Slides

#### DS-5.1: Add A Slide
> **As a** Marketing Manager,
> **I want** to add slides of different types,
> **So that** my carousel has a cover, content and a closing call to action.

**Acceptance Criteria:**
- [ ] **Add Slide** offers slide layouts with small previews: Cover, Content, List, Quote, Statistic, Closing CTA
- [ ] The new slide appears after the current one, in the same theme and brand, and is selected
- [ ] At 20 slides, **Add Slide** is disabled with the tooltip "A design can have up to 20 slides."

**Priority**: P0 | **Story Points**: 3

#### DS-5.2: Duplicate, Delete And Reorder Slides
> **As a** Team Member,
> **I want** to rearrange my slides,
> **So that** the story flows in the right order.

**Acceptance Criteria:**
- [ ] Each slide thumbnail has **Duplicate** and **Delete**; deleting can be undone
- [ ] Slides reorder by dragging the thumbnails, and by keyboard (move up, move down)
- [ ] Slide numbers update at once; the last remaining slide cannot be deleted

**Priority**: P0 | **Story Points**: 3

---

### Epic DS-6: Saving And Safety

#### DS-6.1: Autosave With An Honest Status
> **As a** Solo Creator,
> **I want** my work saved automatically,
> **So that** I never lose it.

**Acceptance Criteria:**
- [ ] Changes save about 1.5 seconds after the user stops typing
- [ ] The status reads **Saving**, **Saved**, **Offline**, or "Could not save. Retrying."
- [ ] **Saved** only shows after the server confirms
- [ ] Offline edits stay on screen and save when the connection returns

**Priority**: P0 | **Story Points**: 5

#### DS-6.2: No Silent Overwrites
> **As a** Marketing Manager with many tabs open,
> **I want** to be warned when a design changed elsewhere,
> **So that** I don't wipe out my own or a teammate's work.

**Acceptance Criteria:**
- [ ] If the design changed in another tab or by a teammate, the editor says "This design changed in another tab." with **Reload**
- [ ] Nothing is overwritten until the user chooses

**Priority**: P0 | **Story Points**: 3

#### DS-6.3: Leaving With Unsaved Changes
> **As a** Solo Creator,
> **I want** a warning if I leave before saving finishes,
> **So that** I don't close the tab on unsaved work.

**Acceptance Criteria:**
- [ ] Leaving the page or closing the tab while changes are unsaved asks for confirmation
- [ ] No warning when everything is saved

**Priority**: P0 | **Story Points**: 1

#### DS-6.4: Rename A Design
> **As a** Team Member,
> **I want** to rename a design from the editor,
> **So that** I can find it again later.

**Acceptance Criteria:**
- [ ] Clicking the title in the top bar makes it editable; Enter saves, Escape cancels
- [ ] An empty title falls back to the previous one

**Priority**: P0 | **Story Points**: 1

---

### Epic DS-7: Preview

#### DS-7.1: Preview In A Platform Frame
> **As a** Solo Creator,
> **I want** to see my carousel as it will look on Instagram,
> **So that** I can catch problems before posting.

**Acceptance Criteria:**
- [ ] The eye icon opens the preview; Escape closes it
- [ ] Platform switch: Instagram, Facebook, LinkedIn and X (only those that fit the format)
- [ ] The frame shows the workspace's avatar and name, the caption, and the slides as a swipeable carousel with dots and arrows
- [ ] Like, comment and share icons appear **without numbers**
- [ ] A clear **Preview** badge is always visible; nothing suggests the post is live

**Priority**: P0 | **Story Points**: 5

#### DS-7.2: Write The Caption In Preview
> **As a** Marketing Manager,
> **I want** to write the caption while I look at the slides,
> **So that** text and visuals match.

**Acceptance Criteria:**
- [ ] The caption is editable in the preview and saved with the design
- [ ] The caption is carried into the composer on Send

**Priority**: P1 | **Story Points**: 2

---

### Epic DS-8: Export And Send

#### DS-8.1: Export Slides To Media
> **As a** Solo Creator,
> **I want** my slides saved as images,
> **So that** I can post them or reuse them.

**Acceptance Criteria:**
- [ ] **Export** shows progress per slide ("Rendering slide 3 of 7")
- [ ] One image per slide lands in Media, in order, named "{title} 01", "{title} 02"...
- [ ] Images are exactly the format's size (for example 1080 x 1350) and match the editor
- [ ] JPEG by default, so Instagram accepts them; PNG available
- [ ] If a slide fails, the message names the slide and the reason; slides already saved are kept
- [ ] The design's status becomes **Exported**

**Priority**: P1 | **Story Points**: 8

#### DS-8.2: Send To The Composer
> **As a** Marketing Manager,
> **I want** to send my carousel straight to the composer,
> **So that** I can schedule it without downloading and uploading files.

**Acceptance Criteria:**
- [ ] **Send To Composer** exports first if the design changed since the last export
- [ ] The composer opens with a draft holding all images in slide order and the caption
- [ ] Channel choice, platform rules and scheduling happen in the composer, as for any other post
- [ ] If a chosen platform takes fewer images than the carousel has, the composer's own warning explains it
- [ ] The design's status becomes **Sent**

**Priority**: P1 | **Story Points**: 5

#### DS-8.3: Download Images
> **As an** Agency Owner,
> **I want** to download the slides,
> **So that** I can send them to a client by email.

**Acceptance Criteria:**
- [ ] Each exported image can be downloaded from Media (P0)
- [ ] **Download All** gives one zip with the slides in order (P1)

**Priority**: P1 | **Story Points**: 2

---

### Epic DS-9: Share For Feedback

#### DS-9.1: Create A Share Link
> **As a** Marketing Manager,
> **I want** a link I can send my manager,
> **So that** they can look at the carousel without a PostGear account.

**Acceptance Criteria:**
- [ ] **Share** creates a link with a 7-day expiry by default (choice up to 30 days), with **Copy Link**
- [ ] The editor lists active links with their expiry and **Revoke**

**Priority**: P1 | **Story Points**: 3

#### DS-9.2: Open A Shared Design
> **As a** manager receiving the link,
> **I want** to see the slides on my phone,
> **So that** I can give quick feedback.

**Acceptance Criteria:**
- [ ] The link opens without sign-in and shows the workspace name, the slides and the platform preview, with the **Preview** badge
- [ ] It works well on a phone (swipe through slides)
- [ ] It shows the latest exported version (shipped as the latest saved version, which Journey B step 6 needs: the Sprint 9 checklist, Deviations)
- [ ] A revoked or expired link shows "This link is no longer available." and nothing else
- [ ] Search engines are told not to index the page

**Priority**: P1 | **Story Points**: 3

---

## 4. UX Best Practices For This Module

These are the rules every Studio screen is checked against.

| # | Principle | What it means in Studio |
|---|---|---|
| 1 | **Fast first win** | A first-time user exports something good in under 10 minutes. Every step before the editor can be skipped or has a sensible default. |
| 2 | **Show, don't ask** | Thumbnails in the user's brand colours, format cards drawn at their real shape, slide layouts shown as pictures. Fewer words to read, fewer decisions to imagine. |
| 3 | **Guardrails, not rules to learn** | Elements stay in their areas, text shrinks before it overflows, contrast is checked for you. The user cannot make an ugly or unreadable slide by accident. |
| 4 | **Forgiving** | Undo for everything, reset to template, autosave, no silent overwrites, a leave warning. Trying things is never risky. |
| 5 | **Honest status** | Saved means saved. Preview says Preview. No engagement numbers that aren't real. Export failures say which slide and why. |
| 6 | **One way in, one way out** | Studio makes images; the composer posts them. There is no second scheduler to learn. |
| 7 | **Two ways to edit** | Direct on the canvas for speed, the side panel for precision and for keyboard and screen-reader users. Both edit the same thing. |
| 8 | **Progressive disclosure** | The panel shows only options the selected element supports. Advanced choices (custom hex, overlay strength) sit one click deeper. |
| 9 | **Consistent with PostGear** | `PageActions` row first, no in-page titles, Title Case names, sentence case messages, "Enter your ..." placeholders, design-system Alert for errors, animated icons for clickable icons, solid red delete. |
| 10 | **Clear error messages** | Every error says what happened and what to do next, in one or two short sentences ("We could not reach that site. You can enter the brand details yourself."). |
| 11 | **Speed you can feel** | Editor opens in under 2 seconds; typing shows on the canvas instantly; the gallery stays smooth at 100+ templates. |
| 12 | **Works for everyone** | Full keyboard use, visible focus, labels for screen readers, status never shown by colour alone, reduced motion respected, drawers on small screens. |

---

## 5. Edge Cases And Expected Behaviour

| Situation | What the user sees |
|---|---|
| Website blocks bots or times out | "We could not read that site. You can enter the brand details yourself." Form stays open. |
| Website has no colours worth using | Review screen shows what it found (maybe nothing) and the colour pickers, ready for manual entry. |
| Logo upload is too big or the wrong type | One sentence with the limit: "Logos can be PNG, JPG, SVG or WebP, up to 5 MB." |
| Text too long for its slot | Shrinks, then a warning ring and a panel message; Export names the slide. |
| Brand colour makes text unreadable | Contrast warning with **Fix Contrast**. |
| Connection lost while editing | **Offline** status, edits kept, saved on reconnect. |
| Same design edited in two places | "This design changed in another tab." with **Reload**. |
| Brand kit deleted while designs use it | Designs keep their colours and logo; the panel shows "This brand kit was deleted." |
| Image in Media deleted while a design uses it | The slot shows an empty placeholder and the panel says "This image was deleted. Choose another." Export warns. |
| Export browser not available on the server | "Export is not available right now. Please try again later." (the API console shows the technical fix) |
| Carousel longer than a platform allows | The composer's platform warning explains it at Send time. |
| Share link expired or revoked | "This link is no longer available." |
| User without access opens a design URL | Not found page; nothing about the design is revealed. |

---

## 6. Completion Checklist ✅

Tick each line at sprint close-out (the `sprint-closeout` skill verifies them against the code). A line is done only when it works in the running app, not just in code.

### Discover And Start
- [x] DS-1.1 Studio in the rail and mobile menu, correct top bar name
- [x] DS-1.2 Empty state with Create Design and example templates
- [x] DS-1.3 Recent designs with status, search, filter, card menu, red confirm delete
- [x] DS-1.4 Duplicate a design

### Brand Kits
- [x] DS-2.1 Manual brand kit with synced picker and hex fields
- [x] DS-2.2 Website extraction with review screen; private addresses refused; failure never blocks
- [x] DS-2.3 Several kits per workspace
- [x] DS-2.4 Skip brand setup
- [x] DS-2.5 (P1) Kit updates offered to existing designs, never forced

### Format And Templates
- [x] DS-3.1 Four formats with real shapes and hover hints
- [x] DS-3.2 40+ presets, filters, search, no-results message, smooth scrolling
- [x] DS-3.3 Thumbnails in the chosen brand, with Show Original Colours
- [x] DS-3.4 (P1) Favourites
- [x] DS-3.5 Template creates a copy; Start From Blank

### Edit A Slide
- [x] DS-4.1 Edit text on the canvas, plain-text paste
- [x] DS-4.2 Edit text in the panel, list items, length hints
- [x] DS-4.3 Constrained move with area outline and keyboard nudge
- [x] DS-4.4 Text fit and too-long warnings, including at export
- [x] DS-4.5 Colours with contrast warning and Fix Contrast; theme swap
- [x] DS-4.6 Logo placement, images, photo backgrounds with overlay
- [x] DS-4.7 Size steps, alignment, hide and show optional elements
- [x] DS-4.8 Undo, redo, reset slide, reset design

### Carousel Slides
- [x] DS-5.1 Add slide by layout, 20-slide limit
- [x] DS-5.2 Duplicate, delete with undo, drag and keyboard reorder

### Saving And Safety
- [x] DS-6.1 Autosave with honest status, offline recovery
- [x] DS-6.2 Conflict warning, no silent overwrite
- [x] DS-6.3 Leave warning only when unsaved
- [x] DS-6.4 Rename from the top bar

### Preview
- [x] DS-7.1 Platform frames, swipeable slides, no engagement numbers, Preview badge
- [x] DS-7.2 (P1) Caption in preview, carried to the composer

### Export And Send
- [x] DS-8.1 (P1) Export to Media in order, exact size, JPEG default, per-slide errors
- [x] DS-8.2 (P1) Send To Composer with images in order and caption
- [x] DS-8.3 (P1) Download per image and Download All

### Share
- [x] DS-9.1 (P1) Create, copy, list and revoke share links
- [x] DS-9.2 (P1) Shared page works signed out, on a phone, not indexed, dead links say so

### UX And Quality Gates
- [ ] Journeys A to D in section 2 walked through by hand, start to finish, without help (needs a person: the Sprint 9 checklist, What remains)
- [ ] A first-time user exports a carousel in under 10 minutes (needs a person: the Sprint 9 checklist, What remains)
- [x] Every edge case in section 5 behaves as written
- [x] Every UX principle in section 4 checked on every Studio screen
- [x] Checked in light, dark and Lilac themes, and at phone width
- [x] Every action works by keyboard alone; focus is always visible
- [x] No other workspace's designs, kits or share links are reachable (API specs)
- [x] `npm run validate` passes; e2e spec covers create, edit, export and send

---

## 7. How We Know It Works (After Launch)

| Measure | Target |
|---|---|
| New users who export their first design within their first session in Studio | 60% or more |
| Median time from Create Design to first export | under 5 minutes |
| Designs that reach Exported or Sent | 50% or more |
| Website extractions the user saves with 2 edits or fewer | 70% or more |
| Templates used at least once a month | 80% of the library (unused ones get replaced) |
