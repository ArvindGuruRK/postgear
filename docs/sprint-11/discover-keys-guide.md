# Discover: Getting Your API Keys

> **For**: Arvind, setting up Discover's optional keys.
> **Checked on**: 2026-11-12. Prices, free limits and button names change now and then. If a screen looks a little different, look for the same words nearby.

Discover already works with **no keys at all**. Every key in this guide switches
on **one extra thing**. Do them in any order, whenever you are ready.

---

## How To Use This Guide

1. Look at **The Short Version** below and pick what you want.
2. Read **Before You Start** once. It shows the three moves every recipe ends with.
3. Open the recipe and follow it top to bottom. Each step says what you should see.
4. Tick the box at the end of each recipe when it works.

---

## The Short Version

| Recipe | What it switches on | Cost | Time | When |
|---|---|---|---|---|
| [1. YouTube key](#recipe-1-youtube-data-api-key) | The **Videos** tab | 🆓 Free | 10 min | ✅ **Today** |
| [2. Google Trends application](#recipe-2-apply-for-the-google-trends-api) | Official trends, later (not built yet) | 🆓 Free | 10 min, then a wait | ✅ **Today** |
| [3. OpenStreetMap contact line](#recipe-3-openstreetmap-contact-line) | Polite city search on a live server | 🆓 Free | 1 min | ✅ Before staging |
| [4. DB-IP country file](#recipe-4-db-ip-country-file) | A better first guess of the visitor's country | 🆓 Free | 2 min | 🟡 Optional |
| [5. Instagram permission](#recipe-5-instagram-competitors) | **Instagram** accounts on the Competitors tab | 🆓 Free, Meta reviews it | Days to weeks | 🟡 With your next Meta review |
| [6. OpenAI key](#recipe-6-openai-api-key-real-ai) | Real AI (Research This Competitor, Copilot, drafts) | 💳 Paid per use | 10 min | 🟡 When AI goes live |
| [7. SerpApi key](#recipe-7-serpapi-key) | Licensed Google News | 💳 250 free a month, then from $25 a month | 5 min | ⚪ Only if you pick option C |
| [8. NewsData.io key](#recipe-8-newsdataio-key) | A spare news source | 💳 Limited free plan, paid from about $199.99 a month | 5 min | ⚪ Probably never |
| [9. Your own place server](#recipe-9-your-own-place-server) | Search-as-you-type for cities | 🆓 Software, but needs a server | 1 to 3 hours | ⚪ Only with lots of users |

✅ = do it now, 🟡 = when it suits you, ⚪ = skip unless you need it.

**Already done for you**: the worker's key (`AUTOMATION_INTERNAL_TOKEN`) is set
on your laptop. Staging and production need their own, see
[Going Live](#going-live-staging-and-production).

---

## Before You Start

Every recipe ends with the same three moves. Here they are once, in full.

### Move 1: Open The Settings File

PostGear keeps its settings in a file called **`.env`** at the top of the
project:

```text
D:\rk-personal-projects\postgear\.env
```

Open it in VS Code (it is in the file list on the left, near the top). It is a
plain list of lines like `NAME="value"`. Git never uploads it, so keys are safe
there.

### Move 2: Paste The Line

Each recipe gives you a line such as:

```env
YOUTUBE_API_KEY="paste-your-key-here"
```

- If the name is **already in the file**, replace only the part between the quotes.
- If it is **not there**, add the whole line at the end of the file.
- Keep the quotes. No spaces around the `=`.
- Save the file (`Ctrl+S`).

### Move 3: Restart PostGear

PostGear reads `.env` only when it starts.

1. Go to the terminal where `npm run dev` is running.
2. Press `Ctrl+C` to stop it (press it again if it asks).
3. Run `npm run dev` again and wait until the web app says it is ready.

### Three Safety Rules

- 🔒 **Never** paste a key into chat, email, a screenshot or a commit.
- 🔁 If a key ever leaks, delete it on the provider's site and make a new one.
- 🧾 Keep a note of which Google, Meta or OpenAI account owns each key.

---

## Recipe 1: YouTube Data API Key

| | |
|---|---|
| 🎯 **Switches on** | The Videos tab: the 25 most popular YouTube videos in the place you are looking at |
| 💰 **Cost** | Free. Google gives each project 10,000 units a day; one Videos refresh costs 1 unit, once an hour per country |
| ⏱️ **Time** | About 10 minutes |
| 🧾 **You need** | A Google account |

### Part A: Make A Project

1. Go to **[console.cloud.google.com](https://console.cloud.google.com)** and sign in.
2. At the top of the page, click the **project picker** (it shows a project
   name, or "Select a project").
3. Click **New Project**.
4. Name it **`PostGear Discover`** and click **Create**.
5. Wait a few seconds, open the project picker again and **select `PostGear Discover`**.

   ✅ You should see `PostGear Discover` at the top of the page.

> 💡 Why a new project? The 10,000 daily units are shared by everything in one
> project. A separate project means Discover never uses up YouTube publishing's
> allowance.

### Part B: Turn On The YouTube API

1. Open the menu (☰, top left), then **APIs & Services**, then **Library**.
2. In the search box type **`YouTube Data API v3`** and open it.
3. Click **Enable**.

   ✅ You should land on the API's page, with a **Manage** button where
   **Enable** was.

### Part C: Make The Key

1. Open the menu (☰), then **APIs & Services**, then **Credentials**.
2. Click **+ Create Credentials**, then **API key**.
3. A box shows your new key (a long line of letters and numbers). Click the
   **copy** icon.

   ✅ You now have the key on your clipboard.

### Part D: Lock The Key To YouTube Only

1. In the same box click **Edit API key** (or click the key's name in the list).
2. Under **API restrictions**, choose **Restrict key**.
3. In the list, tick only **YouTube Data API v3**.
4. Leave **Application restrictions** on **None** for now.
5. Click **Save**.

   ✅ The key shows "1 API" under restrictions in the Credentials list.

### Part E: Put It In PostGear

1. Open `.env` ([Move 1](#move-1-open-the-settings-file)).
2. Paste ([Move 2](#move-2-paste-the-line)):

   ```env
   YOUTUBE_API_KEY="paste-your-key-here"
   ```

3. Restart ([Move 3](#move-3-restart-postgear)).

### ✅ Check It Works

Open PostGear, then **Discover**, then the **Videos** tab. You should see video
cards with thumbnails and view counts.

### 🆘 If Something Goes Wrong

| What you see | What to do |
|---|---|
| Videos still says "not set up" | The API was not restarted, or the line has a typo. Check the name is exactly `YOUTUBE_API_KEY`, then restart |
| Videos says it could not load | Wait a minute and press **Refresh**. If it keeps failing, check the key is restricted to **YouTube Data API v3**, not another API |
| It worked, then stopped for the day | The daily units ran out. They reset at midnight Pacific time (1:30 pm in India in winter, 12:30 pm in summer) |

- [ ] **YouTube key done**

---

## Recipe 2: Apply For The Google Trends API

| | |
|---|---|
| 🎯 **Switches on** | Nothing yet. If Google admits PostGear, it replaces the unofficial Trends feed with the official one, and I build it in |
| 💰 **Cost** | Free |
| ⏱️ **Time** | 10 minutes for the form, then a wait (weeks or longer; Google admits a limited number of developers) |
| 🧾 **You need** | A Google account (the same one as Recipe 1 is fine) |

### Steps

1. Go to **[developers.google.com/search/apis/trends](https://developers.google.com/search/apis/trends)**.
2. Click the button to **apply** for the alpha. A Google form opens.
3. Fill it in. The form's exact questions may be worded differently; these
   answers fit what it asks about:

   | Question | Answer |
   |---|---|
   | Commercial or non-commercial | **Commercial** |
   | What will you build | "PostGear is a social media tool for small businesses. Its Discover page shows what people are searching for in their country and state, so they can plan timely posts. We want rising searches by country and region, refreshed about once an hour, cached and shared between customers." |
   | When can you start | **Right away** |
   | Will you give feedback | **Yes** (Google says it prefers applicants who start soon and give feedback) |

4. Submit the form.

   ✅ Google may show a thank-you page. Any answer comes by email to the
   account you used.

### What Next

When Google's email arrives, tell me and I will build the official Trends source.

- [ ] **Trends application sent**

---

## Recipe 3: OpenStreetMap Contact Line

| | |
|---|---|
| 🎯 **Switches on** | Polite city search on a live server. OpenStreetMap's free place finder asks every app to say who it is, so they can reach you before they block you |
| 💰 **Cost** | Free. It is not a key, just a line of text |
| ⏱️ **Time** | 1 minute |
| 🧾 **You need** | An email address you read |

### Steps

1. Open `.env` ([Move 1](#move-1-open-the-settings-file)).
2. Paste, with your real email in place of `your-email-here`:

   ```env
   DISCOVER_GEOCODER_USER_AGENT="PostGear/1.0 (+https://postgear.rkay.in; contact: your-email-here)"
   ```

3. Restart ([Move 3](#move-3-restart-postgear)).
4. Add the same line to staging's and production's settings when you set them up.

### ✅ Check It Works

Open Discover, click the place button, type a city in **Search for a city** and
press **Search**. The city should be found as before.

- [ ] **Contact line done**

---

## Recipe 4: DB-IP Country File

| | |
|---|---|
| 🎯 **Switches on** | A better first guess of a visitor's country when their time zone says little (for example UTC). The address is looked up in memory and never stored |
| 💰 **Cost** | Free. The licence asks for a credit link, and Discover already shows "IP geolocation by DB-IP" when it uses the file |
| ⏱️ **Time** | 2 minutes, then once a month |
| 🧾 **You need** | Nothing: no account |

### Steps

1. Open a terminal in the project folder (`D:\rk-personal-projects\postgear`).
2. Run this command. It downloads this month's file to a folder **outside** the
   project, so it never ends up in git (the folder is created for you):

   ```bash
   npm run discover:ip-db -- D:/postgear-data/dbip-country-lite.csv
   ```

   ✅ It ends with a line starting **"Wrote"**, naming the month and the file.

3. Open `.env` ([Move 1](#move-1-open-the-settings-file)) and paste:

   ```env
   DISCOVER_IP_COUNTRY_FILE="D:/postgear-data/dbip-country-lite.csv"
   ```

4. Restart ([Move 3](#move-3-restart-postgear)).

### Once A Month

Run the command in step 2 again. It replaces the file with the new month's table.

- [ ] **DB-IP file done**

---

## Recipe 5: Instagram Competitors

| | |
|---|---|
| 🎯 **Switches on** | Following a competitor's **Instagram** on the Competitors tab. Instagram has no public feed, so Meta's official way is used: your workspace's own Instagram business account asks Meta about the other account |
| 💰 **Cost** | Free |
| ⏱️ **Time** | 30 minutes of your time, then Meta's review (days to weeks) |
| 🧾 **You need** | The Meta app you already use for publishing (`FACEBOOK_APP_ID`), an Instagram **Business or Creator** account linked to a Facebook Page, and that account connected in PostGear |

> No new key. What is missing is one **permission**. Meta's
> [Business Discovery page](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery)
> asks for `instagram_basic`, `pages_read_engagement` and
> `instagram_manage_insights`. PostGear asks for the first two today, not the
> third. Until it does, an Instagram competitor shows **Reconnect**.

### Part A: I Add The Permission To PostGear

1. Tell me "add the Instagram insights permission".
2. I add `instagram_manage_insights` to PostGear's Instagram connection and push it.

### Part B: Ask Meta For It

1. Go to **[developers.facebook.com/apps](https://developers.facebook.com/apps)** and open your **publishing** app (not the login app).
2. Find the permissions page. On newer dashboards it is under **Use cases**
   (then **Customize** on the Instagram use case); on older ones it is
   **App Review**, then **Permissions and Features**.
3. Find **`instagram_manage_insights`** and request **Advanced Access**.
4. Meta asks how you use it. Record a short screen video (1 to 2 minutes):
   1. Connect an Instagram business account in PostGear.
   2. Open **Discover**, then **Competitors**, then **Add Competitor**.
   3. Type a public business account's Instagram username and save.
   4. Show its posts appearing.
5. In the text box, explain: "We read the public posts of business accounts our
   customer chooses to follow, so they can plan their own content. Nothing is
   posted on anyone's behalf with this permission."
6. If Meta asks for **Business Verification**, complete it (company documents;
   this is usually the slow part).
7. Submit.

   ✅ The permission shows as **In review**.

### Part C: After Meta Says Yes

1. Switch the app to **Live** (a toggle at the top of the app dashboard).
2. In PostGear, every workspace **reconnects** its Instagram channel once
   (on the Instagram channel's **⋮** menu, choose **Reconnect**), so Meta grants
   the new permission.

### ✅ Check It Works

Add a competitor with an Instagram username. Its Instagram posts appear in its
group on the Competitors tab.

> 💡 You can try it **before** Meta approves: it already works for anyone with a
> role on the Meta app (admin, developer or tester).

### Good To Know

- Only **public Business or Creator** accounts can be followed. Personal and
  age-restricted accounts return nothing.
- The workspace must have its **own** Instagram business account connected.

- [ ] **Instagram permission done**

---

## Recipe 6: OpenAI API Key (Real AI)

| | |
|---|---|
| 🎯 **Switches on** | Real AI everywhere: Research This Competitor, Copilot, post drafts, SEO advice. Today your laptop uses a free stand-in (`AI_SIMULATION="true"`) |
| 💰 **Cost** | Paid, pay as you go, by the amount of text. See [openai.com/api/pricing](https://openai.com/api/pricing/) |
| ⏱️ **Time** | About 10 minutes |
| 🧾 **You need** | An OpenAI account and a payment card |

### Steps

1. Go to **[platform.openai.com](https://platform.openai.com)** and sign in.
2. Open **Settings**, then **Billing**. Add a payment method and a small amount
   of prepaid credit.
3. Open **Limits** and set a **monthly budget**, so a mistake can never run up a
   big bill.
4. Open **API keys** and click **Create new secret key**. Name it
   `PostGear local` and click **Create**.
5. **Copy the key now.** OpenAI shows it only once.
6. Open `.env` ([Move 1](#move-1-open-the-settings-file)) and paste both lines:

   ```env
   OPENAI_API_KEY="paste-your-key-here"
   AI_SIMULATION="false"
   ```

7. Restart ([Move 3](#move-3-restart-postgear)).

### ✅ Check It Works

Open **Copilot** and ask a short question. The answer reads like a real model,
not the stand-in, and your OpenAI usage page shows a small charge.

### To Go Back To Free

Set `AI_SIMULATION="true"` and restart.

- [ ] **OpenAI key done**

---

## Recipe 7: SerpApi Key

| | |
|---|---|
| 🎯 **Switches on** | Google News through SerpApi, a paid service with its own licence. Only if you pick **option C** in [Decisions](#decisions-that-need-no-key) |
| 💰 **Cost** | The free plan is reported as 250 searches a month (one source says 100). Paid plans start at $25 a month for 1,000 searches. Check [serpapi.com/pricing](https://serpapi.com/pricing) |
| ⏱️ **Time** | About 5 minutes |
| 🧾 **You need** | An email address |

### Steps

1. Go to **[serpapi.com](https://serpapi.com)** and click **Register**.
2. Confirm your email (and phone, if asked).
3. Open your **Dashboard** and copy **Your Private API Key**.
4. Open `.env` ([Move 1](#move-1-open-the-settings-file)) and paste both lines:

   ```env
   DISCOVER_NEWS_PROVIDER="serpapi"
   SERPAPI_API_KEY="paste-your-key-here"
   ```

5. Restart ([Move 3](#move-3-restart-postgear)).

### ✅ Check It Works

Open **Discover**, then **News**. Stories appear as before; your SerpApi
dashboard shows the searches used.

### To Go Back To Free

Set `DISCOVER_NEWS_PROVIDER="google"` and restart.

> 💡 Each fresh News group costs one search. Copies are cached and shared, but
> with real users 250 a month runs out fast, so plan on a paid plan if you switch.

- [ ] **SerpApi key done**

---

## Recipe 8: NewsData.io Key

| | |
|---|---|
| 🎯 **Switches on** | A spare news source, built in just in case |
| 💰 **Cost** | Free plan: 200 credits a day, articles delayed about 12 hours, no full text. Paid from about $199.99 a month. Confirm commercial use on [newsdata.io/pricing](https://newsdata.io/pricing) before relying on it |
| ⏱️ **Time** | About 5 minutes |
| 🧾 **You need** | An email address |

### Steps

1. Go to **[newsdata.io](https://newsdata.io)** and sign up.
2. Open your **Dashboard** and copy your **API key**.
3. Open `.env` ([Move 1](#move-1-open-the-settings-file)) and paste both lines:

   ```env
   DISCOVER_NEWS_PROVIDER="newsdata"
   NEWSDATA_API_KEY="paste-your-key-here"
   ```

4. Restart ([Move 3](#move-3-restart-postgear)).

### To Go Back To Free

Set `DISCOVER_NEWS_PROVIDER="google"` and restart.

- [ ] **NewsData.io key done**

---

## Recipe 9: Your Own Place Server

| | |
|---|---|
| 🎯 **Switches on** | City search that suggests as you type, with no limit of one search a second for the whole of PostGear |
| 💰 **Cost** | The software and the map are free; it needs a machine with plenty of memory (plan on 8 GB of RAM or more) and disk |
| ⏱️ **Time** | 1 to 3 hours, mostly waiting for the map to load |
| 🧾 **You need** | Docker |

### Steps

1. Open **Git Bash** (or a Linux server's shell) and run:

   ```bash
   docker run -d --name postgear-nominatim -p 8088:8080 \
     -e PBF_URL=https://download.geofabrik.de/asia/india-latest.osm.pbf \
     -v postgear-nominatim:/var/lib/postgresql \
     mediagis/nominatim:5.1
   ```

   It downloads India's map (over a gigabyte) and loads it. Check
   [the image's page](https://hub.docker.com/r/mediagis/nominatim) for the newest
   version number.
2. Wait until this address answers in your browser with a list (it can take hours):
   `http://localhost:8088/search?q=Chennai&format=json`
3. Open `.env` ([Move 1](#move-1-open-the-settings-file)) and paste:

   ```env
   DISCOVER_GEOCODER_URL="http://localhost:8088"
   ```

4. Restart ([Move 3](#move-3-restart-postgear)).

### ✅ Check It Works

Click the place button in Discover and start typing a city: suggestions appear
as you type.

- [ ] **Place server done**

---

## Going Live: Staging And Production

When you set up a live server (Railway or another host), do these once per
server:

1. **Copy your keys** from `.env` into the host's settings page (on Railway:
   the service, then **Variables**). Use the same names.
2. **Make a new worker key** for that server:
   1. Run `npm run generate:keys` exactly like that, **without** `--write`
      (`--write` would replace the keys on your laptop). It only prints new values.
   2. Copy the long value on the `AUTOMATION_INTERNAL_TOKEN` line.
   3. Put it in **both** the API's and the worker's settings on that host.
3. **Set the email settings** (`SMTP_HOST` and the others) so the weekly digest
   is emailed. On your laptop, without them, emails are printed in the API's
   terminal instead.
4. **Set the contact line** from [Recipe 3](#recipe-3-openstreetmap-contact-line).

---

## Decisions That Need No Key

1. **Research This Competitor**: open to **every member** (as now) or **admins
   only**? It costs the workspace 3 credits per run.
2. **Google's feeds** (from research 04, section 4):

   | Option | What it means | Trade-off |
   |---|---|---|
   | **A. Keep the free feeds** (what is built) | Google Trends and News feeds, with credits and links back | Best page on day one; Google could change or block the feeds |
   | **B. Clean sources only** | Drop Google; keep Wikipedia, YouTube, Bluesky, Mastodon, calendars, GDELT | No Google risk; loses state-level searches and much local news |
   | **C. Paid later** | A, plus SerpApi ([Recipe 7](#recipe-7-serpapi-key)) for workspaces that need it | Monthly cost; only when revenue justifies it |

---

## Sources

- Google: [YouTube Data API overview](https://developers.google.com/youtube/v3/getting-started) and [quota costs](https://developers.google.com/youtube/v3/determine_quota_cost)
- Google: [Trends API alpha](https://developers.google.com/search/apis/trends) and its [announcement](https://developers.google.com/search/blog/2025/07/trends-api)
- Meta: [Business Discovery reference](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery)
- SerpApi pricing as reported by [CostBench](https://www.costbench.com/software/web-scraping/serpapi/free-plan/) and [ScrapeGraphAI](https://scrapegraphai.com/blog/serpapi-pricing) (check [serpapi.com/pricing](https://serpapi.com/pricing))
- NewsData.io: [its blog on the free plan](https://newsdata.io/blog/?p=6514) and [SaaSworthy's copy of its pricing](https://www.saasworthy.com/product/newsdata-io/pricing)
- Nominatim: [mediagis/nominatim on Docker Hub](https://hub.docker.com/r/mediagis/nominatim)
- DB-IP: [db-ip.com](https://db-ip.com) (licence CC BY 4.0)
- PostGear's own Meta app setup: [docs/social-platform-setup.md](../social-platform-setup.md), section 1
