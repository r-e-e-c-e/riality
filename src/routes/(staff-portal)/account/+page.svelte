<script lang="ts">
	import { getIdentity, getAuthPolicy } from '#lib/remotes/auth.remote.js';
	import {
		getSessions,
		beginMfa,
		confirmMfa,
		regenerateRecoveryCodes,
		disableMfa,
		changePassword,
		reauthenticate,
		revokeSession,
		exportAccount,
		updateProfile
	} from './account.remote';
	import Avatar from '#lib/components/Avatar.svelte';
	import { AVATAR_COLOR_NAMES } from '#lib/avatar.js';
	import FormFeedback from '#lib/components/FormFeedback.svelte';
	import { formatDate } from '#lib/format.js';
	const user = $derived(await getIdentity());
	const policy = $derived(await getAuthPolicy());
</script>

<svelte:head><title>Manage account</title></svelte:head>
<main class="workspace narrow">
	<div class="page-heading">
		<div>
			<h1>Manage account</h1>
			{#if user}<p class="muted">{user.email}</p>{/if}
		</div>
	</div>
	{#if user}
		<section class="panel">
			<h2>Profile</h2>
			<form {...updateProfile}>
				<label
					>Name<input
						{...updateProfile.fields.name.as('text', user.name)}
						required
						maxlength="160"
						autocomplete="name"
					/></label
				>
				<fieldset class="colour-choices">
					<legend>Avatar colour</legend>
					{#each AVATAR_COLOR_NAMES as colour (colour)}
						<label
							><input
								{...updateProfile.fields.avatarColor.as(
									'radio',
									colour,
									user.avatarColor === colour
								)}
							/><Avatar name={user.name} color={colour} size={28} /><span class="visually-hidden"
								>{colour}</span
							></label
						>
					{/each}
				</fieldset>
				<FormFeedback
					issues={updateProfile.fields.allIssues()}
					message={updateProfile.result?.message}
				/>
				<button type="submit" disabled={!!updateProfile.pending}>Save profile</button>
			</form>
		</section>
		<h2 class="section-gap">Security</h2>
	{/if}
	{#if confirmMfa.result || regenerateRecoveryCodes.result}
		<section class="panel">
			<h2>Save your recovery codes</h2>
			<p>
				Store these codes in your password manager. Previous recovery codes are invalid and all
				sessions have been signed out. Each code can be used once in place of an authenticator code.
			</p>
			<p>They will not be displayed again after you leave this page.</p>
			<ul class="recovery-codes">
				{#each (regenerateRecoveryCodes.result ?? confirmMfa.result)?.codes ?? [] as code (code)}<li
					>
						<code>{code}</code>
					</li>{/each}
			</ul>
			<p><a class="button" href="/login">Sign in with your authenticator</a></p>
		</section>
	{:else if user}
		<section class="panel">
			<div class="section-heading">
				<h2>Authenticator</h2>
				<span class="badge">{user.mfaEnabled ? 'Enabled' : 'Not set up'}</span>
			</div>
			{#if user.mfaEnabled}
				<p>Your account is protected with an authenticator and one-use recovery codes.</p>
				<details class="disclosure" open={!!regenerateRecoveryCodes.fields.allIssues()?.length}>
					<summary>Replace recovery codes</summary>
					<p>
						This replaces every old code and signs out all sessions. Save the new codes before
						leaving.
					</p>
					<form {...regenerateRecoveryCodes}>
						<label
							>Password<input
								{...regenerateRecoveryCodes.fields._password.as('password')}
								autocomplete="current-password"
								required
								maxlength="128"
							/></label
						>
						<label
							>Authenticator or unused recovery code<input
								{...regenerateRecoveryCodes.fields._code.as('text')}
								autocomplete="one-time-code"
								required
								maxlength="64"
							/></label
						>
						<FormFeedback issues={regenerateRecoveryCodes.fields.allIssues()} />
						<button class="secondary" type="submit" disabled={!!regenerateRecoveryCodes.pending}
							>Generate new recovery codes and sign out</button
						>
					</form>
				</details>
				{#if !policy.requireMfa}
					<details class="disclosure" open={!!disableMfa.fields.allIssues()?.length}>
						<summary>Remove authenticator protection</summary>
						<form {...disableMfa}>
							<label
								>Password<input
									{...disableMfa.fields._password.as('password')}
									autocomplete="current-password"
									required
									maxlength="128"
								/></label
							>
							<label
								>Security code<input
									{...disableMfa.fields._code.as('text')}
									autocomplete="one-time-code"
									required
									maxlength="64"
								/></label
							>
							<FormFeedback issues={disableMfa.fields.allIssues()} />
							<button class="secondary" type="submit" disabled={!!disableMfa.pending}
								>Disable MFA and sign out</button
							>
						</form>
					</details>
				{/if}
			{:else}
				<p>
					{policy.requireMfa
						? 'Set up an authenticator to access your firm and engagements.'
						: 'Add an authenticator for another layer of account protection.'}
				</p>
				<form {...beginMfa}>
					<FormFeedback issues={beginMfa.fields.allIssues()} /><button
						type="submit"
						disabled={!!beginMfa.pending}>Start MFA setup</button
					>
				</form>
				{#if beginMfa.result}
					<p>Enter this setup key into your authenticator:</p>
					<p class="secret"><code>{beginMfa.result.secret}</code></p>
					<p class="muted">Account: {user.email}. Time based, six digits, 30 seconds.</p>
					<form {...confirmMfa}>
						<label
							>Authenticator code<input
								{...confirmMfa.fields._code.as('text')}
								autocomplete="one-time-code"
								inputmode="numeric"
								pattern={'[0-9]{6}'}
								required
							/></label
						>
						<FormFeedback issues={confirmMfa.fields.allIssues()} />
						<button type="submit" disabled={!!confirmMfa.pending}
							>Enable MFA and show recovery codes</button
						>
					</form>
				{/if}
			{/if}
		</section>
		<details class="panel disclosure" open={!!changePassword.fields.allIssues()?.length}>
			<summary>Change password</summary>
			<form {...changePassword}>
				<label
					>Current password<input
						{...changePassword.fields._currentPassword.as('password')}
						autocomplete="current-password"
						required
						maxlength="128"
					/></label
				>
				<label
					>New password<input
						{...changePassword.fields._password.as('password')}
						autocomplete="new-password"
						required
						minlength="15"
						maxlength="128"
					/></label
				>
				<FormFeedback issues={changePassword.fields.allIssues()} />
				<button type="submit" disabled={!!changePassword.pending}
					>Update password and sign out</button
				>
			</form>
		</details>
		<details
			class="panel disclosure"
			open={!!reauthenticate.fields.allIssues()?.length || !!reauthenticate.result}
		>
			<summary>Confirm your identity</summary>
			<p>Confirm again after ten minutes before changing access or security settings.</p>
			<form {...reauthenticate}>
				<label
					>Password<input
						{...reauthenticate.fields._password.as('password')}
						autocomplete="current-password"
						required
						maxlength="128"
					/></label
				>
				<label
					>Security code (if MFA is enabled)<input
						{...reauthenticate.fields._code.as('text')}
						autocomplete="one-time-code"
						maxlength="64"
					/></label
				>
				<FormFeedback
					issues={reauthenticate.fields.allIssues()}
					message={reauthenticate.result?.message}
				/>
				<button type="submit" disabled={!!reauthenticate.pending}>Confirm identity</button>
			</form>
		</details>
		<section class="panel">
			<h2>Active sessions</h2>
			{#each await getSessions() as session (session.id)}
				{@const revoke = revokeSession.for(session.id)}
				<div class="roster-row">
					<div>
						<p>Signed in {formatDate(session.createdAt)}</p>
						<p class="muted">
							Last active {new Date(session.lastSeenAt).toLocaleString('en-GB', {
								timeZone: 'UTC'
							})} UTC
						</p>
					</div>
					<details open={!!revoke.fields.allIssues()?.length}>
						<summary>Manage session</summary>
						<form {...revoke}>
							<input {...revoke.fields.sessionId.as('hidden', session.id)} /><FormFeedback
								issues={revoke.fields.allIssues()}
							/><button class="secondary" type="submit" disabled={!!revoke.pending}
								>Revoke session</button
							>
						</form>
					</details>
				</div>
			{:else}<p class="muted">No active sessions.</p>{/each}
		</section>
		<details
			class="panel disclosure"
			open={!!exportAccount.fields.allIssues()?.length || !!exportAccount.result}
		>
			<summary>Your account information</summary>
			<p>View your profile, memberships and account activity.</p>
			<form {...exportAccount}>
				<FormFeedback issues={exportAccount.fields.allIssues()} /><button
					class="secondary"
					type="submit"
					disabled={!!exportAccount.pending}>View account information</button
				>
			</form>
			{#if exportAccount.result}
				<dl class="facts">
					<div>
						<dt>Name</dt>
						<dd>{exportAccount.result.profile.name}</dd>
					</div>
					<div>
						<dt>Email</dt>
						<dd>{exportAccount.result.profile.email}</dd>
					</div>
					<div>
						<dt>Account created</dt>
						<dd>{formatDate(exportAccount.result.profile.createdAt)}</dd>
					</div>
				</dl>
				<h2>Memberships</h2>
				<ul class="team-list">
					{#each exportAccount.result.memberships as membership (membership.tenantId)}<li>
							<span>{membership.tenantName}</span><span class="muted">{membership.role}</span>
						</li>{/each}
				</ul>
				<details class="disclosure">
					<summary>Account activity</summary>
					<p class="muted">Up to {exportAccount.result.eventsLimitedTo} recorded account events.</p>
					<div class="table-scroll">
						<table>
							<thead><tr><th>Date</th><th>Activity</th></tr></thead><tbody
								>{#each exportAccount.result.events as event (event)}<tr
										><td class="nowrap">{formatDate(event.createdAt)}</td><td
											>{event.action.replace(/[._]/g, ' ')}</td
										></tr
									>{/each}</tbody
							>
						</table>
					</div>
				</details>
			{/if}
		</details>
	{:else}<p><a href="/login">Sign in to manage your security settings</a></p>{/if}
</main>
