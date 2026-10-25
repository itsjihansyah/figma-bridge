// Thin executor: runs JS sent from the relay against the figma API and returns the result.
// No design logic lives here, so this file never needs to change.

figma.showUI(__html__, { width: 300, height: 190, title: "Claude Bridge" });

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function serialize(value, depth = 0) {
  if (value === undefined || value === null) return value ?? null;
  if (value instanceof Uint8Array) return { __png: figma.base64Encode(value) };
  if (typeof value !== "object") return value;
  if (depth > 4) return "[depth limit]";
  if (Array.isArray(value)) return value.map((v) => serialize(v, depth + 1));
  if ("id" in value && "type" in value && "name" in value && typeof value.remove === "function") {
    return { id: value.id, name: value.name, type: value.type };
  }
  const out = {};
  for (const k of Object.keys(value)) out[k] = serialize(value[k], depth + 1);
  return out;
}

figma.ui.onmessage = async (msg) => {
  if (msg.type === "settings:load") {
    const settings = await figma.clientStorage.getAsync("bridge");
    figma.ui.postMessage({ type: "settings", settings: settings || {} });
    return;
  }
  if (msg.type === "settings:save") {
    await figma.clientStorage.setAsync("bridge", msg.settings);
    return;
  }
  if (msg.type === "run") {
    const logs = [];
    const log = (...args) => logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(serialize(a)))).join(" "));
    try {
      const fn = new AsyncFunction("figma", "log", msg.code);
      const value = await fn(figma, log);
      figma.ui.postMessage({ type: "result", id: msg.id, ok: true, value: serialize(value), logs });
    } catch (e) {
      figma.ui.postMessage({ type: "result", id: msg.id, ok: false, error: String((e && e.stack) || e), logs });
    }
  }
};
