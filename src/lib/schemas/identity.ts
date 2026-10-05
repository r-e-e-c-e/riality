import { z } from 'zod';
import { AVATAR_COLOR_NAMES } from '../avatar';

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
export const nameSchema = z.string().trim().min(1).max(160);
export const passwordSchema = z.string().min(15, 'Use at least 15 characters').max(128);
export const tokenSchema = z
	.string()
	.regex(/^[A-Za-z0-9_-]{43}$/, 'Enter the code from your email');
export const otpSchema = z.string().regex(/^\d{6}$/, 'Enter a six-digit authenticator code');
export const loginSchema = z.object({
	email: emailSchema,
	_password: z.string().min(1).max(128),
	_code: z.string().max(64).optional().default(''),
	/** Where to go after signing in (a path on this site). */
	next: z.string().max(2000).optional().default('')
});
export const signupSchema = z.object({ name: nameSchema, email: emailSchema });
export const activateSchema = z.object({ _token: tokenSchema, _password: passwordSchema });
export const emailRequestSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = activateSchema;
export const changePasswordSchema = z.object({
	_currentPassword: z.string().min(1).max(128),
	_password: passwordSchema
});
export const mfaConfirmSchema = z.object({ _code: otpSchema });
export const reauthenticateSchema = z.object({
	_password: z.string().min(1).max(128),
	_code: z.string().max(64).optional().default('')
});
export const profileSchema = z.object({
	name: nameSchema,
	avatarColor: z.enum(AVATAR_COLOR_NAMES)
});
