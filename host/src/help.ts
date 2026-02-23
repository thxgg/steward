export type HelpMethod = {
  signature: string
  description: string
}

export type HelpExample = {
  title: string
  code: string
}

export type StewardHelp = {
  version: number
  envelope: {
    ok: string
    result: string
    logs: string
    error: string
    meta: {
      timeoutMs: string
      durationMs: string
      truncatedResult: string
      truncatedLogs: string
      resultWasUndefined: string
    }
  }
  apis: {
    repos: HelpMethod[]
    prds: HelpMethod[]
    git: HelpMethod[]
    state: HelpMethod[]
  }
  examples: HelpExample[]
}

const HELP: StewardHelp = {
  version: 1,
  envelope: {
    ok: 'true on success, false on failure',
    result: 'returned value from your code, or null when no return value exists',
    logs: 'captured console output entries from this execution',
    error: 'null on success, otherwise { code, message, stack?, details? }',
    meta: {
      timeoutMs: 'execution timeout limit in milliseconds',
      durationMs: 'elapsed runtime in milliseconds',
      truncatedResult: 'true when result is truncated to output limit',
      truncatedLogs: 'true when logs are truncated to output limit',
      resultWasUndefined: 'true when code finished without an explicit return value'
    }
  },
  apis: {
    repos: [
      { signature: 'repos.list()', description: 'List registered repositories' },
      { signature: 'repos.get(repoId)', description: 'Get one repository by id' },
      {
        signature: 'repos.current()',
        description: 'Resolve current repository when exactly one is registered'
      },
      { signature: 'repos.add(path, name?)', description: 'Register repository path' },
      { signature: 'repos.remove(repoId)', description: 'Remove repository by id' },
      {
        signature: 'repos.refreshGitRepos(repoId)',
        description: 'Refresh discovered nested git repositories'
      }
    ],
    prds: [
      { signature: 'prds.list(repoId)', description: 'List PRDs for repository' },
      { signature: 'prds.getDocument(repoId, prdSlug)', description: 'Load PRD markdown document' },
      { signature: 'prds.getTasks(repoId, prdSlug)', description: 'Load tasks state for PRD' },
      { signature: 'prds.getProgress(repoId, prdSlug)', description: 'Load progress state for PRD' },
      {
        signature: 'prds.getTaskCommits(repoId, prdSlug, taskId)',
        description: 'Resolve task commit references'
      }
    ],
    git: [
      {
        signature: 'git.getStatus(repoId, repoPath?)',
        description: 'Load working tree status (staged/unstaged/untracked)'
      },
      { signature: 'git.getCommits(repoId, shas, repoPath?)', description: 'Load commit metadata' },
      { signature: 'git.getDiff(repoId, commit, repoPath?)', description: 'Load full commit diff' },
      {
        signature: 'git.getFileDiff(repoId, commit, file, repoPath?)',
        description: 'Load diff hunks for one file'
      },
      {
        signature: 'git.getFileContent(repoId, commit, file, repoPath?)',
        description: 'Load file content at commit'
      },
      {
        signature: 'git.commitIfChanged(repoId, message, options?)',
        description: 'Stage optional paths and commit when staged changes exist'
      }
    ],
    state: [
      { signature: 'state.get(repoId, slug)', description: 'Load stored state by repo id' },
      { signature: 'state.getByPath(repoPath, slug)', description: 'Load stored state by repo path' },
      {
        signature: 'state.getCurrent(slug)',
        description: 'Load state for current repository when unambiguous'
      },
      { signature: 'state.summaries(repoId)', description: 'Load PRD state summaries by repo id' },
      { signature: 'state.summariesByPath(repoPath)', description: 'Load PRD state summaries by path' },
      {
        signature: 'state.summariesCurrent()',
        description: 'Load state summaries for current repository when unambiguous'
      },
      { signature: 'state.upsert(repoId, slug, payload)', description: 'Save tasks/progress/notes by repo id' },
      {
        signature: 'state.upsertByPath(repoPath, slug, payload)',
        description: 'Save tasks/progress/notes by repo path'
      },
      {
        signature: 'state.upsertCurrent(slug, payload)',
        description: 'Save state in current repository when unambiguous'
      }
    ]
  },
  examples: [
    {
      title: 'List repos and PRDs',
      code: `const allRepos = await repos.list()\n\nreturn await Promise.all(allRepos.map(async (repo) => ({\n  id: repo.id,\n  name: repo.name,\n  prds: await prds.list(repo.id)\n})))`
    },
    {
      title: 'Use current repo helper',
      code: `const repo = await repos.current()\nconst slug = 'prd-viewer'\n\nreturn {\n  repo,\n  tasks: await prds.getTasks(repo.id, slug),\n  progress: await prds.getProgress(repo.id, slug)\n}`
    },
    {
      title: 'Upsert without repoId',
      code: `await state.upsertCurrent('prd-viewer', {\n  notes: '# Updated from MCP'\n})\n\nreturn { saved: true }`
    },
    {
      title: 'Commit task-related changes when present',
      code: `const repo = await repos.current()\n\nconst result = await git.commitIfChanged(repo.id, 'docs: update task notes', {\n  paths: ['docs/prd/prd-viewer.md']\n})\n\nreturn result`
    }
  ]
}

function formatMethodList(methods: HelpMethod[]): string {
  return methods
    .map((method) => `- \`${method.signature}\` - ${method.description}`)
    .join('\n')
}

export function getStewardHelp(): StewardHelp {
  return JSON.parse(JSON.stringify(HELP)) as StewardHelp
}

export function getExecuteToolDescription(): string {
  return [
    'Run codemode JavaScript with repos, prds, git, and state APIs.',
    '',
    'Execution always returns a structured JSON envelope:',
    '`{ ok, result, logs, error, meta }`',
    '',
    'In-sandbox discovery helper:',
    '- `steward.help()`',
    '',
    'Repository APIs:',
    formatMethodList(HELP.apis.repos),
    '',
    'PRD APIs:',
    formatMethodList(HELP.apis.prds),
    '',
    'Git APIs:',
    formatMethodList(HELP.apis.git),
    '',
    'State APIs:',
    formatMethodList(HELP.apis.state),
    '',
    'Use `return` in your code to set the envelope `result` field.'
  ].join('\n')
}
