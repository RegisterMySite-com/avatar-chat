import {
	type Connection,
	Server,
	type WSMessage,
	routePartykitRequest,
} from "partyserver";

import type {
	ChatMessage,
	Message,
	User,
	RoomInfo,
} from "../shared";
import { DEFAULT_AVATAR, SYSTEM_AVATAR } from "../shared";

type ConnectionState = {
	name?: string;
	avatar?: string;
};

/* ================================================================== */
/*  Room Registry – tracks every chat room that has been used         */
/* ================================================================== */

type RoomRecord = {
	id: string;
	label: string;
	kind: "public" | "admin" | "private";
	createdAt: number;
	lastActivity: number;
	messageCount: number;
};

/**
 * Tracks every chat room that has been used so the admin dashboard can list them.
 * Plain Durable Object (not PartyServer) — accessed only via stub.fetch().
 */
export class RoomRegistry {
	constructor(
		private readonly ctx: DurableObjectState,
		private readonly env: Env,
	) {
		this.ctx.storage.sql.exec(`
		CREATE TABLE IF NOT EXISTS rooms (
			id TEXT PRIMARY KEY,
			label TEXT NOT NULL,
			kind TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			last_activity INTEGER NOT NULL,
			message_count INTEGER NOT NULL DEFAULT 0
		)
		`);
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		if (request.method === "POST" && path === "/register") {
			const body = (await request.json()) as {
				id: string;
				label: string;
				kind: RoomRecord["kind"];
				messageCount?: number;
			};
			const now = Date.now();
			this.ctx.storage.sql.exec(
				`INSERT INTO rooms (id, label, kind, created_at, last_activity, message_count)
				VALUES (?, ?, ?, ?, ?, ?)
				ON CONFLICT (id) DO UPDATE SET
				last_activity = excluded.last_activity,
				message_count = COALESCE(excluded.message_count, rooms.message_count)`,
				body.id,
				body.label,
				body.kind,
				now,
				now,
				body.messageCount ?? 0,
			);
			return Response.json({ ok: true });
		}

		if (request.method === "POST" && path === "/touch") {
			const body = (await request.json()) as {
				id: string;
				messageCount?: number;
			};
			this.ctx.storage.sql.exec(
				`UPDATE rooms SET last_activity = ?, message_count = COALESCE(?, message_count) WHERE id = ?`,
				Date.now(),
				body.messageCount ?? null,
				body.id,
			);
			return Response.json({ ok: true });
		}

		if (request.method === "POST" && path === "/unregister") {
			const body = (await request.json()) as { id: string };
			this.ctx.storage.sql.exec(`DELETE FROM rooms WHERE id = ?`, body.id);
			return Response.json({ ok: true });
		}

		if (request.method === "GET" && path === "/list") {
			const rows = this.ctx.storage.sql
				.exec(
					`SELECT id, label, kind, created_at, last_activity, message_count FROM rooms ORDER BY last_activity DESC`,
				)
				.toArray() as Array<Record<string, unknown>>;

			const rooms: Omit<RoomInfo, "participantCount" | "participants">[] =
				rows.map((r) => ({
					id: String(r.id),
					label: String(r.label),
					kind: r.kind as RoomRecord["kind"],
					createdAt: Number(r.created_at),
					lastActivity: Number(r.last_activity),
					messageCount: Number(r.message_count),
				}));

			return Response.json({ rooms });
		}

		return new Response("Not found", { status: 404 });
	}
}

/* ================================================================== */
/*  Chat room Durable Object                                          */
/* ================================================================== */

function roomMeta(name: string): {
	label: string;
	kind: RoomRecord["kind"];
} {
	if (name === "public") return { label: "Public Room", kind: "public" };
	if (name === "admin") return { label: "Message Admin", kind: "admin" };
	return { label: `Private (${name.slice(0, 8)}…)`, kind: "private" };
}

export class Chat extends Server<Env> {
	static options = { hibernate: true };

	messages: ChatMessage[] = [];
	users = new Map<string, User>();
	registered = false;

	broadcastMessage(message: Message, exclude?: string[]) {
		this.broadcast(JSON.stringify(message), exclude);
	}

	getPresence(): User[] {
		return Array.from(this.users.values());
	}

	broadcastPresence(exclude?: string[]) {
		this.broadcastMessage(
			{ type: "presence", users: this.getPresence() },
			exclude,
		);
	}

	async registerWithRegistry() {
		if (this.registered) {
			await this.touchRegistry();
			return;
		}
		try {
			const id = this.env.RoomRegistry.idFromName("global");
			const stub = this.env.RoomRegistry.get(id);
			const meta = roomMeta(this.name);
			await stub.fetch("https://registry/register", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					id: this.name,
					label: meta.label,
					kind: meta.kind,
					messageCount: this.messages.filter((m) => m.role !== "system")
						.length,
				}),
			});
			this.registered = true;
		} catch {
			/* registry unavailable – non-fatal */
		}
	}

	async touchRegistry() {
		try {
			const id = this.env.RoomRegistry.idFromName("global");
			const stub = this.env.RoomRegistry.get(id);
			await stub.fetch("https://registry/touch", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					id: this.name,
					messageCount: this.messages.filter((m) => m.role !== "system")
						.length,
				}),
			});
		} catch {
			/* non-fatal */
		}
	}

	onStart() {
		this.ctx.storage.sql.exec(`
		CREATE TABLE IF NOT EXISTS messages (
			id TEXT PRIMARY KEY,
			user TEXT,
			avatar TEXT,
			role TEXT,
			content TEXT,
			timestamp INTEGER
		)
		`);

		try {
			this.ctx.storage.sql.exec(
				`ALTER TABLE messages ADD COLUMN avatar TEXT DEFAULT ''`,
			);
		} catch {
			/* already exists */
		}
		try {
			this.ctx.storage.sql.exec(
				`ALTER TABLE messages ADD COLUMN timestamp INTEGER DEFAULT 0`,
			);
		} catch {
			/* already exists */
		}

		this.messages = this.ctx.storage.sql
			.exec(`SELECT * FROM messages ORDER BY timestamp ASC`)
			.toArray()
			.map((row: Record<string, unknown>) => ({
				id: String(row.id),
				user: String(row.user),
				avatar: String(row.avatar || DEFAULT_AVATAR),
				role: (row.role as ChatMessage["role"]) || "user",
				content: String(row.content),
				timestamp: Number(row.timestamp) || Date.now(),
			}));

		void this.registerWithRegistry();
	}

	onConnect(connection: Connection<ConnectionState>) {
		void this.registerWithRegistry();

		connection.send(
			JSON.stringify({
				type: "all",
				messages: this.messages,
			} satisfies Message),
		);

		connection.send(
			JSON.stringify({
				type: "presence",
				users: this.getPresence(),
			} satisfies Message),
		);
	}

	onClose(connection: Connection<ConnectionState>) {
		const left = this.users.get(connection.id);
		if (left) {
			this.users.delete(connection.id);
			this.broadcastPresence();
			const systemMsg: ChatMessage = {
				id: `sys-${Date.now()}`,
				content: `${left.name} left the chat`,
				user: "System",
				avatar: SYSTEM_AVATAR,
				role: "system",
				timestamp: Date.now(),
			};
			this.messages.push(systemMsg);
			this.broadcastMessage({ type: "add", ...systemMsg });
		}
	}

	saveMessage(message: ChatMessage) {
		const existing = this.messages.find((m) => m.id === message.id);
		if (existing) {
			this.messages = this.messages.map((m) =>
				m.id === message.id ? message : m,
			);
		} else {
			this.messages.push(message);
		}

		this.ctx.storage.sql.exec(
			`INSERT INTO messages (id, user, avatar, role, content, timestamp)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT (id) DO UPDATE SET
			content = excluded.content,
			avatar = excluded.avatar,
			timestamp = excluded.timestamp`,
			message.id,
			message.user,
			message.avatar,
			message.role,
			message.content,
			message.timestamp,
		);

		void this.touchRegistry();
	}

	deleteMessage(messageId: string): boolean {
		const before = this.messages.length;
		this.messages = this.messages.filter((m) => m.id !== messageId);
		if (this.messages.length === before) return false;

		this.ctx.storage.sql.exec(`DELETE FROM messages WHERE id = ?`, messageId);
		this.broadcastMessage({ type: "delete", id: messageId });
		void this.touchRegistry();
		return true;
	}

	clearAllMessages() {
		this.messages = [];
		this.ctx.storage.sql.exec(`DELETE FROM messages`);
		this.broadcastMessage({ type: "room_cleared" });
		void this.touchRegistry();
	}

	/* ---- Admin HTTP interface (called via DO stub) ---- */

	async onRequest(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		if (request.method === "GET" && path === "/admin/stats") {
			return Response.json({
				id: this.name,
				messageCount: this.messages.filter((m) => m.role !== "system").length,
				participantCount: this.users.size,
				participants: this.getPresence(),
			});
		}

		if (request.method === "GET" && path === "/admin/messages") {
			return Response.json({
				roomId: this.name,
				messages: this.messages,
			});
		}

		if (request.method === "DELETE" && path.startsWith("/admin/messages/")) {
			const messageId = decodeURIComponent(
				path.slice("/admin/messages/".length),
			);
			const ok = this.deleteMessage(messageId);
			return Response.json({ ok, id: messageId });
		}

		if (request.method === "DELETE" && path === "/admin/room") {
			this.clearAllMessages();
			try {
				const id = this.env.RoomRegistry.idFromName("global");
				const stub = this.env.RoomRegistry.get(id);
				await stub.fetch("https://registry/unregister", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ id: this.name }),
				});
			} catch {
				/* non-fatal */
			}
			this.registered = false;
			return Response.json({ ok: true });
		}

		return new Response("Not found", { status: 404 });
	}

	onMessage(connection: Connection<ConnectionState>, message: WSMessage) {
		let parsed: Message;
		try {
			parsed = JSON.parse(message as string) as Message;
		} catch {
			return;
		}

		if (parsed.type === "identity") {
			const prev = this.users.get(connection.id);
			const user: User = {
				id: connection.id,
				name: parsed.name.slice(0, 32) || "Anonymous",
				avatar: parsed.avatar || DEFAULT_AVATAR,
			};
			this.users.set(connection.id, user);
			connection.setState({ name: user.name, avatar: user.avatar });

			if (!prev) {
				const systemMsg: ChatMessage = {
					id: `sys-${Date.now()}-${connection.id}`,
					content: `${user.name} joined the chat`,
					user: "System",
					avatar: SYSTEM_AVATAR,
					role: "system",
					timestamp: Date.now(),
				};
				this.messages.push(systemMsg);
				this.broadcastMessage({ type: "add", ...systemMsg });
			}

			this.broadcastPresence();
			return;
		}

		if (parsed.type === "add" || parsed.type === "update") {
			const enriched: ChatMessage = {
				id: parsed.id,
				content: parsed.content.slice(0, 2000),
				user: parsed.user.slice(0, 32),
				avatar: parsed.avatar || DEFAULT_AVATAR,
				role: parsed.role || "user",
				timestamp: parsed.timestamp || Date.now(),
			};
			this.saveMessage(enriched);
			this.broadcastMessage({ type: parsed.type, ...enriched });
			return;
		}
	}
}

/* ================================================================== */
/*  Worker – routes PartyServer + Admin API                           */
/* ================================================================== */

const CORS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json", ...CORS },
	});
}

function unauthorized() {
	return json({ error: "Unauthorized" }, 401);
}

function checkAdmin(request: Request, env: Env): boolean {
	const secret = (env as Env & { ADMIN_SECRET?: string }).ADMIN_SECRET || "admin";
	const auth = request.headers.get("Authorization") || "";
	if (auth === `Bearer ${secret}`) return true;
	const url = new URL(request.url);
	if (url.searchParams.get("secret") === secret) return true;
	return false;
}

async function handleAdminApi(
	request: Request,
	env: Env,
	path: string,
): Promise<Response> {
	if (request.method === "OPTIONS") {
		return new Response(null, { status: 204, headers: CORS });
	}

	if (path === "/api/admin/login" && request.method === "POST") {
		const body = (await request.json().catch(() => ({}))) as {
			password?: string;
		};
		const secret =
			(env as Env & { ADMIN_SECRET?: string }).ADMIN_SECRET || "admin";
		if (body.password === secret) {
			return json({ ok: true, token: secret });
		}
		return json({ error: "Invalid password" }, 401);
	}

	if (!checkAdmin(request, env)) {
		return unauthorized();
	}

	if (path === "/api/admin/rooms" && request.method === "GET") {
		const registryId = env.RoomRegistry.idFromName("global");
		const registry = env.RoomRegistry.get(registryId);
		const listRes = await registry.fetch("https://registry/list");
		const { rooms: registered } = (await listRes.json()) as {
			rooms: Array<{
				id: string;
				label: string;
				kind: RoomInfo["kind"];
				createdAt: number;
				lastActivity: number;
				messageCount: number;
			}>;
		};

		const rooms: RoomInfo[] = await Promise.all(
			registered.map(async (r) => {
				try {
					const chatId = env.Chat.idFromName(r.id);
					const chat = env.Chat.get(chatId);
					const statsRes = await chat.fetch("https://chat/admin/stats");
					if (statsRes.ok) {
						const stats = (await statsRes.json()) as {
							messageCount: number;
							participantCount: number;
							participants: User[];
						};
						return {
							...r,
							messageCount: stats.messageCount,
							participantCount: stats.participantCount,
							participants: stats.participants,
						};
					}
				} catch {
					/* DO may not be awake */
				}
				return {
					...r,
					participantCount: 0,
					participants: [],
				};
			}),
		);

		return json({ rooms });
	}

	const messagesMatch = path.match(/^\/api\/admin\/rooms\/([^/]+)\/messages$/);
	if (messagesMatch && request.method === "GET") {
		const roomId = decodeURIComponent(messagesMatch[1]);
		const chatId = env.Chat.idFromName(roomId);
		const chat = env.Chat.get(chatId);
		const res = await chat.fetch("https://chat/admin/messages");
		const data = await res.json();
		return json(data);
	}

	const deleteMsgMatch = path.match(
		/^\/api\/admin\/rooms\/([^/]+)\/messages\/([^/]+)$/,
	);
	if (deleteMsgMatch && request.method === "DELETE") {
		const roomId = decodeURIComponent(deleteMsgMatch[1]);
		const messageId = decodeURIComponent(deleteMsgMatch[2]);
		const chatId = env.Chat.idFromName(roomId);
		const chat = env.Chat.get(chatId);
		const res = await chat.fetch(
			`https://chat/admin/messages/${encodeURIComponent(messageId)}`,
			{ method: "DELETE" },
		);
		const data = await res.json();
		return json(data);
	}

	const deleteRoomMatch = path.match(/^\/api\/admin\/rooms\/([^/]+)$/);
	if (deleteRoomMatch && request.method === "DELETE") {
		const roomId = decodeURIComponent(deleteRoomMatch[1]);
		const chatId = env.Chat.idFromName(roomId);
		const chat = env.Chat.get(chatId);
		const res = await chat.fetch("https://chat/admin/room", {
			method: "DELETE",
		});
		const data = await res.json();
		return json(data);
	}

	return json({ error: "Not found" }, 404);
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		if (url.pathname.startsWith("/api/admin")) {
			return handleAdminApi(request, env, url.pathname);
		}

		const partyResponse = await routePartykitRequest(request, { ...env });
		if (partyResponse) return partyResponse;

		return env.ASSETS.fetch(request);
	},
} satisfies ExportedHandler<Env>;
