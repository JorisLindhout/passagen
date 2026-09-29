A first-person maze of plain corridors. The art is the only strong color. The maze is built in the browser from a seed. A Cloudflare Worker chooses twelve licensed pictures for that same seed and caches them.

The shareable URL is `/#/<seed>`. The same seed rebuilds the same corridors and asks the Worker for the same list.

## Stack

Vite and TypeScript, current Three.js, no framework. `@cloudflare/vite-plugin` runs the Worker in development. `wrangler deploy` publishes it. The Vite build is the site. Routes under `/api/` are the Worker. One KV namespace, `ART`, stores the chosen works and their image URLs. One secret, `SMITHSONIAN_API_KEY`, from [api.data.gov](https://api.data.gov/).

The browser never calls a museum. `GET /api/works?seed=` returns the list, with image paths of `/api/image/<id>`. `GET /api/image/<id>` loads the upstream URL stored in KV. The client cannot pass a URL. JSON and image bytes are cached for seven days.

## Develop

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

The Smithsonian key is optional. Without it, those two slots are filled from the Met and the Art Institute of Chicago. Put a real key in `.dev.vars` for local development, and set the deployed secret with:

```bash
npx wrangler secret put SMITHSONIAN_API_KEY
```

## Deploy

```bash
npm run deploy
```

Wrangler provisions the `ART` namespace when it is not bound to an existing id. The static assets use single-page fallback, and `/api/*` runs the Worker first.

## Maze

A 21×21 grid. Each cell is 2.4 m, so the maze is about 50 m across and a corridor is wide enough to stand in front of a picture. Walls are 3.2 m everywhere. There is no courtyard, no colored wings, and no map.

The grid starts black. The center cell is white. Until nothing matches, every horizontal or vertical `W B B` is found, one is picked with a seeded RNG, and it is written `W A W`. White and A cells are floor. Black cells are walls. Four extra walls between adjacent floor cells are opened, also from the seed, so a few loops exist.

You spawn in a dead end, looking down the only opening. Eye height is 1.6 m, the body radius is 0.32 m, and top speed is 1.3 m/s. There is no jump and no sprint.

## Pictures

Twelve works, in quota: three from the Met (different departments), two from the Art Institute of Chicago (different places of origin), two from Cleveland (different departments, dates spread), two from the Smithsonian (different units, CC0 media only), and three from Openverse (`painting`, `print`, `photograph`, different creators, `license=cc0,by`).

Only public domain, CC0, and CC BY are kept. If more than four resolve to Europe, the extras are replaced from non-European departments. A dead API still leaves eight known CC0 images on the walls, shipped in the client.

A plaque fades in within 2.2 m when the work is near the center of view. It is a live region, so the title is not locked inside the canvas. CC BY plaques include the artist’s name.
