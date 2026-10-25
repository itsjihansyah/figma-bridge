# Agent guide

Instructions for an AI agent (Claude Code, Cursor, Codex, or similar) that designs in a user's Figma file through Figma Bridge. Point your agent at this file at the start of a session.

The human setup is covered in the [README](../README.md). This guide assumes it is done and that two environment variables are available:

| Variable | Value |
|---|---|
| `FIGMA_BRIDGE_URL` | The user's relay URL, e.g. `https://figma-bridge.<subdomain>.workers.dev` |
| `FIGMA_BRIDGE_TOKEN` | The user's channel token. **Secret.** |

---

## 1. Check the connection first

```bash
curl -s -H "x-bridge-token: $FIGMA_BRIDGE_TOKEN" "$FIGMA_BRIDGE_URL/status"
# {"pluginConnected":true}
```

- If either variable is missing, ask the user to finish the README setup, then stop.
- If it returns `"pluginConnected":false`, ask the user to open the Figma file and run **Plugins → Development → Claude Bridge**, then check again.

## 2. Send commands

Use the bundled CLI (Node 18+):

```bash
node cli/figma-send.mjs script.js                  # run a script file
echo 'return figma.currentPage.name' | node cli/figma-send.mjs
node cli/figma-send.mjs shot.js --out shot.png     # save a returned PNG
node cli/figma-send.mjs --status
```

Or call the relay directly:

```bash
curl -s -X POST "$FIGMA_BRIDGE_URL/run" \
  -H "content-type: application/json" -H "x-bridge-token: $FIGMA_BRIDGE_TOKEN" \
  --data '{"code":"return figma.currentPage.name","timeoutMs":120000}'
```

### Execution contract

- The code runs as the **body of an async function** with `figma` (the Plugin API) and `log(...)` in scope. Use `await` freely.
- `return` what you need back:
  - Nodes come back as `{id, name, type}`.
  - A `Uint8Array` comes back as a PNG. The CLI saves it with `--out`.
  - Anything else comes back as JSON.
- Responses look like `{"ok":true,"value":...,"logs":[...]}` or `{"ok":false,"error":"<stack>","logs":[...]}`.
- Each call times out after 120 s. Keep each call to **one section of work**.

### Plugin API rules (the plugin uses `documentAccess: dynamic-page`)

- Use the async APIs: `await figma.getNodeByIdAsync(id)`, `await figma.setCurrentPageAsync(page)` and `await page.loadAsync()`.
- Load fonts before you set `characters` or font properties: `await figma.loadFontAsync({family, style})`.
- Find components with `figma.importComponentByKeyAsync(key)` for library assets, or with `page.findAllWithCriteria` / `page.findOne` for local ones. Reuse existing components and icons instead of redrawing them.
- Prefer auto layout (`layoutMode`, `itemSpacing`, `padding*`, `layoutSizingHorizontal/Vertical`) over absolute positioning.
- Bind variables (`setBoundVariable`, `setBoundVariableForPaint`) when the file has a design system.
- Tag every node you create, so later runs can find, update or clean up your own work:
  ```js
  node.setSharedPluginData("claude", "created", "1")
  ```

## 3. Working rules

1. **Check status first** in every session.
2. **Read before writing.** Start with a read-only script that lists the pages, the top-level frames and the selection. To match the file's style, dump a reference frame's layers: names, fonts, fills, auto layout settings.
3. **Build in small calls**, one section each. Return the IDs of the nodes you create and reuse them in the next call.
4. **Look at your work.** After each section, export a PNG, view it, and fix problems before you move on. Scale 1 is usually enough and keeps token use low.
5. **Cloning an existing screen is often the fastest way to match a design.** Clone it, then remove and replace what changes.
6. **Don't destroy the user's work.** Never delete or modify nodes without the `claude/created` tag unless the user asks you to.
7. **Handle errors.** Read `error`, fix the script, and retry.
   - On `Plugin not connected`, ask the user to reopen Claude Bridge.
   - On a timeout, split the work into smaller calls.
8. **Keep the token secret.** Never print `FIGMA_BRIDGE_TOKEN` in chat, logs, commits or shared files.

## 4. Examples

### Read the current page

```js
await figma.currentPage.loadAsync();
return {
  page: figma.currentPage.name,
  selection: figma.currentPage.selection,
  frames: figma.currentPage.children.map(n => ({ id: n.id, name: n.name, type: n.type, w: n.width, h: n.height })),
};
```

### Create a card

```js
await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });
const card = figma.createFrame();
card.name = "Card";
card.layoutMode = "VERTICAL";
card.paddingTop = card.paddingBottom = card.paddingLeft = card.paddingRight = 24;
card.itemSpacing = 12;
card.cornerRadius = 16;
card.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
card.primaryAxisSizingMode = card.counterAxisSizingMode = "AUTO";
const title = figma.createText();
title.fontName = { family: "Inter", style: "Semi Bold" };
title.characters = "Hello from the bridge";
title.fontSize = 20;
card.appendChild(title);
card.setSharedPluginData("claude", "created", "1");
figma.currentPage.appendChild(card);
figma.viewport.scrollAndZoomIntoView([card]);
return card;
```

### Screenshot a node

```js
const node = await figma.getNodeByIdAsync("12:34");
return await node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 1 } });
```

## Limits

- Figma desktop must stay open with the plugin running. The plugin reconnects every 3 s if the connection drops.
- One Figma window holds a channel at a time. Opening the plugin in another window with the same token takes the connection over.
