# 📋 User Stories: Workflow Builder (Visual Automations)

> **Module**: Workflow Builder, n8n-style automations for posting
> **Build spec**: [`../sprint-documents/sprint-10-workflow-builder.md`](../sprint-documents/sprint-10-workflow-builder.md)
> **Last Updated**: 2026-10-27
> **Format**: `As a [persona], I want [action], so that [benefit]`, then acceptance criteria, priority and story points, the same format as [`../../user_stories.md`](../../user_stories.md)

How to use this document:
- **Section 2** shows how real people will use Workflows, start to finish. Read it first.
- **Section 3** is the story list. Each acceptance criterion is something you can see or click.
- **Section 4** is the UX rulebook for this module. Automation tools are powerful and scary; most of these rules are about making people feel safe.
- **Section 6** is the final checklist for sprint close-out.

---

## 1. Personas

| ID | Persona | Who they are | What they want from Workflows |
|---|---|---|---|
| 👤 SC | **Solo Creator** | Priya runs a small yoga studio. Has never used Zapier. | One or two "set and forget" automations, built from a template, without understanding the technical words. |
| 👤 MM | **Marketing Manager** | Karthik markets a B2B SaaS product and reports to a manager every week. | A spreadsheet of everything published, a Slack message when something fails, and a weekly AI draft he can approve. |
| 👤 AO | **Agency Owner** | Meera's agency runs 8 client brands. | Alerts per client in the right Slack channel, reports per client, and control over who can switch automations on. |
| 👤 TM | **Team Member** | Arun, on Meera's team, builds and tests workflows. | Freedom to build and test without the risk of posting or messaging anyone by mistake. |
| 👤 AD | **Workspace Admin** | Meera, as admin. | Only admins connect outside accounts and turn workflows on, so nothing goes live without her. |

---

## 2. Real User Journeys

### Journey A: Karthik's publishing report (template, Sheets and Slack) 📊

1. Karthik clicks **Workflows** in the rail. The list is empty, but three **Start From A Template** cards are waiting. He picks **Publishing Report**.
2. The builder opens with four nodes already connected: Post Published → Set Fields → Google Sheets: Append Row → Slack. Two nodes show a small red marker.
3. He clicks the Sheets node. The panel says "Connect a Google account to use this step." He clicks **Connect Google**, signs in, and comes back to the same panel, now with a spreadsheet picker. He picks "Social Report 2026" and the "Posts" tab.
4. The column mapping is already filled from the template (Date, Channel, Link, Text). He adds a "Campaign" column and clicks **Insert Data** to choose "Post tags" from the trigger. No typing of curly braces.
5. He connects Slack by pasting the webhook link his admin gave him, picks the message, and the red markers disappear. The top bar says "No issues found."
6. He clicks **Test Workflow**. It uses his last published post as sample data. The nodes light up one by one. Sheets and Slack show **Dry Run**: their output says exactly what they *would* have sent. Nothing reached Google or Slack.
7. He switches on "Send for real in tests" on the Slack node, confirms, tests again, and sees the message in Slack.
8. He clicks **Activate**. The dialog says: "When a post is published, this workflow will add a row to Social Report 2026 and send a Slack message." He confirms. The badge turns **Active**.
9. The next morning a post goes out. A row appears in the sheet and a Slack message arrives. In the run list he sees "Succeeded, 1.2 s".

### Journey B: Priya's AI weekly post with approval (AI, schedule, review) 🤖

1. Priya picks the **AI Weekly Post** template: Schedule → Generate Text → Generate Image → Manual Review → Create Draft → In-App Notification.
2. In Schedule, she picks **Every Week**, **Monday**, **08:00**. The panel shows "Next run: Monday 3 November at 08:00 (Asia/Kolkata)."
3. In Generate Text, she writes the prompt: "A short motivating post about a beginner yoga pose, warm and friendly." She picks Instagram and **Personal** voice. The panel shows "Uses about 10 AI credits per run."
4. She tests it. The AI writes a post and an image, and the run stops at **Manual Review** with "Waiting for review". A notification appears: "Your AI Weekly Post is ready for review."
5. She opens it, edits one sentence, and clicks **Approve**. The run finishes and a draft appears in her Drafts with the text and image.
6. She activates the workflow. Every Monday she gets a notification, reviews, approves, and schedules the draft. Nothing ever posts without her approval.

### Journey C: Meera's failed-post alerts per client (agency, permissions) 🚨

1. Meera builds **Failed Post Alert** for client Bloom Bakery: Post Failed (channel filter: the bakery's Instagram and Facebook) → Filter (reason is not "rate limited") → Slack (#bloom-bakery-alerts).
2. She duplicates it seven times, changing the channel filter and the Slack connection for each client.
3. Arun, a member, opens one and changes the message. He can save and test, but **Activate** is disabled with the tooltip "Only workspace admins can turn workflows on."
4. Meera sees **Unpublished Changes** on that workflow, reviews Arun's edit, and activates it. The live version switches only at that moment.
5. When the bakery's Instagram token expires, a post fails, and the client's Slack channel gets "Post failed on Bloom Bakery Instagram: the channel needs to be reconnected." with a link to the post.

### Journey D: Something goes wrong, and it's easy to fix 🛟

- Karthik's Google account access is removed. The next run fails at the Sheets node with "Google Sheets is disconnected. Reconnect it in Connections." The node shows a red marker, and the connection shows **Needs Reconnect**.
- Slack is down for a minute. The Slack step retries on its own and succeeds; the run detail shows "Succeeded after 2 attempts".
- Priya's credits run out. The Generate Text step fails with "Not enough AI credits for this step." and the run stops before anything else happens. She gets a notification.
- Arun connects an output to a node that cannot take it. The connection simply will not attach, and the port that does fit glows.
- Arun deletes a node by mistake. He presses Ctrl+Z and it comes back with its settings and connections.

---

## 3. User Stories

### Epic WF-1: Discover And Start

#### WF-1.1: Open Workflows From The Rail
> **As a** Marketing Manager,
> **I want** Workflows in the main navigation,
> **So that** automations are part of my normal day, not a hidden setting.

**Acceptance Criteria:**
- [ ] A **Workflows** entry with an animated icon sits in the rail after Studio, and in the mobile menu
- [ ] The top bar names the page **Workflows**; no extra title on the page

**Priority**: P0 | **Story Points**: 1

#### WF-1.2: Start From A Template
> **As a** Solo Creator who has never automated anything,
> **I want** ready-made workflows,
> **So that** I don't have to build from a blank canvas.

**Acceptance Criteria:**
- [ ] Three template cards: **Publishing Report**, **AI Weekly Post**, **Failed Post Alert**, each with a one-sentence description and the apps it uses
- [ ] Choosing one creates a draft copy and opens it, with all nodes placed and connected
- [ ] Nodes that still need a connection or a choice are marked, so the user knows exactly what is left
- [ ] Templates are also offered on the empty canvas of a new workflow

**Priority**: P0 | **Story Points**: 3

#### WF-1.3: Workflow List
> **As an** Agency Owner,
> **I want** to see all workflows and how they are doing,
> **So that** I can spot problems quickly.

**Acceptance Criteria:**
- [ ] Table columns: Name, Trigger, Status (Draft, Active, Paused), Last Run (result and time), Runs In 30 Days, Updated
- [ ] A workflow whose last run failed shows a failed badge with the reason on hover
- [ ] Search by name; filter by status
- [ ] Row menu: **Open**, **Duplicate**, **Activate** or **Pause**, **Delete** (solid red, confirm dialog that names the workflow and warns if it is active)
- [ ] Empty state: "No workflows yet. Start from a template or build your own."

**Priority**: P0 | **Story Points**: 3

#### WF-1.4: Create, Rename, Duplicate, Delete
> **As a** Team Member,
> **I want** to manage workflows like any other item,
> **So that** I can copy one for a new client.

**Acceptance Criteria:**
- [ ] **Create Workflow** opens an empty canvas named "Untitled Workflow" with an **Add A Trigger** card in the middle
- [ ] The name is editable in the top bar
- [ ] **Duplicate** creates "{name} (Copy)" as a **Draft**, never active
- [ ] Deleting an active workflow stops it first; its run history goes with it

**Priority**: P0 | **Story Points**: 2

---

### Epic WF-2: Build On The Canvas

#### WF-2.1: Add A Trigger First
> **As a** Solo Creator,
> **I want** to be guided to start with a trigger,
> **So that** I understand that every workflow starts with "when this happens".

**Acceptance Criteria:**
- [ ] An empty canvas shows one card: **Add A Trigger**, with the text "Choose what starts this workflow."
- [ ] Clicking it opens the library on the **Triggers** category
- [ ] A workflow can have only one trigger; the library greys out other triggers once one is placed, with the reason on hover

**Priority**: P0 | **Story Points**: 2

#### WF-2.2: Add Nodes From The Library
> **As a** Marketing Manager,
> **I want** a searchable list of steps,
> **So that** I find "Slack" or "Google Sheets" by typing, not by guessing a category.

**Acceptance Criteria:**
- [ ] Categories: Triggers, PostGear, Social Channels, AI, Logic, Notify, Data
- [ ] Each card: icon, name, one-line description, and a state badge: **Ready**, **Needs Connection**, or **Coming Soon**
- [ ] Search matches names and descriptions ("excel" finds Google Sheets and Excel)
- [ ] Nodes are added by dragging onto the canvas or by clicking (placed after the selected node and connected)
- [ ] **Coming Soon** nodes are visible with a short reason ("WhatsApp is coming soon.") but cannot be added

**Priority**: P0 | **Story Points**: 5

#### WF-2.3: Add The Next Step From A Port
> **As a** Team Member,
> **I want** a "+" on each node's output,
> **So that** I build left to right without dragging from the side panel.

**Acceptance Criteria:**
- [ ] Hovering an output port shows a **+** button
- [ ] Clicking it opens the library filtered to nodes that can take that output
- [ ] The chosen node is placed to the right and connected automatically

**Priority**: P0 | **Story Points**: 3

#### WF-2.4: Connect Nodes
> **As a** Marketing Manager,
> **I want** to draw a line from one step to the next,
> **So that** I decide the order things happen.

**Acceptance Criteria:**
- [ ] Dragging from an output port to an input port creates a connection with an arrow
- [ ] While dragging, ports that fit are highlighted and ports that do not fit are dimmed and refuse the drop
- [ ] A connection that would create a loop is refused with "Workflows cannot loop back to an earlier step."
- [ ] Selecting a connection shows a delete button; Delete or Backspace also removes it
- [ ] If / Else nodes have two labelled outputs: **True** and **False**

**Priority**: P0 | **Story Points**: 5

#### WF-2.5: Move Around The Canvas
> **As an** Agency Owner with large workflows,
> **I want** to zoom, pan and fit,
> **So that** I can see the whole flow or focus on one part.

**Acceptance Criteria:**
- [ ] Scroll or pinch to zoom, drag the background to pan
- [ ] **Fit To Screen**, zoom in and zoom out buttons, and a minimap
- [ ] Nodes snap to a light grid so flows line up neatly
- [ ] Multi-select with Shift-click or a drag box; selected nodes move, duplicate and delete together

**Priority**: P0 | **Story Points**: 3

#### WF-2.6: Undo And Redo On The Canvas
> **As a** Team Member,
> **I want** to undo a deleted node or a wrong connection,
> **So that** I can experiment without fear.

**Acceptance Criteria:**
- [ ] **Undo** and **Redo** buttons plus Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z for add, delete, move, connect and settings changes
- [ ] Undoing a delete restores the node with its settings and connections

**Priority**: P1 | **Story Points**: 3

#### WF-2.7: Autosave And No Silent Overwrites
> **As a** Marketing Manager,
> **I want** my workflow draft saved as I go,
> **So that** I never lose a half-built flow.

**Acceptance Criteria:**
- [ ] Changes save automatically; the status reads **Saving**, **Saved**, **Offline** or "Could not save. Retrying."
- [ ] If someone else changed the draft, the builder says "This workflow changed somewhere else." with **Reload**
- [ ] Saving never activates anything

**Priority**: P0 | **Story Points**: 3

---

### Epic WF-3: Configure A Step

#### WF-3.1: Step Settings Panel
> **As a** Solo Creator,
> **I want** clear settings for each step,
> **So that** I know what to fill in.

**Acceptance Criteria:**
- [ ] Clicking a node opens its settings on the right: name, a short "what this step does", and its fields
- [ ] Required fields are marked; empty required fields show a red marker on the node
- [ ] Field types fit the job: channel picker, spreadsheet picker, time and day pickers, condition builder, text with data
- [ ] Placeholders read "Enter your ..."; help text sits under fields that need it
- [ ] Each node on the canvas shows a one-line summary of its settings ("Every Monday at 08:00")

**Priority**: P0 | **Story Points**: 5

#### WF-3.2: Use Data From Earlier Steps
> **As a** Marketing Manager,
> **I want** to put the post link into my Slack message by picking it from a list,
> **So that** I don't have to learn a code syntax.

**Acceptance Criteria:**
- [ ] Text fields have an **Insert Data** button listing earlier steps and their fields in plain words ("Post Published: Post Link")
- [ ] Only steps that come before this one are listed
- [ ] Inserted data shows as a readable chip in the field, not raw curly braces
- [ ] Hovering a chip shows a sample value from the last test run
- [ ] If an earlier step is deleted, chips that used it turn red with "This data is no longer available."

**Priority**: P0 | **Story Points**: 8

#### WF-3.3: Conditions Without Code
> **As a** Solo Creator,
> **I want** to say "only if the channel is Instagram" with dropdowns,
> **So that** I can make simple decisions in my workflow.

**Acceptance Criteria:**
- [ ] If / Else and Filter use a builder: field, operator (is, is not, contains, is empty, greater than...), value
- [ ] Several rules can be combined with **All Of** or **Any Of**
- [ ] The node summary reads like a sentence: "Channel is Instagram"

**Priority**: P0 | **Story Points**: 5

#### WF-3.4: Test One Step
> **As a** Team Member,
> **I want** to try a single step on its own,
> **So that** I can fix it without running the whole workflow.

**Acceptance Criteria:**
- [ ] **Test Step** runs only this node with sample input (from the last test run, or built-in sample data)
- [ ] The result shows below the fields: output for success, a clear reason for failure
- [ ] Steps that send or post run as a dry run unless "Send for real in tests" is switched on

**Priority**: P1 | **Story Points**: 3

---

### Epic WF-4: Connections To Other Apps

#### WF-4.1: Connect An App From Where I Need It
> **As a** Marketing Manager,
> **I want** to connect Google Sheets right inside the step,
> **So that** I don't lose my place in the builder.

**Acceptance Criteria:**
- [ ] A step that needs a connection shows "Connect a {app} account to use this step." with **Connect {App}**
- [ ] OAuth apps (Google Sheets) open the sign-in and return to the same step, now connected
- [ ] Webhook apps (Slack, Teams, Discord) ask for the webhook link, with a short "Where do I find this?" help link
- [ ] Connections can be reused across workflows

**Priority**: P0 | **Story Points**: 5

#### WF-4.2: Honest Connection States
> **As an** Agency Owner,
> **I want** to see which connections work,
> **So that** I'm never told something is connected when it isn't.

**Acceptance Criteria:**
- [ ] A **Connections** page in workflow settings lists each connection: app, name, status (**Connected**, **Needs Reconnect**, **Error**), last checked, and which workflows use it
- [ ] **Check Connection** tests it now and shows the result
- [ ] Secrets are never shown again after saving; only a masked hint like "hooks.slack.com/...a9F2"
- [ ] A broken connection marks every node that uses it and tells the user how to fix it

**Priority**: P0 | **Story Points**: 5

#### WF-4.3: Only Admins Manage Connections
> **As a** Workspace Admin,
> **I want** only admins to connect outside accounts,
> **So that** company accounts are not linked without my knowledge.

**Acceptance Criteria:**
- [ ] Members can pick existing connections but cannot add, change or remove them
- [ ] For members, **Connect {App}** reads "Ask a workspace admin to connect {app}."

**Priority**: P1 | **Story Points**: 2

---

### Epic WF-5: Check And Test Safely

#### WF-5.1: Live Problem Markers
> **As a** Solo Creator,
> **I want** to see what's missing as I build,
> **So that** I'm not surprised when I try to turn it on.

**Acceptance Criteria:**
- [ ] Nodes with problems show a red marker; hovering says what is wrong in one sentence
- [ ] The top bar shows "2 issues" (clickable) or "No issues found"
- [ ] The issues list names each problem; clicking one selects and centres the node and opens the field that needs attention
- [ ] Checks: one trigger, every step connected, required fields filled, data chips valid, connections working, no loops, no Coming Soon nodes

**Priority**: P0 | **Story Points**: 5

#### WF-5.2: Test The Whole Workflow Safely
> **As a** Team Member,
> **I want** to test without posting or messaging anyone,
> **So that** I can try ideas with zero risk.

**Acceptance Criteria:**
- [ ] **Test Workflow** runs the draft with sample trigger data (the last real event of that type, or built-in sample data)
- [ ] Steps light up on the canvas as they run: waiting, running, succeeded, failed, skipped
- [ ] Steps that post, send or write outside PostGear are **Dry Run** by default: their output shows exactly what would have been sent
- [ ] "Send for real in tests" can be switched on per step, with a confirmation
- [ ] Test runs are labelled **Test** in the run list and never count as live runs

**Priority**: P0 | **Story Points**: 8

#### WF-5.3: Understand A Run
> **As a** Marketing Manager,
> **I want** to see what each step did,
> **So that** I can trust the workflow or fix it.

**Acceptance Criteria:**
- [ ] The run drawer lists runs: status, Test or Live, trigger, started, duration
- [ ] Opening a run paints each node's result on the canvas and lists steps with their input and output in a readable view (and raw view)
- [ ] Failed steps show what went wrong and what to do, with **Copy Details**
- [ ] Passwords, tokens and webhook links never appear in run details
- [ ] Retries show as "Succeeded after 2 attempts"

**Priority**: P0 | **Story Points**: 5

---

### Epic WF-6: Activate And Manage

#### WF-6.1: Activate With A Plain-Words Summary
> **As a** Solo Creator,
> **I want** to know exactly what will happen before I turn a workflow on,
> **So that** I don't post or message people by accident.

**Acceptance Criteria:**
- [ ] **Activate** is only possible with no issues; otherwise it opens the issues list
- [ ] The confirm dialog describes the workflow in a sentence: "When a post is published, this workflow will add a row to Social Report 2026 and send a Slack message."
- [ ] If the workflow posts to channels without a Manual Review step before it, the dialog needs an extra tick: "I understand posts will go out automatically."
- [ ] After activating, the badge says **Active** and a toast confirms it

**Priority**: P0 | **Story Points**: 3

#### WF-6.2: Pause And Resume
> **As an** Agency Owner,
> **I want** to pause a workflow,
> **So that** I can stop it during a client's quiet period.

**Acceptance Criteria:**
- [ ] **Pause** stops new runs at once; runs already in progress finish (or can be cancelled from the run drawer)
- [ ] Paused schedules do not catch up on missed runs when resumed, and the dialog says so
- [ ] **Activate** resumes it

**Priority**: P0 | **Story Points**: 2

#### WF-6.3: Edit A Live Workflow Safely
> **As a** Marketing Manager,
> **I want** my edits to an active workflow to wait until I'm ready,
> **So that** a half-finished change never runs.

**Acceptance Criteria:**
- [ ] Editing an active workflow changes the draft only; the badge shows **Unpublished Changes**
- [ ] Live runs keep using the last activated version until **Activate** is clicked again
- [ ] A run that started on the old version finishes on the old version
- [ ] **Discard Changes** returns the draft to the live version

**Priority**: P0 | **Story Points**: 3

#### WF-6.4: Only Admins Turn Workflows On
> **As a** Workspace Admin,
> **I want** only admins to activate or pause workflows,
> **So that** nothing goes live without approval.

**Acceptance Criteria:**
- [ ] Members can create, edit and test; **Activate** and **Pause** are disabled with "Only workspace admins can turn workflows on."
- [ ] The API refuses activation from a member, whatever the UI shows

**Priority**: P0 | **Story Points**: 2

---

### Epic WF-7: Triggers

#### WF-7.1: When A Post Is Published
> **As a** Marketing Manager,
> **I want** a workflow to start each time a post goes live,
> **So that** I can log it and tell my team.

**Acceptance Criteria:**
- [ ] **Post Published** can be limited to some channels and tags
- [ ] Its data includes the post text preview, link, channel, platform and publish time
- [ ] Each published post starts the workflow exactly once, even if publishing retried

**Priority**: P0 | **Story Points**: 5

#### WF-7.2: When A Post Fails
> **As an** Agency Owner,
> **I want** to be alerted the moment a client's post fails,
> **So that** I fix it before the client notices.

**Acceptance Criteria:**
- [ ] **Post Failed** can be limited to some channels and failure reasons (for example "channel needs reconnecting", "rate limited")
- [ ] Its data includes the reason in plain words and a link to the post in PostGear

**Priority**: P0 | **Story Points**: 3

#### WF-7.3: On A Schedule
> **As a** Solo Creator,
> **I want** a workflow to run every Monday morning,
> **So that** my weekly routine happens without me.

**Acceptance Criteria:**
- [ ] Options: Every Day, Every Weekday, Every Week (pick days), Every Month (pick a date), with a time
- [ ] Uses the workspace time zone, shown in the panel
- [ ] The panel shows the next three run times
- [ ] Workflows with AI steps cannot run more often than hourly, with the reason shown

**Priority**: P0 | **Story Points**: 5

#### WF-7.4: Run Now
> **As a** Team Member,
> **I want** a workflow I can start by hand,
> **So that** I can run it whenever I need.

**Acceptance Criteria:**
- [ ] **Manual** trigger adds a **Run Now** button on the workflow (active workflows only)
- [ ] Optional input fields (for example "Topic") are asked for when it starts

**Priority**: P0 | **Story Points**: 2

#### WF-7.5: From Another App (Webhook)
> **As a** Marketing Manager,
> **I want** my website to start a workflow,
> **So that** a new blog article becomes a draft post automatically.

**Acceptance Criteria:**
- [ ] **Webhook** shows a URL and a secret with **Copy**; the secret is shown once and can be regenerated
- [ ] Calls without the right secret are refused; very large bodies are refused
- [ ] The last received body is available as sample data for testing

**Priority**: P1 | **Story Points**: 5

---

### Epic WF-8: PostGear And Social Steps

#### WF-8.1: Create A Draft
> **As a** Solo Creator,
> **I want** a workflow to put content into my Drafts,
> **So that** I check it before it posts.

**Acceptance Criteria:**
- [ ] **Create Draft** takes text, media and channels (each can use data from earlier steps)
- [ ] The draft appears in Drafts and opens in the composer like any other
- [ ] Platform rules (length, media count) are checked the same way the composer checks them; problems fail the step with the rule in plain words

**Priority**: P0 | **Story Points**: 5

#### WF-8.2: Add To Queue Or Publish To A Channel
> **As a** Marketing Manager,
> **I want** a workflow to schedule or publish a post,
> **So that** routine posts need no manual work.

**Acceptance Criteria:**
- [ ] The library shows one card per platform (Instagram, Facebook, X, LinkedIn, YouTube, TikTok, Pinterest), each listing only connected channels of that platform
- [ ] **Add To Queue** uses the next free slot or a chosen time; **Publish To Channel** posts now
- [ ] These steps are dry runs in tests unless switched on
- [ ] Activation shows the automatic-posting warning when there is no Manual Review before them
- [ ] A post is never published twice for the same run, even if the step retries

**Priority**: P1 | **Story Points**: 8

---

### Epic WF-9: AI Steps

#### WF-9.1: Generate Text
> **As a** Solo Creator,
> **I want** the AI to write my post from a short prompt,
> **So that** fresh content appears every week.

**Acceptance Criteria:**
- [ ] Settings: prompt (with data chips), platform, voice (Personal or Company), web research on or off
- [ ] The panel shows "Uses about {n} AI credits per run" and the current balance
- [ ] Credits are charged when the step runs and refunded if it fails
- [ ] With too few credits the step fails with "Not enough AI credits for this step." and the run stops

**Priority**: P0 | **Story Points**: 5

#### WF-9.2: Generate An Image
> **As a** Marketing Manager,
> **I want** an image made from the generated text,
> **So that** the post has a visual without searching for one.

**Acceptance Criteria:**
- [ ] Settings: prompt (can use the text from Generate Text), with the credit cost shown
- [ ] The image is saved to Media and passed on to the next step

**Priority**: P1 | **Story Points**: 3

#### WF-9.3: Coming Soon AI Steps Are Honest
> **As a** Solo Creator,
> **I want** to know which AI features are not ready yet,
> **So that** I don't build a workflow that can never run.

**Acceptance Criteria:**
- [ ] **Generate Video** shows as **Coming Soon** with "Video generation is coming soon." and cannot be added

**Priority**: P0 | **Story Points**: 1

---

### Epic WF-10: Manual Review

#### WF-10.1: Review Before Anything Goes Out
> **As a** Solo Creator,
> **I want** the workflow to wait for my approval,
> **So that** AI content never posts without me seeing it.

**Acceptance Criteria:**
- [ ] When a run reaches **Manual Review**, it shows "Waiting for review" and the workspace gets a notification
- [ ] The review view shows the content from earlier steps (text, image) with **Approve** and **Reject**
- [ ] The text can be edited before approving (P1)
- [ ] Approve continues the run; Reject ends it as "Rejected", which is not shown as a failure
- [ ] A review left for 7 days expires and the run ends with "Review expired"
- [ ] Waiting runs survive restarts and deployments

**Priority**: P0 | **Story Points**: 8

---

### Epic WF-11: Notify And Data Steps

#### WF-11.1: In-App Notification
> **As a** Team Member,
> **I want** a PostGear notification at the end of a workflow,
> **So that** the team knows it ran without any extra app.

**Acceptance Criteria:**
- [ ] **In-App Notification** takes a title and message (with data chips)
- [ ] It appears in the bell for the whole workspace and follows the usual email settings

**Priority**: P0 | **Story Points**: 2

#### WF-11.2: Slack, Teams And Discord Messages
> **As an** Agency Owner,
> **I want** messages in each client's chat channel,
> **So that** the right people see the right alerts.

**Acceptance Criteria:**
- [ ] **Slack** (P0), **Microsoft Teams** and **Discord** (P1) each send a message with data chips to the chosen connection
- [ ] The step succeeds only when the app confirms it received the message
- [ ] Temporary failures retry on their own; permanent ones (wrong link) fail with the reason

**Priority**: P0 | **Story Points**: 5

#### WF-11.3: Email
> **As a** Marketing Manager,
> **I want** to email a summary to my manager,
> **So that** people outside PostGear stay informed.

**Acceptance Criteria:**
- [ ] **Email** takes recipients, subject and message, with data chips
- [ ] Recipient addresses are checked; at most 10 per step

**Priority**: P1 | **Story Points**: 3

#### WF-11.4: Add A Row To Google Sheets
> **As a** Marketing Manager,
> **I want** each published post logged in a spreadsheet,
> **So that** my weekly report builds itself.

**Acceptance Criteria:**
- [ ] Pick a spreadsheet and tab from the connected Google account
- [ ] Columns are read from the sheet's first row; each column is mapped to data or a fixed value
- [ ] The step's output shows the row number written

**Priority**: P1 | **Story Points**: 8

#### WF-11.5: Call Another App (HTTP Request)
> **As a** Marketing Manager with a developer,
> **I want** to send data to our own system,
> **So that** PostGear fits into our tools.

**Acceptance Criteria:**
- [ ] Method, https URL, headers, and body with data chips
- [ ] Private and internal addresses are refused with the reason
- [ ] Header values marked secret are stored safely and never shown in run details

**Priority**: P1 | **Story Points**: 5

#### WF-11.6: WhatsApp And Excel
> **As an** Agency Owner,
> **I want** WhatsApp alerts and Excel logs,
> **So that** clients who live in those tools are covered.

**Acceptance Criteria:**
- [ ] Both show as **Coming Soon** until they are built (WhatsApp needs Meta business approval)

**Priority**: P2 | **Story Points**: 1 now, sized later

---

### Epic WF-12: Monitor And Recover

#### WF-12.1: Know When A Workflow Fails
> **As an** Agency Owner,
> **I want** to hear about failed runs,
> **So that** a broken automation doesn't go unnoticed for weeks.

**Acceptance Criteria:**
- [ ] A failed live run creates an in-app notification: "{workflow} failed at {step}: {reason}."
- [ ] Repeated failures of the same workflow are grouped, not sent one by one

**Priority**: P0 | **Story Points**: 3

#### WF-12.2: Cancel And Retry
> **As a** Marketing Manager,
> **I want** to stop a run or try a failed step again,
> **So that** I can fix problems without starting over.

**Acceptance Criteria:**
- [ ] Running and waiting runs can be cancelled from the run drawer
- [ ] **Retry From Here** on a failed step reruns from that step, using the same earlier results (P1, only for steps that are safe to repeat)

**Priority**: P1 | **Story Points**: 5

#### WF-12.3: Run History
> **As a** Workspace Admin,
> **I want** 30 days of run history,
> **So that** I can check what happened without the list growing forever.

**Acceptance Criteria:**
- [ ] Runs are kept for 30 days, then removed automatically
- [ ] The run list pages smoothly with hundreds of runs

**Priority**: P0 | **Story Points**: 2

---

## 4. UX Best Practices For This Module

| # | Principle | What it means in Workflows |
|---|---|---|
| 1 | **Templates first** | Most people should start from a template, not a blank canvas. A finished template only asks for the missing pieces, and the markers show exactly which. |
| 2 | **Plain words, no jargon** | "When a post is published", "Insert Data", "Run Now". Never "payload", "JSON path", "cron" or "node" in the UI (the code can say node). |
| 3 | **Safe by default** | Tests are dry runs. Saving never activates. Activation needs a plain-words confirmation, and automatic posting needs an extra tick. A beginner cannot post or message anyone by mistake. |
| 4 | **Pick, don't type** | Data chips from Insert Data, dropdown condition builders, day and time pickers. Users recognise options instead of remembering syntax. |
| 5 | **Show the flow while it runs** | Nodes light up during tests and runs, and the run history paints results on the canvas. People understand automations by watching them. |
| 6 | **Problems found early** | Red markers appear as you build, not when you try to activate. Every issue links to the exact field to fix. |
| 7 | **Honest states** | Connected only when it is. Coming Soon is labelled. Dry Run says what would have happened. Success only when the outside app confirms. |
| 8 | **Forgiving** | Undo on the canvas, autosave, drafts separate from the live version, Discard Changes, cancel and retry. |
| 9 | **Errors that tell you what to do** | "Google Sheets is disconnected. Reconnect it in Connections." Never a raw error code alone; technical details sit behind **Copy Details**. |
| 10 | **The right people hold the keys** | Members build and test; admins connect accounts and turn workflows on. Disabled buttons always say why. |
| 11 | **Consistent with PostGear** | `PageActions` row first, no in-page titles, Title Case names, sentence case messages, "Enter your ..." placeholders, design-system Alert for errors, design-system cards for nodes, animated icons for clickable icons, solid red delete. |
| 12 | **Works for everyone** | Every canvas action has a keyboard path (select node, open settings, connect through the "+" menu); status never shown by colour alone; labels for screen readers; reduced motion turns off the run animations; drawers on small screens. |

---

## 5. Edge Cases And Expected Behaviour

| Situation | What the user sees |
|---|---|
| A connection stops working | Run fails at that step with how to fix it; the connection shows **Needs Reconnect**; nodes using it get a marker. |
| The outside app is briefly down | The step retries on its own; the run shows "Succeeded after 2 attempts". |
| Out of AI credits | "Not enough AI credits for this step." The run stops before any later step. |
| A channel used by the workflow is disconnected | Validation marker on the step; a live run fails with "This channel is disconnected." |
| An earlier step is deleted while a later step uses its data | Chips turn red: "This data is no longer available." Activation is blocked. |
| The same post event arrives twice | Only one run starts. |
| The worker restarts during a run | The run continues where it stopped; waiting reviews keep waiting. |
| An active workflow is edited | **Unpublished Changes**; the live version keeps running until activated again. |
| A paused schedule is resumed | It runs at the next scheduled time; missed runs are not caught up (the dialog says so). |
| A member tries to activate | Disabled button with the reason; the API refuses too. |
| A review is never answered | After 7 days: "Review expired". |
| Too many steps or test runs | "Workflows can have up to 50 steps." / "Too many test runs. Try again in a minute." |
| Someone opens another workspace's workflow link | Not found page; nothing is revealed. |

---

## 6. Completion Checklist ✅

Tick each line at sprint close-out (the `sprint-closeout` skill verifies them against the code). A line is done only when it works in the running app, not just in code.

### Discover And Start
- [ ] WF-1.1 Workflows in the rail and mobile menu
- [ ] WF-1.2 Three templates that open connected, with markers for what is left
- [ ] WF-1.3 Workflow list with status, last run, search, filter, row menu, red confirm delete
- [ ] WF-1.4 Create, rename, duplicate as draft, delete

### Build On The Canvas
- [ ] WF-2.1 Add A Trigger card; one trigger only
- [ ] WF-2.2 Searchable library with Ready, Needs Connection and Coming Soon badges
- [ ] WF-2.3 "+" on output ports with a filtered library
- [ ] WF-2.4 Connect with fitting ports highlighted, loops refused, True and False outputs
- [ ] WF-2.5 Zoom, pan, fit, minimap, grid, multi-select
- [ ] WF-2.6 (P1) Undo and redo on the canvas
- [ ] WF-2.7 Autosave with honest status and conflict warning; saving never activates

### Configure A Step
- [ ] WF-3.1 Settings panel with fitting field types and node summaries
- [ ] WF-3.2 Insert Data chips from earlier steps only, with sample values and broken-chip warnings
- [ ] WF-3.3 Condition builder with All Of and Any Of
- [ ] WF-3.4 (P1) Test Step

### Connections
- [ ] WF-4.1 Connect from inside the step (OAuth returns to the step; webhook apps with help)
- [ ] WF-4.2 Connections page with honest states, Check Connection, masked secrets
- [ ] WF-4.3 (P1) Only admins manage connections

### Check And Test
- [ ] WF-5.1 Live markers and a clickable issues list
- [ ] WF-5.2 Test Workflow with dry runs, per-step "send for real", Test label
- [ ] WF-5.3 Run drawer with per-step input and output, no secrets, retries shown

### Activate And Manage
- [ ] WF-6.1 Activate only with no issues; plain-words summary; automatic-posting tick
- [ ] WF-6.2 Pause and resume, no catch-up
- [ ] WF-6.3 Unpublished Changes, version pinning, Discard Changes
- [ ] WF-6.4 Only admins activate and pause (UI and API)

### Triggers
- [ ] WF-7.1 Post Published with filters, exactly once per post
- [ ] WF-7.2 Post Failed with reason filters
- [ ] WF-7.3 Schedule in the workspace time zone with next run times; hourly limit with AI
- [ ] WF-7.4 Manual trigger with Run Now and inputs
- [ ] WF-7.5 (P1) Webhook trigger with secret

### PostGear And Social Steps
- [ ] WF-8.1 Create Draft with composer rules
- [ ] WF-8.2 (P1) Add To Queue and Publish To Channel, one card per platform, never twice

### AI Steps
- [ ] WF-9.1 Generate Text with credit cost, charge and refund, out-of-credits stop
- [ ] WF-9.2 (P1) Generate Image into Media
- [ ] WF-9.3 Generate Video honestly Coming Soon

### Manual Review
- [ ] WF-10.1 Review notification, Approve and Reject, edit before approve (P1), 7-day expiry, survives restarts

### Notify And Data
- [ ] WF-11.1 In-App Notification
- [ ] WF-11.2 Slack (P0), Teams and Discord (P1), success only on confirmation
- [ ] WF-11.3 (P1) Email
- [ ] WF-11.4 (P1) Google Sheets Append Row with column mapping
- [ ] WF-11.5 (P1) HTTP Request with private addresses refused
- [ ] WF-11.6 (P2) WhatsApp and Excel shown as Coming Soon

### Monitor And Recover
- [ ] WF-12.1 Failed-run notifications, grouped
- [ ] WF-12.2 (P1) Cancel and Retry From Here
- [ ] WF-12.3 30-day run history

### UX And Quality Gates
- [ ] Journeys A to D in section 2 walked through by hand, start to finish, without help
- [ ] A first-time user activates a template workflow in under 10 minutes
- [ ] Every edge case in section 5 behaves as written
- [ ] Every UX principle in section 4 checked on every Workflows screen
- [ ] No jargon ("payload", "cron", "JSON") anywhere in the UI copy
- [ ] Checked in light, dark and Lilac themes, and at phone width
- [ ] Every action has a keyboard path; focus is always visible
- [ ] No secret appears in any API response, run detail or browser storage (API specs)
- [ ] No other workspace's workflows, runs or connections are reachable (API specs)
- [ ] Every outside app tested under `AUTOMATION_SIMULATION`; the checklist notes which were also tested for real
- [ ] `npm run validate` passes; e2e spec covers build, connect, validate, test run and activate

---

## 7. How We Know It Works (After Launch)

| Measure | Target |
|---|---|
| Workspaces that activate at least one workflow within 14 days | 30% or more |
| New workflows started from a template | 70% or more |
| Median time from opening a template to activating it | under 10 minutes |
| Live runs that succeed | 97% or more (excluding disconnected accounts) |
| Workflows still active 30 days after activation | 60% or more |
