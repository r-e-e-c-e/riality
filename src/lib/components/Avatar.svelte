<script lang="ts">
	import { AVATAR_COLORS, initials, type AvatarColor } from '#lib/avatar.js';

	// Initials on the person's chosen colour. Image avatars come later.
	let {
		name,
		color = 'teal',
		size = 32
	}: { name: string; color?: AvatarColor; size?: number } = $props();
</script>

<span
	class="avatar"
	aria-hidden="true"
	style:background={AVATAR_COLORS[color] ?? AVATAR_COLORS.teal}
	style:width="{size}px"
	style:height="{size}px"
	style:font-size="{Math.round(size * 0.4)}px">{initials(name)}</span
>
