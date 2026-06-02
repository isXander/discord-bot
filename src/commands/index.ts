import { applyCommand } from '@/commands/apply'
import { approveCommand } from '@/commands/approve'
import { assignCommand } from '@/commands/assign'
import { memberCommand } from '@/commands/member'
import { pmCommand } from '@/commands/pm'
import { projectCommand } from '@/commands/project'
import { rejectCommand } from '@/commands/reject'
import { reportCommand } from '@/commands/report'
import { resetCommand } from '@/commands/reset'
import type { AnyCommand } from '@/types/commands'

import { docsCommand } from './docs'
import { githubCommand } from './github'
import { pingCommand } from './ping'
import { solvedCommand } from './solved'
import { verifyCommand } from './verify'
import { watchlistCommand } from './watchlist'

export const commands: AnyCommand[] = [
	docsCommand,
	githubCommand,
	pingCommand,
	solvedCommand,
	verifyCommand,
	resetCommand,
	projectCommand,
	pmCommand,
	memberCommand,
	// reportCommand,
	applyCommand,
	assignCommand,
	approveCommand,
	rejectCommand,
	watchlistCommand,
]

export default commands
