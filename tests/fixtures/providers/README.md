# Recorded provider fixtures

Recorded with `npm run smoke -- --record` on 2026-11-20 against the neutral example settings, then validated and stripped to consumed fields. No keys, OAuth tokens, mailbox contents or private settings are stored here.

Google geocoding, transit, walk, bicycle and Places, Transitland and SUPost succeeded. SUPost records additionally replace titles, IDs, dates, prices, URLs and email domains with neutral values; category and verification fields retain their returned values.

Recorded on 2026-11-24, trimmed to the fields the clients read, from the demo listings and the example office:

- `transitland-walk-first.json`: a walk-only itinerary (1808 s) listed before a VTA bus trip (853 s). Checks that the quickest itinerary is chosen, not the first.
- `transitland-caltrain.json`: one trip with a Caltrain leg between two platform stops (with stop ids and coordinates) and a VTA bus leg. Checks that Caltrain stations are matched from stop points.
- `geoapify-places.json`: two of the 13 places Geoapify returned near the first demo listing (a supermarket and a cafe).

Overpass returned a network error. RentCast and Gmail credentials were blank in the loaded server environment. There are no fabricated live-response fixtures for these providers. Tests exercise their disabled or request-validation behavior and the fallback interface using normalized recorded Google results as client stubs. Successful RentCast, Overpass and Gmail payload handling still needs live verification when available.

Provider unit tests inject a transport and an in-memory migrated database. Failure scenarios deliberately corrupt recorded responses or inject HTTP and network failures; no unit test calls a live API.
