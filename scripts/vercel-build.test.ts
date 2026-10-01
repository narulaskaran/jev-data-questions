import { describe, expect, it, vi } from 'vitest'
import {
  isConvexEnvWritePermissionFailure,
  runVercelBuild,
  shouldDeployConvex,
  shouldSkipConvexEnvSync,
} from './vercel-build.mjs'

const prodEnv = {
  VERCEL_ENV: 'production',
  CONVEX_DEPLOY_KEY: 'prod-deploy-key',
  CONVEX_WRITE_SECRET: 'write-secret',
}

const permissionStderr = 'You do not have permission to perform this operation (deployment:env:write)\n'

const captureIo = (spawnSync) => {
  const logs: string[] = []
  const errors: string[] = []
  const warnings: string[] = []
  return {
    spawnSync,
    log: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
    error: (...args: unknown[]) => errors.push(args.map(String).join(' ')),
    warn: (...args: unknown[]) => warnings.push(args.map(String).join(' ')),
    logs,
    errors,
    warnings,
  }
}

const spawnByArgs = (replies: Record<string, unknown>) => {
  const spawnSync = vi.fn((command: string, args: string[] = []) => {
    const key = args.includes('deploy') ? 'deploy' : args.includes('env') ? 'env' : `${command} ${args.join(' ')}`
    const reply = replies[key] ?? replies.default ?? { status: 0 }
    return reply
  })
  return spawnSync
}

describe('Vercel Convex deploy gate', () => {
  it('deploys Convex functions only on Vercel production builds', () => {
    expect(shouldDeployConvex({ VERCEL_ENV: 'production' })).toBe(true)
    expect(shouldDeployConvex({ VERCEL_ENV: 'preview' })).toBe(false)
    expect(shouldDeployConvex({ VERCEL_ENV: 'development' })).toBe(false)
    expect(shouldDeployConvex({})).toBe(false)
  })

  it('skips Convex env sync when SKIP_CONVEX_ENV_SYNC is set', () => {
    expect(shouldSkipConvexEnvSync({ SKIP_CONVEX_ENV_SYNC: '1' })).toBe(true)
    expect(shouldSkipConvexEnvSync({ SKIP_CONVEX_ENV_SYNC: 'true' })).toBe(true)
    expect(shouldSkipConvexEnvSync({ SKIP_CONVEX_ENV_SYNC: 'YES' })).toBe(true)
    expect(shouldSkipConvexEnvSync({ SKIP_CONVEX_ENV_SYNC: '0' })).toBe(false)
    expect(shouldSkipConvexEnvSync({})).toBe(false)
  })
})

describe('Convex env:write permission detection', () => {
  it('matches Convex deploy-key env:write denials', () => {
    expect(isConvexEnvWritePermissionFailure(permissionStderr)).toBe(true)
    expect(isConvexEnvWritePermissionFailure('Error: deployment:env:write is not allowed')).toBe(true)
    expect(isConvexEnvWritePermissionFailure('You do not have permission to perform this operation')).toBe(true)
  })

  it('does not treat unrelated Convex failures as permission denials', () => {
    expect(isConvexEnvWritePermissionFailure('')).toBe(false)
    expect(isConvexEnvWritePermissionFailure('Network error while contacting Convex')).toBe(false)
    expect(isConvexEnvWritePermissionFailure('Failed to set environment variable')).toBe(false)
  })
})

describe('runVercelBuild', () => {
  it('builds a production demo without deploying or provisioning live services', () => {
    const spawnSync = vi.fn(() => ({ status: 0 }))
    const io = captureIo(spawnSync)
    expect(runVercelBuild({ VERCEL: '1', VERCEL_ENV: 'production', DEMO_ONLY: '1' }, io)).toBe(0)
    expect(spawnSync).toHaveBeenCalledTimes(1)
    expect(spawnSync.mock.calls[0].slice(0, 2)).toEqual(['npm', ['run', 'build']])
    expect(shouldDeployConvex({ VERCEL_ENV: 'production', DEMO_ONLY: '1' })).toBe(false)
  })
  it('fails closed on production without CONVEX_DEPLOY_KEY or CONVEX_WRITE_SECRET', () => {
    const missingKey = captureIo(vi.fn())
    expect(runVercelBuild({ VERCEL_ENV: 'production', CONVEX_WRITE_SECRET: 'write-secret' }, missingKey)).toBe(1)
    expect(missingKey.spawnSync).not.toHaveBeenCalled()
    expect(missingKey.errors.join('\n')).toContain('CONVEX_DEPLOY_KEY')

    const missingSecret = captureIo(vi.fn())
    expect(runVercelBuild({ VERCEL_ENV: 'production', CONVEX_DEPLOY_KEY: 'prod-deploy-key' }, missingSecret)).toBe(1)
    expect(missingSecret.spawnSync).not.toHaveBeenCalled()
    expect(missingSecret.errors.join('\n')).toContain('CONVEX_WRITE_SECRET')
  })

  it('runs convex deploy then env set on production', () => {
    const spawnSync = spawnByArgs({
      deploy: { status: 0 },
      env: { status: 0, stdout: 'Set CONVEX_WRITE_SECRET\n', stderr: '' },
    })
    const io = captureIo(spawnSync)

    expect(runVercelBuild(prodEnv, io)).toBe(0)
    expect(spawnSync).toHaveBeenCalledTimes(2)
    expect(spawnSync.mock.calls[0][1]).toEqual(['convex', 'deploy', '--cmd', 'npm run build'])
    expect(spawnSync.mock.calls[1][1]).toEqual(['convex', 'env', 'set', 'CONVEX_WRITE_SECRET'])
    expect(spawnSync.mock.calls[1][2]).toMatchObject({ input: 'write-secret' })
  })

  it('fails the Vercel build when convex deploy fails', () => {
    const spawnSync = spawnByArgs({
      deploy: { status: 2, stderr: 'convex deploy failed' },
      env: { status: 0 },
    })
    const io = captureIo(spawnSync)

    expect(runVercelBuild(prodEnv, io)).toBe(2)
    expect(spawnSync).toHaveBeenCalledTimes(1)
    expect(spawnSync.mock.calls[0][1]).toEqual(['convex', 'deploy', '--cmd', 'npm run build'])
  })

  it('warns and succeeds when env set is denied as deployment:env:write', () => {
    const spawnSync = spawnByArgs({
      deploy: { status: 0 },
      env: { status: 1, stdout: '', stderr: permissionStderr },
    })
    const io = captureIo(spawnSync)

    expect(runVercelBuild(prodEnv, io)).toBe(0)
    expect(spawnSync).toHaveBeenCalledTimes(2)
    expect(io.warnings.join('\n')).toContain('deployment:env:write')
    expect(io.warnings.join('\n')).toContain('Vercel build will continue')
    expect(io.warnings.join('\n')).not.toContain('write-secret')
    expect(io.errors.join('\n')).not.toContain('Failed to set CONVEX_WRITE_SECRET on the Convex deployment.')
  })

  it('still fails hard on non-permission Convex env set errors', () => {
    const spawnSync = spawnByArgs({
      deploy: { status: 0 },
      env: { status: 1, stdout: '', stderr: 'Network error while contacting Convex\n' },
    })
    const io = captureIo(spawnSync)

    expect(runVercelBuild(prodEnv, io)).toBe(1)
    expect(io.errors.join('\n')).toContain('Failed to set CONVEX_WRITE_SECRET on the Convex deployment.')
  })

  it('skips env set when SKIP_CONVEX_ENV_SYNC is set after a successful deploy', () => {
    const spawnSync = spawnByArgs({ deploy: { status: 0 } })
    const io = captureIo(spawnSync)

    expect(runVercelBuild({ ...prodEnv, SKIP_CONVEX_ENV_SYNC: '1' }, io)).toBe(0)
    expect(spawnSync).toHaveBeenCalledTimes(1)
    expect(spawnSync.mock.calls[0][1]).toEqual(['convex', 'deploy', '--cmd', 'npm run build'])
    expect(io.warnings.join('\n')).toContain('SKIP_CONVEX_ENV_SYNC')
  })

  it('runs a frontend-only npm build on preview Vercel environments', () => {
    const spawnSync = vi.fn(() => ({ status: 0 }))
    const io = captureIo(spawnSync)

    expect(runVercelBuild({ VERCEL: '1', VERCEL_ENV: 'preview' }, io)).toBe(0)
    expect(spawnSync).toHaveBeenCalledTimes(1)
    expect(spawnSync.mock.calls[0][0]).toBe('npm')
    expect(spawnSync.mock.calls[0][1]).toEqual(['run', 'build'])
    expect(io.logs.join('\n')).toContain('Skipping Convex deploy')
  })
})
