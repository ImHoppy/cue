import { z } from "zod";
import {
	DEFAULT_SETTINGS,
	IDLE_SNAPSHOT,
	PROVIDERS,
	normalizeSettings,
} from "../shared/contract.js";

export { DEFAULT_SETTINGS, IDLE_SNAPSHOT, PROVIDERS, normalizeSettings };

export type Settings = Record<string, string | number | boolean>;

const seconds = z.number().finite().min(0).max(86400);

export const snapshotSchema = z.discriminatedUnion("hasTrack", [
	z.object({
		hasTrack: z.literal(false),
		playing: z.literal(false).optional(),
	}),
	z.object({
		hasTrack: z.literal(true),
		playing: z.boolean(),
		title: z.string().min(1).max(300),
		artist: z.string().max(300),
		thumbnail: z.string().max(2000),
		duration: seconds,
		currentTime: seconds,
		updatedAt: z.number().finite().optional(),
	}),
]);

export const presenceSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("NOW_PLAYING"), payload: snapshotSchema }),
	// Passed through normalizeSettings rather than validated field by field.
	z.object({ type: z.literal("SETTINGS"), payload: z.record(z.unknown()) }),
]);

export type Snapshot = z.infer<typeof snapshotSchema>;

export const providerIds = PROVIDERS.map((p: { id: string }) => p.id);
export const availableProviderIds = PROVIDERS.filter((p: { available: boolean }) => p.available).map(
	(p: { id: string }) => p.id
);
