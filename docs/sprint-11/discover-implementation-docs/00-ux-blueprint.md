# 00: UX Blueprint, The Discover Experience

> **Sprint 11, Discover** | Reference only, nothing to build here | Read before Modules 03 to 08.
> **Decides**: how Discover looks and behaves. The user stories decide what it must do; the sprint doc decides how it is built.

## 1. The Feeling

Discover is a reading page: calm, dense enough to scan, honest about where every line comes from. It is PostGear's look (borders, hard shadows, Sora) applied to a feed, not a news site. Nothing animates except on hover and when a group refreshes. There is no hero, no title, no tagline, no "AI" sparkle sticker on the page itself; the only violet is the Draft With AI button.

## 2. Page Anatomy (1366 px and up)

```
Top bar: Discover                                                                 search
+---------------------------------------------------------------------------------------------+
| [ (pin) Chennai, Tamil Nadu  v ]  [ Tamil v ]                 Updated 12 min ago   [refresh] |
| Places by OpenStreetMap contributors                                            (Simulated)  |
+---------------------------------------------------------------------------------------------+
| Trending   News   Videos   Festivals   Competitors                                           |
+---------------------------------------------------------------------------------------------+
| +-----------------------------------------------------------------------------------------+ |
| | Rising Searches In Tamil Nadu                                                           | |
| | Via Google Trends. Showing what we had from 25 minutes ago.                             | |
| |  +-----------+  +-----------+  +-----------+  +-----------+                             | |
| |  | img       |  | img       |  |           |  | img       |                             | |
| |  | weather   |  | film name |  | ipl 2027  |  | ...       |                             | |
| |  | coimbatore|  |           |  |           |  |           |                             | |
| |  | 500+ srch |  | 200+ srch |  | 200+ srch |  |           |                             | |
| |  | The Hindu |  | ...       |  |           |  |           |                             | |
| |  | Dinamalar |  |           |  |           |  |           |                             | |
| |  | [Create Post] Read Open  |  ...                                                       | |
| |  +-----------+  +-----------+  +-----------+  +-----------+                             | |
| +-----------------------------------------------------------------------------------------+ |
| +-----------------------------------------------------------------------------------------+ |
| | What People Are Reading On Tamil Wikipedia                                              | |
| | Yesterday's most-read articles. Wikipedia, text CC BY-SA.                               | |
| |  1  Thirukkural                                   284 reads     [Create Post]  Open     | |
| |  2  Deepavali                                     276 reads     [Create Post]  Open     | |
| +-----------------------------------------------------------------------------------------+ |
| +-----------------------------------------------------------------------------------------+ |
| | Worldwide On Bluesky And Mastodon                                                       | |
| | Not local: what the whole network is talking about.                                     | |
| |  [ House speaker picks  234 posts ] [ #MeerMittwoch  1.1k uses ] [ ... ]                | |
| +-----------------------------------------------------------------------------------------+ |
+---------------------------------------------------------------------------------------------+
```

- The actions row is a `PageActions` with `className="justify-between"`: chips on the left, the updated time and a secondary Refresh on the right. The attribution line sits under the chips in `type-muted` text. The Simulated sticker (same as Workflows) appears at the far right when `DISCOVER_SIMULATION` is on.
- The tab row is the design-system `Tabs` (no shadow, as every toggle). The open tab lives in `?tab=`.
- Groups are `AnalyticsPanel` cards (`bg-chrome`) with `PanelHeader` (Title Case title, a sentence sub-line that names the source and the place, an optional `aside` for the group menu). Cards and rows inside a group sit on `bg-inset` when they are read-only boxes, and on their own card layer when they are clickable cards.
- Card grid: `grid gap-4 sm:grid-cols-2 xl:grid-cols-4`. Rows: a simple list with `divide-y`.

## 3. The Place Chip

States, in the chip's own text:

| State | Chip text | Notes |
|---|---|---|
| First visit, time zone guess | "India, from your time zone" | a subtle `Badge variant="outline"` "Guess" after the text |
| Found by the browser | "Chennai, Tamil Nadu" | |
| Picked by search | "Kochi, Kerala" | |
| Workspace default | "Chennai, Tamil Nadu" with a small "Workspace" badge | Module 06 |
| Worldwide | "Worldwide" | |
| Resolving | "Finding your city..." with the chip disabled | |

The popover (design-system `Popover`, no shadow on the trigger since it is a dropdown):

```
+------------------------------------------------+
| [ (pin) Use My Location ]  secondary button     |
| We use your location once to find your city.   |
| We keep the city, not your position.           |
|                                                |
| Search For A City                              |
| [ Enter your city                    ] [Search]|
|   results (after Enter):                       |
|   Chennai, Tamil Nadu, India                   |
|   Chennai Port, Tamil Nadu, India              |
|                                                |
| [ Worldwide ]  secondary                        |
| ------------------------------------------------|
| Workspace default: Chennai, Tamil Nadu         |
| [ Save For This Workspace ]  (admins)          |
| Places by OpenStreetMap contributors           |
+------------------------------------------------+
```

- Denied: the sentence under Use My Location becomes an `Alert variant="warning"`: "Location is blocked in your browser. Search for your city instead." The field gets focus.
- Unavailable or timed out: same alert with "We could not find your location. Search for your city instead."
- Search results are a plain list (no second shadow), keyboard navigable, Enter picks the highlighted one.
- The language chip is a design-system `Select` styled as a chip; it lists `locality.newsLanguages` (the place's languages that have a News edition, which the API sends beside the full `languages`) in order with the native name and the English name ("தமிழ் Tamil").

## 4. Cards And Rows

**Trend card**: image (16:9, lazy, `referrerpolicy="no-referrer"`, hidden on error; without an image the card is shorter, never a grey box), title in `type-heading text-base` with `dir="auto"`, meta line in `type-muted` ("500+ searches, 2 h ago"), up to three related headlines as small links with the publisher name after a comma, then the actions: **Create Post** (`Button variant="primary" size="sm"`), **Read** (secondary, only when a real URL exists), **Open** (a real link styled as a secondary button, external icon, new tab). An overflow menu holds **Draft In Copilot** (P2).

**Story card** (News): the same, with the publisher name and time in the meta line, and the related headlines when Google gives them.

**Wikipedia row**: rank, title (link), "{N} reads", **Create Post**, **Open**.

**Social chip**: the display name or `#tag`, the count, links out. Chips wrap; no shadow.

**Video card**: thumbnail, title, channel, "{N} views", **Open** (to YouTube), **Create Post**.

**Festival row**: date (dd MMM), name, `Badge` "Public Holiday" (success) or "Observance" (secondary), "in 3 days" in `type-muted`, **Plan A Post** (primary, small).

**Competitor row**: `Badge variant="outline"` for the kind (Blog, YouTube, Bluesky, Mastodon, News), title, time, **Create Post**, **Open**.

Hover: a card you click as a whole uses `pressSm`, the design system's standard press (it moves into its shadow), like Home's blog cards. A card that only holds buttons does not move; its buttons do. Nothing pulses.

## 5. The Create Post Sheet

A right-hand `Sheet` (wide, `max-w-xl`), opened from any Create Post or Plan A Post:

```
Create Post                                                    [x]
------------------------------------------------------------------
Brief                                   (bg-inset, read-only, 5 lines max, "Show more")
  Rising search in Tamil Nadu: "weather coimbatore" (500+ searches).
  Related: Heavy rain alert for Coimbatore (The Hindu); ...
------------------------------------------------------------------
Language        [ Tamil v ]
Channels        ( ) Instagram  ( ) LinkedIn  ( ) X          (the AI page's channel picker)
Tone            [ Personal ] [ Company ]                    ChoiceTiles
Format          [ One Short ] [ One Long ] [ Thread ]       ChoiceTiles
Image           ( ) Add an image (10 more credits)
------------------------------------------------------------------
5 credits, 44 left                              [ Draft With AI ]  (highlight)
```

- While drafting: the existing `GenerateProgress` (Research, Category, Hook, Writing) replaces the form; **Cancel** aborts the stream.
- Done: the existing `GenerateResult` with the parts, sources ("Backed By Research" lists the related headlines), **Open In Composer** and **Try Again**.
- Out of credits: the existing out-of-credits `Alert` with the reset date; Draft With AI disabled.
- The sheet is full height on phones.

## 6. The Reader Sheet

```
<- Back            Open in new tab
------------------------------------------------------------------
The Hindu  .  by A. Reporter  .  4 Nov 2026  .  3 min read     (dots are plain full stops in code, see below)
Heavy rain alert for Coimbatore
[ hero image ]
Article text ... (bg-inset, scrollable, dir="auto", max-w-prose)
------------------------------------------------------------------
[ Create Post From This ]  [ Open ]
```

Note: the meta line is written with commas or spaces in the code, never the middle dot. Failures replace the body with an `Alert variant="warning"` and one sentence, keeping Open.

## 7. Empty, Loading And Error States

| Where | What |
|---|---|
| Loading a tab | Skeleton groups with the footprint of three cards and five rows, `aria-busy` |
| A group refreshing in the background | nothing changes; the updated time ticks when it lands |
| A group with a stale copy | the sub-line ends with "Showing what we had from {N} minutes ago." |
| A group with nothing | hidden |
| A tab with nothing | `EmptyState` with the compass icon: "Nothing to show for {Place} right now." and "Try Again" |
| Videos without a key | `EmptyState`: "Trending videos are not set up for this PostGear." (no action for members; admins see "Ask your PostGear admin to add a YouTube key.") |
| Competitors empty | `EmptyState`: "No competitors yet. Add one by website to see what they publish." with **Add Competitor** |
| Festivals empty | `EmptyState`: "No festivals found for {Place} in the next 30 days." |
| API down | `ErrorState`: "Discover could not load. Try again." with **Try Again** |

## 8. Phone (under 640 px)

- Chips collapse to "Chennai" and "ta"; the attribution line stays.
- Tabs scroll horizontally with the active tab kept in view.
- Cards stack in one column; related headlines collapse to one line.
- Sheets are full height; the Create Post form scrolls; Draft With AI sticks to the bottom.
- Use My Location works on phones only over HTTPS; the hand check on a LAN IP uses search.

## 9. Motion And Accessibility

- Group refresh: a 200 ms fade on the items that changed, nothing else.
- Every chip, card action and sheet control is keyboard reachable; Escape closes the popover, then the sheet.
- Tabs announce as tabs; groups are `section`s with their heading; cards are `article`s with the title as the heading.
- `prefers-reduced-motion` turns the hover lift and the fade off.
- Item text carries `dir="auto"`; headlines in scripts Sora lacks render in the system font (the accepted exception).

## 10. Copy Rules

- Group titles are Title Case names ("Rising Searches In Tamil Nadu"); sub-lines are sentences ("Via Google Trends.").
- Button names: Create Post, Plan A Post, Read, Open, Use My Location, Search, Worldwide, Save For This Workspace, Draft With AI, Open In Composer, Try Again, Add Competitor, Create Post From This.
- Messages are sentences, one each, with the next step in them ("Search for your city instead.").
- Placeholders: "Enter your city", "Enter your page address", "Enter your competitor's website".
- Never "feed", "locality", "geocode", "source id", "payload", "API".

## 11. Design System Map

Discover builds no new look. Every piece above is something the app already has, checked against `http://localhost:3000/dev/components` and the code on 2026-11-05. `@postgear/ui` is the design system; paths are under `apps/web/src/components/`. If a piece here does not fit, change the design system and show it in the playground rather than making a one-off.

**Page**

| Piece | Use | Notes |
|---|---|---|
| Page spacing | `Stack gap="lg"` | |
| Actions row | `PageActions className="justify-between"` | its default is `justify-end` |
| Tab row | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` | the calendar's Day, Week, Month bar; never hand-made |
| Group | `AnalyticsPanel`, `PanelHeader` from `analytics/analytics-ui.tsx` | `PanelHeader` takes `title`, `id` (for `aria-labelledby`), `sub`, `aside`. Not `Panel` from `@postgear/ui` (the comic frame) and not `SectionHeader` |
| Read-only box in a group | `INSET` from `ai/ai-ui.tsx` | `rounded-lg border-2 border-outline bg-inset` |
| Card you click as a whole | `pressSm` on the card, as `home/blog-row.tsx` does | |
| Trend or story image | `AspectRatio` at 16 by 9 | leave it out when the image fails; never a grey box |
| Loading | `Skeleton` | `aria-busy` on the group |
| Nothing to show, could not load | `EmptyState`, `ErrorState` | take `icon`, `title`, `description`, and `action` or `actions` |
| Warnings | `Alert variant="warning"` | never a hand-made tint |
| Simulated sticker | `Badge variant="secondary"` | as `workflows/connection-picker.tsx` does |
| Guess, Workspace, kind badges | `Badge variant="outline"` | Public Holiday is `success`, Observance is `secondary` |
| Explaining a disabled button | `TooltipHint` | |
| Links inside a card | `Link` | related headlines, publisher names |

**Buttons**

| Piece | Use | Notes |
|---|---|---|
| Create Post, Plan A Post | `Button variant="primary" size="sm"` | see the open question below |
| Read, Refresh, Worldwide, Use My Location, Search, Try Again | `Button variant="secondary"` (`size="sm"` on cards) | `ghost` is only for icon-only controls that sit on a surface with its own border and shadow |
| Open | `buttonVariants({ variant: 'secondary', size: 'sm' })` on an `<a target="_blank" rel="noopener noreferrer">`, or `ActionLink` from `home/home-actions.tsx` | it goes somewhere, so it is a link, not a button |
| Group menu, overflow | `Button variant="ghost"` with a `MotionIcon`, opening a `DropdownMenu` | icon-only on a surface |
| Draft With AI | `Button variant="highlight"` | the only violet on the page |

**Place and language**

| Piece | Use | Notes |
|---|---|---|
| Place chip and popover | `Popover`, `PopoverTrigger`, `PopoverContent` | content defaults to `w-72`: pass a wider class. A dropdown, so no shadow on the trigger |
| City search | `Input`, `Button`, then `List` and `ListItem` for the results | not `Combobox` (it filters on every keystroke, which Nominatim's policy forbids) and not `SearchInput` (the one search is the top bar's). `ListItem` is `bg-secondary`, so pass `bg-inset` inside the popover |
| Language chip | `Select` and its parts | the trigger is `w-full h-11`: pass the chip's size. No shadow |

**Sheets**

| Piece | Use | Notes |
|---|---|---|
| Create Post, Reader | `Sheet`, `SheetContent` | right-hand, `max-w-md` by default: pass `max-w-xl` |
| Tone, Format | `ChoiceTiles` | the choice is the point of the form; not a toggle bar |
| Channels | the channel picker in `ai/generate-form.tsx` | move it to its own file rather than copying it |
| Credits | `CreditsMeter`, `CreditsChip` from `ai/credits-meter.tsx` | |
| Drafting, done | `GenerateProgress`, `GenerateResult` from `ai/` | |
| AI not set up | `AiUnavailable` from `ai/ai-unavailable.tsx` | |

**Icons**: anything you click uses `MotionIcon` with an icon from `@animateicons/react`; decorative and state icons stay lucide.

**Open question for Arvind**: the comment on `buttonVariants` says "one blue primary per area", and section 4 puts a blue Create Post on every card, up to ten in a group. Either each card counts as its own area (the blueprint as written), or Create Post is `secondary` with its yellow hover, and the page stays as calm as section 1 asks. Recommendation: secondary on cards, because the same action on every card is not a call to action, and Draft With AI is the one that matters. Module 03 builds what is written unless you choose otherwise.
