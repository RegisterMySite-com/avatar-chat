export type User = {
	id: string;
	name: string;
	avatar: string;
};

export type ChatMessage = {
	id: string;
	content: string;
	user: string;
	avatar: string;
	role: "user" | "admin" | "system";
	timestamp: number;
};

export type RoomInfo = {
	id: string;
	label: string;
	kind: "public" | "admin" | "private";
	createdAt: number;
	lastActivity: number;
	messageCount: number;
	participantCount: number;
	participants: User[];
};

export type Message =
	| {
			type: "add";
			id: string;
			content: string;
			user: string;
			avatar: string;
			role: "user" | "admin" | "system";
			timestamp: number;
	  }
	| {
			type: "update";
			id: string;
			content: string;
			user: string;
			avatar: string;
			role: "user" | "admin" | "system";
			timestamp: number;
	  }
	| {
			type: "all";
			messages: ChatMessage[];
	  }
	| {
			type: "presence";
			users: User[];
	  }
	| {
			type: "identity";
			name: string;
			avatar: string;
	  }
	| {
			type: "system";
			content: string;
			timestamp: number;
	  }
	| {
			type: "delete";
			id: string;
	  }
	| {
			type: "room_cleared";
	  };

/**
 * Curated avatar list for users to pick from.
 * These are circular logo-style images (SVG via DiceBear "shapes").
 * Replace any URL with your own image path (e.g. "/avatars/my-logo.png")
 * or a hosted image when ready. Prefer square images — CSS will crop them to circles.
 */
export const AVATARS = [
	"https://api.dicebear.com/9.x/shapes/svg?seed=smile&backgroundColor=b6e3f4",
	"https://api.dicebear.com/9.x/shapes/svg?seed=cool&backgroundColor=c0aede",
	"https://api.dicebear.com/9.x/shapes/svg?seed=star&backgroundColor=d1d4f9",
	"https://api.dicebear.com/9.x/shapes/svg?seed=party&backgroundColor=ffd5dc",
	"https://api.dicebear.com/9.x/shapes/svg?seed=robot&backgroundColor=ffdfbf",
	"https://api.dicebear.com/9.x/shapes/svg?seed=alien&backgroundColor=c0aede",
	"https://api.dicebear.com/9.x/shapes/svg?seed=ghost&backgroundColor=b6e3f4",
	"https://api.dicebear.com/9.x/shapes/svg?seed=cat&backgroundColor=ffd5dc",
	"https://api.dicebear.com/9.x/shapes/svg?seed=dog&backgroundColor=ffdfbf",
	"https://api.dicebear.com/9.x/shapes/svg?seed=fox&backgroundColor=d1d4f9",
	"https://api.dicebear.com/9.x/shapes/svg?seed=bear&backgroundColor=c0aede",
	"https://api.dicebear.com/9.x/shapes/svg?seed=panda&backgroundColor=b6e3f4",
	"https://api.dicebear.com/9.x/shapes/svg?seed=koala&backgroundColor=ffd5dc",
	"https://api.dicebear.com/9.x/shapes/svg?seed=tiger&backgroundColor=ffdfbf",
	"https://api.dicebear.com/9.x/shapes/svg?seed=lion&backgroundColor=d1d4f9",
	"https://api.dicebear.com/9.x/shapes/svg?seed=frog&backgroundColor=c0aede",
	"https://api.dicebear.com/9.x/shapes/svg?seed=unicorn&backgroundColor=b6e3f4",
	"https://api.dicebear.com/9.x/shapes/svg?seed=dragon&backgroundColor=ffd5dc",
	"https://api.dicebear.com/9.x/shapes/svg?seed=octopus&backgroundColor=ffdfbf",
	"https://api.dicebear.com/9.x/shapes/svg?seed=butterfly&backgroundColor=d1d4f9",
	"https://api.dicebear.com/9.x/shapes/svg?seed=flower&backgroundColor=c0aede",
	"https://api.dicebear.com/9.x/shapes/svg?seed=rainbow&backgroundColor=b6e3f4",
	"https://api.dicebear.com/9.x/shapes/svg?seed=sparkle&backgroundColor=ffd5dc",
	"https://api.dicebear.com/9.x/shapes/svg?seed=fire&backgroundColor=ffdfbf",
	"https://api.dicebear.com/9.x/shapes/svg?seed=water&backgroundColor=d1d4f9",
	"https://api.dicebear.com/9.x/shapes/svg?seed=wave&backgroundColor=c0aede",
	"https://api.dicebear.com/9.x/shapes/svg?seed=pizza&backgroundColor=b6e3f4",
	"https://api.dicebear.com/9.x/shapes/svg?seed=coffee&backgroundColor=ffd5dc",
	"https://api.dicebear.com/9.x/shapes/svg?seed=game&backgroundColor=ffdfbf",
	"https://api.dicebear.com/9.x/shapes/svg?seed=music&backgroundColor=d1d4f9",
	"https://api.dicebear.com/9.x/shapes/svg?seed=book&backgroundColor=c0aede",
	"https://api.dicebear.com/9.x/shapes/svg?seed=computer&backgroundColor=b6e3f4",
	"https://api.dicebear.com/9.x/shapes/svg?seed=rocket&backgroundColor=ffd5dc",
	"https://api.dicebear.com/9.x/shapes/svg?seed=target&backgroundColor=ffdfbf",
	"https://api.dicebear.com/9.x/shapes/svg?seed=trophy&backgroundColor=d1d4f9",
	"https://api.dicebear.com/9.x/shapes/svg?seed=diamond&backgroundColor=c0aede",
];

/** Fallback avatar used for system messages and missing avatars */
export const DEFAULT_AVATAR =
	"https://api.dicebear.com/9.x/shapes/svg?seed=system&backgroundColor=94a3b8";

export const SYSTEM_AVATAR =
	"https://api.dicebear.com/9.x/shapes/svg?seed=wave&backgroundColor=64748b";

export const PUBLIC_ROOM = "public";
export const ADMIN_ROOM = "admin";
