# Spotlight rules

A spotlight points the reviewer's open Review UI at specific diagram elements while you explain. Follow `SKILL.md` for when to send one and for the request command.

## Delivery semantics

- The Review UI must already be open in a browser: the server delivers a spotlight to connected viewers once and stores nothing. A browser opened later, or a closed one, sees nothing until you send another spotlight.
- The server validates the artifact and every element against the current catalog. A `422` response names the mismatch; fix the referenced elements and send again. Do not resend an identical payload.
- A new spotlight replaces the one before it. Do not send several spotlights to stack emphasis; combine or sequence them within one request's steps.

## Request shape

```json
{
  "artifactId": ".architecture-companion/artifacts/<artifact>.archcomp.json",
  "diagram": {
    "steps": [
      {
        "elements": [{ "type": "node", "id": "node-id" }],
        "caption": "What this step shows"
      }
    ]
  }
}
```

- `artifactId` is the artifact's catalog `id`, the scope-relative file path.
- `elements` uses the same targets as Annotation anchors: `group`, `node`, and `edge` by stable `id`, and `edge-set` by `sourceId` and `targetId` plus the underlying `edgeIds`. Read the ids from the artifact's stored graph, not from rendered titles or positions.
- A step with empty `elements` spotlights the whole artifact.
- `caption` is required on every step. Write captions in the user's language, except the fixed fallback below, which is always English.

## Caption and step conventions

- Prefer a single step when one framed area suffices. Use several steps to walk through an order, and expect the reviewer to step through them with the arrow keys.
- In a multi-step spotlight, the first step summarizes the flow the remaining steps will cover: emphasize only the nodes that flow actually involves, plus every edge along the paths from the first to the last target. Intermediate pass-through nodes between them stay unemphasized.
- In a multi-step spotlight, every caption must explain its step. Never send the fallback line as a multi-step caption.
- A single-step spotlight with nothing to explain sends exactly `The agent is spotlighting.` — always that English sentence, regardless of the user's language.
