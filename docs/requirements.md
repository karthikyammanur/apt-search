# Palo Alto Apartment Finder: Requirements

Nov 18, 2026 · @goat

## Goal

A browser web app that works with me, through conversation, to find one place to live near my office (Palo Alto to start, anywhere in California) from early January to mid-August 2027, at or under $2,500 a month all-in. It is a search partner, not a filter: it learns what I care about, ranks options with reasons, and gets sharper every time I react to a listing.

## My settings (editable)

These are my starting values, not hard-coded. I can change any of them on a Settings page or in chat, and the tool rechecks every saved listing. Scope: one user (me), any office location in California.

| Fact | Value |
| --- | --- |
| Reason for move | Software engineering intern at a tech company in Palo Alto, full-time in office |
| Office | Palo Alto. The exact address lives only in my private settings file, never in the repo |
| Start date | Mon Jan 11, 2027 |
| Move-in window | Sat Jan 2 to Fri Jan 8, 2027 (settled the week before) |
| End date | Fri Aug 13, 2027 (about 7 months total) |
| Car | None. Walking, transit and bike only |
| Budget | $2,500/month all-in, hard cap. This is my housing stipend; staying under it keeps my regular pay untouched |
| Roommates | OK, if I can talk to or meet them online before committing. Private bedroom and private bathroom required |
| Familiarity | Never been to California. The tool must explain areas from zero |

## Hard requirements (dealbreakers)

A listing that fails any of these is excluded, enforced in code. The AI cannot override them. Items marked (default) are my starting values and I can change them in the app.

1. **All-in monthly cost is $2,500 or less**, using the cost model below. $2,501 is a fail.
2. **Move-in by Jan 8, 2027** at the latest.
3. **Lease fits Jan to Aug 13, 2027.** Accept: a 7 to 8 month lease, month-to-month, a sublet, or a 12-month lease with a written break or sublet clause. Any break fee counts toward the cost cap.
4. **Commute without a car is 30 minutes or less** door to office, weekday 8 to 9 am.
5. **Transit stop within a 10-minute walk** with service at least every 30 minutes at rush hour (default).
6. **Private bedroom and private bathroom.** No shared bathroom.
7. **Furnished.** At minimum a bed, desk, chair and an equipped kitchen.
8. **Passes every scam check** in the trust section, or the failed check is resolved.
9. **Roommate listings only:** I can message or video call the roommates before signing.

## True monthly cost model

The number checked against $2,500 is the real monthly cost, not the advertised rent. Code computes it; every line is labeled **Confirmed** (from the listing or landlord) or **Estimated** (with its source).

```latex
\text{All-in monthly} = \text{rent} + \text{recurring costs} + \frac{\text{one-time non-refundable costs}}{\text{months of stay}}
```

| Line item | Type | How the tool gets it |
| --- | --- | --- |
| Base rent | Recurring | Listing |
| Electric, gas, water, sewer, trash | Recurring | Listing if included; otherwise estimate for the unit size, or my share if split |
| Internet | Recurring | Listing if included; otherwise estimate |
| Renter's insurance | Recurring | Only if the lease requires it; estimate |
| Mandatory fees (amenity, admin, valet trash, bundled parking) | Recurring | Listing or landlord |
| Short-term lease premium | Recurring | Listing or landlord |
| Application, admin, holding and broker fees | One-time, spread over stay | Listing or landlord |
| Non-refundable part of any deposit | One-time, spread over stay | Lease |
| Lease break fee (12-month leases only) | One-time, spread over stay | Lease |
| Setup items the furnished place lacks | One-time, spread over stay | Small gaps only (bedding, towels, kitchen basics); estimate |
| Refundable security deposit | Upfront cash, not monthly | Shown separately as cash I need before move-in |

Rules:

- If the cap check only passes because of estimates, flag it: "Passes on estimates, confirm utilities with landlord."
- The $2,500 cap covers housing only. The tool also shows housing plus a monthly transit pass, and ranks a listing higher when both fit under $2,500 (strong preference, not a dealbreaker).

## Location and neighborhood

The search area is wherever the commute passes, not just Palo Alto. At $2,500 all-in, a whole apartment in Palo Alto is unlikely. Listings found on 2026-11-18 show private rooms in shared Palo Alto houses at roughly $1,500 to $2,500 a month ([HotPads](https://hotpads.com/palo-alto-ca/rooms-for-rent), [ForRent](https://www.forrent.com/ca/palo-alto/233-homer-ave/e6vbcjm), [Furnished Finder](https://www.furnishedfinder.com/property/874920_1)). So the search area is built from the commute limit around whatever office address is set. For Palo Alto, that pulls in Mountain View, Menlo Park, Redwood City, Sunnyvale and East Palo Alto.

For each listing the tool shows:

| Factor | What it measures | Default target |
| --- | --- | --- |
| Commute | Door-to-office time by transit and walking, weekday 8 to 9 am, from real schedules; full route shown (walk, train or bus, walk) | 30 min or less (hard) |
| Bike commute | Same trip by bike, since a bike may beat transit for short trips | Shown, not scored |
| Transit access | Nearest stops, walk time, lines, rush-hour and weekend frequency; a regional rail station nearby scores higher (Caltrain in the Bay Area) | Stop within 10 min walk (hard) |
| Grocery | Nearest full grocery store, by name and walk time | 10 min walk |
| Gym | Nearest gyms, by name, walk time and monthly price if found | 15 min walk |
| Cafes | Cafes within walking distance, by name | 2 or more within 10 min walk |
| Safety and feel | Plain-English summary for someone new: noise, lighting for walking home at night, what the area is like; every claim sourced | Shown, I judge it |

The soft factors (grocery, gym, cafes, transit quality, feel) are weighted. The weights start equal and change as I react to listings.

## Roommates

Roommate listings are allowed, but none is marked ready to sign until I have logged a message thread or video call with the people I would live with.

- **Listing types:** room in a shared house, room in an apartment, and co-leasing a 2-bedroom with someone I find.
- **Who's there:** for each listing, show how many people live there and what the listing says about them (work, schedule, house rules).
- **My roommate profile:** I fill it in once (schedule, cleanliness, guests, noise, cooking). The tool uses it to write intro messages.
- **Call prep:** a short question list for the video call: sleep and work schedules, cleaning, guests, noise, shared kitchen and fridge, smoking, how bills are split.
- **Tracking:** per roommate: Messaged, Call scheduled, Met, plus my notes on the vibe.
- **I send everything myself.** The tool drafts messages; it never sends anything on my behalf.

## Reviews, trust and scam protection

I am renting sight unseen from Texas, which is exactly who rental scams target, so trust checks are a dealbreaker, not a nice-to-have.

**Reviews**

- Apartment buildings: summarize Google, Yelp and Reddit (r/paloalto, r/bayarea) reviews for the building and its management company. Show repeated themes with counts, weight the last 2 years higher, and link every source.
- Private rooms: building reviews rarely exist. Use host reviews where the site has them (Furnished Finder, Airbnb), and otherwise suggest asking the landlord for a past tenant reference.
- Never write a review summary without links to the reviews it came from.

**Scam checks** (each shown as Pass, Fail or Unknown)

1. Price far below similar listings in the same area.
2. Landlord won't do a live video tour.
3. Asks for wire, Zelle, gift cards or crypto before a signed lease.
4. "I'm overseas, I'll mail you the keys" or similar.
5. Same photos appear on other listings (reverse image search).
6. Pressure to pay a holding deposit fast.
7. Address doesn't match the photos or Street View, or the person isn't the owner or property manager on record.

Rule: the tool never suggests paying anything before a live video tour and a written lease.

## How the tool works with me

The tool runs a loop: interview, suggest, listen, adjust. It keeps going until I have one place I'm confident in.

1. **Intake interview.** One question at a time, about 10 minutes. It separates dealbreakers from preferences and has me rank the preferences. It explains tradeoffs I wouldn't know as a newcomer (for example, Palo Alto room vs Mountain View studio).
2. **First batch.** 5 to 10 options, ranked. Each one gets a line on why it's here and a line on the catch.
3. **I react.** Thumbs up or down plus a reason in my own words ("too far from Caltrain", "love the kitchen"). The tool says what it learned and how it changed the weights, so I can correct it.
4. **Deep dive.** For any listing: full cost breakdown, commute route, neighborhood summary, reviews, scam checks, and questions to ask the landlord.
5. **Compare.** 2 to 4 shortlisted places side by side.
6. **Next steps.** Draft messages to landlords and roommates, track replies, and schedule video tours.

Behavior rules:

- Remembers my preferences, shortlist and notes between sessions.
- Pushes back: if I contradict myself, or a listing barely passes a requirement, it tells me.
- Explains every ranking in plain English. No unexplained scores.

## Getting listings in

Listings arrive automatically through channels that are free and allowed. Pasting is only a fallback. The tool must keep working if any one channel breaks.

- **Automatic (v1).** A daily SUPost poll for rooms, shares and sublets; new-listing alert emails from my Craigslist and Zillow/HotPads saved searches, read from Gmail (read-only, email body only, links never opened); a RentCast search for studios near the office.
- **One click (v1).** A Send to finder browser button for pages I open myself (Furnished Finder, SabbaticalHomes, Airbnb monthly stays, Facebook, Diggz, Roomies). It sends the page text and its photo links.
- **Facebook groups (v1).** Email notifications from my best housing groups, a capture button that sends the posts I'm scrolling past, and a daily 10-minute round of saved group searches. Posts from people looking for a roommate go to a separate list, so I can find another intern to rent with.
- **Paste (fallback).** Text or screenshots in chat.
- **Optional, off by default.** An Apify Craigslist scraper on Apify's free $5 monthly credit. It breaks Craigslist's terms, so it only runs if I turn it on.
- **Search links.** For sites with no channel, the tool builds ready-made search links from my requirements.
- **Dedupe.** Recognize the same place posted on several sites.
- **Re-check.** Mark when each listing was last confirmed available.

## Web app

A single-user browser app with the chat always on screen. It also works on my phone, so I can check listings on the go.

| Screen | What it does |
| --- | --- |
| Chat | Main panel, always visible. The interview, suggestions and feedback all happen here |
| Map | Office pin, listings, Caltrain stations and bus stops, grocery, gym and cafe pins, and a commute-time area around the office |
| Shortlist board | Columns: New, Interested, Contacted, Video tour, Applied, Rejected. Drag cards between them. Each card shows the listing's main photo |
| Listing detail | Photo gallery (when the listing has photos), cost breakdown, commute route, neighborhood summary, reviews, scam checks, landlord questions, my notes |
| Compare | 2 to 4 listings side by side, with the winner per row highlighted |
| My requirements | Editable dealbreakers and ranked preferences. Changes from chat show up here too |

Access is locked to me with a simple password. It runs locally or on free hosting.

## What "works 100%" means

The AI never makes up a number or a fact. Code and real data sources handle facts; the AI handles judgment and conversation.

| Code does | AI does |
| --- | --- |
| All costs and the $2,500 check | Intake interview and follow-up questions |
| Distances, walk, bike and transit times (from a maps or transit API) | Reading messy listing text into fields |
| Dealbreaker filtering | Summarizing reviews into themes |
| Scam checks that can be automated (price vs area, duplicate photos) | Explaining tradeoffs and rankings |
| Saving preferences, shortlist and history | Drafting messages and call questions |

Rules:

- Every fact shows its source and the date it was checked.
- Missing information shows as Unknown, never a guess.
- Acceptance test before I trust it: 10 real listings with costs and commutes I've checked by hand. The tool must match all 10.

## Timeline, scope and open questions

**Proposed timeline**

1. Nov 18 to 25: build and test v1.
2. Nov 25 to Dec 18: search, react, message landlords and roommates, do video tours.
3. By Dec 18: sign a lease. This leaves margin before the holidays slow replies.
4. Jan 2 to 8: fly in and move in.

**Out of scope for v1:** applying or signing inside the app, payments, sending messages automatically, multiple users, buying furniture.

**Open questions**

- [ ] Exact office address (ask the recruiter). Until then, use the placeholder above.
- [ ] Stipend timing and upfront cash: answered; details are in my private Manual Tasks doc.
- [ ] Does my employer offer intern housing help, a corporate housing partner, or a transit benefit? (ask the recruiter)

## Sources

- [HotPads Palo Alto rooms](https://hotpads.com/palo-alto-ca/rooms-for-rent), [ForRent 233 Homer Ave](https://www.forrent.com/ca/palo-alto/233-homer-ave/e6vbcjm) and [Furnished Finder Palo Alto room](https://www.furnishedfinder.com/property/874920_1), room price range
