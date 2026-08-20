# Veetal Connect API — recipes

Runnable travel apps built on [Veetal Connect API](https://connect-api.veetal.app)
data. Each top-level folder is one self-contained recipe: clone the repo, put your
API key in the recipe's `.env`, run it.

Every recipe here has a page on the site with the walkthrough, the API call and the
FAQ: <https://connect-api.veetal.app/recipes>

## Recipes

| Recipe | What it does | Dataset |
| --- | --- | --- |
| [`import-hotel-reputation`](import-hotel-reputation) | Multi-OTA reputation report for a hotel — score, reviews and category breakdown, as a table, CSV and HTML | Feed · Reputation |
| [`google-reviews-widget`](google-reviews-widget) | A hotel's Google reviews rendering on its own website, behind a proxy that keeps the API key server-side | Feed · Reputation |
| [`rate-shopping-like-for-like`](rate-shopping-like-for-like) | Your comp set compared product by product — same board, same cancellation — instead of cheapest-per-hotel | Feed · Accommodation Rates |

## Getting a key

Start free with 100 API credits at
[connect-api.veetal.app/start-guide](https://connect-api.veetal.app/start-guide).
No credit card.

## Conventions

Recipes are meant to be read, so they stay deliberately small:

- **Node 20+, no dependencies** unless a recipe genuinely needs one. `fetch` and
  `--env-file` are built in.
- **One folder, one recipe.** No shared runtime between them — copying a folder out
  of this repo has to keep working.
- **`.env.example` in every recipe**, with the variables it reads and nothing else.
- **Fail with a sentence, not a stack trace.** A 401 means the key, a 404 means the
  slug, a 5xx means the API — say which.
- **Nothing secret, ever.** This repo is public and its history cannot be cleaned.
  `node check.mjs` blocks keys, customer data, internal hosts and oversized files;
  wire it as a pre-commit hook with `git config core.hooksPath .githooks`.

Writing a recipe with an agent? Point it at [AGENTS.md](AGENTS.md).

## Licence

MIT.
