You are working on PostGear, a Next.js SaaS application.

Sprint 0 is focused on building a complete, production-ready Design System before feature development begins.

I already have an initial design system implemented under src/components, including components such as:

- Avatar
- Badge
- Button
- Card
- Checkbox
- Dialog
- Dropdown Menu
- Input
- Select
- Toast
- Toaster
- Toggle

I also already have design tokens, theme support, application shell/navigation, icons, and light/dark mode.

IMPORTANT:
Do NOT replace, rewrite, or unnecessarily restructure the existing design system.

First inspect the entire repository and understand:
1. Existing components
2. Existing design tokens
3. Existing theme implementation
4. Existing typography
5. Existing spacing/radius/shadow rules
6. Existing icon system
7. Existing variants and states
8. Existing component APIs
9. Existing naming conventions
10. Existing NeoBrutalist visual language

Then identify what is missing and extend the system.

The goal is to create an AMAZING, cohesive, production-ready SaaS Design System for PostGear.

==================================================
DESIGN LANGUAGE
==================================================

The entire system must follow a strong NeoBrutalism aesthetic.

The design language should feel:

- Bold
- Playful
- High contrast
- Editorial
- Confident
- Slightly unconventional
- Highly interactive
- Extremely clear
- Modern SaaS rather than generic UI

Maintain the existing visual identity from the current Design System playground.

Preserve and consistently apply:

- Thick black borders
- Hard/brutalist shadows
- Strong contrast
- Bold typography
- Slightly playful typography
- Strong primary/secondary/accent colors
- Pressed interaction states
- Clear hover states
- Distinct disabled states
- Consistent corner-radius rules
- Light and dark themes
- Keyboard accessibility
- Focus-visible states

Do NOT turn the design system into a generic shadcn/Tailwind-looking interface.

NeoBrutalism should be a SYSTEM, not decoration.

==================================================
COMPONENT AUDIT
==================================================

Audit the current implementation and extend it with missing reusable primitives.

Prioritize these areas:

FOUNDATION
- Typography
- Heading styles
- Text styles
- Link
- Label
- Separator
- Spacer
- Container
- Stack
- Grid
- Aspect Ratio

FORM CONTROLS
- Textarea
- Radio Group
- Form Field
- Form Label
- Helper Text
- Error Message
- Combobox
- Search Input
- Multi Select
- Slider
- Range Slider
- Date Picker
- Date Range Picker
- File Upload
- Input OTP if useful

NAVIGATION
- Tabs
- Breadcrumb
- Pagination
- Navigation Menu
- Command Menu
- Sidebar
- Navbar
- Menu
- Context Menu

OVERLAYS
- Popover
- Tooltip
- Drawer / Sheet
- Confirmation Dialog
- Alert Dialog
- Hover Card

FEEDBACK
- Alert
- Progress
- Spinner
- Skeleton
- Loading State
- Empty State
- Error State
- Success State

DATA DISPLAY
- Table
- Data Table
- Status Indicator
- KPI / Stat Card
- Timeline
- Accordion
- Collapsible
- List
- List Item
- Avatar Group

SAAS-SPECIFIC PATTERNS
- Page Header
- Section Header
- Filter Bar
- Search + Filter Toolbar
- Data Table Toolbar
- Sort Control
- View Switcher
- Bulk Action Bar
- Command Palette
- User Menu
- Workspace / Organization Switcher
- Notification Center
- Activity Feed
- Upgrade / Plan Card
- Pricing Card
- Usage Meter
- Settings Navigation
- Onboarding Stepper

==================================================
COMPONENT QUALITY
==================================================

Every component must be production-quality.

Each component should have:

- Strong TypeScript types
- Consistent APIs
- Consistent naming
- Variants where appropriate
- Sizes where appropriate
- Disabled state
- Loading state where appropriate
- Hover state
- Active/pressed state
- Focus-visible state
- Error state where appropriate
- Dark mode support
- Keyboard accessibility
- ARIA attributes where required
- Responsive behavior

Do not create unnecessary variants.

Only expose variants that make sense for the component.

==================================================
DESIGN SYSTEM RULES
==================================================

Create clear rules for:

1. Typography hierarchy
2. Spacing scale
3. Component heights
4. Border thickness
5. Border radius
6. Brutalist shadow depth
7. Color usage
8. Interaction states
9. Focus states
10. Disabled states
11. Error states
12. Responsive behavior
13. Dark mode
14. Icon sizing
15. Icon/text alignment
16. Form layout
17. Density
18. Motion/animation

All components must consume the existing design tokens.

Do NOT hardcode random colors, spacing, shadows, radii, or typography values inside individual components when an existing token should be used.

If a required token is genuinely missing, extend the token system rather than introducing a one-off value.

==================================================
INTERACTION LANGUAGE
==================================================

Create a consistent interaction model across the entire system.

For example:

Default:
normal NeoBrutalist border + shadow

Hover:
subtle movement/shadow change

Pressed:
hard shadow collapses and element visibly shifts

Focus:
strong accessible focus indicator

Disabled:
reduced contrast + no interaction

Loading:
preserve component dimensions while showing loading feedback

Make interactions feel consistent across Buttons, Inputs, Cards, Menus, Dialogs, Tabs, etc.

==================================================
RESPONSIVENESS
==================================================

The system must work across:

- Desktop
- Laptop
- Tablet
- Mobile

Do not design desktop-only components.

Pay particular attention to:

- Sidebar collapse
- Navigation
- Tables
- Dialogs
- Drawers
- Forms
- Filter bars
- Toolbars
- Data-heavy SaaS screens

==================================================
DESIGN SYSTEM PLAYGROUND
==================================================

The existing Design System page should become the central visual documentation/playground.

Extend it so that every component can be visually inspected.

For each component show:

- Component name
- Short description
- Variants
- Sizes
- States
- Example usage
- Interactive example
- Light theme
- Dark theme

Organize the playground into logical sections:

FOUNDATIONS
LAYOUT
BUTTONS
FORM CONTROLS
NAVIGATION
OVERLAYS
FEEDBACK
DATA DISPLAY
SAAS PATTERNS

The playground should itself demonstrate the quality of the design system.

==================================================
IMPORTANT IMPLEMENTATION RULE
==================================================

Before creating anything:

1. Inspect the repository.
2. Inspect the existing components.
3. Inspect existing tokens.
4. Inspect existing Design System playground.
5. Identify what already exists.
6. Identify duplication.
7. Identify missing primitives.
8. Reuse existing architecture wherever possible.

Then implement only what is missing or needs improvement.

Do not create duplicate components.

Do not break existing application functionality.

Do not modify product-specific pages unless required to integrate the design system.

==================================================
FINAL GOAL
==================================================

When Sprint 0 is complete, PostGear should have a reusable UI foundation where future product pages can be built almost entirely from the Design System.

A future developer should be able to build:

Dashboard
Calendar
Analytics
SEO
Team
Settings
Content workflows
Social media workflows
Reporting
Billing
Onboarding

without inventing new visual styles for every page.

The result should feel like ONE coherent product.

Think of this as building the internal UI platform for PostGear, not simply adding a collection of React components.

At the end:

1. Run the application.
2. Verify the Design System playground.
3. Verify light/dark themes.
4. Verify responsive behavior.
5. Verify keyboard navigation.
6. Verify component states.
7. Verify TypeScript.
8. Verify lint/build.
9. Fix any issues discovered.

Do not stop after creating files.

Actually validate the finished Design System.

Most importantly:

PRESERVE THE EXISTING POSTGEAR NEO-BRUTALIST IDENTITY AND EVOLVE IT INTO A COMPLETE, CONSISTENT, PRODUCTION-READY SAAS DESIGN SYSTEM.