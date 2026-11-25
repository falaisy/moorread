import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter'
import type { Buffer } from 'node:buffer'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

// 每一輪執行建立獨立的證據目錄，永不清理既有資料。
// 失敗當下（onTestEnd）就把附件複製出來，並以 append-only 方式寫 journal，
// 因此即使行程被強制終止，已發生的失敗證據仍會留在磁碟上。
export default class EvidenceReporter implements Reporter {
  private runDir = ''
  private journal = ''
  private outputLog = ''

  onBegin() {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const root = process.env.MOORREAD_E2E_EVIDENCE_DIR
      || path.join(os.tmpdir(), 'moorread-e2e-evidence')
    this.runDir = path.join(root, `run-${stamp}`)
    fs.mkdirSync(this.runDir, { recursive: true })
    this.journal = path.join(this.runDir, 'journal.jsonl')
    this.outputLog = path.join(this.runDir, 'output.log')
    fs.appendFileSync(
      this.journal,
      `${JSON.stringify({ event: 'run-start', at: new Date().toISOString(), cwd: process.cwd() })}\n`,
    )
  }

  onStdOut(chunk: string | Buffer) {
    fs.appendFileSync(this.outputLog, chunk)
  }

  onStdErr(chunk: string | Buffer) {
    fs.appendFileSync(this.outputLog, chunk)
  }

  onTestBegin(test: TestCase) {
    fs.appendFileSync(
      this.journal,
      `${JSON.stringify({
        event: 'test-begin',
        title: test.titlePath().join(' › '),
        file: test.location.file,
        line: test.location.line,
        column: test.location.column,
        at: new Date().toISOString(),
      })}\n`,
    )
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const entry = {
      event: 'test-end',
      title: test.titlePath().join(' › '),
      file: test.location.file,
      line: test.location.line,
      status: result.status,
      retry: result.retry,
      workerIndex: result.workerIndex,
      duration: result.duration,
      at: new Date().toISOString(),
      error: result.error?.message?.split('\n')[0] ?? null,
      attachments: result.attachments.map(a => a.name),
    }
    fs.appendFileSync(this.journal, `${JSON.stringify(entry)}\n`)
    if (result.status === 'passed' || result.status === 'skipped')
      return
    const failureDir = fs.mkdtempSync(path.join(this.runDir, 'failure-'))
    for (const attachment of result.attachments) {
      if (!attachment.path || !fs.existsSync(attachment.path))
        continue
      const target = path.join(failureDir, path.basename(attachment.path))
      fs.copyFileSync(attachment.path, target)
    }
    fs.writeFileSync(
      path.join(failureDir, 'meta.json'),
      JSON.stringify({ title: entry.title, status: result.status, at: entry.at, error: result.error?.message ?? null }, null, 2),
    )
    fs.appendFileSync(
      this.journal,
      `${JSON.stringify({ event: 'failure-saved', dir: failureDir, at: new Date().toISOString() })}\n`,
    )
  }

  onEnd(result: FullResult) {
    fs.appendFileSync(
      this.journal,
      `${JSON.stringify({ event: 'run-end', status: result.status, at: new Date().toISOString() })}\n`,
    )
    fs.writeFileSync(path.join(this.runDir, 'RUN-COMPLETE'), result.status)
  }
}
