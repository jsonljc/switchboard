import type { FastifyReply } from "fastify";

interface SseConnection {
  reply: FastifyReply;
  heartbeatTimer: ReturnType<typeof setInterval>;
}

const HEARTBEAT_INTERVAL_MS = 30_000;

export class SseSessionManager {
  private connections = new Map<string, SseConnection>();

  register(sessionId: string, reply: FastifyReply): void {
    // Close existing connection for this session
    this.remove(sessionId);

    const heartbeatTimer = setInterval(() => {
      try {
        reply.raw.write(": heartbeat\n\n");
      } catch {
        this.remove(sessionId);
      }
    }, HEARTBEAT_INTERVAL_MS);

    this.connections.set(sessionId, { reply, heartbeatTimer });

    // Send initial connected event
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ sessionId })}\n\n`);
  }

  sendTyping(sessionId: string): void {
    const conn = this.connections.get(sessionId);
    if (!conn) return;
    try {
      conn.reply.raw.write(`event: typing\ndata: {}\n\n`);
    } catch {
      this.remove(sessionId);
    }
  }

  sendMessage(sessionId: string, role: string, content: string): void {
    const conn = this.connections.get(sessionId);
    if (!conn) return;
    try {
      const data = JSON.stringify({ role, content, id: crypto.randomUUID() });
      conn.reply.raw.write(`event: message\ndata: ${data}\n\n`);
    } catch {
      this.remove(sessionId);
    }
  }

  sendError(sessionId: string, error: string): void {
    const conn = this.connections.get(sessionId);
    if (!conn) return;
    try {
      conn.reply.raw.write(`event: error\ndata: ${JSON.stringify({ error })}\n\n`);
    } catch {
      this.remove(sessionId);
    }
  }

  remove(sessionId: string): void {
    const conn = this.connections.get(sessionId);
    if (conn) {
      clearInterval(conn.heartbeatTimer);
      this.connections.delete(sessionId);
    }
  }

  has(sessionId: string): boolean {
    return this.connections.has(sessionId);
  }

  get size(): number {
    return this.connections.size;
  }
}
