import { EmbedBuilder, SlashCommandBuilder } from 'discord.js'

import type { ChatInputCommand } from '@/types/commands'
import { createVerificationState } from '@/web'

export const verifyCommand: ChatInputCommand = {
	data: new SlashCommandBuilder()
		.setName('verify')
		.setDescription('Link your external account to your Discord user')
		.addSubcommand((sub) => sub.setName('crowdin').setDescription('Link your Crowdin account'))
		.addSubcommand((sub) =>
			sub.setName('modrinth').setDescription('Link your Modrinth account'),
		) as SlashCommandBuilder,
	meta: {
		name: 'verify',
		description: 'Link your Crowdin or Modrinth account with your Discord user',
		category: 'utility',
		guildOnly: true,
	},
	execute: async (interaction) => {
		const sub = interaction.options.getSubcommand()
		if (sub === 'crowdin') {
			const base = process.env.PUBLIC_BASE_URL || 'http://localhost:3000'
			const token = await createVerificationState(interaction.user.id)
			const url = `${base}/crowdin/verify?token=${encodeURIComponent(token)}`

			const expireAt = Math.floor(Date.now() / 1000) + 15 * 60 // now + 15 minutes

			const embed = new EmbedBuilder()
				.setColor(0x1bd96a)
				.setTitle('Link your Crowdin account')
				.setDescription(
					[
						'We need to verify your Crowdin account to link it with your Discord.',
						' ',
						'To continue, please click the link down below.',
						' ',
						`**[[ Click here to continue → ]](${url})**`,
						' ',
						`-# This link will expire <t:${expireAt}:R>`,
					].join('\n'),
				)

			await interaction.reply({
				embeds: [embed],
				flags: 'Ephemeral',
			})
			return
		}
		if (sub === 'modrinth') {
			const url = process.env.MODRINTH_COMMUNITY_LINK_URL || 'https://modrinth.com/discord/link'

			const embed = new EmbedBuilder()
				.setColor(0x1bd96a)
				.setTitle('Link your Modrinth account')
				.setDescription(
					[
						'Connect Discord through Modrinth to link your account and claim eligible roles.',
						' ',
						`**[[ Click here to continue → ]](${url})**`,
					].join('\n'),
				)

			await interaction.reply({
				embeds: [embed],
				flags: 'Ephemeral',
			})
			return
		}
	},
}

export default verifyCommand
