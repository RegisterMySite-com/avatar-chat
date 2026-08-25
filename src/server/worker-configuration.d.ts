/* Minimal Env types for Avatar Chat.
 * Run `npm run cf-typegen` after install to regenerate full Cloudflare runtime types.
 */
interface Env {
	ASSETS: Fetcher;
	Chat: DurableObjectNamespace;
	RoomRegistry: DurableObjectNamespace;
	ADMIN_SECRET?: string;
}
