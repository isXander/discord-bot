import type { GuildMember } from 'discord.js'

import { ModrinthApi } from '@/api'
import { createDefaultEmbed } from '@/utils/embeds'

const roleChecks = [
	['Pride', 'PRIDE_ROLE_ID'],
	['Creator', 'CREATOR_ROLE_ID'],
	['1M+ downloads', 'BIG_CREATOR_ROLE_ID'],
] as const

export async function syncModrinthRoles(member: GuildMember, modrinthUserId: string) {
	const [user, projects] = await Promise.all([
		ModrinthApi.getUser(modrinthUserId),
		ModrinthApi.getUserAllProjects(modrinthUserId),
	])

	const totalDownloads = projects.reduce((acc, project) => acc + (project.downloads ?? 0), 0)
	const eligibleRoles = [
		['Pride', process.env.PRIDE_ROLE_ID, user.campaigns?.pride_26?.has_badge === true],
		['Creator', process.env.CREATOR_ROLE_ID, totalDownloads >= 20_000],
		['1M+ downloads', process.env.BIG_CREATOR_ROLE_ID, totalDownloads >= 1_000_000],
	] as const
	const grantedRoles: string[] = []

	console.debug('[Modrinth][Roles]', {
		userId: modrinthUserId,
		discordUserId: member.id,
		hasPrideBadge: user.campaigns?.pride_26?.has_badge === true,
		projectCount: projects.length,
		totalDownloads,
		configuredRoles: Object.fromEntries(
			roleChecks.map(([name, envName]) => [name, Boolean(process.env[envName])]),
		),
	})

	for (const [name, roleId, eligible] of eligibleRoles) {
		if (!eligible) continue

		if (!roleId) {
			console.warn(`[Discord] ${name} role is not configured; cannot grant role`)
			continue
		}

		if (member.roles.cache.has(roleId)) continue

		try {
			await member.roles.add(roleId)
			grantedRoles.push(name)
		} catch (err) {
			console.error(`[Discord][ERROR] Failed to grant ${name} role`, err)
		}
	}

	const description =
		grantedRoles.length > 0
			? `You have been granted the following roles:\n${grantedRoles.map((role) => `- ${role}`).join('\n')}`
			: 'Your Modrinth account has been linked.'

	await member
		.send({
			embeds: [createDefaultEmbed().setTitle('Modrinth account linked').setDescription(description)],
		})
		.catch(() => {})

	return { grantedRoles, totalDownloads }
}
