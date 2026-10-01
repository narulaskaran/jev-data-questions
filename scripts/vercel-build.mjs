#!/usr/bin/env node
/**
 * Vercel production build: push Convex functions, then the Vite app.
 *
 * Prod BYOD (`datasets.put`) 500s with Convex HTTP `[Request ID] Server Error`
 * when Vercel only runs `npm run build`. Convex is a separate backend.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultIo = {
  spawnSync,
  log: (...args) => console.log(...args),
  error: (...args) => console.error(...args),
  warn: (...args) => console.warn(...args),
}

export const shouldDeployConvex = (env = process.env) => env.VERCEL_ENV === 'production' && env.DEMO_ONLY !== '1'

export const shouldSkipConvexEnvSync = (env = process.env) => {
  const flag = env.SKIP_CONVEX_ENV_SYNC?.trim().toLowerCase()
  return flag === '1' || flag === 'true' || flag === 'yes'
}

export const isConvexEnvWritePermissionFailure = (output) => {
  const text = String(output ?? '')
  return /deployment:env:write/i.test(text) || /do not have permission to perform this operation/i.test(text)
}

const spawnOutput = (result) => {
  const stdout = result?.stdout == null ? '' : String(result.stdout)
  const stderr = result?.stderr == null ? '' : String(result.stderr)
  const error = result?.error?.message ? String(result.error.message) : ''
  return `${stdout}\n${stderr}\n${error}`
}

const replaySpawnOutput = (result, io) => {
  const stdout = result?.stdout == null ? '' : String(result.stdout).trimEnd()
  const stderr = result?.stderr == null ? '' : String(result.stderr).trimEnd()
  if (stdout) io.log(stdout)
  if (stderr) io.error(stderr)
}

const run = (command, args, env, io) => {
  const result = io.spawnSync(command, args, { stdio: 'inherit', env })
  if (result.status !== 0) return result.status ?? 1
  return 0
}

const setConvexWriteSecret = (writeSecret, env, io) => {
  if (shouldSkipConvexEnvSync(env)) {
    io.warn('Skipping Convex CONVEX_WRITE_SECRET sync (SKIP_CONVEX_ENV_SYNC is set).')
    return 0
  }

  const result = io.spawnSync('npx', ['convex', 'env', 'set', 'CONVEX_WRITE_SECRET'], {
    env,
    input: writeSecret,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  replaySpawnOutput(result, io)

  if (result.status === 0) {
    io.log('Set CONVEX_WRITE_SECRET on the Convex deployment.')
    return 0
  }

  const output = spawnOutput(result)
  if (isConvexEnvWritePermissionFailure(output)) {
    io.warn('Could not set CONVEX_WRITE_SECRET on Convex: deploy key lacks deployment:env:write.')
    io.warn('Convex functions were deployed. The Vercel build will continue.')
    io.warn('Set CONVEX_WRITE_SECRET in the Convex dashboard if authorizeWrite rejects writes.')
    return 0
  }

  io.error('Failed to set CONVEX_WRITE_SECRET on the Convex deployment.')
  return result.status ?? 1
}

export const runVercelBuild = (env = process.env, io = {}) => {
  const resolved = { ...defaultIo, ...io }
  const deployKey = env.CONVEX_DEPLOY_KEY?.trim()
  const writeSecret = env.CONVEX_WRITE_SECRET?.trim()

  if (shouldDeployConvex(env)) {
    if (!deployKey) {
      resolved.error('CONVEX_DEPLOY_KEY is not set on this Vercel Production environment.')
      resolved.error('Convex dashboard → this production deployment → Settings → Generate Production Deploy Key.')
      resolved.error('Add it as Vercel env CONVEX_DEPLOY_KEY (Production only). Then redeploy.')
      return 1
    }
    if (!writeSecret) {
      resolved.error('CONVEX_WRITE_SECRET is not set on Vercel. Convex authorizeWrite will reject datasets.put.')
      return 1
    }
    resolved.log('Deploying Convex functions with npx convex deploy (CONVEX_DEPLOY_KEY present).')
    const deployStatus = run('npx', ['convex', 'deploy', '--cmd', 'npm run build'], env, resolved)
    if (deployStatus !== 0) return deployStatus
    return setConvexWriteSecret(writeSecret, env, resolved)
  }

  if (env.VERCEL) {
    resolved.log(env.DEMO_ONLY === '1' ? 'Building the standalone demo. Live intake and analysis are disabled.' : `Skipping Convex deploy (VERCEL_ENV=${env.VERCEL_ENV ?? 'unset'}). Production builds require CONVEX_DEPLOY_KEY.`)
  }
  return run('npm', ['run', 'build'], env, resolved)
}

const isMain = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isMain) process.exit(runVercelBuild() ?? 0)
