import type * as Party from 'partykit/server';

type Team = 'blue' | 'red';
type Role = 'RUNNER' | 'INNER_SENTRY' | 'OUTER_WARDEN' | 'SABOTEUR';
type MatchStatus = 'lobby' | 'playing' | 'finished';
type RelayKind = 'input' | 'snapshot' | 'event';

type Slot = {
  id: string;
  team: Team;
  role: Role;
  duty: 'SENTRY' | 'WARDEN' | null;
  order: number;
};

type Player = {
  userId: string;
  clientId: string;
  username: string;
  slotId: string;
  team: Team;
  role: Role;
  duty: 'SENTRY' | 'WARDEN' | null;
  joinedAt: number;
  lastSeenAt: number;
  connected: boolean;
  connectionId: string | null;
};

type Match = {
  id: string;
  status: MatchStatus;
  createdAt: number;
  startsAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  hostUserId: string | null;
  players: Map<string, Player>;
  version: number;
  scoredRounds: Set<string>;
};

type ConnectionMeta = {
  userId: string;
  matchId: string;
};

type LeaderboardEntry = {
  userId: string;
  username: string;
  karma: number;
  lastSeenAt: number;
};

const SLOTS: readonly Slot[] = [
  { id: 'blue-runner-1', team: 'blue', role: 'RUNNER', duty: null, order: 0 },
  { id: 'red-runner-1', team: 'red', role: 'RUNNER', duty: null, order: 1 },
  { id: 'blue-sentry', team: 'blue', role: 'INNER_SENTRY', duty: 'SENTRY', order: 2 },
  { id: 'red-sentry', team: 'red', role: 'INNER_SENTRY', duty: 'SENTRY', order: 3 },
  { id: 'blue-warden', team: 'blue', role: 'OUTER_WARDEN', duty: 'WARDEN', order: 4 },
  { id: 'red-warden', team: 'red', role: 'OUTER_WARDEN', duty: 'WARDEN', order: 5 },
  { id: 'blue-saboteur', team: 'blue', role: 'SABOTEUR', duty: null, order: 6 },
  { id: 'red-saboteur', team: 'red', role: 'SABOTEUR', duty: null, order: 7 },
  { id: 'blue-runner-2', team: 'blue', role: 'RUNNER', duty: null, order: 8 },
  { id: 'red-runner-2', team: 'red', role: 'RUNNER', duty: null, order: 9 },
] as const;

const MAX_PLAYERS = SLOTS.length;
const LOBBY_MS = 15_000;
const RECONNECT_GRACE_MS = 60_000;
const EMPTY_MATCH_TTL_MS = 35_000;
const LEADERBOARD_TTL_MS = 60 * 60 * 1000;

function cleanText(value: unknown, max = 64): string {
  return String(value ?? '')
    .replace(/[^a-zA-Z0-9_ -]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, max);
}

function safeNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export default class WordWarsRealtime implements Party.Server {
  readonly options = { hibernate: false };

  private matches = new Map<string, Match>();
  private connectionMeta = new Map<string, ConnectionMeta>();
  private leaderboard = new Map<string, LeaderboardEntry>();
  private nextMatchNumber = 1;
  private ticker: ReturnType<typeof setInterval> | null = null;

  constructor(readonly room: Party.Room) {}

  onStart() {
    this.ticker = setInterval(() => this.tick(), 500);
  }

  onConnect(connection: Party.Connection, ctx: Party.ConnectionContext) {
    const url = new URL(ctx.request.url);
    const clientId = cleanText(url.searchParams.get('clientId'), 80) || connection.id;
    const nickname = cleanText(url.searchParams.get('nickname'), 16) || this.randomNickname();
    this.join(connection, clientId, nickname);
  }

  onMessage(message: string | ArrayBuffer, sender: Party.Connection) {
    if (typeof message !== 'string' || message.length > 700_000) return;

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(message) as Record<string, unknown>;
    } catch {
      return;
    }

    const type = String(data.type || '');
    if (type === 'hello') {
      const meta = this.connectionMeta.get(sender.id);
      if (!meta) {
        this.join(
          sender,
          cleanText(data.clientId, 80) || sender.id,
          cleanText(data.nickname, 16) || this.randomNickname()
        );
      }
      return;
    }

    const meta = this.connectionMeta.get(sender.id);
    if (!meta) return;
    const match = this.matches.get(meta.matchId);
    const player = match?.players.get(meta.userId);
    if (!match || !player) return;

    player.lastSeenAt = Date.now();

    if (type === 'heartbeat') {
      this.advanceMatch(match);
      return;
    }

    if (type === 'nickname') {
      const nickname = cleanText(data.nickname, 16);
      if (!nickname) return;
      player.username = nickname;
      const score = this.leaderboard.get(player.userId);
      if (score) score.username = nickname;
      match.version += 1;
      this.broadcastRoom(match);
      this.broadcastLeaderboard();
      return;
    }

    if (type === 'leave') {
      try {
        sender.close(1000, 'left match');
      } catch {
        // Socket may already be closing.
      }
      return;
    }

    if (type === 'finish') {
      if (match.hostUserId !== player.userId) return;
      match.status = 'finished';
      match.finishedAt = Date.now();
      match.version += 1;
      this.broadcastRoom(match);
      return;
    }

    if (type !== 'relay' || match.status !== 'playing') return;
    const kind = String(data.kind || '') as RelayKind;
    if (!['input', 'snapshot', 'event'].includes(kind)) return;
    if (kind === 'snapshot' && match.hostUserId !== player.userId) return;

    const payload = data.payload ?? null;
    const envelope = {
      source: 'word-wars-server',
      roomId: match.id,
      senderUserId: player.userId,
      kind,
      payload,
      sentAt: Date.now(),
    };

    this.sendToMatch(match.id, envelope);

    if (
      kind === 'event' &&
      match.hostUserId === player.userId &&
      payload &&
      typeof payload === 'object' &&
      (payload as Record<string, unknown>).type === 'round-finished'
    ) {
      this.scoreRound(match, payload as Record<string, unknown>);
    }
  }

  onClose(connection: Party.Connection) {
    this.disconnectConnection(connection.id);
  }

  onError(connection: Party.Connection) {
    this.disconnectConnection(connection.id);
  }

  private join(connection: Party.Connection, rawClientId: string, rawNickname: string) {
    if (this.connectionMeta.has(connection.id)) return;

    const clientId = cleanText(rawClientId, 80) || connection.id;
    const nickname = cleanText(rawNickname, 16) || this.randomNickname();

    const existing = this.findReconnectPlayer(clientId);
    let match: Match;
    let player: Player;

    if (existing) {
      match = existing.match;
      player = existing.player;

      if (player.connected && player.connectionId && player.connectionId !== connection.id) {
        const oldConnection = this.room.getConnection(player.connectionId);
        try {
          oldConnection?.close(4001, 'opened in another tab');
        } catch {
          // Best effort replacement of a stale tab.
        }
        this.connectionMeta.delete(player.connectionId);
      }

      player.connectionId = connection.id;
      player.connected = true;
      player.lastSeenAt = Date.now();
      player.username = nickname;
      match.version += 1;
      this.ensureHost(match);
    } else {
      match = this.pickMatch();
      const slot = this.nextOpenSlot(match);
      if (!slot) {
        match = this.createMatch();
      }
      const assignedSlot = this.nextOpenSlot(match);
      if (!assignedSlot) {
        connection.send(JSON.stringify({ type: 'error', message: 'No multiplayer slot is available.' }));
        connection.close(1013, 'room full');
        return;
      }

      const userId = clientId;
      player = {
        userId,
        clientId,
        username: nickname,
        slotId: assignedSlot.id,
        team: assignedSlot.team,
        role: assignedSlot.role,
        duty: assignedSlot.duty,
        joinedAt: Date.now(),
        lastSeenAt: Date.now(),
        connected: true,
        connectionId: connection.id,
      };
      match.players.set(userId, player);
      match.version += 1;
      this.ensureHost(match);
    }

    this.connectionMeta.set(connection.id, { userId: player.userId, matchId: match.id });
    this.touchLeaderboard(player);
    this.advanceMatch(match);

    connection.send(JSON.stringify({
      type: 'welcome',
      room: this.publicRoom(match),
      identity: { userId: player.userId, username: player.username },
      assignment: this.publicPlayer(player),
      leaderboard: this.topLeaderboard(),
    }));

    this.broadcastRoom(match);
    this.broadcastLeaderboard();
  }

  private disconnectConnection(connectionId: string) {
    const meta = this.connectionMeta.get(connectionId);
    this.connectionMeta.delete(connectionId);
    if (!meta) return;

    const match = this.matches.get(meta.matchId);
    const player = match?.players.get(meta.userId);
    if (!match || !player || player.connectionId !== connectionId) return;

    player.connected = false;
    player.connectionId = null;
    player.lastSeenAt = Date.now();
    const score = this.leaderboard.get(player.userId);
    if (score) score.lastSeenAt = Date.now();
    match.version += 1;
    this.ensureHost(match);
    this.broadcastRoom(match);
    this.broadcastLeaderboard();
  }

  private pickMatch(): Match {
    const now = Date.now();
    const candidates = [...this.matches.values()]
      .filter((match) => {
        if (match.status === 'finished') return false;
        if (!this.nextOpenSlot(match)) return false;
        if (match.status === 'lobby') return true;
        return Boolean(match.startedAt && now - match.startedAt < 45_000);
      })
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === 'lobby' ? -1 : 1;
        return this.connectedCount(b) - this.connectedCount(a) || a.createdAt - b.createdAt;
      });

    return candidates[0] || this.createMatch();
  }

  private createMatch(): Match {
    const now = Date.now();
    const id = `match-${now.toString(36)}-${this.nextMatchNumber++}`;
    const match: Match = {
      id,
      status: 'lobby',
      createdAt: now,
      startsAt: now + LOBBY_MS,
      startedAt: null,
      finishedAt: null,
      hostUserId: null,
      players: new Map(),
      version: 1,
      scoredRounds: new Set(),
    };
    this.matches.set(id, match);
    return match;
  }

  private findReconnectPlayer(clientId: string): { match: Match; player: Player } | null {
    for (const match of this.matches.values()) {
      if (match.status === 'finished') continue;
      const player = match.players.get(clientId);
      if (player) return { match, player };
    }
    return null;
  }

  private nextOpenSlot(match: Match): Slot | null {
    const used = new Set([...match.players.values()].map((player) => player.slotId));
    return SLOTS.find((slot) => !used.has(slot.id)) || null;
  }

  private connectedCount(match: Match): number {
    let count = 0;
    for (const player of match.players.values()) {
      if (player.connected) count += 1;
    }
    return count;
  }

  private ensureHost(match: Match) {
    const current = match.hostUserId ? match.players.get(match.hostUserId) : null;
    if (current?.connected) return;

    const next = [...match.players.values()]
      .filter((player) => player.connected)
      .sort((a, b) => a.joinedAt - b.joinedAt)[0];
    match.hostUserId = next?.userId || null;
  }

  private advanceMatch(match: Match) {
    if (match.status === 'lobby' && Date.now() >= match.startsAt && this.connectedCount(match) > 0) {
      match.status = 'playing';
      match.startedAt = Date.now();
      match.version += 1;
      this.ensureHost(match);
      this.broadcastRoom(match);
    }
  }

  private tick() {
    const now = Date.now();
    let leaderboardChanged = false;

    for (const match of [...this.matches.values()]) {
      this.advanceMatch(match);

      for (const player of [...match.players.values()]) {
        if (!player.connected && now - player.lastSeenAt > RECONNECT_GRACE_MS) {
          match.players.delete(player.userId);
          match.version += 1;
        }
      }

      this.ensureHost(match);

      if (this.connectedCount(match) === 0) {
        const emptySince = Math.max(
          match.finishedAt || 0,
          ...[...match.players.values()].map((player) => player.lastSeenAt),
          match.createdAt
        );
        if (now - emptySince > EMPTY_MATCH_TTL_MS) {
          this.matches.delete(match.id);
          continue;
        }
      }
    }

    for (const [userId, entry] of this.leaderboard) {
      const active = [...this.matches.values()].some((match) => match.players.has(userId));
      if (!active && now - entry.lastSeenAt > LEADERBOARD_TTL_MS) {
        this.leaderboard.delete(userId);
        leaderboardChanged = true;
      }
    }

    if (leaderboardChanged) this.broadcastLeaderboard();
  }

  private publicPlayer(player: Player) {
    return {
      userId: player.userId,
      username: player.username,
      slotId: player.slotId,
      team: player.team,
      role: player.role,
      duty: player.duty,
      joinedAt: player.joinedAt,
      lastSeenAt: player.lastSeenAt,
      connected: player.connected,
    };
  }

  private publicRoom(match: Match) {
    return {
      roomId: match.id,
      postId: 'web',
      channel: match.id,
      status: match.status,
      createdAt: match.createdAt,
      startsAt: match.startsAt,
      startedAt: match.startedAt,
      finishedAt: match.finishedAt,
      hostUserId: match.hostUserId,
      players: [...match.players.values()]
        .sort((a, b) => a.joinedAt - b.joinedAt)
        .map((player) => this.publicPlayer(player)),
      version: match.version,
      transport: {
        inputIntervalMs: 70,
        snapshotIntervalMs: 100,
        worldIntervalMs: 700,
      },
    };
  }

  private sendToMatch(matchId: string, data: unknown) {
    const serialized = JSON.stringify(data);
    for (const connection of this.room.getConnections()) {
      if (this.connectionMeta.get(connection.id)?.matchId === matchId) {
        connection.send(serialized);
      }
    }
  }

  private broadcastRoom(match: Match) {
    this.sendToMatch(match.id, {
      source: 'word-wars-server',
      roomId: match.id,
      senderUserId: null,
      kind: 'room',
      payload: this.publicRoom(match),
      sentAt: Date.now(),
    });
  }

  private touchLeaderboard(player: Player) {
    const existing = this.leaderboard.get(player.userId);
    if (existing) {
      existing.username = player.username;
      existing.lastSeenAt = Date.now();
      return;
    }
    this.leaderboard.set(player.userId, {
      userId: player.userId,
      username: player.username,
      karma: 0,
      lastSeenAt: Date.now(),
    });
  }

  private topLeaderboard() {
    return [...this.leaderboard.values()]
      .sort((a, b) => b.karma - a.karma || b.lastSeenAt - a.lastSeenAt)
      .slice(0, 8)
      .map((entry, index) => ({
        rank: index + 1,
        username: entry.username,
        karma: entry.karma,
      }));
  }

  private broadcastLeaderboard() {
    const message = JSON.stringify({
      type: 'leaderboard',
      entries: this.topLeaderboard(),
      sentAt: Date.now(),
    });
    this.room.broadcast(message);
  }

  private scoreRound(match: Match, event: Record<string, unknown>) {
    const roundIndex = Math.max(0, Math.floor(safeNumber(event.roundIndex)));
    const scoreKey = `${match.id}:${roundIndex}`;
    if (match.scoredRounds.has(scoreKey)) return;
    match.scoredRounds.add(scoreKey);

    const winnerTeam = event.winnerTeam === 'blue' || event.winnerTeam === 'red'
      ? event.winnerTeam
      : null;
    const statsBySlot = event.statsBySlot && typeof event.statsBySlot === 'object'
      ? event.statsBySlot as Record<string, Record<string, unknown>>
      : {};

    for (const player of match.players.values()) {
      this.touchLeaderboard(player);
      const stats = statsBySlot[player.slotId] || {};
      let earned = 1;
      if (winnerTeam && winnerTeam === player.team) earned += 3;
      earned += Math.min(3, Math.floor(safeNumber(stats.correctLettersPlaced)));
      earned += Math.min(2, Math.floor(safeNumber(stats.stolenDelivered)));
      earned += Math.min(2, Math.floor(safeNumber(stats.eliminations)));
      earned += Math.min(2, Math.floor(safeNumber(stats.bombsDefused)));
      earned += Math.min(2, Math.floor(safeNumber(stats.wallsBuilt) / 2));
      earned += Math.min(2, Math.floor(safeNumber(stats.blocks)));
      earned += Math.min(1, Math.floor(safeNumber(stats.bombsPlanted)));
      earned += Math.min(1, Math.floor(safeNumber(stats.cluesCollected)));
      earned = Math.max(1, Math.min(12, earned));

      const entry = this.leaderboard.get(player.userId);
      if (entry) {
        entry.karma += earned;
        entry.username = player.username;
        entry.lastSeenAt = Date.now();
      }
    }

    this.broadcastLeaderboard();
  }

  private randomNickname() {
    const first = ['Swift', 'Quiet', 'Bold', 'Lucky', 'Rapid', 'Clever', 'Bright', 'Wild'];
    const second = ['Falcon', 'Otter', 'Lion', 'Panda', 'Fox', 'Raven', 'Cobra', 'Wolf'];
    return `${first[Math.floor(Math.random() * first.length)]}${second[Math.floor(Math.random() * second.length)]}${Math.floor(10 + Math.random() * 90)}`;
  }
}
