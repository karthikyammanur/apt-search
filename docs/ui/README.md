# UI reference

These files are the agreed look of the app: minimal, one narrow column, white space instead of boxes. Each `.dc.html` file is one screen, written for a design canvas. Open one in a browser to see it roughly (the canvas script is missing, so it renders as a static page), or read it as markup. Build the real screens to match them, using real data and real components. All listings, prices and people in them are made-up samples.

| File | Screen | Route |
| --- | --- | --- |
| `Main.dc.html` | Listings: one-line rows, bucket tabs, Map toggle | `/` |
| `Listing.dc.html` | One listing | `/listing/[id]` |
| `Chat.dc.html` | Chat | `/chat` |
| `Leads.dc.html` | Sources, roommates, paste | `/leads` |
| `Settings.dc.html` | Settings | `/settings` |
| `Extension.dc.html` | Browser extension popup | `extension/` |

Compare (`/compare`) and Requirements (`/requirements`) have no mockup. Build them in the same style: the detail page's rows side by side, and a plain list of requirements with pass, fail and Unknown counts.

## Principles

- One column, content at most 760 px wide, centred. No sidebars, no cards with borders or shadows.
- Separate things with space and 1 px hairlines, not boxes.
- One listing is one line: photo thumbnail, title, "price · commute · area", score.
- Show the summary and fold the detail away (`<details>` for the requirement checks).
- Only one primary button per screen (black). Everything else is a plain text button or link.
- Black and white, plus blue for scores and good states and amber for things that need attention.

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| `bg` | `#FFFFFF` | page |
| `ink` | `#111111` | text, primary button |
| `muted` | `#6B6E76` | secondary text, inactive nav (passes 4.5:1 on white) |
| `line` | `#ECECEC` | hairlines |
| `field` | `#DDDDDA` | input borders |
| `fill` | `#F2F2F0` | your chat messages |
| `thumb` | `#E9E9E6` | photo placeholder |
| `accent` | `#1F4FD1` | scores, "passes" dot, good states |
| `attention` | `#8A4B00` | Unknown facts, estimates, "capture due" |

- One font: Inter, weights 400, 500 and 600.
- Sizes: page title 28 px, listing title 26 px, body 15 px, small 13 to 14 px.
- Radius: 8 to 12 px on thumbnails and inputs, fully round on the chat input.
- Every button, link and input is at least 44 px tall. Use real `button`, `a`, `input` and `label` elements.
- No gradients, emoji, icons for decoration, or coloured backgrounds on sections.

## Buckets

Shown as text tabs with counts ("Passes 3", "Likely 2", "Needs info 6", "Fails 14"). The active tab is ink with a 2 px underline; the others are muted. On the detail page the bucket is one line with a small dot: blue for passes and likely, amber for needs info, muted for fails, and always the words, never colour alone.

## Provenance

Every cost line names its source in small muted text after the label: "· listing", "· landlord said", "· you", "· fare table". Estimates use the attention colour: "· estimate".

## Rules shown in the mockups

- Numbers come from the database, never from model text.
- The app drafts messages and never sends them: drafts always have a Copy button.
- Roommate leads show their video-call status. Nobody counts as a roommate until they've been met on video.
- The office is shown as "Your office". The real address stays in the private settings file.
