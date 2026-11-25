import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// 故障注入：先讓第一條測試失敗（產生 trace／截圖／error-context），
// 再於第二條測試掛住期間強制終止整個行程樹，
// 最後檢查失敗證據是否仍留在獨立目錄（不依賴收尾流程）。
const evidenceRoot = path.join(os.tmpdir(), `moorread-fault-injection-${Date.now()}`)
const outputDir = path.join(evidenceRoot, 'playwright-output')
fs.mkdirSync(outputDir, { recursive: true })

const child = spawn(
  process.execPath,
  [path.join('node_modules', '@playwright', 'test', 'cli.js'), 'test', '--config', 'e2e-tools/fault-injection/playwright.fault.config.ts'],
  {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      MOORREAD_E2E_EVIDENCE_DIR: evidenceRoot,
      MOORREAD_FAULT_OUTPUT_DIR: outputDir,
    },
  },
)

let killed = false
let childOutput = ''
child.stdout.on('data', (chunk) => {
  childOutput += chunk.toString()
})
child.stderr.on('data', (chunk) => {
  childOutput += chunk.toString()
})
child.on('error', (error) => {
  childOutput += `spawn error: ${error.message}\n`
})

function killTree() {
  if (killed)
    return
  killed = true
  spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
}

function findRunDir() {
  const runs = fs.readdirSync(evidenceRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('run-'))
  return runs.length > 0 ? path.join(evidenceRoot, runs[0].name) : null
}

function failureSaved() {
  const runDir = findRunDir()
  if (!runDir)
    return false
  const journal = path.join(runDir, 'journal.jsonl')
  if (!fs.existsSync(journal))
    return false
  return fs.readFileSync(journal, 'utf8').includes('failure-saved')
}

const deadline = Date.now() + 90_000
while (Date.now() < deadline && !failureSaved())
  await new Promise(resolve => setTimeout(resolve, 500))

const savedBeforeKill = failureSaved()
killTree()
await new Promise(resolve => {
  child.on('exit', resolve)
  setTimeout(resolve, 15_000)
})

const runDir = findRunDir()
const failures = runDir
  ? fs.readdirSync(runDir, { withFileTypes: true }).filter(e => e.isDirectory() && e.name.startsWith('failure-'))
  : []
const files = failures.flatMap(dir => fs.readdirSync(path.join(runDir, dir.name)))
const journalText = runDir && fs.existsSync(path.join(runDir, 'journal.jsonl'))
  ? fs.readFileSync(path.join(runDir, 'journal.jsonl'), 'utf8')
  : ''

const checks = {
  savedBeforeKill,
  failureDirExists: failures.length > 0,
  hasMetaJson: files.includes('meta.json'),
  hasTraceOrScreenshot: files.some(name => name.endsWith('.zip') || name.endsWith('.png')),
  journalHasFailedEntry: journalText.includes('"status":"failed"'),
  journalHasFailureSaved: journalText.includes('failure-saved'),
  runDir: runDir ?? null,
  files,
}

const passed = Object.entries(checks)
  .filter(([key]) => key !== 'runDir' && key !== 'files')
  .every(([, value]) => value === true)

console.log(JSON.stringify({ passed, checks, evidenceRoot, childOutputTail: childOutput.slice(-2000) }, null, 2))
process.exit(passed ? 0 : 1)
