# Recorded provider fixtures

Recorded with `npm run smoke -- --record` on 2026-11-20 against the neutral example settings, then validated and stripped to consumed fields. No keys, OAuth tokens, mailbox contents or private settings are stored here.

Google geocoding, transit, walk, bicycle and Places, Transitland and SUPost succeeded. SUPost records additionally replace titles, IDs, dates, prices, URLs and email domains with neutral values; category and verification fields retain their returned values.

Overpass returned a network error. Geoapify, RentCast and Gmail credentials were blank in the loaded server environment. There are no fabricated live-response fixtures for these providers. Tests exercise their disabled or request-validation behavior and the fallback interface using normalized recorded Google results as client stubs. Successful Geoapify, RentCast, Overpass and Gmail payload handling still needs live verification when available.

Provider unit tests inject a transport and an in-memory migrated database. Failure scenarios deliberately corrupt recorded responses or inject HTTP and network failures; no unit test calls a live API.
