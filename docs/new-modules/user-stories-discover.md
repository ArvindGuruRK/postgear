# 📋 User Stories: Discover (Trending Content Where Your Audience Is)

> **Module**: Discover, location-aware trending content that feeds AI post creation
> **Build spec**: [`../sprint-documents/sprint-11-discover.md`](../sprint-documents/sprint-11-discover.md)
> **Research**: [`../sprint-11/README.md`](../sprint-11/README.md)
> **Last Updated**: 2026-11-05
> **Format**: `As a [persona], I want [action], so that [benefit]`, then acceptance criteria, priority and story points, the same format as [`../../user_stories.md`](../../user_stories.md)

How to use this document:
- **Section 2** shows how real people will use Discover, start to finish. Read it first.
- **Section 3** is the story list. Each acceptance criterion is something you can see or click.
- **Section 4** is the UX rulebook for this module. Discover shows other people's content and asks for a person's location, so most of these rules are about trust and honesty.
- **Section 6** is the final checklist for sprint close-out.

---

## 1. Personas

| ID | Persona | Who they are | What they want from Discover |
|---|---|---|---|
| 👤 SC | **Solo Creator** | Priya runs a small yoga studio in Chennai and posts in Tamil and English. | Something to post about today that her neighbours care about, without reading ten news sites. |
| 👤 MM | **Marketing Manager** | Karthik markets a B2B SaaS product from Bangalore to customers across India. | Industry news and what three competitors are saying, turned into posts fast. |
| 👤 AO | **Agency Owner** | Meera's agency runs 8 client brands in Chennai, Kochi, Dubai and Singapore. | Each client workspace tuned to its own city and language, so the team never posts a Chennai festival on the Dubai account. |
| 👤 TM | **Team Member** | Arun, on Meera's team, drafts posts for clients. | A quick way to draft from a trend, in the client's language, without being allowed to change the client's saved place. |
| 👤 AD | **Workspace Admin** | Meera, as admin. | Only admins set a workspace's place, languages and competitors. |

---

## 2. Real User Journeys

### Journey A: Priya finds Deepavali and a Tamil trend 🪔

1. Priya clicks **Discover** in the rail. The chip says "India, from your time zone. Use My Location for your city." Trending already shows India-wide rising searches.
2. She clicks the chip and presses **Use My Location**. Under the button it says "We use your location once to find your city. We keep the city, not your position." The browser asks; she allows. The chip now says "Chennai, Tamil Nadu" and the language chip says "Tamil".
3. Trending refreshes: "Rising searches in Tamil Nadu" shows "weather coimbatore" (500+ searches) and a Tamil film title, with two related headlines under each. Below, "What people are reading on Tamil Wikipedia" lists Thirukkural and Deepavali.
4. She opens **Festivals**. "Deepavali, in 3 days, Public Holiday" is first, then Karthigai Deepam and Christmas.
5. She presses **Plan A Post** on Deepavali. The Create Post sheet opens with the brief "Deepavali on Sunday 8 November in Chennai", Language "Tamil", her Instagram channel ticked, Tone Personal, Format One Short, and "5 credits, 44 left".
6. She presses **Draft With AI**. The progress shows Research, Hook, Writing. The result is a Tamil post with a Deepavali greeting and a yoga angle. She presses **Open In Composer**; the composer opens on 7 November with the draft in it.
7. She comes back the next day on her phone. The chip still says Chennai, because the page remembered.

### Journey B: Karthik watches three competitors 🔎

1. Karthik opens **Competitors**. The tab is empty: "No competitors yet. Add one by website to see what they publish."
2. He presses **Add Competitor**, types the name "Acme Analytics" and the website. PostGear finds two feeds on the site ("Blog, RSS" and "Changelog, Atom") and shows them ticked. He adds the YouTube channel id and the Bluesky handle, and saves.
3. The tab now shows "Latest from Acme Analytics": a blog post from yesterday, a YouTube video, two Bluesky posts and one news mention from Google News. Each row has **Create Post** and **Open**.
4. He presses **Create Post** on the blog post. The brief says "Acme Analytics published: 'Five ways to cut churn'. Write our own take, not a summary of theirs." He picks English and LinkedIn, drafts, and opens the composer.
5. A week later the YouTube feed answers 404 for an hour. The row says "YouTube could not be reached. Showing what we had from 2 hours ago." Nothing else on the page is affected.

### Journey C: Meera's clients in four cities 🌍

1. Meera opens the Kochi client's workspace, clicks the chip, searches "Kochi" and presses Enter. One result: "Kochi, Kerala, India". She picks it, and presses **Save For This Workspace**. The chip says "Kochi, Kerala" and the language chip says "Malayalam".
2. She does the same for Dubai ("Arabic, English") and Singapore ("English, Chinese, Malay, Tamil").
3. Arun opens the Dubai workspace on his laptop for the first time. The chip already says "Dubai" and the language chip "Arabic". He switches the language chip to English for the day; the workspace default stays Arabic.
4. Arun tries **Save For This Workspace**. The button is disabled with the tooltip "Only workspace admins can change the workspace place."
5. In Settings, Discover, Meera turns off "Worldwide on Bluesky and Mastodon" for the Dubai client. The group disappears for everyone in that workspace.

### Journey D: Something goes wrong, and it's easy to fix 🛟

- Priya denied location once by mistake. The popover says "Location is blocked in your browser. Search for your city instead." with the search field focused. She types "Chennai" and is done.
- Google Trends answers 429 for a while. The Trending tab still shows the Wikipedia and Worldwide groups, and "Rising searches" shows the copy from 25 minutes ago with "Showing what we had". No error page.
- Priya's credits run out. The Create Post sheet shows "You have used all your AI credits. They reset on 1 December." with the plan link; nothing is charged.
- Karthik adds a competitor whose website is on a private address. PostGear answers "This address is private or on your own network." and does not save it.
- Arun presses **Read** on a News story whose Google link cannot be resolved. The sheet says "We could not open this story here. Open it in a new tab instead." with the Open button.
- Meera's Dubai workspace has Arabic first. Headlines read right to left and render in the system's Arabic font, aligned correctly, with the Sora chips and buttons around them.

---

## 3. User Stories

### Epic DC-1: Open Discover And Choose A Place

#### DC-1.1: Open Discover From The Rail

> **As a** solo creator,
> **I want** a Discover item in the rail,
> **So that** I can see what is trending without leaving PostGear.

**Acceptance Criteria:**
- [ ] The rail shows **Discover** with an animated icon; the top bar names the page "Discover".
- [ ] The page opens with a `PageActions` row (place chip, language chip, updated time, Refresh) and the tabs **Trending**, **News**, **Videos**, **Festivals**, **Competitors**. No in-page title.
- [ ] On a phone, Discover is reachable from the **More** menu (or the tab bar if Arvind places it in the first four).

**Priority**: P0 | **Story Points**: 2

#### DC-1.2: A First Guess From My Time Zone

> **As a** new user,
> **I want** Discover to show something for my country before I click anything,
> **So that** the page is never empty.

**Acceptance Criteria:**
- [ ] With no saved or remembered place, the chip says "{Country}, from your time zone. Use My Location for your city." and Trending shows country-level groups.
- [ ] No browser prompt appears on load.
- [ ] If the time zone matches no country, the chip says "Worldwide" and only the worldwide groups show.

**Priority**: P0 | **Story Points**: 2

#### DC-1.3: Use My Location

> **As a** solo creator,
> **I want** to press one button and have Discover find my city,
> **So that** I see local trends without typing.

**Acceptance Criteria:**
- [ ] The place popover has **Use My Location** with the sentence "We use your location once to find your city. We keep the city, not your position." under it.
- [ ] The browser prompt appears only after the click.
- [ ] On success the chip shows "{City}, {Region}" within a few seconds and the language chip changes to the place's first language.
- [ ] Denied: "Location is blocked in your browser. Search for your city instead." and the search field is focused. Unavailable or timed out: "We could not find your location. Search for your city instead."
- [ ] The position is rounded to two decimals in the browser before it is sent, and nothing stores it (no row, no log line with coordinates).
- [ ] "Places by OpenStreetMap contributors" is visible under the chip and in the popover.

**Priority**: P0 | **Story Points**: 5

#### DC-1.4: Search For A City

> **As a** team member,
> **I want** to type a city and pick it from a short list,
> **So that** I can set a client's place without being there.

**Acceptance Criteria:**
- [ ] The popover has a field with the placeholder "Enter your city"; results appear after **Enter** or the **Search** button, never while typing.
- [ ] Up to eight results, each as "City, Region, Country"; picking one updates the chips.
- [ ] No results: "No places found for '{text}'. Try the city's English name."
- [ ] Too many searches in a minute: "Try again in a moment."

**Priority**: P0 | **Story Points**: 3

#### DC-1.5: Remember My Choice

> **As a** solo creator,
> **I want** Discover to remember the place and language I chose,
> **So that** I do not set it again tomorrow.

**Acceptance Criteria:**
- [ ] After a reload the chips show the last choice (kept per workspace in the browser).
- [ ] Switching workspaces switches the remembered choice.
- [ ] **Worldwide** is a choice too and is remembered.

**Priority**: P0 | **Story Points**: 2

#### DC-1.6: Save For This Workspace

> **As a** workspace admin,
> **I want** to save a place and languages as the workspace default,
> **So that** everyone on the team starts from the client's city.

**Acceptance Criteria:**
- [ ] Admins see **Save For This Workspace** in the popover; after saving, the popover shows "Workspace default: {City}".
- [ ] Members see the button disabled with "Only workspace admins can change the workspace place."
- [ ] A member on a new device starts from the workspace default; their own later choice is remembered on that device without changing the default.
- [ ] Settings, Discover shows the same place, the ordered languages, news topics and source switches, with the optimistic save and a "Saved" toast.

**Priority**: P1 | **Story Points**: 5

#### DC-1.7: Switch Language

> **As a** solo creator,
> **I want** a language chip with the languages of my place,
> **So that** I can read Tamil news or English news with one click.

**Acceptance Criteria:**
- [ ] The language chip lists the place's languages in order (Tamil Nadu: Tamil, English); the first is selected after a place change.
- [ ] Changing it reloads News in that language and sets the default language in the Create Post sheet.
- [ ] A language that Google News has no edition for is not offered in the chip (the AI may still write it in the sheet).

**Priority**: P0 | **Story Points**: 3

### Epic DC-2: Trending

#### DC-2.1: Rising Searches Where I Am

> **As a** solo creator,
> **I want** to see what people near me are searching for right now,
> **So that** I can post about it while it is hot.

**Acceptance Criteria:**
- [ ] The group "Rising searches in {Region}" shows up to ten cards: the search term, "{N}+ searches", the time, an image when there is one, and up to three related headlines with publisher names.
- [ ] When the region has no feed, the group says "Rising searches in {Country}" instead.
- [ ] The group footer says "via Google Trends".
- [ ] **Open** on a card goes to the first related story's publisher page; **Create Post** opens the sheet with the term and the headlines as the brief.

**Priority**: P0 | **Story Points**: 5

#### DC-2.2: What People Are Reading On Wikipedia

> **As a** marketing manager,
> **I want** the most-read Wikipedia articles in my audience's language,
> **So that** I know what topics are on their minds this week.

**Acceptance Criteria:**
- [ ] The group "What people are reading on {Language} Wikipedia" lists up to ten rows with the article title and "{N} reads yesterday"; the main page, special pages and namespace pages never appear.
- [ ] Each row links to the article; the footer says "Wikipedia, text CC BY-SA".
- [ ] The group is hidden, not errored, when the edition has no data yet.

**Priority**: P1 | **Story Points**: 3

#### DC-2.3: Worldwide Social Topics

> **As a** marketing manager,
> **I want** to see what is trending on Bluesky and Mastodon,
> **So that** I catch worldwide conversations too.

**Acceptance Criteria:**
- [ ] The group "Worldwide on Bluesky and Mastodon" shows topic chips (Bluesky: the display name and "{N} posts"; Mastodon: "#tag" and "{N} uses this week"), each linking out.
- [ ] The group is clearly labelled Worldwide and never claims to be local.
- [ ] Either source being down hides its chips only.

**Priority**: P1 | **Story Points**: 3

#### DC-2.4: A Resting Source Does Not Break The Page

> **As a** solo creator,
> **I want** the page to keep working when one source is down,
> **So that** I am never looking at an error page.

**Acceptance Criteria:**
- [ ] A group whose source failed shows its last copy with "Showing what we had from {N} minutes ago".
- [ ] A group with no copy at all is hidden; if every group in a tab is hidden, the tab shows "Nothing to show for {Place} right now. Try again in a few minutes." with a **Try Again** button.
- [ ] The updated time in the actions row reflects the oldest group shown.

**Priority**: P0 | **Story Points**: 3

### Epic DC-3: News

#### DC-3.1: My City's Stories In My Language

> **As a** solo creator,
> **I want** today's stories about my city in my language,
> **So that** my posts feel local.

**Acceptance Criteria:**
- [ ] The group "{City} stories" shows cards with the headline (right-to-left scripts aligned correctly), the publisher, the time, and related headlines when the feed gives them.
- [ ] A second group "Top stories in {Country}" follows.
- [ ] Every card has **Open** (goes to the story), **Read** (opens the reader sheet), **Create Post**.
- [ ] The tab footer says "via Google News".

**Priority**: P0 | **Story Points**: 5

#### DC-3.2: Pick A Topic

> **As a** marketing manager,
> **I want** to narrow News to Business or Technology,
> **So that** I see my industry, not sport.

**Acceptance Criteria:**
- [ ] A **Topic** select above the groups offers All, World, Nation, Business, Technology, Entertainment, Sports, Science, Health.
- [ ] Picking one adds a "{Topic} in {Country}" group and keeps the city group.
- [ ] The choice is remembered with the place; a saved workspace topic list (DC-1.6) sets the default.

**Priority**: P1 | **Story Points**: 3

### Epic DC-4: Create Post

#### DC-4.1: Create A Post From Any Item

> **As a** solo creator,
> **I want** one button that turns a trend or story into a draft,
> **So that** going from "that's interesting" to "that's scheduled" takes a minute.

**Acceptance Criteria:**
- [ ] **Create Post** opens a right-hand sheet with the brief preview (read-only, `bg-inset`), **Language**, **Channels**, **Tone**, **Format**, the credits meter, and **Draft With AI**.
- [ ] Draft With AI streams progress (Research, Hook, Writing) and shows the result with **Open In Composer** and **Try Again**.
- [ ] The research step lists the item's related headlines as sources, with their links.
- [ ] The brief never contains HTML, control characters, or more than 1,800 characters.

**Priority**: P0 | **Story Points**: 8

#### DC-4.2: Draft In The Local Language

> **As a** solo creator,
> **I want** the draft written in Tamil when I choose Tamil,
> **So that** I do not translate by hand.

**Acceptance Criteria:**
- [ ] The **Language** select offers the place's languages plus English; the default follows the language chip.
- [ ] The draft comes back in that language, with brand names and hashtags left as they are.
- [ ] Under `AI_SIMULATION` the simulated draft states the requested language in its text so the hand check can see it.

**Priority**: P0 | **Story Points**: 3

#### DC-4.3: The Draft Opens In The Composer

> **As a** team member,
> **I want** the draft to land in the composer with the channels I picked,
> **So that** I finish it where I always do.

**Acceptance Criteria:**
- [ ] **Open In Composer** creates a draft (state Draft) and opens `/composer?group=...` with the text and the picked channels.
- [ ] A festival draft opens the composer on the festival's date (the day before when the festival is a public holiday).
- [ ] Closing the sheet without opening the composer leaves no draft behind.

**Priority**: P0 | **Story Points**: 3

#### DC-4.4: Credits Are Honest

> **As a** workspace admin,
> **I want** each draft to cost the usual 5 credits and nothing when it fails,
> **So that** Discover does not surprise my bill.

**Acceptance Criteria:**
- [ ] The sheet shows "5 credits, {N} left" before drafting and the new balance after.
- [ ] A failed draft refunds the charge and the meter shows the refund.
- [ ] Out of credits: the existing message with the reset date, and **Draft With AI** is disabled.

**Priority**: P0 | **Story Points**: 2

#### DC-4.5: The Quick Path

> **As a** marketing manager,
> **I want** a "Draft In Copilot" link on a card,
> **So that** I can use the full AI page when I want more control.

**Acceptance Criteria:**
- [ ] The card's overflow menu has **Draft In Copilot**, which opens the AI page with the brief prefilled as the topic.

**Priority**: P2 | **Story Points**: 1

### Epic DC-5: Festivals

#### DC-5.1: What Is Coming Up

> **As a** solo creator,
> **I want** the festivals and holidays of the next 30 days for my place,
> **So that** I plan posts ahead.

**Acceptance Criteria:**
- [ ] The Festivals tab lists rows by date: date, name, a **Public Holiday** or **Observance** badge, "in {N} days" (or "today", "tomorrow", "{N} days ago" for the past week).
- [ ] The list merges the country's holiday calendar with `date-holidays` (country and region) and shows one row per occasion.
- [ ] The footer says "Dates from public holiday calendars and date-holidays (CC BY-SA)".
- [ ] Empty: "No festivals found for {Place} in the next 30 days."

**Priority**: P0 | **Story Points**: 5

#### DC-5.2: Plan A Post For The Day

> **As a** solo creator,
> **I want** Plan A Post on a festival,
> **So that** the draft is scheduled for the right day.

**Acceptance Criteria:**
- [ ] **Plan A Post** opens the Create Post sheet with the festival brief (name, date, place) and, after Open In Composer, the composer opens on the festival date.

**Priority**: P0 | **Story Points**: 2

### Epic DC-6: Videos

#### DC-6.1: Trending Videos In My Country

> **As a** marketing manager,
> **I want** the most popular YouTube videos in my country,
> **So that** I see what formats are working.

**Acceptance Criteria:**
- [ ] With `YOUTUBE_API_KEY` set, the Videos tab shows up to 25 cards: thumbnail, title, channel, views, published time, **Open** (to YouTube), **Create Post**.
- [ ] Without the key, the tab says "Trending videos are not set up for this PostGear." (and the status endpoint says `videos: false`).
- [ ] Past the daily budget, the tab says "YouTube is resting until tomorrow. Showing what we had." with the last copy.

**Priority**: P1 | **Story Points**: 3

### Epic DC-7: Competitors

#### DC-7.1: Add A Competitor By Website

> **As a** marketing manager,
> **I want** to add a competitor by name and website,
> **So that** PostGear finds their blog for me.

**Acceptance Criteria:**
- [ ] **Add Competitor** opens a dialog with Name and Website; after the website is entered, PostGear lists the feeds it found (title and kind) with checkboxes, or "No feeds found. You can paste a feed address."
- [ ] A private or unsafe address answers "This address is private or on your own network." and nothing is saved.
- [ ] The dialog also takes a YouTube channel id, a Bluesky handle, a Mastodon account and a news search phrase (defaulting to the name).
- [ ] A workspace can have 20 competitors; the 21st shows "You can follow up to 20 competitors."

**Priority**: P1 | **Story Points**: 5

#### DC-7.2: Latest From Each Competitor

> **As a** marketing manager,
> **I want** to see what each competitor published this week,
> **So that** I can respond with our own angle.

**Acceptance Criteria:**
- [ ] The tab shows one group per competitor, "Latest from {Name}", with rows: kind badge (Blog, YouTube, Bluesky, Mastodon, News), title, time, **Create Post**, **Open**.
- [ ] A feed that failed shows "{Kind} could not be reached. Showing what we had from {N} hours ago." in that group only.
- [ ] **Create Post** uses a brief that says to write our own take, not a summary.

**Priority**: P1 | **Story Points**: 5

#### DC-7.3: Edit Or Remove A Competitor

> **As a** workspace admin,
> **I want** to edit a competitor's feeds or remove them,
> **So that** the list stays current.

**Acceptance Criteria:**
- [ ] The group header menu has **Edit** (members) and **Remove** (admins, solid red, confirm: "Remove Acme Analytics? Their items disappear from Discover.").
- [ ] Removing is a soft delete; the API returns 404 for the id afterwards.

**Priority**: P1 | **Story Points**: 2

### Epic DC-8: Read A Page

#### DC-8.1: Read A Story Without Leaving

> **As a** solo creator,
> **I want** to read a story in a side panel,
> **So that** I stay in my flow.

**Acceptance Criteria:**
- [ ] **Read** opens a sheet with the title, site name, byline, date, reading time, the hero image and the article text.
- [ ] The text is fetched safely (private addresses refused), capped at 1 MB and 10 seconds, and never stored in the database.
- [ ] The footer has **Create Post From This** and **Open**.

**Priority**: P1 | **Story Points**: 5

#### DC-8.2: Kind Failures

> **As a** team member,
> **I want** a clear sentence when a page cannot be read,
> **So that** I know what to do next.

**Acceptance Criteria:**
- [ ] "This page is private or on your own network.", "We could not read this page. Open it in a new tab instead.", "This page is not an article." are the only failure sentences, each with **Open**.
- [ ] A Google News link that cannot be resolved shows "We could not open this story here. Open it in a new tab instead."
- [ ] More than ten reads a minute: "Try again in a moment."

**Priority**: P1 | **Story Points**: 2

#### DC-8.3: Paste Any Address

> **As a** marketing manager,
> **I want** to paste any article address into Discover,
> **So that** I can draft from something a colleague sent me.

**Acceptance Criteria:**
- [ ] The News tab has a **Read A Page** button that opens the reader sheet with an address field (placeholder "Enter your page address"); the same rules as DC-8.1 and DC-8.2 apply.

**Priority**: P2 | **Story Points**: 2

---

## 4. UX Best Practices For This Module

| # | Principle | What it means in Discover |
|---|---|---|
| 1 | **Ask for location like a person would** | One button, a plain sentence about what happens, a prompt only after the click, and a typed-city path that is always there. |
| 2 | **Say where things come from** | Every group names its source and place; every card links out and names the publisher; OpenStreetMap is credited under the chip. |
| 3 | **Never an error page** | A resting source shows its last copy or hides its group; the page always has something or a plain sentence with Try Again. |
| 4 | **Local means local** | Groups that are worldwide say Worldwide; a country fallback says the country, not the region. |
| 5 | **The draft is ours, not theirs** | Briefs ask for our own take; competitor briefs say so; nothing republishes an article. |
| 6 | **Honest credits** | The cost is shown before, the balance after, refunds on failure. |
| 7 | **Keep the place, not the position** | Rounded in the browser, used once, never stored; the sentence says so. |
| 8 | **Scripts look right** | `dir="auto"` on item text; system fonts for scripts Sora lacks; chips and buttons stay in Sora. |
| 9 | **No filler** | No in-page title, no tagline, no decorative pills; the top bar names the page; attribution lines are the only small print. |
| 10 | **Same words everywhere** | place, trend, story, festival, competitor; never locality, feed, source id, geocode. |

---

## 5. Edge Cases And Expected Behaviour

| Situation | What the user sees |
|---|---|
| Location permission denied | "Location is blocked in your browser. Search for your city instead." and the field is focused |
| Position found but Nominatim is down | "We could not find your city right now. Search for it instead." (search also down: "Places are not available right now. Try again in a few minutes.") |
| Nominatim turned off (`DISCOVER_GEOCODER=off`) | The popover shows a country and region picker instead of Use My Location and search |
| Region has no Trends feed | "Rising searches in {Country}" |
| Country has no Google News edition | "Top stories" in English from the world edition plus the city feed |
| Place feed is empty | Only the country group shows |
| Google answers 429 or a consent page | Breaker opens; stale copy with "Showing what we had"; other groups unaffected |
| Wikipedia has no data for yesterday yet | The day before is used; if neither, the group is hidden |
| YouTube key missing | "Trending videos are not set up for this PostGear." |
| YouTube budget spent | "YouTube is resting until tomorrow. Showing what we had." |
| Holiday calendar id missing for the country | `date-holidays` only; if that has nothing, the empty state |
| A festival is also an observance in another calendar | One row, the stronger badge (Public Holiday) wins |
| Competitor website has no feed | "No feeds found. You can paste a feed address." |
| Competitor feed is huge or malformed | Capped at 1 MB; "{Kind} could not be read." in that group |
| Reader hits a paywall or a login page | "We could not read this page. Open it in a new tab instead." |
| Reader URL is private | "This page is private or on your own network." |
| Google News link cannot be resolved | "We could not open this story here. Open it in a new tab instead." |
| Out of AI credits | The existing message with the reset date; Draft With AI disabled |
| Draft fails after charging | Refund; "Something went wrong while drafting. Your credits were not used." |
| Member tries Save For This Workspace | Disabled with "Only workspace admins can change the workspace place." |
| Simulation on | A small **Simulated** sticker in the actions row (like Workflows); fixtures for Chennai, San Francisco, Paris; other places answer Worldwide |
| Arabic or Hebrew place | Headlines right to left, aligned right, Sora chips unchanged |

---

## 6. Completion Checklist ✅

**Epic DC-1: Open Discover And Choose A Place**
- [ ] DC-1.1 Open Discover From The Rail
- [ ] DC-1.2 A First Guess From My Time Zone
- [ ] DC-1.3 Use My Location
- [ ] DC-1.4 Search For A City
- [ ] DC-1.5 Remember My Choice
- [ ] DC-1.6 Save For This Workspace (P1)
- [ ] DC-1.7 Switch Language

**Epic DC-2: Trending**
- [ ] DC-2.1 Rising Searches Where I Am
- [ ] DC-2.2 What People Are Reading On Wikipedia (P1)
- [ ] DC-2.3 Worldwide Social Topics (P1)
- [ ] DC-2.4 A Resting Source Does Not Break The Page

**Epic DC-3: News**
- [ ] DC-3.1 My City's Stories In My Language
- [ ] DC-3.2 Pick A Topic (P1)

**Epic DC-4: Create Post**
- [ ] DC-4.1 Create A Post From Any Item
- [ ] DC-4.2 Draft In The Local Language
- [ ] DC-4.3 The Draft Opens In The Composer
- [ ] DC-4.4 Credits Are Honest
- [ ] DC-4.5 The Quick Path (P2)

**Epic DC-5: Festivals**
- [ ] DC-5.1 What Is Coming Up
- [ ] DC-5.2 Plan A Post For The Day

**Epic DC-6: Videos**
- [ ] DC-6.1 Trending Videos In My Country (P1)

**Epic DC-7: Competitors**
- [ ] DC-7.1 Add A Competitor By Website (P1)
- [ ] DC-7.2 Latest From Each Competitor (P1)
- [ ] DC-7.3 Edit Or Remove A Competitor (P1)

**Epic DC-8: Read A Page**
- [ ] DC-8.1 Read A Story Without Leaving (P1)
- [ ] DC-8.2 Kind Failures (P1)
- [ ] DC-8.3 Paste Any Address (P2)

**UX And Quality Gates**
- [ ] Every group shows its source and place; OpenStreetMap credited under the chip
- [ ] No coordinates stored or logged; the consent sentence is shown before the click
- [ ] Every upstream call goes through the SSRF-guarded fetch; private addresses refused with a sentence
- [ ] `DISCOVER_SIMULATION=true` runs every screen offline; `e2e/discover.spec.ts` passes
- [ ] Light, dark, Lilac and phone width checked; Tamil, Arabic and Japanese items render correctly
- [ ] Title Case names, sentence-case messages, "Enter your ..." placeholders, no em dash, no middle dot
- [ ] Completion checklist written with the `sprint-closeout` skill

---

## 7. How We Know It Works (After Launch)

| Measure | Target |
|---|---|
| Users who open Discover and set a place in the first session | 60% |
| Drafts started from Discover as a share of all AI drafts | 25% within a month |
| Discover drafts that reach the composer | 70% of drafts started |
| Feed answers served from cache | 90% or more |
| Upstream errors shown as an error page | 0 (always stale copy or hidden group) |
| Nominatim requests a day across the deployment | under 2,000 (well inside the policy) |
| Paid API calls | 0 |
