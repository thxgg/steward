import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import type { RepoConfig } from '../../app/types/repo.js'
import { dbGet, dbRun } from './db.js'
import { isGitRepo } from './git.js'

type RepoSyncMetaRow = {
  repo_id: string
  sync_key: string
  fingerprint: string | null
  fingerprint_kind: string | null
  updated_at: string
}

type AppMetaRow = {
  value: string
}

export type RepoSyncMeta = {
  repoId: string
  syncKey: string
  fingerprint: string
  fingerprintKind: string
  updatedAt: string
}

const SYNC_DEVICE_ID_KEY = 'sync:device-id'
const SYNC_KEY_PREFIX = 'rsk_'
const GIT_REMOTE_FINGERPRINT_KIND = 'git-remotes-v1'
const REPO_SHAPE_FINGERPRINT_KIND = 'repo-shape-v1'

function nowIso(): string {
  return new Date().toISOString()
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function normalizePathSlashes(path: string): string {
  return path.replaceAll('\\', '/')
}

function createSyncKey(): string {
  return `${SYNC_KEY_PREFIX}${randomUUID().replaceAll('-', '')}`
}

async function execGit(repoPath: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolvePromise) => {
    const proc = spawn('git', args, {
      cwd: repoPath,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    })

    let stdout = ''

    proc.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    proc.on('close', (code) => {
      resolvePromise({
        ok: code === 0,
        stdout
      })
    })

    proc.on('error', () => {
      resolvePromise({ ok: false, stdout: '' })
    })
  })
}

function normalizeRemoteUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) {
    return ''
  }

  const scpLikeMatch = trimmed.match(/^([^@/\s]+)@([^:/\s]+):(.+)$/)
  const candidate = scpLikeMatch
    ? `ssh://${scpLikeMatch[1]}@${scpLikeMatch[2]}/${scpLikeMatch[3]}`
    : trimmed

  try {
    const parsed = new URL(candidate)
    const protocol = parsed.protocol.toLowerCase()
    const username = parsed.username ? `${parsed.username}@` : ''
    const hostname = parsed.hostname.toLowerCase()
    const port = parsed.port ? `:${parsed.port}` : ''

    let pathname = parsed.pathname.replace(/\/+/g, '/').replace(/\.git$/i, '').replace(/\/$/, '')
    pathname = pathname.toLowerCase()

    return `${protocol}//${username}${hostname}${port}${pathname}`
  } catch {
    return candidate.replace(/\.git$/i, '').toLowerCase()
  }
}

function mapRepoSyncMetaRow(row: RepoSyncMetaRow): RepoSyncMeta {
  return {
    repoId: row.repo_id,
    syncKey: row.sync_key,
    fingerprint: row.fingerprint || '',
    fingerprintKind: row.fingerprint_kind || '',
    updatedAt: row.updated_at
  }
}

function getGitRoots(repo: RepoConfig): Array<{ repoRef: string; path: string }> {
  const roots = new Map<string, { repoRef: string; path: string }>()

  roots.set(resolve(repo.path), {
    repoRef: '',
    path: repo.path
  })

  for (const gitRepo of repo.gitRepos || []) {
    const repoRef = normalizePathSlashes(gitRepo.relativePath).replace(/^\.\//, '').replace(/\/$/, '')
    if (!repoRef) {
      continue
    }

    roots.set(resolve(gitRepo.absolutePath), {
      repoRef,
      path: gitRepo.absolutePath
    })
  }

  return Array.from(roots.values())
}

async function readGitRemoteSignatures(repo: RepoConfig): Promise<string[]> {
  const roots = getGitRoots(repo)
  const signatures = new Set<string>()

  for (const root of roots) {
    if (!await isGitRepo(root.path)) {
      continue
    }

    const result = await execGit(root.path, ['config', '--get-regexp', '^remote\\..*\\.url$'])
    if (!result.ok) {
      continue
    }

    const lines = result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    for (const line of lines) {
      const firstSpace = line.indexOf(' ')
      const rawUrl = firstSpace >= 0 ? line.slice(firstSpace + 1).trim() : line
      const normalized = normalizeRemoteUrl(rawUrl)
      if (!normalized) {
        continue
      }

      signatures.add(`${root.repoRef}:${normalized}`)
    }
  }

  return Array.from(signatures).sort((a, b) => a.localeCompare(b))
}

async function readPrdSlugs(repoPath: string): Promise<string[]> {
  try {
    const files = await fs.readdir(join(repoPath, 'docs', 'prd'))
    return files
      .filter((file) => file.endsWith('.md'))
      .map((file) => basename(file, '.md'))
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

export async function calculateRepoFingerprint(repo: RepoConfig): Promise<{ fingerprint: string; fingerprintKind: string }> {
  const remoteSignatures = await readGitRemoteSignatures(repo)
  if (remoteSignatures.length > 0) {
    return {
      fingerprint: sha256Hex(JSON.stringify(remoteSignatures)),
      fingerprintKind: GIT_REMOTE_FINGERPRINT_KIND
    }
  }

  const prdSlugs = await readPrdSlugs(repo.path)
  const nestedRepos = (repo.gitRepos || [])
    .map((gitRepo) => normalizePathSlashes(gitRepo.relativePath).replace(/^\.\//, '').replace(/\/$/, ''))
    .filter((value) => value.length > 0)
    .sort((a, b) => a.localeCompare(b))

  return {
    fingerprint: sha256Hex(JSON.stringify({
      name: repo.name.trim().toLowerCase(),
      prdSlugs,
      nestedRepos
    })),
    fingerprintKind: REPO_SHAPE_FINGERPRINT_KIND
  }
}

export async function getOrCreateSyncDeviceId(): Promise<string> {
  const existing = await dbGet<AppMetaRow>(
    'SELECT value FROM app_meta WHERE key = ?',
    [SYNC_DEVICE_ID_KEY]
  )

  if (existing?.value) {
    return existing.value
  }

  const createdAt = nowIso()
  const generatedValue = randomUUID()

  await dbRun(
    `
      INSERT INTO app_meta (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO NOTHING
    `,
    [SYNC_DEVICE_ID_KEY, generatedValue, createdAt]
  )

  const resolved = await dbGet<AppMetaRow>(
    'SELECT value FROM app_meta WHERE key = ?',
    [SYNC_DEVICE_ID_KEY]
  )

  if (!resolved?.value) {
    throw new Error('Failed to initialize sync device identifier')
  }

  return resolved.value
}

export async function getRepoSyncMeta(repoId: string): Promise<RepoSyncMeta | null> {
  const row = await dbGet<RepoSyncMetaRow>(
    `
      SELECT repo_id, sync_key, fingerprint, fingerprint_kind, updated_at
      FROM repo_sync_meta
      WHERE repo_id = ?
    `,
    [repoId]
  )

  return row ? mapRepoSyncMetaRow(row) : null
}

export async function ensureRepoSyncMetaForRepo(repo: RepoConfig): Promise<RepoSyncMeta> {
  await getOrCreateSyncDeviceId()

  const { fingerprint, fingerprintKind } = await calculateRepoFingerprint(repo)
  const existing = await dbGet<RepoSyncMetaRow>(
    `
      SELECT repo_id, sync_key, fingerprint, fingerprint_kind, updated_at
      FROM repo_sync_meta
      WHERE repo_id = ?
    `,
    [repo.id]
  )

  const updatedAt = nowIso()

  if (!existing) {
    const created: RepoSyncMeta = {
      repoId: repo.id,
      syncKey: createSyncKey(),
      fingerprint,
      fingerprintKind,
      updatedAt
    }

    await dbRun(
      `
        INSERT INTO repo_sync_meta (repo_id, sync_key, fingerprint, fingerprint_kind, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      [created.repoId, created.syncKey, created.fingerprint, created.fingerprintKind, created.updatedAt]
    )

    return created
  }

  if (existing.fingerprint !== fingerprint || existing.fingerprint_kind !== fingerprintKind) {
    await dbRun(
      `
        UPDATE repo_sync_meta
        SET fingerprint = ?, fingerprint_kind = ?, updated_at = ?
        WHERE repo_id = ?
      `,
      [fingerprint, fingerprintKind, updatedAt, repo.id]
    )

    return {
      repoId: existing.repo_id,
      syncKey: existing.sync_key,
      fingerprint,
      fingerprintKind,
      updatedAt
    }
  }

  return mapRepoSyncMetaRow(existing)
}

export async function ensureRepoSyncMetaForRepos(repos: RepoConfig[]): Promise<Map<string, RepoSyncMeta>> {
  const metaByRepoId = new Map<string, RepoSyncMeta>()
  if (repos.length === 0) {
    return metaByRepoId
  }

  await getOrCreateSyncDeviceId()

  for (const repo of repos) {
    const meta = await ensureRepoSyncMetaForRepo(repo)
    metaByRepoId.set(repo.id, meta)
  }

  return metaByRepoId
}
