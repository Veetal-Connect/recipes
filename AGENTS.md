# Instructions for agents writing recipes

**This repository is public.** Anything committed here is readable by anyone,
forever — deleting a file later does not remove it from the git history. Read the
"Never commit" list below before you write a single line.

A recipe is a small, runnable travel app built on
[Veetal Connect API](https://connect-api.veetal.app) data. It has two homes: the
folder here, and a record in the `Recipes` table in Airtable that renders its page
on the site. Both have to be updated or the recipe is half-published.

## Never commit

These are the mistakes that cannot be undone. `node check.mjs` blocks all of them —
run it before every commit.

- **A real API key.** Not in code, not in a README example, not in a comment, not in
  `.env`. `.env` is gitignored; keep it that way. `.env.example` carries the variable
  names with **empty** values.
- **Real customer data.** No real accommodation slugs, account ids, location ids,
  hotel names or generated `report.csv` / `report.html`. Examples use placeholders:
  `YOUR_API_KEY`, `YOUR_ACCOMMODATION_SLUG`, `YOUR_LOCATION_ID`.
- **Internal or staging URLs.** Only these hosts belong here: `api.veetal.app`,
  `connect-api.veetal.app`, `dashboard.veetal.app`, `developers.veetal.app`,
  `mcp.veetal.app`, `github.com`, and localhost. Anything else is a leak of internal
  infrastructure.
- **`node_modules/`, build output, or any file over 1 MB.**

If a key ever does get committed, **rotating it is the fix** — rewriting history is
not enough, GitHub caches and forks keep the old objects. Say so immediately rather
than trying to quietly clean it up.

## How to write a recipe

Follow the conventions in the [README](README.md) — Node 20+, no dependencies, one
self-contained folder, errors explained in a sentence. On top of those:

- **Never invent an endpoint.** Every call must exist in the Veetal API. If you are
  not certain of a path, its parameters or its response shape, verify it against
  <https://developers.veetal.app/> or the MCP before writing code around it. A recipe
  that 404s is worse than no recipe.
- **Say what it costs.** Real Time calls and Feed imports burn credits. If a recipe
  can run up a bill (a loop over a comp set, a date range), the README says so before
  the run command, not after.
- **Feed datasets need an import first.** They only return what a previous import
  wrote. If your recipe reads a Feed endpoint, the README states the dashboard setup
  it assumes.
- **The recipe must actually run.** Add a `test.mjs` that exercises the parsing and
  formatting with fixture data — no network, no key. `node test.mjs` has to pass.

## Registering it

A new folder alone changes nothing on the site. Also:

1. Add a row to the **Recipes** table in the README.
2. Create the record in **Airtable** (`Recipes` table, base `appRgZPZ1snwMeMqU`) with
   `Kind = code`, and fill `Repo_url`, `Repo_folder`, `Stack` and `Run_command`.
   - `Repo_url` is `https://github.com/Veetal-Connect/recipes` — the whole repo.
   - `Repo_folder` is the folder name only, e.g. `import-hotel-reputation`.
   - `Run_command` starts with `git clone …` and `cd recipes/<folder>` — note the
     clone directory is `recipes`, not the folder name.
3. Leave `Published` unchecked until a human has reviewed it. Unpublished recipes
   still ship in the site's page payload, so **a draft is not a private draft** —
   the same "never commit" rules apply to Airtable content.
4. The site reads from a synced JSON, so the recipe appears only after
   `npm run "sync airtable"` in the `connect-api-web` repo.

## Git

- Work on a branch and open a pull request. **Never push to `main` directly and never
  force-push** — this repo is public and forks pick up rewritten history.
- One commit per logical change, with a message that says why, not what.
- Run `node check.mjs` before committing. It is also wired as a pre-commit hook via
  `git config core.hooksPath .githooks`.
