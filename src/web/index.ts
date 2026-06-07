import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

import type { Client } from 'discord.js'
import { and, eq, gt, sql } from 'drizzle-orm'
import express, { NextFunction, Request, Response } from 'express'

import { CrowdinOauthHelper } from '@/api/'
import { db } from '@/db'
import { crowdinAccounts, oauthVerifications, users } from '@/db/schema'
import { createDefaultEmbed } from '@/utils/embeds'
import { syncModrinthRoles } from '@/utils/modrinth-roles'

import htmlClosePage from './close.html?raw'

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000
const BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:3000'
const GUILD_ID = process.env.GUILD_ID!
const TRANSLATOR_ROLE_ID = process.env.TRANSLATOR_ROLE_ID || process.env.ACTIVE_ROLE_ID!
const CROWDIN_SCOPES = 'project'
const PROOFREADER_ROLE_ID = process.env.PROOFREADER_ROLE_ID || ''

const inflightStates = new Map<string, number>()

type ModrinthHandoffPayload = {
  v: 1
  modrinth_user_id: string
  discord_user_id: string
  iat: number
  exp: number
  nonce: string
}

export function verifyHandoff(payload: string, sig: string): ModrinthHandoffPayload | null {
  const secret = process.env.MODRINTH_HANDOFF_SECRET
  if (!secret || !payload || !sig) return null

  try {
    const expected = createHmac('sha256', secret).update(payload).digest('base64url')
    const sigBuffer = Buffer.from(sig)
    const expectedBuffer = Buffer.from(expected)

    if (sigBuffer.length !== expectedBuffer.length) return null
    if (!timingSafeEqual(sigBuffer, expectedBuffer)) return null

    const parsed = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as ModrinthHandoffPayload
    if (parsed.v !== 1) return null
    if (!parsed.modrinth_user_id || !parsed.discord_user_id) return null
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null

    return parsed
  } catch {
    return null
  }
}

export function startWebServer(client: Client) {
  const app = express()
  app.use(express.json())

  const crowdin = new CrowdinOauthHelper({
    baseUrl: BASE_URL,
    clientId: process.env.CROWDIN_CLIENT_ID!,
    clientSecret: process.env.CROWDIN_CLIENT_SECRET!,
    scopes: CROWDIN_SCOPES,
  })

  app.get(
    '/healthz',
    (req: Request, res: Response, next: NextFunction) => {
      let ip = req.ip || ''
      if (ip.startsWith('::ffff:')) ip = ip.slice(7)
      if (ip === '::1' || ip.startsWith('172.16')) return next()
      return res.status(403).send()
    },
    async (_req: Request, res: Response) => {
      try {
        await db.execute(sql`select 1`)
        res.status(200).send()
      } catch (err) {
        console.error('[Healthz][DB][ERROR]', err)
        res.status(503).send()
      }
    },
  )

  app.get('/modrinth/handoff', async (req: Request, res: Response) => {
    const payload = String(req.query.payload ?? '')
    const sig = String(req.query.sig ?? '')
    const verified = verifyHandoff(payload, sig)

    if (!verified) return res.status(400).send('Invalid or expired link')

    await db
      .insert(users)
      .values({
        id: verified.discord_user_id,
        modrinthUserId: verified.modrinth_user_id,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: { modrinthUserId: verified.modrinth_user_id },
      })

    if (!client.isReady()) {
      await new Promise<void>((resolve) => client.once('ready', () => resolve()))
    }

    const guild = await client.guilds.fetch(GUILD_ID)
    const member = await guild.members.fetch(verified.discord_user_id).catch(() => null)

    if (!member) {
      return res.redirect(process.env.DISCORD_INVITE_URL || 'https://discord.gg/modrinth')
    }

    await syncModrinthRoles(member, verified.modrinth_user_id)
    res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(htmlClosePage)
  })

  app.get('/crowdin/verify', async (req: Request, res: Response) => {
    const token = (req.query.token as string) || ''
    if (!token) return res.status(400).send('Missing token')

    const records = await db
      .select()
      .from(oauthVerifications)
      .where(and(eq(oauthVerifications.token, token), gt(oauthVerifications.expiresAt, new Date())))

    if (records.length === 0) return res.status(400).send('Invalid or expired token')

    const authUrl = crowdin.buildAuthorizeUrl(token)
    res.redirect(authUrl)
  })

  app.get('/callback/crowdin', async (req: Request, res: Response) => {
    const code = req.query.code as string
    const state = req.query.state as string
    if (!code || !state) return res.status(400).send('Missing code/state')

    if (!inflightStates.has(state)) inflightStates.set(state, 0)
    const now = Date.now()
    const last = inflightStates.get(state) ?? 0
    if (last !== 0 && now - last < 60_000)
      return res.status(429).send('Request already in progress')
    inflightStates.set(state, now)

    const [stateRow] = await db
      .select()
      .from(oauthVerifications)
      .where(and(eq(oauthVerifications.token, state), gt(oauthVerifications.expiresAt, new Date())))

    if (!stateRow) return res.status(400).send('Invalid or expired state')

    try {
      const token = await crowdin.exchangeCodeForToken(code)

      const authUser = await crowdin.getCurrentUser(token.access_token)

      const expiresAt = new Date(Date.now() + (token.expires_in ?? 0) * 1000)
      await db
        .insert(crowdinAccounts)
        .values({
          discordUserId: stateRow.discordUserId,
          crowdinUserId: String(authUser.id),
          accessToken: token.access_token,
          refreshToken: token.refresh_token,
          expiresAt,
          organizationDomain: undefined,
        })
        .onConflictDoUpdate({
          target: crowdinAccounts.discordUserId,
          set: {
            crowdinUserId: String(authUser.id),
            accessToken: token.access_token,
            refreshToken: token.refresh_token,
            expiresAt,
          },
        })

      await db
        .insert(users)
        .values({ id: stateRow.discordUserId, crowdinUserId: String(authUser.id) })
        .onConflictDoUpdate({ target: users.id, set: { crowdinUserId: String(authUser.id) } })

      const projectId = process.env.CROWDIN_PROJECT_ID
      let hasContribution = false
      let isProofreader = false
      let translated = 0
      let approved = 0
      if (projectId) {
        const serviceToken = process.env.CROWDIN_TOKEN!
        if (!serviceToken) {
          console.error('[Crowdin][Verify][ERROR] CROWDIN_TOKEN is not set')
        } else {
          try {
            const activity = await crowdin.getMemberActivity(projectId, authUser.id, serviceToken)
            translated = activity.translated
            approved = activity.approved
            hasContribution = translated > 0 || approved > 0

            // Check proofreader role separately
            try {
              isProofreader = await crowdin.hasProofreaderRole(projectId, authUser.id, serviceToken)
            } catch (err) {
              console.error('[Crowdin][Verify][ERROR] hasProofreaderRole failed', err)
              // Fallback: if they have approved translations, they're likely a proofreader
              isProofreader = approved > 0
            }
          } catch (e) {
            console.error('[Crowdin][Verify][ERROR] getMemberActivity failed', e)
            // Keep defaults: translated = 0, approved = 0, hasContribution = false
          }
        }
      }
      console.debug('[Crowdin][Verify]', {
        userId: String(authUser.id),
        translated,
        approved,
        hasContribution,
        isProofreader,
      })

      if (!client.isReady()) {
        await new Promise<void>((resolve) => client.once('ready', () => resolve()))
      }
      const guild = await client.guilds.fetch(GUILD_ID)
      const member = await guild.members.fetch(stateRow.discordUserId).catch(() => null)
      if (!member) {
        console.warn(
          `[Discord] Member ${stateRow.discordUserId} not found in guild ${GUILD_ID}; cannot grant roles`,
        )
      }
      if (member) {
        const hasTranslatorRole = member.roles.cache.has(TRANSLATOR_ROLE_ID)
        const hasProofreaderRole = PROOFREADER_ROLE_ID
          ? member.roles.cache.has(PROOFREADER_ROLE_ID)
          : false

        const newlyGranted: string[] = []
        const alreadyHad: string[] = []

        // Ensure translator role if the user has contributions
        if (hasContribution) {
          if (!hasTranslatorRole) {
            try {
              await member.roles.add(TRANSLATOR_ROLE_ID)
              newlyGranted.push('Translator')
            } catch (err) {
              console.error('[Discord][ERROR] Failed to grant translator role', err)
            }
          } else {
            alreadyHad.push('Translator')
          }
        } else if (hasTranslatorRole) {
          // User already has Translator from before
          alreadyHad.push('Translator')
        }

        // Ensure proofreader role if detected on Crowdin
        if (isProofreader) {
          if (PROOFREADER_ROLE_ID) {
            if (!hasProofreaderRole) {
              try {
                await member.roles.add(PROOFREADER_ROLE_ID)
                newlyGranted.push('Proofreader')
              } catch (err) {
                console.error('[Discord][ERROR] Failed to grant proofreader role', err)
              }
            } else {
              alreadyHad.push('Proofreader')
            }
          } else {
            // Detected proofreader, but role id is not configured
            if (!PROOFREADER_ROLE_ID) {
              console.warn(
                '[Discord] PROOFREADER_ROLE_ID is not configured; cannot grant proofreader role',
              )
            }
          }
        }

        try {
          const base = createDefaultEmbed().setTitle('Crowdin account linked')
          const activityField = {
            name: 'Your activity',
            value: `Translated: ${translated}\nApproved: ${approved}`,
            inline: false,
          }
          if (newlyGranted.length > 0) {
            const embed = base
              .setDescription('Thanks for contributing! We granted you new role(s).')
              .addFields(
                { name: 'Granted roles', value: newlyGranted.join(', '), inline: true },
                ...(alreadyHad.length > 0
                  ? [{ name: 'Already had', value: alreadyHad.join(', '), inline: true }]
                  : []),
                activityField,
              )
            await member.send({ embeds: [embed] })
          } else if (alreadyHad.length > 0) {
            const embed = base
              .setDescription(
                'Your Crowdin account is linked. You already have the following role(s).',
              )
              .addFields(
                { name: 'Roles', value: alreadyHad.join(', '), inline: true },
                activityField,
              )
            await member.send({ embeds: [embed] })
          } else if (isProofreader && !PROOFREADER_ROLE_ID) {
            const embed = base
              .setDescription(
                "We detected you're a proofreader, but the server hasn't configured the Proofreader role yet. Please contact the staff.",
              )
              .addFields(activityField)
            await member.send({ embeds: [embed] })
          } else {
            const embed = base
              .setDescription(
                'We did not detect contributions yet. Try contributing (translating or approving) and then run /verify crowdin again.',
              )
              .addFields(activityField)
            await member.send({ embeds: [embed] })
          }
        } catch {
          // ignore
        }
      }

      await db.delete(oauthVerifications).where(eq(oauthVerifications.token, state))

      res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(htmlClosePage)
    } catch (e: any) {
      console.error('[OAuth][ERROR]', e)
      res.status(500).send(`OAuth failed: ${e?.message ?? 'unknown error'}`)
    } finally {
      setTimeout(() => inflightStates.delete(state), 5_000)
    }
  })

  const server = app.listen(PORT, () => { })

  return server
}

export async function createVerificationState(discordUserId: string) {
  const token = randomBytes(20).toString('hex')
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000)
  await db.insert(oauthVerifications).values({
    token,
    provider: 'crowdin',
    discordUserId,
    expiresAt,
  })
  console.debug('[Verify] Created verification state', {
    discordUserId,
    tokenPreview: token.slice(0, 8),
    expiresAt,
  })
  return token
}
