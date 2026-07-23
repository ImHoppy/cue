import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { cookieSecret } from "./config.js";

const key = createHash("sha256").update(`cue:token:${cookieSecret}`).digest();

export function seal(plain: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
	return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

export function unseal(sealed: string): string | null {
	try {
		const parts = sealed.split(".").map((s) => Buffer.from(s, "base64url"));
		if (parts.length !== 3) return null;
		const [iv, tag, body] = parts as [Buffer, Buffer, Buffer];
		const decipher = createDecipheriv("aes-256-gcm", key, iv);
		decipher.setAuthTag(tag);
		return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
	} catch {
		return null;
	}
}
