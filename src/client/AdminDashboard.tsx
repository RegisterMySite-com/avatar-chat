import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import type { ChatMessage, RoomInfo } from "../shared";
import { DEFAULT_AVATAR } from "../shared";

function AvatarImg({
	src,
	alt = "",
	className = "",
}: {
	src: string;
	alt?: string;
	className?: string;
}) {
	const url =
		src && (src.startsWith("http") || src.startsWith("/"))
			? src
			: DEFAULT_AVATAR;
	return (
		<img
			src={url}
			alt={alt}
			className={className}
			loading="lazy"
			decoding="async"
			draggable={false}
		/>
	);
}

function adminHeaders(token: string): HeadersInit {
	return {
		Authorization: `Bearer ${token}`,
		"Content-Type": "application/json",
	};
}

function formatAdminTime(ts: number): string {
	if (!ts) return "—";
	return new Date(ts).toLocaleString([], {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

function formatTimestamp(ts: number): string {
	const date = new Date(ts);
	const now = new Date();
	const isToday =
		date.getFullYear() === now.getFullYear() &&
		date.getMonth() === now.getMonth() &&
		date.getDate() === now.getDate();
	const yesterday = new Date(now);
	yesterday.setDate(yesterday.getDate() - 1);
	const isYesterday =
		date.getFullYear() === yesterday.getFullYear() &&
		date.getMonth() === yesterday.getMonth() &&
		date.getDate() === yesterday.getDate();
	const timeStr = date
		.toLocaleTimeString([], {
			hour: "numeric",
			minute: "2-digit",
			hour12: true,
		})
		.toLowerCase()
		.replace(" ", "");
	if (isToday) return `today at ${timeStr}`;
	if (isYesterday) return `yesterday at ${timeStr}`;
	const dateStr = `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
	return `${dateStr} at ${timeStr}`;
}

function loadTheme(): "light" | "dark" {
	const t = localStorage.getItem("chat-theme");
	if (t === "dark" || t === "light") return t;
	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
}

export function AdminDashboard() {
	const navigate = useNavigate();
	const [token, setToken] = useState<string | null>(() =>
		sessionStorage.getItem("admin-token"),
	);
	const [password, setPassword] = useState("");
	const [loginError, setLoginError] = useState("");
	const [rooms, setRooms] = useState<RoomInfo[]>([]);
	const [loading, setLoading] = useState(false);
	const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [messagesLoading, setMessagesLoading] = useState(false);
	const [actionError, setActionError] = useState("");
	const [theme] = useState<"light" | "dark">(loadTheme);

	useEffect(() => {
		document.documentElement.setAttribute("data-theme", theme);
		document.title = "Admin Dashboard";
		return () => {
			document.title = "Chat";
		};
	}, [theme]);

	const fetchRooms = useCallback(async (t: string) => {
		setLoading(true);
		setActionError("");
		try {
			const res = await fetch("/api/admin/rooms", {
				headers: adminHeaders(t),
			});
			if (res.status === 401) {
				sessionStorage.removeItem("admin-token");
				setToken(null);
				return;
			}
			const data = (await res.json()) as { rooms: RoomInfo[] };
			setRooms(data.rooms || []);
		} catch {
			setActionError("Failed to load rooms");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (token) void fetchRooms(token);
	}, [token, fetchRooms]);

	useEffect(() => {
		if (!token) return;
		const id = setInterval(() => void fetchRooms(token), 8000);
		return () => clearInterval(id);
	}, [token, fetchRooms]);

	const handleLogin = async (e: React.FormEvent) => {
		e.preventDefault();
		setLoginError("");
		try {
			const res = await fetch("/api/admin/login", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ password }),
			});
			const data = (await res.json()) as {
				ok?: boolean;
				token?: string;
				error?: string;
			};
			if (!res.ok || !data.token) {
				setLoginError(data.error || "Invalid password");
				return;
			}
			sessionStorage.setItem("admin-token", data.token);
			setToken(data.token);
		} catch {
			setLoginError("Network error");
		}
	};

	const handleLogout = () => {
		sessionStorage.removeItem("admin-token");
		setToken(null);
		setRooms([]);
		setSelectedRoom(null);
		setMessages([]);
	};

	const openRoom = async (roomId: string) => {
		if (!token) return;
		setSelectedRoom(roomId);
		setMessagesLoading(true);
		setActionError("");
		try {
			const res = await fetch(
				`/api/admin/rooms/${encodeURIComponent(roomId)}/messages`,
				{ headers: adminHeaders(token) },
			);
			const data = (await res.json()) as { messages: ChatMessage[] };
			setMessages(data.messages || []);
		} catch {
			setActionError("Failed to load messages");
		} finally {
			setMessagesLoading(false);
		}
	};

	const deleteMessage = async (messageId: string) => {
		if (!token || !selectedRoom) return;
		if (!confirm("Delete this message for everyone?")) return;
		try {
			const res = await fetch(
				`/api/admin/rooms/${encodeURIComponent(selectedRoom)}/messages/${encodeURIComponent(messageId)}`,
				{ method: "DELETE", headers: adminHeaders(token) },
			);
			if (res.ok) {
				setMessages((prev) => prev.filter((m) => m.id !== messageId));
				void fetchRooms(token);
			} else {
				setActionError("Failed to delete message");
			}
		} catch {
			setActionError("Failed to delete message");
		}
	};

	const deleteRoom = async (roomId: string) => {
		if (!token) return;
		if (
			!confirm(
				`Delete room "${roomId}" and ALL of its messages? This cannot be undone.`,
			)
		) {
			return;
		}
		try {
			const res = await fetch(
				`/api/admin/rooms/${encodeURIComponent(roomId)}`,
				{ method: "DELETE", headers: adminHeaders(token) },
			);
			if (res.ok) {
				if (selectedRoom === roomId) {
					setSelectedRoom(null);
					setMessages([]);
				}
				void fetchRooms(token);
			} else {
				setActionError("Failed to delete room");
			}
		} catch {
			setActionError("Failed to delete room");
		}
	};

	if (!token) {
		return (
			<div className="setup-screen">
				<div className="setup-card">
					<h1>Admin Dashboard</h1>
					<p className="setup-subtitle">Sign in to manage chat rooms</p>
					<form onSubmit={handleLogin} className="setup-form">
						<input
							type="password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							placeholder="Admin password"
							className="name-input"
							autoFocus
							required
						/>
						{loginError && <p className="admin-error">{loginError}</p>}
						<button type="submit" className="primary-btn">
							Sign in
						</button>
					</form>
					<button
						type="button"
						className="text-btn"
						style={{ marginTop: 16 }}
						onClick={() => navigate("/")}
					>
						← Back to chat
					</button>
				</div>
			</div>
		);
	}

	const selected = rooms.find((r) => r.id === selectedRoom);

	return (
		<div className="admin-app">
			<header className="admin-header">
				<div className="admin-header-left">
					<span className="nav-logo">🛡️</span>
					<strong>Admin Dashboard</strong>
				</div>
				<div className="admin-header-right">
					<button
						type="button"
						className="admin-btn ghost"
						onClick={() => void fetchRooms(token)}
					>
						↻ Refresh
					</button>
					<button
						type="button"
						className="admin-btn ghost"
						onClick={() => navigate("/")}
					>
						Open chat
					</button>
					<button type="button" className="admin-btn" onClick={handleLogout}>
						Log out
					</button>
				</div>
			</header>

			{actionError && <div className="admin-banner error">{actionError}</div>}

			<div className="admin-body">
				<aside className="admin-sidebar">
					<div className="admin-sidebar-head">
						<h2>Chat rooms</h2>
						<span className="admin-count">{rooms.length}</span>
					</div>
					{loading && rooms.length === 0 && (
						<p className="empty-hint">Loading…</p>
					)}
					{!loading && rooms.length === 0 && (
						<p className="empty-hint">
							No rooms yet. Rooms appear when someone joins.
						</p>
					)}
					<ul className="admin-room-list">
						{rooms.map((r) => (
							<li key={r.id}>
								<button
									type="button"
									className={`admin-room-item ${selectedRoom === r.id ? "active" : ""}`}
									onClick={() => void openRoom(r.id)}
								>
									<div className="admin-room-top">
										<span className="admin-room-label">{r.label}</span>
										{r.participantCount > 0 && (
											<span className="admin-live">
												<span className="online-dot" />
												{r.participantCount}
											</span>
										)}
									</div>
									<div className="admin-room-meta">
										<span className={`admin-kind ${r.kind}`}>{r.kind}</span>
										<span>{r.messageCount} msgs</span>
										<span>{formatAdminTime(r.lastActivity)}</span>
									</div>
								</button>
							</li>
						))}
					</ul>
				</aside>

				<main className="admin-main">
					{!selectedRoom && (
						<div className="admin-empty">
							<p>Select a room to view messages and manage it.</p>
						</div>
					)}

					{selectedRoom && (
						<>
							<div className="admin-detail-head">
								<div>
									<h2>{selected?.label || selectedRoom}</h2>
									<p className="admin-detail-sub">
										<code>{selectedRoom}</code>
										{selected && (
											<>
												{" · "}
												{selected.participantCount} online
												{" · "}
												{selected.messageCount} messages
											</>
										)}
									</p>
								</div>
								<button
									type="button"
									className="admin-btn danger"
									onClick={() => void deleteRoom(selectedRoom)}
								>
									Delete room
								</button>
							</div>

							{selected && selected.participants.length > 0 && (
								<div className="admin-participants">
									{selected.participants.map((p) => (
										<span key={p.id} className="admin-participant-chip">
											<AvatarImg src={p.avatar} alt="" className="admin-chip-avatar" />{" "}
											{p.name}
										</span>
									))}
								</div>
							)}

							<div className="admin-messages">
								{messagesLoading && (
									<p className="empty-hint">Loading messages…</p>
								)}
								{!messagesLoading && messages.length === 0 && (
									<p className="empty-hint">No messages in this room.</p>
								)}
								{messages.map((m) => (
									<div
										key={m.id}
										className={`admin-msg ${m.role === "system" ? "system" : ""}`}
									>
										<div className="admin-msg-avatar">
											<AvatarImg src={m.avatar} alt={m.user} />
										</div>
										<div className="admin-msg-body">
											<div className="admin-msg-meta">
												<strong>{m.user}</strong>
												<span>{formatTimestamp(m.timestamp)}</span>
												<span className="admin-msg-role">{m.role}</span>
											</div>
											<div className="admin-msg-content">{m.content}</div>
										</div>
										{m.role !== "system" && (
											<button
												type="button"
												className="admin-msg-delete"
												title="Delete message"
												onClick={() => void deleteMessage(m.id)}
											>
												✕
											</button>
										)}
									</div>
								))}
							</div>
						</>
					)}
				</main>
			</div>
		</div>
	);
}
