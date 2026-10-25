// Relay between Claude (HTTP POST /run) and the Figma plugin (WebSocket /ws).
// One Durable Object per channel token; the token is the shared secret.

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const token = url.searchParams.get("token") || req.headers.get("x-bridge-token");
    if (url.pathname === "/") return new Response("figma-bridge relay ok");
    if (!token || token.length < 24) return new Response("missing or short token", { status: 401 });
    const stub = env.CHANNEL.get(env.CHANNEL.idFromName(token));
    return stub.fetch(req);
  },
};

export class Channel {
  constructor(state) {
    this.state = state;
    this.pending = new Map(); // id -> resolve
  }

  plugin() {
    return this.state.getWebSockets()[0];
  }

  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/ws") {
      if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
      for (const old of this.state.getWebSockets()) old.close(4000, "replaced by new plugin session");
      const [client, server] = Object.values(new WebSocketPair());
      this.state.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/status") {
      return Response.json({ pluginConnected: !!this.plugin() });
    }

    if (url.pathname === "/run" && req.method === "POST") {
      const ws = this.plugin();
      if (!ws) return Response.json({ ok: false, error: "Plugin not connected. Open Figma and run Plugins → Development → Claude Bridge." }, { status: 503 });
      const { code, timeoutMs = 60000 } = await req.json();
      const id = crypto.randomUUID();
      const result = await new Promise((resolve) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          resolve({ ok: false, error: `Timed out after ${timeoutMs}ms` });
        }, timeoutMs);
        this.pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
        ws.send(JSON.stringify({ type: "run", id, code }));
      });
      return Response.json(result);
    }

    return new Response("not found", { status: 404 });
  }

  webSocketMessage(ws, raw) {
    const msg = JSON.parse(raw);
    if (msg.type === "ping") return ws.send(JSON.stringify({ type: "pong" }));
    if (msg.type === "result") {
      const resolve = this.pending.get(msg.id);
      if (resolve) { this.pending.delete(msg.id); resolve(msg); }
    }
  }

  webSocketClose(ws, code, reason) {
    try { ws.close(code, reason); } catch {}
  }
}
