import { createRoot } from "react-dom/client";
import { usePartySocket } from "partysocket/react";
import React, {
	useState,
	useEffect,
	useRef,
	useCallback,
	useMemo,
} from "react";
import {
	BrowserRouter,
	Routes,
	Route,
	Navigate,
	useParams,
	useNavigate,
	useLocation,
} from "react-router";
import { nanoid } from "nanoid";

import {
	AVATARS,
	PUBLIC_ROOM,
	ADMIN_ROOM,
	DEFAULT_AVATAR,
	type ChatMessage,
	type Message,
	type User,
} from "../shared";
import { AdminDashboard } from "./AdminDashboard";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Renders an avatar as a circular image. Falls back to DEFAULT_AVATAR. */
function AvatarImg({
	src,
	alt = "",
	className = "",
}: {
	src: string;
	alt?: string;
	className?: string;
}) {
	const url = src && (src.startsWith("http") || src.startsWith("/")) ? src : DEFAULT_AVATAR;
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

function loadProfile(): { name: string; avatar: string } | null {
	try {
		const raw = localStorage.getItem("chat-profile");
		if (!raw) return null;
		const p = JSON.parse(raw);
		if (p?.name && p?.avatar) return p;
	} catch {
		/* ignore */
	}
	return null;
}

function saveProfile(name: string, avatar: string) {
	localStorage.setItem("chat-profile", JSON.stringify({ name, avatar }));
}

function loadTheme(): "light" | "dark" {
	const t = localStorage.getItem("chat-theme");
	if (t === "dark" || t === "light") return t;
	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
}

function saveTheme(theme: "light" | "dark") {
	localStorage.setItem("chat-theme", theme);
	document.documentElement.setAttribute("data-theme", theme);
}

function loadNotificationsEnabled(): boolean {
	const v = localStorage.getItem("chat-notifications");
	if (v === null) return "Notification" in window;
	return v === "1";
}

function saveNotificationsEnabled(enabled: boolean) {
	localStorage.setItem("chat-notifications", enabled ? "1" : "0");
}

/** Show a browser notification for a new chat message */
function showMessageNotification(msg: {
	user: string;
	avatar: string;
	content: string;
	roomLabel: string;
}) {
	if (!("Notification" in window) || Notification.permission !== "granted") {
		return;
	}

	if (document.visibilityState === "visible" && document.hasFocus()) {
		return;
	}

	const body =
		msg.content.length > 120 ? msg.content.slice(0, 117) + "…" : msg.content;

	const notification = new Notification(msg.user, {
		body,
		tag: `chat-${msg.user}`,
		renotify: true,
		silent: false,
	});

	notification.onclick = () => {
		window.focus();
		notification.close();
	};

	setTimeout(() => notification.close(), 6000);
}

async function requestNotificationPermission(): Promise<NotificationPermission> {
	if (!("Notification" in window)) return "denied";
	if (Notification.permission === "granted") return "granted";
	if (Notification.permission === "denied") return "denied";
	return Notification.requestPermission();
}

/* ------------------------------------------------------------------ */
/*  Notification sound (Web Audio API – no external files needed)     */
/* ------------------------------------------------------------------ */

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
	if (typeof window === "undefined") return null;
	const AC =
		window.AudioContext ||
		(window as unknown as { webkitAudioContext?: typeof AudioContext })
			.webkitAudioContext;
	if (!AC) return null;
	if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
		sharedAudioCtx = new AC();
	}
	return sharedAudioCtx;
}

function playNotificationSound() {
	try {
		const ctx = getAudioContext();
		if (!ctx) return;

		if (ctx.state === "suspended") {
			void ctx.resume();
		}

		const now = ctx.currentTime;

		const master = ctx.createGain();
		master.gain.setValueAtTime(0.22, now);
		master.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
		master.connect(ctx.destination);

		const osc1 = ctx.createOscillator();
		const g1 = ctx.createGain();
		osc1.type = "sine";
		osc1.frequency.setValueAtTime(880, now);
		g1.gain.setValueAtTime(0, now);
		g1.gain.linearRampToValueAtTime(1, now + 0.02);
		g1.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
		osc1.connect(g1);
		g1.connect(master);
		osc1.start(now);
		osc1.stop(now + 0.3);

		const osc2 = ctx.createOscillator();
		const g2 = ctx.createGain();
		osc2.type = "sine";
		osc2.frequency.setValueAtTime(1174.66, now + 0.08);
		g2.gain.setValueAtTime(0, now + 0.08);
		g2.gain.linearRampToValueAtTime(0.9, now + 0.1);
		g2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
		osc2.connect(g2);
		g2.connect(master);
		osc2.start(now + 0.08);
		osc2.stop(now + 0.52);
	} catch {
		/* Audio not available */
	}
}

/* ------------------------------------------------------------------ */
/*  Profile Setup                                                     */
/* ------------------------------------------------------------------ */

function ProfileSetup({
	onComplete,
	initialName,
	initialAvatar,
}: {
	onComplete: (name: string, avatar: string) => void;
	initialName?: string;
	initialAvatar?: string;
}) {
	const [name, setName] = useState(initialName || "");
	const [avatar, setAvatar] = useState(
		initialAvatar || AVATARS[Math.floor(Math.random() * AVATARS.length)],
	);

	const submit = (e: React.FormEvent) => {
		e.preventDefault();
		const trimmed = name.trim().slice(0, 24);
		if (!trimmed) return;
		saveProfile(trimmed, avatar);
		onComplete(trimmed, avatar);
	};

	return (
		<div className="setup-screen">
			<div className="setup-card">
				<h1>Welcome</h1>
				<p className="setup-subtitle">Choose a display name and avatar</p>

				<div className="avatar-preview">
					<AvatarImg src={avatar} alt="Selected avatar" />
				</div>

				<div className="avatar-grid">
					{AVATARS.map((a) => (
						<button
							key={a}
							type="button"
							className={`avatar-btn ${a === avatar ? "selected" : ""}`}
							onClick={() => setAvatar(a)}
							aria-label="Select avatar"
						>
							<AvatarImg src={a} alt="" />
						</button>
					))}
				</div>

				<form onSubmit={submit} className="setup-form">
					<input
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Your name"
						maxLength={24}
						autoFocus
						required
						className="name-input"
					/>
					<button type="submit" className="primary-btn" disabled={!name.trim()}>
						Continue
					</button>
				</form>
			</div>
		</div>
	);
}

/* ------------------------------------------------------------------ */
/*  Room Selector                                                     */
/* ------------------------------------------------------------------ */

function RoomSelector({
	name,
	avatar,
	onChangeProfile,
}: {
	name: string;
	avatar: string;
	onChangeProfile: () => void;
}) {
	const navigate = useNavigate();

	const goPublic = () => navigate(`/${PUBLIC_ROOM}`);
	const goAdmin = () => navigate(`/${ADMIN_ROOM}`);
	const goPrivate = () => {
		const slug = nanoid(10);
		navigate(`/p/${slug}`);
	};

	return (
		<div className="setup-screen">
			<div className="setup-card room-card">
				<div className="profile-chip">
					<span className="chip-avatar">
						<AvatarImg src={avatar} alt="" />
					</span>
					<span className="chip-name">{name}</span>
					<button
						type="button"
						className="text-btn"
						onClick={onChangeProfile}
						title="Change name & avatar"
					>
						Edit
					</button>
				</div>

				<h1>Choose a chatroom</h1>
				<p className="setup-subtitle">Pick where you want to chat</p>

				<div className="room-options">
					<button type="button" className="room-option" onClick={goPublic}>
						<span className="room-icon">🌐</span>
						<div>
							<strong>Public Room</strong>
							<span>Open chat with everyone</span>
						</div>
					</button>

					<button type="button" className="room-option" onClick={goPrivate}>
						<span className="room-icon">🔒</span>
						<div>
							<strong>Private Room</strong>
							<span>Generate a unique invite link</span>
						</div>
					</button>

					<button type="button" className="room-option admin" onClick={goAdmin}>
						<span className="room-icon">📩</span>
						<div>
							<strong>Message Admin</strong>
							<span>Chat directly with the site admin</span>
						</div>
					</button>
				</div>

				<button
					type="button"
					className="text-btn admin-link"
					onClick={() => navigate("/dashboard")}
				>
					🛡️ Admin dashboard
				</button>
			</div>
		</div>
	);
}

/* ------------------------------------------------------------------ */
/*  Top Navigation                                                    */
/* ------------------------------------------------------------------ */

function TopNav({
	roomLabel,
	name,
	avatar,
	theme,
	notificationsEnabled,
	onToggleTheme,
	onToggleNotifications,
	onChangeRoom,
	onChangeProfile,
	participantCount,
}: {
	roomLabel: string;
	name: string;
	avatar: string;
	theme: "light" | "dark";
	notificationsEnabled: boolean;
	onToggleTheme: () => void;
	onToggleNotifications: () => void;
	onChangeRoom: () => void;
	onChangeProfile: () => void;
	participantCount: number;
}) {
	const [open, setOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const handler = (e: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, []);

	return (
		<header className="top-nav">
			<div className="nav-left">
				<span className="nav-logo">💬</span>
				<span className="nav-room">{roomLabel}</span>
			</div>

			<div className="nav-right">
				<span className="online-badge" title="Online now">
					<span className="online-dot" />
					{participantCount} online
				</span>

				<div className="menu-wrapper" ref={menuRef}>
					<button
						type="button"
						className="menu-trigger"
						onClick={() => setOpen((v) => !v)}
						aria-label="Menu"
					>
						<span className="menu-avatar">
							<AvatarImg src={avatar} alt="" />
						</span>
						<span className="menu-name">{name}</span>
						<span className="chevron">{open ? "▴" : "▾"}</span>
					</button>

					{open && (
						<div className="dropdown-menu">
							<button
								type="button"
								className="dropdown-item"
								onClick={() => {
									onToggleTheme();
									setOpen(false);
								}}
							>
								{theme === "dark" ? "☀️ Light mode" : "🌙 Dark mode"}
							</button>
							<button
								type="button"
								className="dropdown-item"
								onClick={() => {
									onToggleNotifications();
									setOpen(false);
								}}
							>
								{notificationsEnabled
									? "🔔 Notifications on"
									: "🔕 Notifications off"}
							</button>
							<button
								type="button"
								className="dropdown-item"
								onClick={() => {
									onChangeRoom();
									setOpen(false);
								}}
							>
								🚪 Change chatroom
							</button>
							<button
								type="button"
								className="dropdown-item"
								onClick={() => {
									onChangeProfile();
									setOpen(false);
								}}
							>
								👤 Change name & avatar
							</button>
						</div>
					)}
				</div>
			</div>
		</header>
	);
}

/* ------------------------------------------------------------------ */
/*  Participants Panel                                                */
/* ------------------------------------------------------------------ */

function ParticipantsPanel({ users }: { users: User[] }) {
	if (users.length === 0) {
		return (
			<aside className="participants">
				<h3>Online</h3>
				<p className="empty-hint">No one else is here yet</p>
			</aside>
		);
	}

	return (
		<aside className="participants">
			<h3>
				Online <span className="count">{users.length}</span>
			</h3>
			<ul className="participant-list">
				{users.map((u) => (
					<li key={u.id} className="participant">
						<span className="p-avatar">
							<AvatarImg src={u.avatar} alt="" />
						</span>
						<span className="p-name">{u.name}</span>
					</li>
				))}
			</ul>
		</aside>
	);
}

/* ------------------------------------------------------------------ */
/*  Message List                                                      */
/* ------------------------------------------------------------------ */

function MessageList({
	messages,
	myName,
}: {
	messages: ChatMessage[];
	myName: string;
}) {
	const bottomRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages]);

	return (
		<div className="message-list">
			{messages.map((m) => {
				const isMe = m.user === myName && m.role === "user";
				const isSystem = m.role === "system";

				if (isSystem) {
					return (
						<div key={m.id} className="msg system">
							<span className="system-text">{m.content}</span>
							<span className="msg-time">{formatTimestamp(m.timestamp)}</span>
						</div>
					);
				}

				return (
					<div
						key={m.id}
						className={`msg ${isMe ? "me" : "other"} ${m.role === "admin" ? "admin" : ""}`}
					>
						{!isMe && (
							<div className="msg-avatar" title={m.user}>
								<AvatarImg src={m.avatar} alt={m.user} />
							</div>
						)}
						<div className="msg-body">
							<div className="msg-meta">
								{!isMe && <span className="msg-author">{m.user}</span>}
								<span className="msg-time">{formatTimestamp(m.timestamp)}</span>
							</div>
							<div className="msg-bubble">{m.content}</div>
						</div>
						{isMe && (
							<div className="msg-avatar" title={m.user}>
								<AvatarImg src={m.avatar} alt={m.user} />
							</div>
						)}
					</div>
				);
			})}
			<div ref={bottomRef} />
		</div>
	);
}

/* ------------------------------------------------------------------ */
/*  Chat Room                                                         */
/* ------------------------------------------------------------------ */

function ChatRoom({
	room,
	name,
	avatar,
	onChangeProfile,
	onChangeRoom,
}: {
	room: string;
	name: string;
	avatar: string;
	onChangeProfile: () => void;
	onChangeRoom: () => void;
}) {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [users, setUsers] = useState<User[]>([]);
	const [theme, setTheme] = useState<"light" | "dark">(loadTheme);
	const [notificationsEnabled, setNotificationsEnabled] = useState(
		loadNotificationsEnabled,
	);
	const [unreadCount, setUnreadCount] = useState(0);
	const [input, setInput] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	const notifiedIds = useRef(new Set<string>());
	const notificationsEnabledRef = useRef(notificationsEnabled);
	notificationsEnabledRef.current = notificationsEnabled;

	const roomLabel = useMemo(() => {
		if (room === PUBLIC_ROOM) return "Public Room";
		if (room === ADMIN_ROOM) return "Message Admin";
		if (room.startsWith("p/")) return "Private Room";
		return `Room ${room.slice(0, 8)}…`;
	}, [room]);

	const partyRoom = room.startsWith("p/") ? room.slice(2) : room;

	const socket = usePartySocket({
		party: "chat",
		room: partyRoom,
		onMessage(evt) {
			const msg = JSON.parse(evt.data as string) as Message;

			if (msg.type === "all") {
				setMessages(msg.messages);
				for (const m of msg.messages) {
					notifiedIds.current.add(m.id);
				}
			} else if (msg.type === "add") {
				const incoming: ChatMessage = {
					id: msg.id,
					content: msg.content,
					user: msg.user,
					avatar: msg.avatar,
					role: msg.role,
					timestamp: msg.timestamp,
				};

				setMessages((prev) => {
					if (prev.some((m) => m.id === incoming.id)) {
						return prev.map((m) => (m.id === incoming.id ? incoming : m));
					}
					return [...prev, incoming];
				});

				const isOwn = incoming.user === name && incoming.role === "user";
				const isSystem = incoming.role === "system";
				const alreadyNotified = notifiedIds.current.has(incoming.id);

				if (!isOwn && !isSystem && !alreadyNotified) {
					notifiedIds.current.add(incoming.id);

					if (notificationsEnabledRef.current) {
						playNotificationSound();
						showMessageNotification({
							user: incoming.user,
							avatar: incoming.avatar,
							content: incoming.content,
							roomLabel,
						});
					}

					if (document.visibilityState === "hidden") {
						setUnreadCount((c) => c + 1);
					}
				}
			} else if (msg.type === "update") {
				setMessages((prev) =>
					prev.map((m) =>
						m.id === msg.id
							? {
									id: msg.id,
									content: msg.content,
									user: msg.user,
									avatar: msg.avatar,
									role: msg.role,
									timestamp: msg.timestamp,
							  }
							: m,
					),
				);
			} else if (msg.type === "delete") {
				setMessages((prev) => prev.filter((m) => m.id !== msg.id));
			} else if (msg.type === "room_cleared") {
				setMessages([]);
			} else if (msg.type === "presence") {
				setUsers(msg.users);
			}
		},
	});

	useEffect(() => {
		const sendIdentity = () => {
			if (socket.readyState === WebSocket.OPEN) {
				socket.send(
					JSON.stringify({
						type: "identity",
						name,
						avatar,
					} satisfies Message),
				);
			}
		};

		sendIdentity();

		const onOpen = () => sendIdentity();
		socket.addEventListener("open", onOpen);
		return () => socket.removeEventListener("open", onOpen);
	}, [name, avatar, socket]);

	useEffect(() => {
		const onVisibility = () => {
			if (document.visibilityState === "visible") {
				setUnreadCount(0);
			}
		};
		document.addEventListener("visibilitychange", onVisibility);
		return () => document.removeEventListener("visibilitychange", onVisibility);
	}, []);

	useEffect(() => {
		const unlock = () => {
			const ctx = getAudioContext();
			if (ctx?.state === "suspended") {
				void ctx.resume();
			}
		};
		document.addEventListener("pointerdown", unlock, { once: true });
		document.addEventListener("keydown", unlock, { once: true });
		return () => {
			document.removeEventListener("pointerdown", unlock);
			document.removeEventListener("keydown", unlock);
		};
	}, []);

	useEffect(() => {
		const base = roomLabel || "Chat";
		document.title = unreadCount > 0 ? `(${unreadCount}) ${base}` : base;
		return () => {
			document.title = "Chat";
		};
	}, [unreadCount, roomLabel]);

	const toggleTheme = useCallback(() => {
		setTheme((prev) => {
			const next = prev === "dark" ? "light" : "dark";
			saveTheme(next);
			return next;
		});
	}, []);

	useEffect(() => {
		saveTheme(theme);
	}, [theme]);

	const toggleNotifications = useCallback(async () => {
		if (notificationsEnabled) {
			setNotificationsEnabled(false);
			saveNotificationsEnabled(false);
			return;
		}

		const permission = await requestNotificationPermission();
		if (permission === "granted") {
			setNotificationsEnabled(true);
			saveNotificationsEnabled(true);
		} else {
			setNotificationsEnabled(false);
			saveNotificationsEnabled(false);
			const prev = document.title;
			document.title = "Notifications blocked by browser";
			setTimeout(() => {
				document.title = prev;
			}, 2500);
		}
	}, [notificationsEnabled]);

	const sendMessage = (e: React.FormEvent) => {
		e.preventDefault();
		const content = input.trim();
		if (!content) return;

		const chatMessage: ChatMessage = {
			id: nanoid(10),
			content,
			user: name,
			avatar,
			role: "user",
			timestamp: Date.now(),
		};

		notifiedIds.current.add(chatMessage.id);
		setMessages((prev) => [...prev, chatMessage]);

		socket.send(
			JSON.stringify({
				type: "add",
				...chatMessage,
			} satisfies Message),
		);

		setInput("");
		inputRef.current?.focus();
	};

	return (
		<div className="chat-app">
			<TopNav
				roomLabel={roomLabel}
				name={name}
				avatar={avatar}
				theme={theme}
				notificationsEnabled={notificationsEnabled}
				onToggleTheme={toggleTheme}
				onToggleNotifications={toggleNotifications}
				onChangeRoom={onChangeRoom}
				onChangeProfile={onChangeProfile}
				participantCount={users.length}
			/>

			<div className="chat-body">
				<main className="chat-main">
					<MessageList messages={messages} myName={name} />

					<form className="composer" onSubmit={sendMessage}>
						<input
							ref={inputRef}
							type="text"
							value={input}
							onChange={(e) => setInput(e.target.value)}
							placeholder={
								room === ADMIN_ROOM
									? "Write a message to the admin…"
									: "Type a message…"
							}
							autoComplete="off"
							maxLength={2000}
						/>
						<button type="submit" disabled={!input.trim()} aria-label="Send">
							➤
						</button>
					</form>
				</main>

				<ParticipantsPanel users={users} />
			</div>
		</div>
	);
}

/* ------------------------------------------------------------------ */
/*  App Shell                                                         */
/* ------------------------------------------------------------------ */

type Screen = "profile" | "rooms" | "chat";

function AppShell() {
	const navigate = useNavigate();
	const location = useLocation();
	const params = useParams();

	const [profile, setProfile] = useState(() => loadProfile());
	const [screen, setScreen] = useState<Screen>(() => {
		if (!loadProfile()) return "profile";
		const path = window.location.pathname;
		if (path !== "/" && path !== "") return "chat";
		return "rooms";
	});

	const room = useMemo(() => {
		if (params.slug) return `p/${params.slug}`;
		if (params.room) return params.room;
		return null;
	}, [params]);

	useEffect(() => {
		if (!profile) {
			setScreen("profile");
			return;
		}
		if (room) {
			setScreen("chat");
		} else if (location.pathname === "/" || location.pathname === "") {
			setScreen("rooms");
		}
	}, [profile, room, location.pathname]);

	const handleProfileComplete = (name: string, avatar: string) => {
		setProfile({ name, avatar });
		if (room) {
			setScreen("chat");
		} else {
			setScreen("rooms");
			navigate("/");
		}
	};

	const handleChangeProfile = () => {
		setScreen("profile");
	};

	const handleChangeRoom = () => {
		setScreen("rooms");
		navigate("/");
	};

	if (screen === "profile") {
		return (
			<ProfileSetup
				onComplete={handleProfileComplete}
				initialName={profile?.name}
				initialAvatar={profile?.avatar}
			/>
		);
	}

	if (screen === "rooms" || !room || !profile) {
		return (
			<RoomSelector
				name={profile!.name}
				avatar={profile!.avatar}
				onChangeProfile={handleChangeProfile}
			/>
		);
	}

	return (
		<ChatRoom
			room={room}
			name={profile.name}
			avatar={profile.avatar}
			onChangeProfile={handleChangeProfile}
			onChangeRoom={handleChangeRoom}
		/>
	);
}

/* ------------------------------------------------------------------ */
/*  Router                                                            */
/* ------------------------------------------------------------------ */

createRoot(document.getElementById("root")!).render(
	<BrowserRouter>
		<Routes>
			<Route path="/dashboard" element={<AdminDashboard />} />
			<Route path="/" element={<AppShell />} />
			<Route path="/p/:slug" element={<AppShell />} />
			<Route path="/:room" element={<AppShell />} />
			<Route path="*" element={<Navigate to="/" replace />} />
		</Routes>
	</BrowserRouter>,
);
