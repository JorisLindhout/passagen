A first-person maze of plain corridors that never ends. The art is the only strong color. The mazes are built in the browser from a seed. A Cloudflare Worker chooses licensed pictures from museums around the world and caches them.

The shareable URL is `/#/<seed>`. The same seed rebuilds the same chain of corridors and asks the Worker for the same lists.

## Stack

Vite and TypeScript, current Three.js, no framework. `@cloudflare/vite-plugin` runs the Worker in development. `wrangler deploy` publishes it. The Vite build is the site. Routes under `/api/` are the Worker. One KV namespace, `ART`, stores the chosen works and their image URLs. One secret, `SMITHSONIAN_API_KEY`, from [api.data.gov](https://api.data.gov/).

The browser never calls a museum. `GET /api/works?seed=<seed>.<n>` returns a list of twelve, with image paths of `/api/image/<id>`. Maze k asks for lists 2k and 2k+1. `GET /api/image/<id>` loads the upstream URL stored in KV. The client cannot pass a URL. JSON and image bytes are cached for seven days.

## Develop

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

The Smithsonian key is optional. Without it, that slot is filled from the Art Institute of Chicago. The other sources need no key. Put a real key in `.dev.vars` for local development, and set the deployed secret with:

```bash
npx wrangler secret put SMITHSONIAN_API_KEY
```

## Deploy

```bash
npm run deploy
```

Wrangler provisions the `ART` namespace when it is not bound to an existing id. The static assets use single-page fallback, and `/api/*` runs the Worker first.

## Maze

Each maze is a 15×15 grid of 2.4 m cells, 36 m across, so a corridor is wide enough to stand in front of a picture. Walls are 3.2 m everywhere. There is no courtyard, no colored wings, no map, and nothing marks where one maze ends and the next begins.

A maze is carved with MarkovJunior's backtracker, written directly in TypeScript. `RBB=GGR` moves the red head forward two cells. When nothing matches, `RGG=WWR` walks it back along its gray path. Forward steps prefer turns three to one and never go straight a third time. Two walls are opened where their sides are at least 20 cells apart along the corridors, which makes long loops. The seed tries up to twelve variants of each maze and keeps the first whose longest straight line is 9 cells or less, so no view is longer than 21.6 m.

Every maze has an exit on the edge farthest along the corridors from where you came in. The exit is on a different side and at least 12 cells away. It is a gap in the outer wall that leads straight into the next maze. You see the maze you are in and one maze on each side. When you cross into the next maze, the maze two back is hidden, the maze two ahead is shown, and the gaps at both far ends are closed with ordinary wall. No line of sight reaches those gaps from where the change happens, so the walk feels like one endless building. Going back rebuilds the earlier mazes from the same seed.

You spawn in a dead end of the first maze, looking down the only opening. Eye height is 1.6 m, the body radius is 0.32 m, and top speed is 1.3 m/s. There is no jump and no sprint.

## Light

Light comes from above. Every ceiling cell holds a glowing diffuser panel, and a hemisphere light makes the floor brightest, the walls warm white, and the ceiling a little dimmer. There are no shadow maps. The shadows a museum cannot fully avoid are painted into textures instead: a soft darkening where the walls meet the floor and ceiling, deeper in corners, and a faint shadow below each frame, which stands a few centimeters off the wall.

## Pictures

Each maze hangs twenty frames: the back wall of every dead end, the wall a corridor runs into at a turn or a T, and then the straight runs, one wall per run. Frames stay at least 3.4 m apart.

A list holds twelve works, one per search, and the searches run in parallel:

- two from the Met (different departments)
- one or two from the Art Institute of Chicago (different places of origin)
- one from Cleveland
- one from the Smithsonian (CC0 media only, when the key is set)
- one from Openverse (`license=cc0,by`)
- one from [SMK](https://open.smk.dk/), the National Gallery of Denmark (public domain, mostly paintings)
- two from the [Wellcome Collection](https://wellcomecollection.org/) in London (public domain mark, CC0, and CC BY; searches such as Chinese painting, Indian painting, Persian, Japanese woodcut)
- three from museum collections on [Wikimedia Commons](https://commons.wikimedia.org/): the Tokyo and Kyoto National Museums, the National Palace Museum in Taipei, the National Museum of Korea, the Museu Nacional de Belas Artes in Rio, the Pinacoteca and Museu Paulista in São Paulo, the Museo de Arte de Lima, the Museo Nacional de Colombia, Te Papa in Wellington, the State Library of New South Wales, and Nigerian works in museum collections

Only public domain, CC0, and CC BY are kept; Commons files under share-alike licenses are skipped. If more than four in a list resolve to Europe, the extras are replaced from non-European sources. A maze skips any work the three mazes before it already showed. Each maze's lists are requested two mazes ahead, so the pictures are loaded before you arrive. A dead API still leaves eight known CC0 images on the walls, shipped in the client.

A plaque fades in within 2.2 m when the work is near the center of view. It is a live region, so the title is not locked inside the canvas. CC BY plaques include the artist’s name.
