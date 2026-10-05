// Avatars show the person's initials on a colour they choose. The palette is fixed
// so every colour has enough contrast with white text.

export const AVATAR_COLORS = {
	teal: '#1f6f5c',
	blue: '#2457a6',
	indigo: '#4b45a8',
	purple: '#7a3f98',
	pink: '#a8336b',
	red: '#b03a2e',
	orange: '#a5520f',
	brown: '#7a5634',
	slate: '#47555e'
} as const;

export type AvatarColor = keyof typeof AVATAR_COLORS;
export const AVATAR_COLOR_NAMES = Object.keys(AVATAR_COLORS) as [AvatarColor, ...AvatarColor[]];

/** Up to two initials: "Priya Shah" → "PS", "Morgan" → "M". */
export function initials(name: string) {
	const words = name.trim().split(/\s+/).filter(Boolean);
	const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words;
	return letters.map((word) => Array.from(word)[0]?.toUpperCase() ?? '').join('');
}
