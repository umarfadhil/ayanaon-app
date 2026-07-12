# AyaNaon Gather Actor

External scraper used by the AyaNaon **Gather Pins** admin tab. It emits normalized dataset rows with `title`, `description`, `category`, `link`, `startDate`, `endDate`, `lat`, `lng`, and up to three source `images` URLs when available.

Netlify also supplies internal `excludeExternalIds` and `excludeLinks` arrays. Adapters skip known rows before detail requests/geocoding and continue paging until they collect the requested number of new items.

## Deploy

1. Create an Apify Actor and push this directory with `apify push`.
2. Enable Apify Proxy for the account. Browser sources use an Indonesian residential proxy when `APIFY_PROXY_GROUPS` includes `RESIDENTIAL`; API sources use ordinary HTTP.
3. Add `APIFY_API_TOKEN` and `APIFY_GATHER_ACTOR_ID` to the AyaNaon Netlify environment.

If Apify reports `Actor version was not found`, inspect the build immediately above it. A schema validation error prevents Apify from creating the runnable version; fix the schema, run `npx apify-cli validate-schema .actor/input_schema.json`, then push again.

Static outlet sources (`michelin`, `pertamina`, and `spklu`) do not naturally provide event dates. Their drafts intentionally keep start/end dates empty so AyaNaon will not publish them until an editor makes an explicit date decision.
