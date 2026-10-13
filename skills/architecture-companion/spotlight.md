# Spotlight rules

Use these rules to present a walkthrough on the Review UI screen: the diagram emphasizes the elements each step addresses while the reviewer reads the step's caption. Follow `SKILL.md` for starting the Review UI and for authoring and follow-up procedures.

A Spotlight is an action, not stored state. The walkthrough is delivered to the screen once and is never persisted in the catalog or Annotations; presenting it again means Spotlighting it again. Loading a walkthrough from a URL or the browser history is review-screen state, not a new Spotlight.

## Walkthrough contract

A walkthrough is a single JSON object addressing one artifact:

```json
{
  "artifactId": ".architecture-companion/artifacts/checkout-workflow.archcomp.json",
  "diagram": {
    "steps": [
      {
        "elements": [
          { "type": "node", "id": "submit" },
          { "type": "edge", "id": "confirm" }
        ],
        "caption": "The checkout flow from request to confirmation."
      }
    ]
  }
}
```

- `artifactId` is the artifact's full scope-relative file path, the same identity `view-artifacts.js` reports. Do not shorten it to a filename or stem.
- Each step's `elements` reuse the Annotation target contract. Use the diagram's stored stable IDs, resolved the same way as Annotation targets in `review-follow-up.md`: `group`, `node`, and `edge` take the graph element's ID; an `edge-set` takes its `sourceId`, `targetId`, and the underlying `edgeIds` of an aggregated dependency path. A step may also address nothing (`elements: []`) to show its caption as explanation only.
- `steps` contains at least one step, and every step carries a required `caption` string.
- Validate the walkthrough's element IDs against the current catalog before delivering. Spotlighting does not repair unknown IDs; mismatches are rejected.

## Caption policy

Write captions in the user's language.

- A multi-step walkthrough starts with an overview step: the nodes involved plus every reachable path edge connecting the start to the finish, with a caption naming the whole flow.
- Every step of a multi-step walkthrough has a meaningful caption of its own. Never substitute placeholder or fallback text for a missing caption.
- A single-step walkthrough with nothing specific to explain may send the fixed English sentence `The agent is spotlighting.`

## Delivering to an already-open local Review UI

When the Review UI for the scope is already open locally, `POST` the walkthrough JSON to the running server's `/api/spotlight` endpoint. The request must come from local tooling (no `Origin` header, as with `curl`) or from the companion page itself.

```sh
curl -X POST "http://127.0.0.1:<port>/api/spotlight" \
  -H "Content-Type: application/json" \
  --data @walkthrough.json
```

- `201`: delivered. Connected viewers receive it immediately; a viewer that connects later sees nothing until you Spotlight again, and there is no replay.
- `422`: the walkthrough shape or its match against the catalog failed. The message names the failing field path (for example `diagram.steps[1].caption`) or the unknown elements per step. Fix the walkthrough and send it again.
- `404`: no catalog is available; there is no artifact to address.
- `403`: the request did not come from local tooling or the companion page. Use the URL below instead.

## URL direct entry

When the Review UI is remote or already closed, or as a first-class alternative to the POST, share a URL that opens the artifact with the walkthrough applied:

`<server-url>/artifacts/<full artifactId>?walkthrough=<encoded>`

`<encoded>` is the walkthrough JSON serialized as UTF-8 and base64url-encoded, uncompressed and unpadded. Build it with Node and the server URL printed by `serve.js`:

```js
const walkthrough = {
  artifactId: ".architecture-companion/artifacts/checkout-workflow.archcomp.json",
  diagram: {
    steps: [
      {
        elements: [
          { type: "node", id: "submit" },
          { type: "edge", id: "confirm" },
        ],
        caption: "The checkout flow from request to confirmation.",
      },
    ],
  },
};
const encoded = Buffer.from(JSON.stringify(walkthrough), "utf8").toString("base64url");
const artifactPath = walkthrough.artifactId.split("/").map(encodeURIComponent).join("/");
const url = new URL(`/artifacts/${artifactPath}?walkthrough=${encoded}`, "http://127.0.0.1:4173");
console.log(url.href);
```

- Use the full `artifactId` in the path, forward slashes included; there is no stem or shorthand convention. Encode each path segment with `encodeURIComponent` as above, so an artifact ID containing `?`, `#`, or `%` keeps its identity instead of breaking the URL.
- Only canonical unpadded base64url decodes. The screen removes an undecodable `walkthrough` parameter from the URL without any error, so verify the encoding when constructing URLs by hand.
- Refreshing, navigating back and forward, and re-entering such a URL all restart the walkthrough at its first step.
- Spotlighting again while a walkthrough is showing also restarts at the first step.

## Review-screen state around a walkthrough

- A Spotlight that addresses the artifact already on screen replaces the current history entry and preserves the rest of the URL, including the search query.
- A Spotlight that switches to a different artifact pushes a new history entry and clears the previous search query and walkthrough.
- Closing the walkthrough on screen replaces the current entry with the walkthrough removed, leaving the search query intact.
