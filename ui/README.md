# UI reference

These files are the agreed look of the app. Each `.dc.html` file is one screen, written for a design canvas. Open one in a browser to see it roughly (the canvas script is missing, so it renders as a static page), or read it as markup. Build the real screens to match them, but use real data and real components. All listings, prices and people in them are made-up samples.

| File | Screen | Route |
| --- | --- | --- |
| `Main.dc.html` | Board: bucket tabs, listing cards, map, "since yesterday" | `/` |
| `Listing.dc.html` | One listing, fully checked | `/listing/[id]` |
| `Chat.dc.html` | Chat with the assistant | `/chat` |
| `Leads.dc.html` | Leads and sources, Facebook capture, roommates, paste | `/leads` |
| `Settings.dc.html` | Settings | `/settings` |

Compare (`/compare`) and Requirements (`/requirements`) have no mockup. Build them from the same parts: the detail page's rows side by side, and a list of requirements with pass, fail and Unknown counts.

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| `bg` | `#F5F5F2` | page background |
| `surface` | `#FFFFFF` | cards, header |
| `border` | `#E2E2DC` | card borders |
| `divider` | `#EEEEE9` | table rows |
| `ink` | `#16181D` | headings, primary dark buttons |
| `body` | `#2E3138` | body text |
| `muted` | `#5B5F68` | secondary text (passes 4.5:1 on white) |
| `accent` | `#1F4FD1` | primary buttons, pins, strong bars |
| `accent-strong` | `#183E9F` | text on `accent-soft`, link hover |
| `accent-soft` | `#E6EDFC` | active nav, soft chips |
| `warn-soft` / `warn-text` / `warn-border` | `#FCEFD9` / `#6E3B00` / `#F0D7AE` | Needs info, Estimate |
| `neutral-soft` / `neutral-text` | `#ECECE8` / `#42454C` | Fails, off states |
| `orange` | `#C2560E` | weak score bars, office marker |

- Fonts: Inter for text, Space Grotesk for headings and big numbers.
- Radius: cards 14 px, buttons and inputs 10 px, chips fully round.
- Every button, link and input is at least 44 px tall. Use real `button`, `a`, `input` and `label` elements.
- No gradients, emoji or coloured left borders.

## Buckets

| Bucket | Style |
| --- | --- |
| Passes | solid `accent`, white text |
| Likely passes | `accent-soft`, `accent-strong` text |
| Needs info | `warn-soft`, `warn-text` |
| Fails | `neutral-soft`, `neutral-text` |

The buckets differ in lightness as well as hue, and always carry their name, so they don't depend on colour alone.

## Provenance chips

Every cost line and fact shows where it came from: **Listing** (grey outline), **Landlord said** and **You** (`accent-soft`), **Fare table** or **API** (grey outline), **Estimate** (`warn-soft`).

## Rules shown in the mockups

- Numbers on cards come from the database, never from model text.
- The app drafts messages and never sends them: drafts always have a Copy button.
- Roommate leads show their video-call status. Nobody counts as a roommate until they've been met on video.
- The office is shown as "Your office". The real address stays in the private settings file.
