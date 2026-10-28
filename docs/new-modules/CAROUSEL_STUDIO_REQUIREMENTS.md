# PostGear Carousel Studio --- Detailed Requirements

## 1. Purpose

Carousel Studio lets a user create branded social-media graphics and
multi-slide carousels using reusable templates. It is a focused
content-design module inside PostGear, not a general-purpose freeform
design application.

## 2. Entry points

-   Add **Carousel Studio** to the left sidebar.
-   The landing page shows:
    -   **Create new** primary action.
    -   Recent designs.
    -   Saved templates/favorites.
    -   Search and filters.
    -   Empty state for new users.

Each recent design card should show thumbnail, title, updated date,
slide count, and status (Draft, Exported, or Ready to schedule where
applicable).

## 3. New design flow

### Step 1 --- Brand setup (skippable)

Fields: - Brand name (optional but recommended). - Website URL
(optional). - Logo upload (optional). - Primary, secondary, and accent
colors. - Optional brand notes.

Actions: - **Extract brand from website** when a URL is supplied. -
**Continue manually** when no URL is supplied. - **Skip for now** where
appropriate.

Website extraction requirements: - Validate the URL and restrict
requests to public HTTP/HTTPS destinations. - Protect against SSRF:
block localhost, private IP ranges, link-local addresses, cloud metadata
endpoints, and unsafe redirects. - Apply request timeouts, response-size
limits, content-type checks, and rate limits. - Extract only useful
public brand signals, such as page title, description, logo candidates,
and CSS color candidates where feasible. - Show a confirmation screen
with editable values before saving. - If extraction fails, explain why
and allow manual entry. Never block the user from continuing.

### Step 2 --- Choose design format

Offer: - Square: 1:1. - Portrait feed: 4:5. - Landscape: 16:9. -
Story/Reel: 9:16.

Treat dimensions as presets, not universal platform guarantees. Show
exact pixel dimensions and platform guidance from the current product
configuration. Do not claim that every platform accepts every format.

### Step 3 --- Template gallery

-   Start with 30--40 polished templates; architecture must scale to
    100+.
-   Categories may include Educational, Tips, Announcement, Product,
    Case Study, Listicle, Quote, Data/Statistics, Promotional, and
    Storytelling.
-   Search by template name and filter by category, format, color/style,
    and favorites.
-   Each card displays a thumbnail, name, category, slide count, and
    supported formats.
-   Selecting a template opens an editor with a new copy; never modify
    the shared template itself.
-   Provide a **Start from blank** option if supported.

### Step 4 --- Canvas editor

Layout: - Top toolbar: design title, save status, undo, redo, preview,
export, and schedule/send-to-queue action if available. - Left panel:
slide thumbnails and add/duplicate/delete/reorder slide controls. -
Center: canvas with the active slide. - Right panel: properties for
selected element, text, image, colors, typography, and layout.

Editable elements: - Eyebrow/kicker. - Headline. - Subheadline. - Body
text/list items. - Footer/CTA. - Logo and image. - Background, shape,
and accent decoration.

Editing behavior: - Inline text editing and accessible side-panel
fields. - Support only properties allowed by each template. - Keep
elements within their defined regions by default. If an element cannot
move outside a region, show clear boundaries and provide a helpful
interaction rather than silently snapping without feedback. - Maintain
readable text sizing and safe margins. - Prevent accidental element
overlap where the template requires fixed regions. - Provide undo/redo
and reset-to-template. - Autosave with a visible
Saved/Saving/Offline/Error indicator. Do not show "Saved" before
persistence succeeds. - Warn before navigating away if unsaved changes
remain.

### Step 5 --- Preview

-   Preview all slides in sequence.
-   Preview selected aspect ratio and safe margins.
-   Allow switching to a platform-style preview when supported.
-   Use illustrative engagement UI only when clearly marked as a mock
    preview.
-   Do not imply that a preview is a live post or that likes/comments
    are real.

### Step 6 --- Export and scheduling

-   Export supported image formats, initially PNG and/or JPEG based on
    existing stack.
-   Export all carousel slides in order.
-   Use consistent dimensions and filenames.
-   Show export progress and errors.
-   Offer **Send to Queue** or **Schedule** only through the existing
    PostGear publishing/scheduling path.
-   Require the user to choose destination accounts and confirm
    publishing details.
-   If direct publishing is unsupported for a chosen platform/account,
    explain the limitation and provide a usable export path.

## 4. Data model guidance

Reuse current persistence patterns. Suggested logical fields: - Design:
id, workspaceId, ownerId, title, brandProfileId, templateId,
aspectRatio, status, createdAt, updatedAt. - Slide: id, designId,
position, background, dimensions, elements. - Element: id, type,
content/assetRef, style, bounds, constraints, zIndex. - Template: id,
name, description, category, thumbnailRef, supportedRatios, slideSchema,
defaultTokens, version, isPublished. - BrandProfile: id, workspaceId,
name, websiteUrl, logoRef, colors, typography, notes.

Avoid storing large binary assets directly in relational JSON if the
project already uses object storage.

## 5. Accessibility and responsive behavior

-   All actions have accessible labels.
-   Keyboard users can reach slide controls and properties.
-   Provide visible focus states.
-   Do not communicate state using color alone.
-   On smaller screens, panels may collapse into drawers; keep the
    canvas usable.
-   Respect reduced-motion preferences.

## 6. Acceptance criteria

1.  A user can open Carousel Studio from the sidebar.
2.  A user can create a design without a website URL.
3.  A user can enter a website URL, inspect extracted brand values, and
    edit them before applying.
4.  A user can choose a format and filter/search the template gallery.
5.  Choosing a template creates an editable copy.
6.  A user can edit text, logo, colors, and supported layout properties.
7.  A user can add, reorder, duplicate, and delete slides.
8.  Save status reflects actual persistence state.
9.  Preview shows every slide and the chosen aspect ratio.
10. Export produces ordered image files at the selected dimensions.
11. Errors are recoverable and do not erase the user's work.
12. The module uses the same theme and navigation patterns as the
    existing PostGear dashboard.
