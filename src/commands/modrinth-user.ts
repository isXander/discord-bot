import {
	ApplicationCommandType,
	ContextMenuCommandBuilder,
	SlashCommandBuilder,
	User,
} from 'discord.js'
import { eq } from 'drizzle-orm'

import { ModrinthApi } from '@/api'
import { db } from '@/db'
import { users } from '@/db/schema'
import type { ChatInputCommand, MessageContextMenuCommand } from '@/types/commands'

async function getModrinthAccountMessage(user: User) {
	const [linkedUser] = await db
		.select({ modrinthUserId: users.modrinthUserId })
		.from(users)
		.where(eq(users.id, user.id))
		.limit(1)

	if (!linkedUser?.modrinthUserId) {
		return `${user} does not have a linked Modrinth account.`
	}

	let profileUser = linkedUser.modrinthUserId
	try {
		const modrinthUser = await ModrinthApi.getUser(linkedUser.modrinthUserId)
		profileUser = modrinthUser.username
	} catch {
		// The stored ID is still useful if Modrinth's API is unavailable.
	}

	const profileUrl = `https://modrinth.com/user/${encodeURIComponent(profileUser)}`
	return `${user}'s linked Modrinth account: ${profileUrl}`
}

export const modrinthUserCommand: ChatInputCommand = {
	type: ApplicationCommandType.ChatInput,
	data: new SlashCommandBuilder()
		.setName('modrinth-user')
		.setDescription("Get a Discord user's linked Modrinth account")
		.addUserOption((option) =>
			option.setName('user').setDescription('Discord user to look up').setRequired(true),
		) as SlashCommandBuilder,
	meta: {
		name: 'modrinth-user',
		description: "Get a Discord user's linked Modrinth account",
		category: 'utility',
		guildOnly: true,
		cooldownSeconds: 3,
	},
	async execute(interaction) {
		const user = interaction.options.getUser('user', true)

		await interaction.reply({
			content: await getModrinthAccountMessage(user),
			flags: 'Ephemeral',
		})
	},
}

export const modrinthUserMessageCommand: MessageContextMenuCommand = {
	type: ApplicationCommandType.Message,
	data: new ContextMenuCommandBuilder()
		.setName('Linked Modrinth Account')
		.setType(ApplicationCommandType.Message),
	meta: {
		name: 'Linked Modrinth Account',
		description: "Get the message author's linked Modrinth account",
		category: 'utility',
		guildOnly: true,
		cooldownSeconds: 3,
	},
	async execute(interaction) {
		await interaction.reply({
			content: await getModrinthAccountMessage(interaction.targetMessage.author),
			flags: 'Ephemeral',
		})
	},
}
