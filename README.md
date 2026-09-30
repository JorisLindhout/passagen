# Passagen

A first-person maze of plain corridors that never ends. The art is the only strong color. The mazes are built in the browser from a seed. A Cloudflare Worker chooses licensed pictures from museums around the world, steered by what the visitor stops to look at, so no two walks hang the same pictures.

The URL is `/#/<seed>`. The same seed rebuilds the same chain of corridors, but the pictures are chosen anew for every visit.

## Stack

Vite and TypeScript, current Three.js, no framework. `@cloudflare/vite-plugin` runs the Worker in development. `wrangler deploy` publishes it. The Vite build is the site. Routes under `/api/` are the Worker. One KV namespace, `ART`, stores the image URL of every work handed out. One Workers AI binding, `AI`, runs the curator. One secret, `SMITHSONIAN_API_KEY`, from [api.data.gov](https://api.data.gov/). Two variables: `CURATOR` (`on` or `off`) and `CURATOR_MODEL`.

The browser never calls a museum. `POST /api/works` takes `{ count, seen, taste }` and returns one maze's works, with image paths of `/api/image/<id>`. The answer is never cached. `GET /api/image/<id>` loads the upstream URL stored in KV. The client cannot pass a URL. Image bytes are cached for seven days.

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

Workers AI always runs on Cloudflare, even under `npm run dev`, and bills the account Wrangler is logged in to. Production uses `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (set in `wrangler.jsonc`). `.dev.vars` switches local development to `@cf/meta/llama-3.1-8b-instruct-fp8`, and `CURATOR=off` there skips the AI entirely. After changing `wrangler.jsonc`, run `npm run cf-typegen`.

## Deploy

```bash
npm run deploy
```

Wrangler provisions the `ART` namespace when it is not bound to an existing id. The static assets use single-page fallback, and `/api/*` runs the Worker first.

## Maze

Each maze is a 15×15 grid of 2.4 m cells, 36 m across, so a corridor is wide enough to stand in front of a picture. Corridor walls are 3.2 m. There is no courtyard, no colored wings, no map, and nothing marks where one maze ends and the next begins.

Every two to four mazes, one holds a hall. It is a rectangle from 5×7 to 7×11 cells (12 by 17 m up to 17 by 26 m), with a ceiling between 4.2 and 5.4 m, higher for larger halls. The hall is laid over the carved maze, so every corridor that ran through it now ends at its wall. Where several corridors reach the hall from the same part of the maze, all but one are walled up, which leaves a few doorways. Above each doorway, the wall comes down to the corridor ceiling. The straight-line limit applies only to corridors. A hall variant is dropped if its entry and exit gaps can see each other, because the mazes beyond both gaps change when you step through one.

A maze is carved with MarkovJunior's backtracker, written directly in TypeScript. `RBB=GGR` moves the red head forward two cells. When nothing matches, `RGG=WWR` walks it back along its gray path. Forward steps prefer turns three to one and never go straight a third time. Two walls are opened where their sides are at least 20 cells apart along the corridors, which makes long loops. The seed tries up to twelve variants of each maze and keeps the first whose longest straight line is 9 cells or less, so no view is longer than 21.6 m.

Every maze has an exit on the edge farthest along the corridors from where you came in. The exit is on a different side and at least 12 cells away. It is a gap in the outer wall that leads straight into the next maze. You see the maze you are in and one maze on each side. When you cross into the next maze, the maze two back is hidden, the maze two ahead is shown, and the gaps at both far ends are closed with ordinary wall. No line of sight reaches those gaps from where the change happens, so the walk feels like one endless building. Going back rebuilds the earlier mazes from the same seed and hangs the pictures they had.

You spawn in a dead end of the first maze, looking down the only opening. Eye height is 1.6 m, the body radius is 0.32 m, and top speed is 1.3 m/s. There is no jump and no sprint.

## Light

Light comes from above. Every ceiling cell holds a glowing diffuser panel, and a hemisphere light makes the floor brightest, the walls warm white, and the ceiling a little dimmer. There are no shadow maps. The shadows a museum cannot fully avoid are painted into textures instead: a soft darkening where the walls meet the floor and ceiling, deeper in corners, and a faint shadow below each frame, which stands a few centimeters off the wall.

## Sound

The only sound is your own footsteps, synthesized in the browser from filtered noise. A step is a short, deep, muffled bump: noise kept below about 120 Hz with a low thud under it, lasting a few tens of milliseconds, and a softer second bump 30 ms later as the foot rolls onto the toe. There are eight variations that differ noticeably in timbre and pitch, swaying left and right. One step lands at the low point of each head bob, two a second at full speed, and slower steps are quieter.

At every step the distance to the nearest wall is measured in the four grid directions. Each wall and the ceiling return an echo delayed by its round trip, quieter and duller with distance, and panned to where that wall is relative to your view, so a long corridor ahead sends back a distinct slap. A dark reverb tail follows, mixed between a short, dry one and a long, hollow one by how open the spot is: a dead end sounds close, and a junction or a long view rings on for a second or two.

Every value lives in `DEFAULT_SOUND` in `src/sound.ts`. In development, settings saved under `passagen:sound` in local storage override the defaults.

## Pictures

Each maze hangs thirty frames: the back wall of every dead end, the wall a corridor runs into at a turn or a T, and then the straight runs, one wall per run. Frames stay at least 3.4 m apart.

A hall hangs its own walls on top of the thirty. Each hall picks a spacing between 2.7 and 4.6 m and a frame size 15 to 60% larger than in the corridors. Every stretch of wall between corners and doorways holds as many frames as fit at that spacing, evenly spread. Large frames hang higher so they stay at least 0.7 m off the floor, and their plaque appears from farther away.

A maze asks for twelve works more than it has frames, in one request, when it is built two mazes ahead. The request carries every work hung so far in the visit, so nothing hangs twice, and the visitor's taste as it stands then.

A maze draws on twelve searches, run in parallel, and takes works from each in turn so one generous source does not fill it alone:

- two from the Met (different departments)
- one or two from the Art Institute of Chicago (different places of origin)
- one from Cleveland
- one from the Smithsonian (CC0 media only, when the key is set)
- one from Openverse (`license=cc0,by`)
- one from [SMK](https://open.smk.dk/), the National Gallery of Denmark (public domain, mostly paintings)
- two from the [Wellcome Collection](https://wellcomecollection.org/) in London (public domain mark, CC0, and CC BY; searches such as Chinese painting, Indian painting, Persian, Japanese woodcut)
- three from museum collections on [Wikimedia Commons](https://commons.wikimedia.org/): the Tokyo and Kyoto National Museums, the National Palace Museum in Taipei, the National Museum of Korea, the Museu Nacional de Belas Artes in Rio, the Pinacoteca and Museu Paulista in São Paulo, the Museo de Arte de Lima, the Museo Nacional de Colombia, Te Papa in Wellington, the State Library of New South Wales, and Nigerian works in museum collections

Only public domain, CC0, and CC BY are kept; Commons files under share-alike licenses are skipped. Each maze is requested two mazes ahead, so the pictures are loaded before you arrive. A picture that fails to load, which happens most with Wellcome's image server, gives way to one of the maze's spare works. Only when those run out does it hang a broken image icon, first those not yet shown in the visit, so a dead API still leaves something on the walls. The icons hang as works of their own: Marsh Chamberlin's torn page for Netscape (1994), Internet Explorer's red cross, Safari's question mark, Chrome's torn landscape, and the little mountain placeholder. They are pixel drawings made for this museum after the originals, which carry no open licence, and they never count toward your taste.

## Taste

The browser watches which picture is in front of you, the one whose plaque would show. A picture scores for the time you stand still before it (up to 30 s), for walking up close, for opening its plaque with the button or the I key (the automatic opening does not count), and for coming back to it at least 15 s after you last looked. Passing one at full speed, close by, counts slightly against it. Scores are kept in local storage under `passagen:taste`. A new visit starts from 35% of what the last one scored, so earlier visits fade.

With each maze request the browser sends the twelve works it liked most, the six it liked least, the artists it kept stopping for, and whether it stopped for loosened kinds of work. The Worker keeps the source mix above and hands eight of the twelve searches, about 70%, to a curator on Workers AI. The curator picks within each source's own lists (a Met department and classification, a Chicago place of origin, a Cleveland department, type, and period, a Smithsonian museum, an SMK kind, a Commons room) and writes free-text searches for the Met, Openverse, and Wellcome. Anything off those lists is dropped for a random search. If the curator is off, has no taste to go on, fails, or takes longer than 10 s, all twelve searches are random.

The other four searches stay random, and only they keep the old rules. At most one in three of their works resolves to Europe, with non-European searches to make up the difference. An artist you keep stopping for can hang up to three times in a maze; anyone else once. Machine-made images and unnamed works under an attribution licence never hang. Two filters loosen: ephemera (postcards, stereographs, trade cards, maps, negatives and the like) and unnamed photographs, collages, and digital work under CC0 or public domain. The random searches let one such work through per maze. The curated ones let them through once you have clearly stopped for one.

The curator reads about 700 to 1,000 tokens and writes about 150. The 70B model answers in about 3.5 s, at about 0.05 cents and 50 neurons a maze. Workers AI includes 10,000 neurons a day free, about 200 mazes on the 70B model.

The Walk button waits for the pictures in the first maze; the mazes around it start loading once they are up. Pictures go to the GPU as they arrive, a few per frame, while their maze is still out of sight. Left to the renderer, every picture of a maze that just came into view would upload in the same frame and stall the walk. On a phone each picture is redrawn with its longest side at 640 px (up to 800 px in a hall) and the copy freed once uploaded; on a desktop the limit is 1024 px. Five mazes are kept loaded, the one you are in and two each way, and the rest are dropped. At thirty frames a maze that is about 250 MB of textures on a phone.

A plaque fades in within 2.2 m when the work is near the center of view. It sits in the bottom-right corner, stays open for four seconds, and then folds into a small "i" button. The button, or the I key while the pointer is locked, opens it again until you close it. Looking away and back at the same work brings back the button, not the full plaque. The text is a live region, so the title is not locked inside the canvas. CC BY plaques include the artist’s name.
