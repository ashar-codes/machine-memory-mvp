// Server-Sent Events hub.
//
// SSE rather than WebSockets: the feed is one-directional (server → browser), it is plain HTTP so
// it goes through the existing Vite proxy and the existing Host/Origin checks unchanged, and it
// needs no broker, no handshake and no extra dependency. Reliability over sophistication.
import type { Response } from 'express';

export const MAX_CLIENTS = 8;
export const MAX_FRAME_BYTES = 64 * 1024;
const HEARTBEAT_MS = 25_000;

/** Everything the feed can emit. Data only: no client message ever travels the other way. */
export type StreamEvent =
  | { type: 'telemetry'; payload: Record<string, unknown> }
  | { type: 'event'; payload: Record<string, unknown> }
  | { type: 'run'; payload: Record<string, unknown> };

export interface StreamHub {
  subscribe(res: Response): () => void;
  publish(event: StreamEvent): void;
  clientCount(): number;
  close(): void;
}

export function createStreamHub(): StreamHub {
  const clients = new Set<Response>();
  const send = (client: Response, frame: string) => {
    try {
      if (client.writableLength > MAX_FRAME_BYTES || !client.write(frame)) {
        clients.delete(client);
        client.destroy();
      }
    } catch {
      clients.delete(client);
      try { client.destroy(); } catch { /* already gone */ }
    }
  };
  // A comment line keeps the connection alive through proxies that would otherwise time it out.
  const heartbeat = setInterval(() => {
    for (const client of clients) send(client, ': keep-alive\n\n');
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  return {
    subscribe(res) {
      if (clients.size >= MAX_CLIENTS) {
        // Bounded: a loopback demo does not need unlimited streams, and an unbounded set is a
        // slow memory leak if a browser reconnects in a loop.
        res.status(503).end();
        return () => undefined;
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      clients.add(res);
      const remove = () => { clients.delete(res); };
      res.on('close', remove);
      send(res, 'retry: 3000\n\n');
      return remove;
    },

    publish(event) {
      const frame = `event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`;
      if (Buffer.byteLength(frame) > MAX_FRAME_BYTES) return;
      for (const client of clients) {
        // One broken pipe must not stop delivery to the others.
        send(client, frame);
      }
    },

    clientCount: () => clients.size,

    close() {
      clearInterval(heartbeat);
      for (const client of clients) { try { client.end(); } catch { /* already gone */ } }
      clients.clear();
    },
  };
}
