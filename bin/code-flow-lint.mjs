#!/usr/bin/env node

import { ESLint } from 'eslint'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtime = join(root, 'runtime')
const jsExtensions = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'])
const maxBuffer = 128 * 1024 * 1024

function supported(file) {
  const extension = extname(file)
  return extension === '.java' || jsExtensions.has(extension)
}

function git(cwd, ...args) {
  const executable = readFileSync(join(runtime, 'git-path'), 'utf8').trim()
  return execFileSync(executable, args, { cwd, maxBuffer })
}

function stagedFiles() {
  // Read object IDs from the selected index, including the temporary index
  // Git creates for partial commits. Working tree edits cannot affect the lint.
  const cwd = git(process.cwd(), 'rev-parse', '--show-toplevel').toString().replace(/\n$/, '')
  const fields = git(
    cwd, 'diff', '--cached', '--raw', '--no-abbrev', '--no-renames', '--no-ext-diff',
    '--diff-filter=AMT', '-z', '--',
  ).toString().split('\0')
  const files = []
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const [, mode, , object] = fields[index].split(' ')
    const path = fields[index + 1]
    if ((mode === '100644' || mode === '100755') && supported(path)) {
      files.push({ path, contents: git(cwd, 'cat-file', 'blob', object) })
    }
  }
  return { cwd, files }
}

function explicitFiles(args) {
  const cwd = realpathSync(process.cwd())
  const files = args.filter(supported).map((path) => ({
    path: relative(cwd, resolve(path)),
    contents: readFileSync(path),
  }))
  if (!files.length) throw new Error('请指定 Java、JavaScript 或 TypeScript 源文件')
  return { cwd, files }
}

async function lintScripts(cwd, files) {
  // ESLint matches config relative to cwd, so explicit files outside the
  // current directory get an instance rooted at their parent directory.
  const engines = new Map()
  let passed = true
  for (const file of files) {
    const absolute = resolve(cwd, file.path)
    const outside = file.path === '..' || file.path.startsWith('..' + sep) || isAbsolute(file.path)
    const base = outside ? dirname(absolute) : cwd
    if (!engines.has(base)) {
      engines.set(base, new ESLint({
        cwd: base,
        overrideConfigFile: join(root, 'rules', 'eslint.config.mjs'),
        allowInlineConfig: false,
        ignore: false,
      }))
    }
    const results = await engines.get(base).lintText(file.contents.toString('utf8'), {
      filePath: absolute,
      warnIgnored: true,
    })
    for (const result of results) {
      for (const issue of result.messages) {
        console.error(`${file.path}:${issue.line ?? 1}:${issue.column ?? 1} ${issue.message} [${issue.ruleId ?? 'eslint'}]`)
        passed = false
      }
    }
  }
  return passed
}

function lintJava(files) {
  // Checkstyle takes files on disk. Use each input's contents with its
  // original basename, then show paths relative to the caller in diagnostics.
  const directory = mkdtempSync(join(tmpdir(), 'code-flow-lint-java-'))
  const names = new Map()
  try {
    for (const [index, file] of files.entries()) {
      const target = join(directory, String(index), file.path.split(sep).at(-1))
      mkdirSync(dirname(target))
      writeFileSync(target, file.contents)
      names.set(target, file.path)
      names.set(realpathSync(target), file.path)
    }
    const executable = readFileSync(join(runtime, 'java-path'), 'utf8').trim()
    const result = spawnSync(executable, [
      '-jar', join(runtime, 'checkstyle.jar'), '-c',
      join(root, 'rules', 'java', 'checkstyle.xml'), directory,
    ], { encoding: 'utf8', maxBuffer })
    if (result.error) throw result.error
    for (const line of result.stdout.split('\n')) {
      const match = /^\[(ERROR|WARN|INFO)\] (.*?\.java)(:\d+.*)$/.exec(line)
      if (match) console.error(`${names.get(match[2]) ?? match[2]}${match[3]}`)
      else if (result.status !== 0 && line && !/^Starting audit|Audit done/.test(line)) {
        console.error(line)
      }
    }
    if (result.stderr) process.stderr.write(result.stderr)
    return result.status === 0
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

async function main(args) {
  if (!args.length || args[0] === '--help' || args[0] === '-h') {
    console.log('用法  code-flow-lint --staged  |  code-flow-lint [--] 文件...')
    return
  }
  const { cwd, files } = args.length === 1 && args[0] === '--staged'
    ? stagedFiles()
    : explicitFiles(args[0] === '--' ? args.slice(1) : args)
  const scripts = files.filter(({ path }) => jsExtensions.has(extname(path)))
  const java = files.filter(({ path }) => extname(path) === '.java')
  const scriptsPassed = await lintScripts(cwd, scripts)
  const javaPassed = java.length === 0 || lintJava(java)
  if (!scriptsPassed || !javaPassed) process.exitCode = 1
}

try {
  await main(process.argv.slice(2))
} catch (error) {
  console.error(`code-flow-lint 运行失败  ${error.message}`)
  process.exitCode = 1
}
