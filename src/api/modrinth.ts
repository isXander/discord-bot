import type { ModrinthProject, ModrinthUser } from '@/api/types'

export class ModrinthApi {
	private static baseUrl = (process.env.MODRINTH_API_BASE_URL || 'https://api.modrinth.com').replace(
		/\/$/,
		'',
	)

	private static async request<T>(
		version: 'v2' | 'v3',
		endpoint: string,
		options: RequestInit = {},
	): Promise<T> {
		const res = await fetch(`${this.baseUrl}/${version}${endpoint}`, options)
		if (!res.ok) {
			const txt = await res.text()
			throw new Error(`Modrinth API ${version} ${endpoint} failed: ${res.status} ${txt}`)
		}
		return (await res.json()) as T
	}

	static async getUser(idOrUsername: string): Promise<ModrinthUser> {
		return this.request<ModrinthUser>('v3', `/user/${encodeURIComponent(idOrUsername)}`)
	}

	static async getProject(id: string): Promise<ModrinthProject> {
		return this.request<ModrinthProject>('v2', `/project/${id}`)
	}

	static async getUserProjects(idOrUsername: string): Promise<ModrinthProject[]> {
		return this.request<ModrinthProject[]>(
			'v2',
			`/user/${encodeURIComponent(idOrUsername)}/projects`,
		)
	}
}
