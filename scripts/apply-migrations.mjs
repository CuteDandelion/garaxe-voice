import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const tsxCli = fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url))
const migrationRunner = fileURLToPath(new URL('../server/migrate.ts', import.meta.url))
const result = spawnSync(process.execPath, [tsxCli, migrationRunner], { env: process.env, stdio: 'inherit' })

if (result.error) throw result.error
process.exit(result.status ?? 1)
