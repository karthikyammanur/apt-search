# Provider clients

All clients return `Result<T>` with string error codes. Import clients and fallback helpers from `src/lib/providers/index.ts` on the server. Coordinates use `{ lat, lng }`. Route durations are rounded up to integer minutes. Missing line names and step durations stay null. Listing prices remain the provider's raw USD fields for the intake boundary to handle later.

`cachedFetch(provider, { url, init?, schema, classify?, memoryOnly? }, ttlMilliseconds)` validates responses before caching and on cache reads. It hashes URL, method, headers and body, and stores only the hash and validated response in `api_cache`. OAuth responses are memory-only. A cache failure returns `network` and does not spend API quota. Run the existing database migrations before using clients.

Successful cache hits bypass rate gates. Request budgets per minute per running process: Google 60 shared across its APIs, Transitland 10, Geoapify 60, Overpass 2, SUPost 30, RentCast 5, Gmail 60. HTTP 429 honors Retry-After; 5xx retries once within the budget. Each request has a 20-second timeout and rejects redirects. Daily Google quota errors persist a conservative 24-hour pause in `api_cache`, shared across instances. The short-term budgets are per process, not a distributed rate limiter. Concurrent requests can consume separate quota even for the same cache key.

Routes cache for 6 hours, geocodes for 30 days, POIs for 1 day, SUPost for 5 minutes, RentCast for 1 day, Gmail reads for 1 minute. These are prototype defaults, not provider quota guarantees. Credentials are read from server environment variables at call time. No client reads environment files.

Fallback helpers try Google first, then Transitland for transit or Geoapify for walking, cycling and geocoding. Success adds `provider` to the result. If both fail, the last provider's error is returned. Transitland converts the requested instant to California local date/time and disables fallback service dates so an expired feed cannot silently substitute a different travel date.

SUPost supports `listings("rooms" | "shares" | "sublets", cursor?)`, using `cat=housing` with separate supported full-text searches. Its public API has no subcategory parameter and exposes no listing body. These searches can overlap and do not guarantee an exact subcategory match. Intake must retain canonical links and handle deduplication without downloading listing pages.

Gmail uses only refresh-token exchange and GET requests for message listing, full messages and text-body attachments. `listMessages(since, pageToken?)` returns one page under `label:housing-alerts`; callers follow `nextPageToken`. `getMessage(id)` decodes nested base64url plain text and HTML, including text stored as attachments. HTML remains untrusted text for the intake layer. Links are never opened. Provision the refresh token with `https://www.googleapis.com/auth/gmail.readonly`; if the exchange reports a different scope, the client rejects it.

Run `npm run smoke` for one probe per implemented API operation. Next's standard environment loader initializes server variables. Only `config/settings.example.json` supplies the example office address. The runner prints status codes, never response bodies or credentials, and explicitly reports whether Google's result contains a TRANSIT step. When both geocoders are unavailable it clearly identifies its neutral example coordinate fallback. `npm run smoke -- --record` saves validated public response fixtures; SUPost titles, IDs, prices and domains are sanitized. It never records Gmail tokens or mailbox content. Disabled keys produce no requests. A Gmail probe may additionally retrieve one message if a labeled message is available.

Official contracts checked on 2026-11-20:

- [Google Routes](https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes), [Places Nearby Search](https://developers.google.com/maps/documentation/places/web-service/nearby-search), [Geocoding v4](https://developers.google.com/maps/documentation/geocoding/geocoding), [Demo Key](https://developers.google.com/maps/demo-key)
- [Transitland routing OpenAPI](https://transit.land/api/v2/routing/openapi.json)
- [Geoapify geocoding](https://apidocs.geoapify.com/docs/geocoding/forward-geocoding/), [routing](https://apidocs.geoapify.com/docs/routing/)
- [Overpass QL](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL)
- [SUPost OpenAPI](https://supost.com/api/public/openapi.json)
- [RentCast long-term listings](https://developers.rentcast.io/reference/rental-listings-long-term)
- [Gmail list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list), [get](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get), [attachments](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages.attachments/get), [OAuth refresh](https://developers.google.com/identity/protocols/oauth2/web-server#offline)
