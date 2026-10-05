import { defineParams } from '@sveltejs/kit/params';
import { looksLikeHandle } from '#lib/handles.js';

// Route parameter matchers. [handle=handle] only matches strings shaped like a firm
// handle, so other top-level paths (and files like /favicon.ico) never reach it.
export const params = defineParams({
	handle: (value) => (looksLikeHandle(value) ? value : undefined)
});
