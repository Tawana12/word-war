import WordWarsRealtime from './server';

interface Env {
  WORD_WARS_ROOM: DurableObjectNamespace;
}

type PartyMessage = string | ArrayBuffer;

class CloudflareConnection {
  constructor(
    readonly id: string,
    private readonly socket: WebSocket,
  ) {}

  send(message: string | ArrayBuffer): void {
    this.socket.send(message);
  }

  close(code?: number, reason?: string): void {
    this.socket.close(code, reason);
  }
}

class CloudflareRoom {
  private readonly connections = new Map<string, CloudflareConnection>();

  add(connection: CloudflareConnection): void {
    this.connections.set(connection.id, connection);
  }

  remove(connectionId: string): void {
    this.connections.delete(connectionId);
  }

  getConnection(connectionId: string): CloudflareConnection | undefined {
    return this.connections.get(connectionId);
  }

  getConnections(): Iterable<CloudflareConnection> {
    return this.connections.values();
  }

  broadcast(message: string | ArrayBuffer): void {
    for (const connection of this.connections.values()) {
      try {
        connection.send(message);
      } catch {
        // Ignore sockets that are already closing.
      }
    }
  }
}

/**
 * Native Cloudflare Durable Object wrapper around the existing PartyKit server.
 *
 * This keeps the current lobby/matchmaking/relay logic in src/server.ts and
 * replaces PartyKit's hosting layer with Cloudflare's WebSocket runtime.
 *
 * It intentionally uses the standard WebSocket API rather than hibernation
 * because the current Word Wars server stores live match state in memory.
 */
export class WordWarsRoom {
  private readonly room = new CloudflareRoom();
  private readonly gameServer: WordWarsRealtime;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {
    void this.state;
    void this.env;

    this.gameServer = new WordWarsRealtime(this.room as never);
    this.gameServer.onStart();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({
        ok: true,
        service: 'word-wars-live',
        transport: 'cloudflare-durable-object',
      });
    }

    const upgrade = request.headers.get('Upgrade');
    if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade request.', {
        status: 426,
        headers: {
          Upgrade: 'websocket',
        },
      });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    server.accept();

    const connection = new CloudflareConnection(
      crypto.randomUUID(),
      server,
    );

    this.room.add(connection);

    server.addEventListener('message', (event: MessageEvent) => {
      const data = event.data;

      if (
        typeof data !== 'string' &&
        !(data instanceof ArrayBuffer)
      ) {
        return;
      }

      try {
        this.gameServer.onMessage(
          data as PartyMessage,
          connection as never,
        );
      } catch (error) {
        console.error('Word Wars WebSocket message error:', error);
      }
    });

    server.addEventListener('close', () => {
      this.room.remove(connection.id);

      try {
        this.gameServer.onClose(connection as never);
      } catch (error) {
        console.error('Word Wars WebSocket close error:', error);
      }
    });

    server.addEventListener('error', () => {
      this.room.remove(connection.id);

      try {
        this.gameServer.onError(connection as never);
      } catch (error) {
        console.error('Word Wars WebSocket error:', error);
      }
    });

    try {
      this.gameServer.onConnect(
        connection as never,
        { request } as never,
      );
    } catch (error) {
      this.room.remove(connection.id);
      console.error('Word Wars WebSocket connection error:', error);

      try {
        server.close(1011, 'Unable to join multiplayer server');
      } catch {
        // Socket may already be closed.
      }
    }

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({
        ok: true,
        service: 'word-wars-live',
        transport: 'cloudflare-worker',
      });
    }

    /*
     * One Durable Object coordinates matchmaking across all current visitors.
     * The existing server then separates users into multiple internal matches.
     */
    const id = env.WORD_WARS_ROOM.idFromName('global');
    const room = env.WORD_WARS_ROOM.get(id);

    return room.fetch(request);
  },
} satisfies ExportedHandler<Env>;
