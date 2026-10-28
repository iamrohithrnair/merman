import type { On } from 'claude-code'
import { expect, mock } from 'claude-code/testing'
import { test } from './tool-rows'
import type { TestBody } from 'claude-code/testing'

import { clockText, sentAt } from '../hooks/clock'
import { FIGURE_HINT } from '../hooks/figure'
import { parse } from '../hooks/markdown'
import { PRESET_BACKGROUNDS, PRESET_NAMES, PRESETS } from '../hooks/presets'
import { RANDOM_THEMES, pickTheme, resolveStyle } from '../hooks/theme'
import { paintOf, tokensOf as paintTokens, shownLines } from './paint'
import { DEMO_SHOWN, HELP_SHOWN, HINT, KOREAN_DEMO_SHOWN, SETUP_DONE, SETUP_PANE_KEYS, SETUP_PANE_OPENED, setupParts, setupSteps, setupText } from '../hooks/help'
import type { Theme } from '../hooks/theme'
import { EDIT_NOTES, PRISM_COLORS, bashEdits, columnWidths, contrast, describeShell, diffLines, diffTint, fullHue, movesTree, onTint, pathLanguage, previewBand, tint, wordTint, errorReason, groupSummary, isReadOnlyCall, programsOf, refusalReason, rememberCall, shortTarget, shortenPaths, withoutBashEdits } from '../hooks/render'
import { claudeAt } from './claude-version'

const t = PRESETS['catppuccin-mocha']
const BUTTON_PROBE = 'TextButtonProbe'
const engine = (on: On) => {
  on('ui.render', { component: 'ToolResult' }, ($, e, next) => {
    if (e.props.tool !== BUTTON_PROBE) return next(e)
    const { Button, Text } = $.ui.resolve(e)
    return <Button plain label={BUTTON_PROBE} onPress={() => undefined}><Text>{BUTTON_PROBE}</Text></Button>
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
}

const call = (tool: string, input: unknown, id: string) => ({ tool_use_id: id, tool, input, isRunning: false, isErrored: false, isInterrupted: false })

test('collapsed tool groups draw one summary line', { options: { toolStyle: 'classic' } }, async $ => {
  const ui = await $.ui.mount({
    plugin: 'merman',
    surface: 'terminal',
    component: 'ToolGroup',
    props: { calls: [call('Bash', { command: 'ls' }, 'a'), call('Bash', { command: 'pwd' }, 'b'), call('Read', { file_path: '/tmp/x' }, 'c')], isActive: false, isExpanded: false },
  })
  expect((await ui.find({ type: 'Text', text: /^Ran 2 commands, read 1 file$/ }))?.props.bold).toBe(true)
  await ui.unmount()
})

test('reads, searches and read-only shell commands count as read-only', () => {
  const shell = (command: string) => isReadOnlyCall('Bash', { command })
  expect(isReadOnlyCall('Read', { file_path: '/tmp/x' })).toBe(true)
  expect(isReadOnlyCall('Grep', { pattern: 'x' })).toBe(true)
  expect(shell('sed -n 40,135p tests/sheets.py; grep -n "^def " src/app.py')).toBe(true)
  expect(shell('cd /repo && ls -la docs/ | head -20')).toBe(true)
  expect(shell('grep -rn "C5" docs/ 2>/dev/null | cut -c1-300 | head -20; echo ---')).toBe(true)
  expect(shell('git log --oneline -5')).toBe(true)
  expect(shell('gh pr view 12 --json state')).toBe(true)
})

test('anything that can change files is not read-only', () => {
  const shell = (command: string) => isReadOnlyCall('Bash', { command })
  expect(isReadOnlyCall('Edit', { file_path: '/tmp/x' })).toBe(false)
  expect(shell('sed -i s/a/b/ app.py')).toBe(false)
  expect(shell('cat a > b')).toBe(false)
  expect(shell('find . -name "*.tmp" -delete')).toBe(false)
  expect(shell('ls && rm -rf build')).toBe(false)
  expect(shell('echo $(touch x)')).toBe(false)
  expect(shell('git commit -m x')).toBe(false)
  expect(shell('make test 2>&1 | tail -5')).toBe(false)
  expect(shell('cat x | tee y')).toBe(false)
})

test('quoted pipes, variables and harmless redirects do not break read-only detection', () => {
  const shell = (command: string) => isReadOnlyCall('Bash', { command })
  expect(shell('grep -n "cwd\\b\\|cwd:\\|root" types/index.d.ts | head -20')).toBe(true)
  expect(shell('T=types/index.d.ts; sed -n 3585,3602p $T; sed -n 2740,2750p $T')).toBe(true)
  expect(shell('grep -n "a > b" notes.md')).toBe(true)
  expect(shell('ls docs 2>&1 | head')).toBe(true)
  expect(shell("echo 'x' >> log.txt")).toBe(false)
  expect(describeShell('grep -n "cwd\\b\\|root" notes.md')).toBe('Searched notes.md for "cwd\\b\\|root"')
})

test('read-only shell commands are described in plain words with short paths', () => {
  const places = { cwd: '/home/dev/app', home: '/home/dev' }
  expect(shortTarget(places, '/home/dev/app/src/main.ts')).toBe('src/main.ts')
  expect(shortTarget(places, '/home/dev/notes.md')).toBe('~/notes.md')
  expect(shortTarget(places, '/private/tmp/build-501/run-3/cache/scratch/out.txt')).toBe('/private/tmp/…/scratch/out.txt')
  expect(describeShell('sed -n 40,135p /home/dev/app/tests/sheets.py', places)).toBe('Read tests/sheets.py lines 40–135')
  expect(describeShell('grep -rn "TODO" src/ | head -20', places)).toBe('Searched src/ for "TODO"')
  expect(describeShell('cd /home/dev/app && ls -la docs/', places)).toBe('Listed docs/')
  expect(describeShell('ls -A src', places)).toBe('Listed src')
  expect(describeShell('tree -L 2 src', places)).toBe('Listed src')
  expect(describeShell('test -f notes.md && cat notes.md', places)).toBe('Read notes.md')
  expect(describeShell('T=/home/dev/app/types/index.d.ts; sed -n 1,10p $T; grep -n "root" $T', places)).toBe('Read types/index.d.ts lines 1–10 · Searched types/index.d.ts for "root"')
  expect(describeShell('git log --oneline -5', places)).toBeUndefined()
  expect(describeShell('make test', places)).toBeUndefined()
  expect(describeShell('for f in a.py b.py; do sed -n 1,9p $f; done', places)).toBeUndefined()
  expect(describeShell('cat $NOTES', places)).toBeUndefined()
})

test('toolOutput quiet rows say what was read, and failed groups say why', { options: { toolOutput: 'quiet', toolStyle: 'classic' } }, async $ => {
  const row = await $.ui.mount({ plugin: 'merman', surface: 'terminal', component: 'ToolUse', props: call('Bash', { command: 'sed -n 1,12p hooks/theme.ts' }, 'd-1') })
  expect(await row.find({ type: 'Text', text: /^Read hooks\/theme\.ts lines 1–12$/ })).toBeDefined()
  await row.unmount()
  const described = await $.ui.mount({
    plugin: 'merman',
    surface: 'terminal',
    component: 'ToolUse',
    props: call('Bash', { command: 'R=a/b; for q in a b; do gh search issues "$q"; done | jq -s add', description: 'Search upstream issues about copy buttons' }, 'd-5'),
  })
  expect(await described.find({ type: 'Text', text: /^Search upstream issues about copy buttons · gh, jq$/ })).toBeDefined()
  await described.unmount()
  const failed = { ...call('Bash', { command: 'cat missing.txt' }, 'd-2'), isErrored: true, output: 'Exit code 1\ncat: missing.txt: No such file or directory' }
  const group = await $.ui.mount({
    plugin: 'merman',
    surface: 'terminal',
    component: 'ToolGroup',
    props: { calls: [call('Read', { file_path: 'AGENTS.md' }, 'd-3'), failed], isActive: false, isExpanded: false },
  })
  expect(await group.find({ type: 'Text', text: /^Read AGENTS\.md · Read missing\.txt$/ })).toBeDefined()
  expect(await group.find({ type: 'Text', text: /cat: missing\.txt: No such file or directory$/ })).toBeDefined()
  await group.unmount()
  const bare = await $.ui.mount({ plugin: 'merman', surface: 'terminal', component: 'ToolUse', props: call('Bash', { command: 'make test' }, 'd-6') })
  expect(await bare.find({ type: 'Text', text: /^Ran make test$/ })).toBeDefined()
  await bare.unmount()
  const searched = await $.ui.mount({ plugin: 'merman', surface: 'terminal', component: 'ToolUse', props: call('Grep', { pattern: 'TODO', path: 'src/' }, 'd-7') })
  expect(await searched.find({ type: 'Text', text: /^Searched src\/ for "TODO"$/ })).toBeDefined()
  await searched.unmount()
})

test('loops, gh search and read-only gh api count as reads; gh api with fields does not', () => {
  const shell = (command: string) => isReadOnlyCall('Bash', { command })
  expect(shell('R=a/b; for q in copy click; do gh search issues --repo $R "$q" --json number; done | jq -s add')).toBe(true)
  expect(shell('gh api repos/a/b/pulls/1/comments --jq ".[].body"')).toBe(true)
  expect(shell('gh api -X PATCH repos/a/b/issues/comments/1 -f body=x')).toBe(false)
  expect(shell('gh api repos/a/b/issues -f title=x')).toBe(false)
})

test('a shell call without a plain-words form shows its description and the programs it ran', () => {
  expect(programsOf('R=a/b; for q in a b; do gh search issues "$q"; done | jq -s add')).toEqual(['gh', 'jq'])
  expect(programsOf('cd app && .venv/bin/python -I run.py && make test && git status && npm ci')).toEqual(['python', 'make', 'git', '…'])
  expect(programsOf("python3 - <<'EOF'\nfrom pathlib import Path\nassert Path('x').exists()\nEOF\nmake test")).toEqual(['python3', 'make'])
  expect(programsOf('cat >> notes.md <<EOF\n### Built\nGebaut ist alles\nEOF')).toEqual(['cat'])
  expect(programsOf('python3 - <<-PY\n\timport os\n\tPY\ngit status')).toEqual(['python3', 'git'])
  expect(programsOf('cd app && pwd && test -f x')).toEqual([])
})

test('the failure reason is the last real line of the error', () => {
  expect(errorReason('Exit code 1\nstate: CLOSED\n(eval):1: ===== not found')).toBe('(eval):1: ===== not found')
  expect(errorReason({ stdout: 'ok\n', stderr: 'warning: x\nfatal: not a git repository\n' })).toBe('fatal: not a git repository')
})

test('commands that write through their arguments or in the background are not read-only', () => {
  const shell = (command: string) => isReadOnlyCall('Bash', { command })
  for (const command of [
    'ls & rm -rf build',
    'case x in *) rm -rf build;; esac',
    'sed -Ei s/a/b/ app.py',
    'sed -ni p app.py',
    "sed -n 'w out.txt' app.py",
    "sed 's/a/b/w out.txt' app.py",
    "sed -n -e 1p -e 'w out' app.py",
    'sort -o out.txt in.txt',
    'uniq in.txt out.txt',
    'awk \'{print > "out.txt"}\' in.txt',
    'find . -name x -fls out.txt',
    'pdftotext doc.pdf',
    'gh api --method=DELETE repos/a/b/issues/comments/1',
    'gh api repos/a/b/issues -ftitle=x',
    'gh api -XPOST repos/a/b/issues',
  ]) expect([command, shell(command)]).toEqual([command, false])
  for (const command of ['ls docs &>/dev/null', 'sort names.txt', 'uniq names.txt', 'pdftotext doc.pdf -', 'gh api --method GET repos/a/b/pulls']) {
    expect([command, shell(command)]).toEqual([command, true])
  }
})

test('line continuations and grep value flags do not leak into descriptions', () => {
  expect(describeShell('grep -rn "foo" \\\n  src/ tests/')).toBe('Searched src/, tests/ for "foo"')
  expect(describeShell('grep -rn --include "*.ts" foo src/')).toBe('Searched src/ for "foo"')
})

test('project and home prefixes are only shortened at the start of a path', () => {
  const places = { cwd: '/tmp/proj', home: '/Users/me' }
  expect(shortenPaths('see /tmp/proj/tests/x.py', places)).toBe('see tests/x.py')
  expect(shortenPaths('see /private/tmp/proj/tests/x.py', places)).toBe('see /private/tmp/proj/tests/x.py')
  expect(shortenPaths('open file:///Users/me/a.txt', places)).toBe('open file:///Users/me/a.txt')
})

test('the failure reason skips stack frames and runtime banners', () => {
  expect(errorReason('Exit code 1\nTypeError: boom\n    at run (app.js:3:9)\n    at main (app.js:9:1)\n\nNode.js v20.19.6')).toBe('TypeError: boom')
})

test('toolOutput quiet labels skills and PowerShell, and hides the skill result', { options: { toolOutput: 'quiet', toolStyle: 'classic' } }, async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const skill = await $.ui.mount({ plugin: 'merman', surface, component: 'ToolUse', props: call('Skill', { skill: 'kolibee:do-review', args: '--branch' }, `s-${surface}`) })
    expect(await skill.find({ type: 'Text', text: /^Loaded skill kolibee:do-review --branch$/ })).toBeDefined()
    const done = await $.ui.mount({ plugin: 'merman', surface, component: 'ToolResult', props: { tool_use_id: `s-${surface}`, tool: 'Skill', output: 'Successfully loaded skill', isErrored: false } })
    expect(await done.find({ type: 'Text', text: /^engine$/ })).toBeUndefined()
    await done.unmount()
    await skill.unmount()
    const pwsh = await $.ui.mount({ plugin: 'merman', surface, component: 'ToolUse', props: call('PowerShell', { command: 'cat C:\\Users\\me\\notes.md' }, `p-${surface}`) })
    expect(await pwsh.find({ type: 'Text', text: /^Ran cat C:\\Users\\me\\notes\.md$/ })).toBeDefined()
    await pwsh.unmount()
  }
})

test('toolOutput quiet leaves background and image shell results to the engine', { options: { toolOutput: 'quiet' } }, async ($, on) => {
  engine(on)
  for (const [id, output] of [['b-1', { stdout: '', stderr: '', backgroundTaskId: 'task-7' }], ['b-2', { stdout: 'iVBORw0KGgo', stderr: '', isImage: true }], ['b-3', { stdout: 'partial', stderr: '', interrupted: true }]] as const) {
    const use = await $.ui.mount({ plugin: 'merman', surface: 'terminal', component: 'ToolUse', props: call('Bash', { command: 'make watch' }, id) })
    const out = await $.ui.mount({ plugin: 'merman', surface: 'terminal', component: 'ToolResult', props: { tool_use_id: id, tool: 'Bash', output, isErrored: false } })
    expect(await out.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
    await out.unmount()
    await use.unmount()
  }
})

const result = (tool: string, input: unknown, id: string) => [
  { plugin: 'merman', surface: 'terminal' as const, component: 'ToolUse' as const, props: call(tool, input, id) },
  { plugin: 'merman', surface: 'terminal' as const, component: 'ToolResult' as const, props: { tool_use_id: id, tool, output: { stdout: 'file contents' }, isErrored: false } },
] as const

test('toolOutput quiet hides the result of read-only calls only', { options: { toolOutput: 'quiet' } }, async ($, on) => {
  engine(on)
  const cases: [string, unknown, string, boolean][] = [
    ['Bash', { command: 'sed -n 1,20p app.py' }, 'q-1', false],
    ['Edit', { file_path: '/tmp/app.ts' }, 'q-2', true],
  ]
  for (const [tool, input, id, shown] of cases) {
    const [use, res] = result(tool, input, id)
    const row = await $.ui.mount(use)
    const out = await $.ui.mount(res)
    expect((await out.find({ type: 'Text', text: /^engine$/ })) !== undefined).toBe(shown)
    if (!shown) expect(await out.find({ type: 'Text', text: /file contents/ })).toBeUndefined()
    await out.unmount()
    await row.unmount()
  }
})

test('toolOutput quiet shows why a call failed instead of only its exit code', { options: { toolOutput: 'quiet' } }, async ($, on) => {
  engine(on)
  const out = await $.ui.mount({
    plugin: 'merman',
    surface: 'terminal',
    component: 'ToolResult',
    props: { tool_use_id: 'e-1', tool: 'Bash', output: 'Error: Exit code 1\ncat: missing.txt: No such file or directory', isErrored: true },
  })
  expect(await out.find({ type: 'Text', text: /No such file or directory$/ })).toBeDefined()
  expect(await out.find({ type: 'Text', text: /^engine$/ })).toBeUndefined()
  await out.unmount()
})

const REFUSED = 'Permission for this action was denied by the Claude Code auto mode classifier. Reason: Blocked by classifier. If you have other tasks that do not depend on this action, continue with those.'

test('a refused call keeps its whole reason, a failed command only its last line', () => {
  expect(refusalReason(REFUSED)).toBe(REFUSED)
  expect(refusalReason('The user doesn\'t want to proceed with this tool use.\nThe tool use was rejected.')).toBe('The user doesn\'t want to proceed with this tool use. The tool use was rejected.')
  expect(refusalReason('Exit code 1\ncat: missing.txt: No such file or directory')).toBeUndefined()
  expect(refusalReason({ stdout: '', stderr: 'denied' })).toBeUndefined()
  expect(refusalReason('Error: 405 Method Not Allowed\n<html>request blocked</html>')).toBeUndefined()
  expect(refusalReason('PreToolUse:Bash hook error: [protect-main.sh]: Blocked: HEAD is on main.')).toBe('PreToolUse:Bash hook error: [protect-main.sh]: Blocked: HEAD is on main.')
  expect(refusalReason('Error: PreToolUse:Bash hook error: ["$CLAUDE_PROJECT_DIR"/.claude/hooks/guard.sh]: Blocked: HEAD is on main.')).toBe('Error: PreToolUse:Bash hook error: ["$CLAUDE_PROJECT_DIR"/.claude/hooks/guard.sh]: Blocked: HEAD is on main.')
})

test('a refused call inside a collapsed quiet group keeps its whole reason too', { options: { toolOutput: 'quiet', toolStyle: 'classic' } }, async $ => {
  const refused = { ...call('Bash', { command: 'cat secrets.txt' }, 'g-2'), isErrored: true, output: REFUSED }
  const group = await $.ui.mount({
    plugin: 'merman',
    surface: 'terminal',
    component: 'ToolGroup',
    props: { calls: [call('Read', { file_path: 'AGENTS.md' }, 'g-1'), refused], isActive: false, isExpanded: false },
  })
  const text = await group.find({ type: 'Text', text: /Reason: Blocked by classifier\. If you have other tasks/ })
  expect(text).toBeDefined()
  expect(text?.props.wrap).toBe('wrap')
  await group.unmount()
})

test('toolOutput quiet shows the full reason of a refused call, wrapped and not cut', { options: { toolOutput: 'quiet' } }, async ($, on) => {
  engine(on)
  const out = await $.ui.mount({
    plugin: 'merman',
    surface: 'terminal',
    component: 'ToolResult',
    props: { tool_use_id: 'r-1', tool: 'Bash', output: REFUSED, isErrored: true },
  })
  const text = await out.find({ type: 'Text', text: /Reason: Blocked by classifier\. If you have other tasks/ })
  expect(text).toBeDefined()
  expect(text?.props.wrap).toBe('wrap')
  expect(await out.find({ type: 'Text', text: /^engine$/ })).toBeUndefined()
  await out.unmount()
})

test('the call memory is capped and forgets the oldest ids first', () => {
  const calls = new Set<string>()
  for (let i = 0; i < 5; i++) rememberCall(calls, `c${i}`, 3)
  expect([...calls]).toEqual(['c2', 'c3', 'c4'])
})

test('a collapsed quiet group still shows the first lines of a shell command that is not a read', { options: { toolOutput: 'quiet', toolStyle: 'classic' } }, async $ => {
  const read = { ...call('Bash', { command: 'sed -n 1,4p app.py' }, 'g-3'), output: { stdout: 'file contents\n', stderr: '' } }
  const tests = { ...call('Bash', { command: 'python3 -m unittest -v', description: 'Run the unit tests' }, 'g-4'), output: { stdout: '', stderr: 'test_one ... ok\ntest_two ... ok\n\nOK\n' } }
  const group = await $.ui.mount({ plugin: 'merman', surface: 'terminal', component: 'ToolGroup', props: { calls: [read, tests], isActive: false, isExpanded: false } })
  expect(await group.find({ type: 'Text', text: /^test_one \.\.\. ok$/ })).toBeDefined()
  expect(await group.find({ type: 'Text', text: /^… \+1 lines$/ })).toBeDefined()
  expect(await group.find({ type: 'Text', text: /file contents/ })).toBeUndefined()
  await group.unmount()
})

test('toolOutput quiet draws shell results itself, a few lines and no approval line', { options: { toolOutput: 'quiet' } }, async ($, on) => {
  engine(on)
  const use = await $.ui.mount({ plugin: 'merman', surface: 'terminal', component: 'ToolUse', props: call('Bash', { command: 'make test' }, 'w-1') })
  const out = await $.ui.mount({
    plugin: 'merman',
    surface: 'terminal',
    component: 'ToolResult',
    props: { tool_use_id: 'w-1', tool: 'Bash', output: { stdout: 'one\ntwo\nthree\nfour\nfive\n', stderr: '' }, isErrored: false },
  })
  expect(await out.find({ type: 'Text', text: /^one$/ })).toBeDefined()
  expect(await out.find({ type: 'Text', text: /^four$/ })).toBeUndefined()
  expect(await out.find({ type: 'Text', text: /^… \+2 lines$/ })).toBeDefined()
  expect(await out.find({ type: 'Text', text: /^engine$/ })).toBeUndefined()
  await out.unmount()
  await use.unmount()
})

test('toolOutput full leaves every result to the engine', async ($, on) => {
  engine(on)
  const [use, res] = result('Bash', { command: 'sed -n 1,20p app.py' }, 'f-1')
  const row = await $.ui.mount(use)
  const out = await $.ui.mount(res)
  expect(await out.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
  await out.unmount()
  await row.unmount()
})

const expand = async ($: Parameters<TestBody>[0], id: string) => {
  const group = await $.ui.mount({
    plugin: 'merman',
    surface: 'terminal',
    component: 'ToolGroup',
    props: { calls: [call('Bash', { command: 'ls' }, id)], isActive: false, isExpanded: true },
  })
  await group.unmount()
}

test('expanded non-shell rows go back to the engine so their output shows', async ($, on) => {
  engine(on)
  await expand($, 'exp-1')
  const row = await $.ui.mount({
    plugin: 'merman',
    surface: 'terminal',
    component: 'ToolUse',
    props: { ...call('Read', { file_path: '/tmp/x' }, 'exp-1'), output: { stdout: 'file' } },
  })
  expect(await row.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
  await row.unmount()
})

test('expanded shell rows color the command and show stdout and stderr', async ($, on) => {
  engine(on)
  await expand($, 'exp-2')
  const row = await $.ui.mount({
    plugin: 'merman',
    surface: 'terminal',
    component: 'ToolUse',
    props: { ...call('Bash', { command: 'gh run list --repo "a/b"' }, 'exp-2'), output: { stdout: 'in_progress\n', stderr: 'warn' } },
  })
  expect(await row.find({ type: 'Text', text: /^Bash\($/ })).toBeDefined()
  expect(await paintOf(row, 'gh')).toBeDefined()
  expect(await paintOf(row, '--repo')).toBeDefined()
  expect(await paintOf(row, '"a/b"')).toBeDefined()
  expect(await row.find({ type: 'Text', text: /^in_progress$/ })).toBeDefined()
  expect(await row.find({ type: 'Text', text: /^warn$/ })).toBeDefined()
  await row.unmount()
})

test('expanded shell output is capped so a huge result cannot hit the node limit', async ($, on) => {
  engine(on)
  await expand($, 'exp-3')
  const stdout = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n')
  const row = await $.ui.mount({
    plugin: 'merman',
    surface: 'terminal',
    component: 'ToolUse',
    props: { ...call('Bash', { command: 'seq 5000' }, 'exp-3'), output: { stdout } },
  })
  expect(await row.find({ type: 'Text', text: /^… \+4880 lines$/ })).toBeDefined()
  await row.unmount()
})

test('an expanded shell row with no output says so', async ($, on) => {
  engine(on)
  await expand($, 'exp-4')
  const row = await $.ui.mount({
    plugin: 'merman',
    surface: 'terminal',
    component: 'ToolUse',
    props: { ...call('Bash', { command: 'true' }, 'exp-4'), output: { stdout: '', stderr: '' } },
  })
  expect(await row.find({ type: 'Text', text: /^\(No output\)$/ })).toBeDefined()
  await row.unmount()
})

test('standalone tool rows keep the merman look', async $ => {
  const ui = await $.ui.mount({
    plugin: 'merman',
    surface: 'terminal',
    component: 'ToolUse',
    props: { ...call('Bash', { command: 'ls' }, 'solo-1'), output: { stdout: 'file' } },
  })
  expect(await ui.find({ type: 'Text', text: /^Ran$/ })).toBeDefined()
  await ui.unmount()
})

test('group summaries count by kind', async () => {
  expect(groupSummary([{ tool: 'Grep' }, { tool: 'Grep' }, { tool: 'Edit' }])).toBe('Searched 2 patterns, edited 1 file')
  expect(groupSummary([{ tool: 'WebSearch' }])).toBe('Fetched 1 page')
})

const local = (day: number, h: number, m: number, sec = 0) => new Date(2026, 9, day, h, m, sec).getTime()

test('clock times read as 24h or 12h, with the date when not today', () => {
  const now = local(10, 18, 0)
  expect(clockText(local(10, 14, 32, 5), now, '24h')).toBe('14:32')
  expect(clockText(local(10, 14, 32, 5), now, '12h')).toBe('2:32 PM')
  expect(clockText(local(10, 0, 5), now, '12h')).toBe('12:05 AM')
  expect(clockText(local(9, 23, 5), now, '24h')).toBe('Oct 9 23:05')
})

test('a row takes the newest matching time recorded before it was first drawn', () => {
  const list = [{ text: 'again', at: 1 }, { text: 'hi there', at: 2 }, { text: 'again', at: 3 }]
  expect(sentAt(list, 'again', 2)).toBe(1)
  expect(sentAt(list, ' hi   there\n', 2)).toBe(2)
  expect(sentAt(list, 'again', 3)).toBe(3)
  expect(sentAt(list, 'again', 0)).toBeUndefined()
  expect(sentAt(list, 'never sent', 9)).toBeUndefined()
})

test('slash command output renders as markdown, errors stay native', async ($, on) => {
  engine(on)
  const ok = await $.ui.mount({ plugin: 'merman', surface: 'terminal', component: 'CommandOutput', props: { command: 'cost', args: '', text: '| a | b |\n|---|---|\n| 1 | 2 |', isErrored: false } })
  expect((await ok.find({ type: 'Text', text: /^a$/ }))?.props.color).toBe(t.tableHeader)
  await ok.unmount()
  const bad = await $.ui.mount({ plugin: 'merman', surface: 'terminal', component: 'CommandOutput', props: { command: 'cost', args: '', text: 'boom', isErrored: true } })
  expect(await bad.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
  await bad.unmount()
})

const promptContexts = (on: On) => {
  const seen: (readonly string[] | undefined)[] = []
  mock.env(on, {})
  on('prompt.submit', (_, e) => {
    seen.push(e.context)
    return { text: e.text, context: e.context }
  })
  return seen
}

const carries = (context: readonly string[] | undefined, hint: string) => (context ?? []).some(c => c.includes(hint))

const hinted = (context: readonly string[] | undefined) => carries(context, HINT) && carries(context, FIGURE_HINT)

const ask = ($: Parameters<TestBody>[0], text = 'hi') => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

test('your prompts carry the render hint as model-only context', async ($, on) => {
  const seen = promptContexts(on)
  await ask($, 'show me deploys per day')
  expect(carries(seen[0], 'merman')).toBe(true)
  expect(seen[0]?.some(c => c.includes('fenced block') && c.includes('copy button') && c.includes('language tag'))).toBe(true)
  expect(carries(seen[0], FIGURE_HINT)).toBe(true)
  expect(seen[0]).toHaveLength(1)
})

test('prompts another plugin sends carry the render hint, framed or as your own words, notifications do not', async ($, on) => {
  const seen = promptContexts(on)
  const session = { id: 's1' }
  on('session.id', () => ({ value: session.id }))
  await $.prompt.submit({ text: 'next step', wait: false, origin: { kind: 'plugin', name: 'some-plugin', asUser: true } })
  session.id = 's2'
  await $.prompt.submit({ text: 'build finished', wait: false, origin: { kind: 'plugin', name: 'some-plugin' } })
  session.id = 's3'
  await $.prompt.submit({ text: 'task done', wait: false, origin: { kind: 'task-notification' } })
  expect(seen.map(hinted)).toEqual([true, true, false])
})

test('no render hint when diagramHints is off', { options: { diagramHints: false } }, async ($, on) => {
  const seen = promptContexts(on)
  await ask($)
  expect(seen).toHaveLength(1)
  expect(carries(seen[0], 'merman')).toBe(false)
  expect(carries(seen[0], FIGURE_HINT)).toBe(false)
})

test('no figure hint when mermaid is off', { options: { mermaid: false } }, async ($, on) => {
  const seen = promptContexts(on)
  await ask($)
  expect(seen).toHaveLength(1)
  expect(carries(seen[0], FIGURE_HINT)).toBe(false)
})

test('the render hint rides only the first prompt of a conversation', async ($, on) => {
  const seen = promptContexts(on)
  on('session.id', () => ({ value: 's1' }))
  for (const text of ['one', 'two', 'three']) await ask($, text)
  expect(seen.map(hinted)).toEqual([true, false, false])
})

const SUMMARY = [{ role: 'user' as const, text: 'summary', toolUses: [] }]

test('a compaction puts the render hint on the next prompt again', async ($, on) => {
  const seen = promptContexts(on)
  on('session.id', () => ({ value: 's1' }))
  on('session.compact', () => ({ messages: SUMMARY }))
  await ask($, 'one')
  await ask($, 'two')
  await $.session.compact({ trigger: 'manual', messages: SUMMARY })
  await ask($, 'three')
  await ask($, 'four')
  expect(seen.map(hinted)).toEqual([true, false, true, false])
})

test('a skipped, a precomputed or a sub-agent compaction leaves the render hint where it is', async ($, on) => {
  const seen = promptContexts(on)
  on('session.id', () => ({ value: 's1' }))
  on('session.compact', (_, e) => (e.trigger === 'manual' && e.agentId === undefined ? { skip: 'kept' } : { messages: SUMMARY }))
  await ask($, 'one')
  await $.session.compact({ trigger: 'manual', messages: SUMMARY })
  await $.session.compact({ trigger: 'precompute', messages: SUMMARY })
  await $.session.compact({ trigger: 'auto', agentId: 'sub-agent', messages: SUMMARY })
  await ask($, 'two')
  expect(seen.map(hinted)).toEqual([true, false])
})

test('a new conversation gets the render hint again, a resumed one that still holds it does not', async ($, on) => {
  const seen = promptContexts(on)
  const session = { id: 's1', api: [] as { role: 'user' | 'assistant'; content: { type: string; text: string }[] }[] }
  on('session.id', () => ({ value: session.id }))
  on('session.messages', (_, e) => ({ value: e.as === 'api' ? session.api : [] }))
  await ask($, 'one')
  session.id = 's2'
  await ask($, 'two')
  const held = seen[1]?.find(c => c.includes(HINT)) ?? ''
  session.id = 's3'
  session.api = [{ role: 'user', content: [{ type: 'text', text: 'two' }, { type: 'text', text: `<system-reminder>\n${held}\n</system-reminder>` }] }, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
  await ask($, 'three')
  await ask($, 'four')
  expect(seen.map(hinted)).toEqual([true, true, false, false])
})

test('a compaction that kept the prompt holding the render hint does not send it again', async ($, on) => {
  const seen = promptContexts(on)
  const session = { api: [] as { role: 'user'; content: { type: string; text: string }[] }[] }
  on('session.id', () => ({ value: 's1' }))
  on('session.messages', (_, e) => ({ value: e.as === 'api' ? session.api : [] }))
  on('session.compact', () => ({ messages: SUMMARY }))
  await ask($, 'one')
  session.api = [{ role: 'user', content: [{ type: 'text', text: 'summary' }, { type: 'text', text: seen[0]?.find(c => c.includes(HINT)) ?? '' }] }]
  await $.session.compact({ trigger: 'auto', messages: SUMMARY })
  await ask($, 'two')
  expect(seen.map(hinted)).toEqual([true, false])
})

test('a slash command or a dropped prompt does not use up the render hint', async ($, on) => {
  const seen: (readonly string[] | undefined)[] = []
  mock.env(on, {})
  on('session.id', () => ({ value: 's1' }))
  on('prompt.submit', (_, e) => {
    seen.push(e.context)
    return e.text === 'blocked' ? { drop: 'blocked by policy' } : { text: e.text, context: e.context }
  })
  await $.prompt.submit({ text: '/merman demo', command: { name: 'merman', args: 'demo' }, wait: false, origin: { kind: 'composer' } })
  await ask($, 'blocked')
  await ask($, 'one')
  await ask($, 'two')
  expect(seen.map(hinted)).toEqual([false, true, true, false])
})

test('the issue hint and its option are gone', async ($, on) => {
  const seen = promptContexts(on)
  const session = { id: 's1' }
  on('session.id', () => ({ value: session.id }))
  for (let i = 0; i < 11; i++) {
    session.id = `s${i % 2}`
    await ask($, `prompt ${i}`)
  }
  expect(seen.some(c => carries(c, 'issue'))).toBe(false)
  expect('issueHint' in resolveStyle({})).toBe(false)
})

test('a continuation line joins the list item it is indented under', async () => {
  const [list] = parse('- parent\n  - child\n  more about parent', { numbers: false, paths: false })
  if (list?.kind !== 'list') throw new Error('not a list')
  expect(list.items.map(i => i.inline.map(n => ('text' in n ? n.text : '')).join(''))).toEqual(['parent more about parent', 'child'])
})

test('double-backtick code keeps single backticks inside', async () => {
  const [p] = parse('use ``a `b` c`` here', { numbers: false, paths: false })
  if (p?.kind !== 'paragraph') throw new Error('not a paragraph')
  expect(p.inline.filter(n => n.kind === 'code').map(n => ('text' in n ? n.text : ''))).toEqual(['a `b` c'])
})

test('wide characters take two columns in tables', async $ => {
  const ui = await $.ui.mount({
    plugin: 'merman',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: '| 名前 | n |\n|---|---|\n| 寿司 | 1 |', isFirstOfReply: true },
    viewport: { columns: 120, rows: 40 },
  })
  const shown = await shownLines(ui)
  expect(shown.find(l => l.startsWith('┌'))).toBe(`┌${'─'.repeat(4 + 2)}┬───┐`)
  expect(shown).toContain('│ 寿司 │ 1 │')
  await ui.unmount()
})

test('short columns stay whole next to a very wide one, and a long path is not split', () => {
  expect(columnWidths([2, 5, 20, 161], 96, 3, [2, 3, 9, 38])).toEqual([2, 5, 20, 60])
  expect(columnWidths([2, 45, 80], 86, 3, [2, 45, 7])).toEqual([2, 45, 33])
})

test('a long word takes room from a column that would fit its share', () => {
  expect(columnWidths([100, 40], 90, 2, [60, 5])).toEqual([60, 28])
})

test('columns share the room equally when even the longest words do not fit', () => {
  expect(columnWidths([20, 20], 13, 3, [12, 12])).toEqual([5, 5])
  expect(columnWidths([20, 20, 20], 26, 3, [12, 12, 2])).toEqual([7, 7, 6])
})

test('a long path in a narrow table keeps its column wide enough to stay whole', async $ => {
  const table = [
    '| # | File | Change |',
    '|---|---|---|',
    '| 1 | src/services/reporting/exports/monthly_pdf.py | The monthly export now writes one summary file per region and uploads them after the nightly run |',
  ].join('\n')
  const ui = await $.ui.mount({
    plugin: 'merman',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: table, isFirstOfReply: true },
    viewport: { columns: 90, rows: 40 },
  })
  const shown = await shownLines(ui)
  expect(shown.find(l => l.startsWith('┌'))).toBe(`┌${[1, 45, 30].map(w => '─'.repeat(w + 2)).join('┬')}┐`)
  expect(shown.some(l => l.includes('src/services/reporting/exports/monthly_pdf.py'))).toBe(true)
  await ui.unmount()
})

const FULL = [
  '# merman',
  '',
  'Status: 3 regions in 6m 20s, p95 82ms. Notes in ~/notes/today.md and https://example.com/docs',
  '',
  '| Name | Size |',
  '| :--- | ---: |',
  '| alpha | 5cm |',
  '',
  '1. first',
  '   - nested',
  '',
  '```mermaid',
  'graph LR',
  '  A --> B',
  '```',
  '',
  '```mermaid',
  'sequenceDiagram',
  '  A->>B: hi',
  '```',
  '',
  '```mermaid',
  'xychart-beta',
  '  x-axis [a, b]',
  '  bar [1, 2]',
  '```',
  '',
  '```ts',
  'const x = "y"',
  '```',
  '',
  '```bash',
  'ls -la',
  '```',
  '',
  '> a quote',
].join('\n')

test('a full reply draws every element itself, with the right copy buttons', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({
    plugin: 'merman',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: FULL, isFirstOfReply: true },
    viewport: { columns: 200, rows: 60 },
  })
  expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^Name$/ }))?.props.color).toBe(t.tableHeader)
  const labels = (await ui.findAll({ type: 'Button' })).map(b => b.props.label)
  expect(labels.filter(l => l === '⧉ copy').length).toBe(4)
  expect(labels.filter(l => l === '⧉ md').length).toBe(1)
  expect(labels.filter(l => l === '⧉ source').length).toBe(3)
  expect(labels.filter(l => l === '⧉ art').length).toBe(4)
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props.flexWrap === 'wrap')).toBe(true)
  await ui.unmount()
})

test('headless runs get no render hint', async ($, on) => {
  const seen: (readonly string[] | undefined)[] = []
  mock.env(on, {})
  on('prompt.submit', (_, e) => {
    seen.push(e.context)
    return { text: e.text, context: e.context }
  })
  await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'sdk' } })
  expect(seen).toHaveLength(1)
  expect((seen[0] ?? []).some(c => c.includes('merman'))).toBe(false)
  expect(carries(seen[0], FIGURE_HINT)).toBe(false)
})

test('/merman theme <name> and /merman <name> switch the theme through config', async ($, on) => {
  const writes: { key: string; value: unknown }[] = []
  on('config.set', (_, e) => {
    writes.push({ key: e.key, value: e.value })
    return { value: e.value }
  })
  const result = await $.command.run({ command: 'merman', args: 'theme nord', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(writes).toEqual([{ key: 'merman.theme', value: 'nord' }])
  expect(result.text).toBe('Theme set to nord.')
  const short = await $.command.run({ command: 'merman', args: 'random', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(writes.at(-1)).toEqual({ key: 'merman.theme', value: 'random' })
  expect(short.text).toBe('Theme set to random.')
})

test('/merman random re-rolls on every call once the setting is random', { options: { theme: 'random' } }, async ($, on) => {
  on('config.set', (_, e) => ({ value: e.value }))
  const roll = async () => (await $.command.run({ command: 'merman', args: 'random', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })).text ?? ''
  const first = /^Theme set to random: (\S+) for now\.\nkeep it: \/merman theme \1$/.exec(await roll())?.[1]
  const second = /^Theme set to random: (\S+) for now\./.exec(await roll())?.[1]
  expect(RANDOM_THEMES).toContain(first)
  expect(RANDOM_THEMES).toContain(second)
  expect(second).not.toBe(first)
})

test('/merman rejects unknown themes and lists the real ones', async ($, on) => {
  const writes: unknown[] = []
  on('config.set', (_, e) => {
    writes.push(e.value)
    return { value: e.value }
  })
  const bad = await $.command.run({ command: 'merman', args: 'theme vaporwave', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(writes).toEqual([])
  expect(bad.text?.startsWith('Unknown theme "vaporwave".')).toBe(true)
  const list = await $.command.run({ command: 'merman', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(list.text).toBe(HELP_SHOWN)
  const drawn = await $.ui.mount({ plugin: 'merman', surface: 'terminal', component: 'CommandOutput', props: { command: 'merman', args: '', text: `merman: ${list.text}`, isErrored: false } })
  expect(await drawn.find({ text: /dracula/ })).toBeDefined()
  await drawn.unmount()
})

test('theme random can pick every dark color preset, never mono or a light one, and falls back on junk', async () => {
  const n = RANDOM_THEMES.length
  const picks = RANDOM_THEMES.map((_, i) => pickTheme('random', () => (i + 0.5) / n))
  expect(picks).toEqual([...RANDOM_THEMES])
  expect(RANDOM_THEMES).not.toContain('mono')
  expect(RANDOM_THEMES.some(t => /latte|light|dawn/.test(t))).toBe(false)
  expect(RANDOM_THEMES.length).toBeGreaterThan(5)
  expect(pickTheme('nord')).toBe('nord')
  expect(pickTheme('vaporwave')).toBe('catppuccin-mocha')
})

test('/merman theme reports the random pick and how to keep it', { options: { theme: 'random' } }, async $ => {
  const run = () => $.command.run({ command: 'merman', args: 'theme', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  const first = (await run()).text ?? ''
  const name = /^current: (\S+) \(random\)\nkeep it: \/merman theme (\S+)$/.exec(first)
  expect(name?.[1]).toBe(name?.[2])
  expect((PRESET_NAMES as readonly string[]).includes(name?.[1] ?? '')).toBe(true)
  expect((await run()).text).toBe(first)
})

test('/merman theme reports a fixed theme without the random note', { options: { theme: 'nord' } }, async $ => {
  const result = await $.command.run({ command: 'merman', args: 'theme', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(result.text).toBe('current: nord')
})

test('task list items parse as checked or open, nested ones too', async () => {
  const [list] = parse('- [ ] write tests\n- [x] ship it\n  - [X] nested done\n- plain', { numbers: false, paths: false })
  if (list?.kind !== 'list') throw new Error('not a list')
  expect(list.items.map(i => i.task)).toEqual([false, true, true, undefined])
  expect(list.items[0]?.inline).toEqual([{ kind: 'text', text: 'write tests' }])
})

test('task lists draw brackets and check marks, done items dimmed and struck through', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'merman', component: 'AssistantMessage', props: { text: '- [ ] todo\n- [x] done', isFirstOfReply: true }, viewport: { columns: 80, rows: 20 }, surface })
    expect((await ui.find({ type: 'Text', text: /^\[ \] $/ }))?.props.color).toBe(PRESETS['catppuccin-mocha'].bullet)
    expect(await ui.find({ type: 'Text', text: /^\[✓\] $/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^done$/ }))?.props).toMatchObject({ dimColor: true, strikethrough: true })
    expect((await ui.find({ type: 'Text', text: /^todo$/ }))?.props.dimColor).toBeFalsy()
    await ui.unmount()
  }
})

const tasks = (surface: 'terminal' | 'desktop') => ({ plugin: 'merman', component: 'AssistantMessage' as const, props: { text: '- [ ] todo\n- [x] done', isFirstOfReply: true }, viewport: { columns: 80, rows: 20 }, surface })

test('taskStyle progress draws ticks under a done-count bar', { options: { taskStyle: 'progress' } }, async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(tasks(surface))
    expect(await ui.find({ type: 'Text', text: /^ 1\/2 done$/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^━{10}$/ }))?.props.color).toBe(PRESETS['catppuccin-mocha'].accent)
    expect(await ui.find({ type: 'Text', text: /^○ $/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^✓ $/ }))?.props.color).toBe(PRESETS['catppuccin-mocha'].accent)
    expect((await ui.find({ type: 'Text', text: /^done$/ }))?.props).toMatchObject({ dimColor: true, strikethrough: false })
    await ui.unmount()
  }
})

test('taskStyle box draws a box and a tick', { options: { taskStyle: 'box' } }, async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(tasks(surface))
    expect(await ui.find({ type: 'Text', text: /^□ $/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^✓ $/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ 1\/2 done$/ })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /^done$/ }))?.props.strikethrough).toBe(true)
    await ui.unmount()
  }
})

test('markdown links and bare URLs draw as clickable links', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'merman', component: 'AssistantMessage', props: { text: 'See [the docs](https://example.com/docs) or https://example.com/raw for more.', isFirstOfReply: true }, viewport: { columns: 100, rows: 20 }, surface })
    const links = await ui.findAll({ type: 'Link' })
    expect(links.map(l => l.props.href)).toEqual(['https://example.com/docs', 'https://example.com/raw'])
    expect((await ui.find({ type: 'Text', text: /^the docs$/ }))?.props.color).toBe(t.link)
    expect(await ui.find({ type: 'Text', text: /\(https:\/\/example\.com\/docs\)/ })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /^https:\/\/example\.com\/raw$/ }))?.props.color).toBe(t.link)
    await ui.unmount()
  }
})

const run = (args: string) => ({ command: 'merman', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 120 } })

const transcript = (on: On, messages: { role: 'user' | 'assistant'; text: string }[]) => {
  const copied: string[] = []
  on('session.messages', () => ({ value: messages.map(m => ({ ...m, toolUses: [] })) }))
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  return copied
}

test('/merman copy copies the last reply without a mouse', async ($, on) => {
  const copied = transcript(on, [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'old' }, { role: 'user', text: 'again' }, { role: 'assistant', text: 'שלום, the newest reply' }])
  const result = await $.command.run(run('copy'))
  expect(copied).toEqual(['שלום, the newest reply'])
  expect(result.text).toBe('Copied the last reply.')
})

test('/merman copy code copies the last code block of the last reply', async ($, on) => {
  const copied = transcript(on, [{ role: 'assistant', text: 'Run:\n\n```bash\nls\n```\n\nthen:\n\n```bash\nnpm test\n```' }])
  const result = await $.command.run(run('copy code'))
  expect(copied).toEqual(['npm test'])
  expect(result.text).toBe('Copied the last code block.')
})

test('/merman copy code finds a code block under a list item', async ($, on) => {
  const copied = transcript(on, [{ role: 'assistant', text: '1. Setup:\n   ```bash\n   npm i\n   ```\n2. Next' }])
  await $.command.run(run('copy code'))
  expect(copied).toEqual(['npm i'])
})

test('/merman copy code finds a code block inside a quote', async ($, on) => {
  const copied = transcript(on, [{ role: 'assistant', text: '> Try:\n>\n> ```bash\n> npm ci\n> ```' }])
  await $.command.run(run('copy code'))
  expect(copied).toEqual(['npm ci'])
})

test('/merman copy says so when there is nothing to copy', async ($, on) => {
  const copied = transcript(on, [{ role: 'assistant', text: 'no code here' }])
  expect((await $.command.run(run('copy code'))).text).toBe('The last reply has no code block.')
  expect(copied).toEqual([])
})

const prompt = (text: string, kind: 'composer' | 'task-notification' = 'composer', surface: 'terminal' | 'desktop' = 'terminal') =>
  ({ plugin: 'merman', component: 'UserMessage' as const, props: { text, origin: { kind } as never, isExpanded: true }, viewport: { columns: 80, rows: 10 }, surface })

test('your prompts draw in a rounded accent bubble by default', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(prompt('how many frog raids?', 'composer', surface))
    const bubble = (await ui.findAll({ type: 'Box' })).find(b => b.props.borderStyle === 'round')
    expect(bubble?.props.borderColor).toBe(PRESETS['catppuccin-mocha'].accent)
    expect((await ui.find({ type: 'Text', text: /^how many frog raids\?$/ }))?.props.color).toBe(PRESETS['catppuccin-mocha'].heading)
    await ui.unmount()
  }
})

test('a pasted block in your prompt is its own frame, folded to a button that opens it as highlighted code', async $ => {
  const ui = await $.ui.mount(prompt('look\n<pasted_content id="9649">\n{\n  "on": true\n}\n</pasted_content id="9649">\nseems obvious!'))
  const button = (await ui.findAll({ type: 'Button' })).find(b => b.props.label === 'pasted text · 3 lines')
  expect(button).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^seems obvious!$/ })).toBeDefined()
  expect(JSON.stringify(await ui.drawn())).not.toMatch(/pasted_content|"on"/)
  await ui.press({ key: button!.key! })
  expect((await ui.find({ type: 'Text', text: /^true$/ }))?.props.color).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^── json$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Button' })).some(b => b.props.label === 'show less')).toBe(true)
  await ui.unmount()
})

test('promptStyle wide draws the bubble across the full width', { options: { promptStyle: 'wide' } }, async $ => {
  const ui = await $.ui.mount(prompt('hi'))
  expect((await ui.findAll({ type: 'Box' })).find(b => b.props.borderStyle === 'round')?.props.width).toBe('100%')
  await ui.unmount()
})

test('the default bubble fits its text', async $ => {
  const ui = await $.ui.mount(prompt('hi'))
  expect((await ui.findAll({ type: 'Box' })).find(b => b.props.borderStyle === 'round')?.props.width).toBeUndefined()
  await ui.unmount()
})

test('promptStyle bar draws an accent bar', { options: { promptStyle: 'bar' } }, async $ => {
  const ui = await $.ui.mount(prompt('hi'))
  expect((await ui.find({ type: 'Text', text: /^▌ $/ }))?.props.color).toBe(PRESETS['catppuccin-mocha'].accent)
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props.borderStyle)).toBe(false)
  await ui.unmount()
})

test('promptStyle chevron draws a bold accent prompt', { options: { promptStyle: 'chevron' } }, async $ => {
  const ui = await $.ui.mount(prompt('hi'))
  expect(await ui.find({ type: 'Text', text: /^› $/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^hi$/ }))?.props).toMatchObject({ bold: true, color: PRESETS['catppuccin-mocha'].accent })
  await ui.unmount()
})

test('promptStyle off and task notifications keep the engine look', { options: { promptStyle: 'off' } }, async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(prompt('hi'))
  expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
  await ui.unmount()
})

test('clock puts the send time before your prompt', { options: { clock: '24h' } }, async ($, on) => {
  mock.clock(on, { now: local(10, 9, 7, 3) })
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  await $.prompt.submit({ text: 'how many frog raids?', wait: false, origin: { kind: 'composer' } })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...prompt('how many frog raids?', 'composer', surface), requestId: 'row-1' })
    expect((await ui.find({ type: 'Text', text: /^09:07 $/ }))?.props.color).toBe(t.codeComment)
    await ui.unmount()
  }
  const unsent = await $.ui.mount(prompt('typed before this session'))
  expect(await unsent.find({ type: 'Text', text: /^\d\d:\d\d $/ })).toBeUndefined()
  await unsent.unmount()
})

test('an old prompt row that redraws after a resume never takes a later send time', { options: { clock: '24h' } }, async ($, on) => {
  const clock = mock.clock(on, { now: local(10, 9, 0) })
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  const old = await $.ui.mount({ ...prompt('again'), requestId: 'old' })
  await clock.advance(60000)
  await $.prompt.submit({ text: 'again', wait: false, origin: { kind: 'composer' } })
  await old.redraw()
  expect(await old.find({ type: 'Text', text: /^\d\d:\d\d $/ })).toBeUndefined()
  const fresh = await $.ui.mount({ ...prompt('again'), requestId: 'new' })
  expect(await fresh.find({ type: 'Text', text: /^09:01 $/ })).toBeDefined()
  await old.unmount()
  await fresh.unmount()
})

test('clock with promptStyle off stamps the engine row', { options: { clock: '24h', promptStyle: 'off' } }, async ($, on) => {
  mock.clock(on, { now: local(10, 9, 7) })
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.component === 'UserMessage' ? String(e.props.text) : 'engine'}</Text>
  })
  await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
  const ui = await $.ui.mount(prompt('hi'))
  expect(await ui.find({ type: 'Text', text: /^\[09:07\] hi$/ })).toBeDefined()
  await ui.unmount()
})

test('task notifications are not drawn as your prompt', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(prompt('task done', 'task-notification'))
  expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
  await ui.unmount()
})

test('a Hebrew prompt bubble sits on the right', { options: { rtl: 'warp' } }, async $ => {
  const ui = await $.ui.mount(prompt('כמה פשיטות היו השבוע?'))
  expect((await ui.findAll({ type: 'Box' })).find(b => b.props.borderStyle === 'round')?.props.alignSelf).toBe('flex-end')
  await ui.unmount()
})

test('an unstamped prompt is yours, a teammate message is not', async ($, on) => {
  engine(on)
  const mine = await $.ui.mount(prompt('typed on the command line', 'unclassified' as never))
  expect((await mine.findAll({ type: 'Box' })).some(b => b.props.borderStyle === 'round')).toBe(true)
  await mine.unmount()
  const peer = await $.ui.mount({ ...prompt('from a teammate', 'unclassified' as never), props: { text: 'from a teammate', origin: { kind: 'unclassified' } as never, isExpanded: true, from: { name: 'bob' } as never } })
  expect(await peer.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
  await peer.unmount()
})

const readRow = { plugin: 'merman', component: 'ToolUse' as const, props: call('Read', { file_path: '/tmp/x' }, 'ts-1'), viewport: { columns: 100, rows: 10 }, surface: 'terminal' as const }

test('chat puts tool rows on the right, dimmed, by default', async $ => {
  const ui = await $.ui.mount(readRow)
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props.justifyContent === 'flex-end')).toBe(true)
  expect(await ui.find({ type: 'Text', text: /⎿/ })).toBeUndefined()
  expect((await ui.findAll({ type: 'Text' })).find(t => t.props.wrap === 'truncate-end')?.props.dimColor).toBe(true)
  await ui.unmount()
})

test('toolStyle tree-dim tucks tool rows under the sentence', { options: { toolStyle: 'tree-dim' } }, async $ => {
  const ui = await $.ui.mount(readRow)
  expect((await ui.find({ type: 'Text', text: /^ {2}⎿ $/ }))?.props.color).toBe(PRESETS['catppuccin-mocha'].number)
  expect((await ui.findAll({ type: 'Text' })).find(t => t.props.wrap === 'truncate-end')?.props.dimColor).toBe(true)
  await ui.unmount()
})

test('toolStyle classic is the original look', { options: { toolStyle: 'classic' } }, async $ => {
  const ui = await $.ui.mount(readRow)
  expect(await ui.find({ type: 'Text', text: /⎿/ })).toBeUndefined()
  expect((await ui.findAll({ type: 'Text' })).find(t => t.props.wrap === 'truncate-end')?.props.dimColor).toBe(false)
  await ui.unmount()
})

test('toolStyle tree-bold draws one-line narration in bold', { options: { toolStyle: 'tree-bold' } }, async $ => {
  const one = await $.ui.mount({ plugin: 'merman', component: 'AssistantMessage', props: { text: 'Checking the tests next.', isFirstOfReply: true }, viewport: { columns: 80, rows: 10 }, surface: 'terminal' })
  expect((await one.find({ type: 'Text', text: /^Checking the tests next\.$/ }))?.props.bold).toBe(true)
  await one.unmount()
  const long = await $.ui.mount({ plugin: 'merman', component: 'AssistantMessage', props: { text: 'First.\n\nSecond.', isFirstOfReply: true }, viewport: { columns: 80, rows: 10 }, surface: 'terminal' })
  expect((await long.find({ type: 'Text', text: /^First\.$/ }))?.props.bold).toBeFalsy()
  await long.unmount()
})

test('slash command output with terminal escape codes is left to the engine', async ($, on) => {
  engine(on)
  const colored = await $.ui.mount({ plugin: 'merman', surface: 'terminal', component: 'CommandOutput', props: { command: 'context', args: '', text: '\u001b[1mContext Usage\u001b[22m\n\u001b[38;5;246m⛁ 3.8k tokens\u001b[39m', isErrored: false } })
  expect(await colored.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
  await colored.unmount()
})

test('tool rows show paths relative to the project, and ~ for the home directory', async ($, on) => {
  mock.env(on, { HOME: '/home/demo' })
  on('session.root', () => ({ value: '/home/demo/tank-monitor' }))
  const row = async (file_path: string) => {
    const ui = await $.ui.mount({ plugin: 'merman', component: 'ToolUse', props: call('Read', { file_path }, `p-${file_path}`), viewport: { columns: 100, rows: 10 }, surface: 'terminal' })
    const text = (await ui.find({ type: 'Text', text: /^Read / }))?.text
    await ui.unmount()
    return text
  }
  expect(await row('/home/demo/tank-monitor/logs/hourly.csv')).toContain('Read logs/hourly.csv')
  expect(await row('/home/demo/notes/todo.md')).toContain('Read ~/notes/todo.md')
  expect(await row('/etc/hosts')).toContain('Read /etc/hosts')
  const group = await $.ui.mount({ plugin: 'merman', component: 'ToolGroup', props: { calls: [call('Read', { file_path: '/home/demo/tank-monitor/src/pool.ts' }, 'g1')], isActive: false, isExpanded: false }, viewport: { columns: 100, rows: 10 }, surface: 'terminal' })
  expect(await group.find({ type: 'Text', text: /last: src\/pool\.ts$/ })).toBeDefined()
  await group.unmount()
})

test('tool rows shorten Windows paths against a backslashed root, with USERPROFILE as home', async ($, on) => {
  mock.env(on, { USERPROFILE: 'C:\\Users\\demo' })
  on('session.root', () => ({ value: 'C:\\Users\\demo\\tank-monitor' }))
  const row = async (file_path: string) => {
    const ui = await $.ui.mount({ plugin: 'merman', component: 'ToolUse', props: call('Read', { file_path }, `w-${file_path}`), viewport: { columns: 100, rows: 10 }, surface: 'terminal' })
    const text = (await ui.find({ type: 'Text', text: /^Read / }))?.text
    await ui.unmount()
    return text
  }
  expect(await row('C:\\Users\\demo\\tank-monitor\\logs\\hourly.csv')).toContain('Read logs\\hourly.csv')
  expect(await row('c:\\users\\demo\\notes\\todo.md')).toContain('Read ~\\notes\\todo.md')
  expect(await row('D:\\other\\hosts')).toContain('Read D:\\other\\hosts')
})

test('drive-letter roots match case-insensitively and with any separator, POSIX roots stay exact', () => {
  const windows = { cwd: 'E:\\p\\app\\', home: 'E:\\p' }
  expect(shortTarget(windows, 'E:\\p\\app\\src\\main.ts')).toBe('src\\main.ts')
  expect(shortTarget(windows, 'e:/p/app/src/main.ts')).toBe('src/main.ts')
  expect(shortTarget(windows, 'E:\\p\\notes.md')).toBe('~\\notes.md')
  expect(shortTarget(windows, 'E:\\p\\app2\\x.ts')).toBe('~\\app2\\x.ts')
  expect(shortTarget(windows, 'D:\\p\\app\\x.ts')).toBe('D:\\p\\app\\x.ts')
  const posix = { cwd: '/home/dev/app', home: '/home/dev' }
  expect(shortTarget(posix, '/home/dev/App/x.ts')).toBe('~/App/x.ts')
  expect(shortTarget(posix, '/home/dev/app/x.ts')).toBe('x.ts')
})

test('git --output and awk -f are not reads, and an error starting with "at" is not stack noise', () => {
  const shell = (command: string) => isReadOnlyCall('Bash', { command })
  expect(shell('git log --oneline -5')).toBe(true)
  expect(shell('git log --output=log.txt')).toBe(false)
  expect(shell('git diff --output patch.diff')).toBe(false)
  expect(shell("awk -F, '{print $1}' data.csv")).toBe(true)
  expect(shell('awk -f transform.awk data.csv')).toBe(false)
  expect(errorReason('at least one tank id is required')).toBe('at least one tank id is required')
  expect(errorReason('TypeError: boom\n    at run (/app/src/pool.ts:12:5)\n    at main.js:3:1')).toBe('TypeError: boom')
})

test('tool row paths follow the project root after a worktree move', async ($, on) => {
  mock.env(on, { HOME: '/home/demo' })
  let root = '/home/demo/tank-monitor'
  on('session.root', () => ({ value: root }))
  const row = async (file_path: string, id: string) => {
    const ui = await $.ui.mount({ plugin: 'merman', component: 'ToolUse', props: call('Read', { file_path }, id), viewport: { columns: 100, rows: 10 }, surface: 'terminal' })
    const text = (await ui.find({ type: 'Text', text: /^Read / }))?.text
    await ui.unmount()
    return text
  }
  expect(await row('/home/demo/tank-monitor/src/pool.ts', 'w1')).toContain('Read src/pool.ts')
  root = '/home/demo/worktrees/tank-monitor-fix'
  expect(await row('/home/demo/worktrees/tank-monitor-fix/src/pool.ts', 'w2')).toContain('Read src/pool.ts')
})

test('/merman random redraws replies in the new pick', { options: { theme: 'random' } }, async ($, on) => {
  on('config.set', (_, e) => ({ value: e.value }))
  const heading = async () => {
    const ui = await $.ui.mount({ plugin: 'merman', surface: 'terminal', component: 'AssistantMessage', props: { text: '# Tanks', isFirstOfReply: true }, viewport: { columns: 120, rows: 40 } })
    const color = (await ui.find({ type: 'Text', text: /^Tanks$/ }))?.props.color
    await ui.unmount()
    return color
  }
  const run = await $.command.run({ command: 'merman', args: 'random', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  const picked = /^Theme set to random: (\S+) for now/.exec(run.text ?? '')?.[1] ?? ''
  const want = (PRESETS as Record<string, { heading?: string }>)[picked]?.heading
  expect(want).toBeDefined()
  expect(await heading()).toBe(want)
})

const patch = { filePath: '/tmp/app.ts', structuredPatch: [{ oldStart: 4, newStart: 4, lines: [' const a = 1', '-const b = 2', '+const b = 3', '+const c = 4'] }] }
const editResult = (surface: 'terminal' | 'desktop' | 'mobile', tool: string, output: unknown, isErrored = false) =>
  ({ plugin: 'merman', surface, component: 'ToolResult' as const, props: { tool_use_id: `d-${surface}`, tool, output, isErrored } })

const overwrite = (filePath: string, content: string) => {
  const added = content.split('\n')
  return { type: 'update', filePath, content, originalFile: '', structuredPatch: [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: added.length, lines: added.map(l => `+${l}`) }] }
}

test('diff lines number old and new sides', () => {
  expect(diffLines(patch)?.map(r => `${r.num}${r.mark}${r.text}`)).toEqual(['4 const a = 1', '5-const b = 2', '5+const b = 3', '6+const c = 4'])
  expect(diffLines({ type: 'create', content: 'one\ntwo\n', structuredPatch: [] })).toBeUndefined()
  expect(diffLines({ stdout: 'x' })).toBeUndefined()
  expect(diffLines('Updated file')).toBeUndefined()
})

for (const toolOutput of ['full', 'quiet'] as const) {
  test(`edits draw a diff card with counts and colored lines (toolOutput ${toolOutput})`, { options: { toolOutput } }, async ($, on) => {
    engine(on)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount(editResult(surface, 'Edit', patch))
      expect((await ui.find({ type: 'Text', text: /^\+2$/ }))?.props.color).toBe(t.number)
      expect((await ui.find({ type: 'Text', text: /^−1$/ }))?.props.color).toBe(t.codeFlag)
      expect((await ui.find({ type: 'Text', text: /^\+ $/ }))?.props.color).toBe(t.number)
      expect((await ui.find({ type: 'Text', text: /^- $/ }))?.props.color).toBe(t.codeFlag)
      expect((await ui.find({ type: 'Text', text: /^const a = 1$/ }))?.props.dimColor).toBeUndefined()
      const row = (text: RegExp) => ui.find({ type: 'Box', text })
      expect((await row(/^6 \+ const c = 4$/))?.props.backgroundColor).toBe(diffTint(t.codeText, t.number))
      expect((await row(/^5 - const b = 2$/))?.props.backgroundColor).toBe(diffTint(t.codeText, t.codeFlag))
      expect((await row(/^4   const a = 1$/))?.props.backgroundColor).toBeUndefined()
      expect((await ui.find({ type: 'Text', text: /^const c = 4$/ }))?.props.color).toBe(t.codeText)
      expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeUndefined()
      await ui.unmount()
    }
  })
}

test('a long diff card folds to 20 lines, opens on press up to 400, and folds back', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const content = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join('\n')
    const ui = await $.ui.mount(editResult(surface, 'Write', overwrite('/tmp/new.txt', content)))
    expect(await ui.find({ type: 'Text', text: /^\+25$/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^−0$/ }))?.props.dimColor).toBe(true)
    expect((await ui.find({ type: 'Text', text: /^\+25$/ }))?.props.dimColor).toBe(false)
    expect(await ui.find({ type: 'Text', text: /^line 20$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^line 21$/ })).toBeUndefined()
    expect((await ui.find({ key: 'fold' }))?.props.label).toBe('+5 more lines')
    await ui.press({ key: 'fold' })
    expect(await ui.find({ type: 'Text', text: /^line 25$/ })).toBeDefined()
    expect((await ui.find({ key: 'fold' }))?.props.label).toBe('show less')
    await ui.press({ key: 'fold' })
    expect(await ui.find({ type: 'Text', text: /^line 21$/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('an opened diff card stops at 400 lines and counts the rest', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const content = Array.from({ length: 450 }, (_, i) => `line ${i + 1}`).join('\n')
    const ui = await $.ui.mount(editResult(surface, 'Write', overwrite('/tmp/big.txt', content)))
    await ui.press({ key: 'fold' })
    expect(await ui.find({ type: 'Text', text: /^line 400$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^line 401$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^… \+50 lines$/ })).toBeDefined()
    expect((await ui.findAll({})).length).toBeLessThan(2000)
    await ui.unmount()
  }
})

test('edits the card cannot parse, failed edits and other tools go to the engine', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const [tool, output, isErrored] of [['Edit', 'File updated', false], ['Edit', null, false], ['Edit', undefined, false], ['Write', patch, true], ['Read', patch, false]] as const) {
      const ui = await $.ui.mount(editResult(surface, tool, output, isErrored))
      expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
      await ui.unmount()
    }
  }
})

test('edits keep the engine diff when tool rows are off', { options: { toolRows: false } }, async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(editResult('terminal', 'Edit', patch))
  expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
  await ui.unmount()
})

const bashEdit = (stdout = '', more = 0) => ({
  stdout,
  stderr: '',
  interrupted: false,
  bashEditDiff: {
    files: [
      { filePath: '/home/demo/app/src/app.ts', hunks: patch.structuredPatch.map(h => ({ ...h, oldLines: 2, newLines: 3 })) },
      { filePath: '/home/demo/app/NOTES.md', hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, lines: ['+one', '+two'] }], created: true },
    ],
    moreFiles: more,
  },
})

test('shell edits read a diff per changed file, the lines of each new file, and a count of files not shown', () => {
  expect(bashEdits(bashEdit('', 3))?.files.map(f => (f.kind === 'modified' ? [f.path, f.rows.map(r => `${r.num}${r.mark}${r.text}`)] : f))).toEqual([
    ['/home/demo/app/src/app.ts', ['4 const a = 1', '5-const b = 2', '5+const b = 3', '6+const c = 4']],
    { kind: 'created', path: '/home/demo/app/NOTES.md', lines: ['one', 'two'] },
  ])
  expect(bashEdits(bashEdit('', 3))?.more).toBe(3)
  expect(bashEdits({ stdout: 'x' })).toBeUndefined()
  expect(bashEdits({ bashEditDiff: { files: [], moreFiles: 0 } })).toBeUndefined()
  expect(bashEdits({ bashEditDiff: { files: [{ filePath: '/tmp/a' }], moreFiles: 0 } })).toBeUndefined()
  expect(bashEdits({ bashEditDiff: { files: [null], moreFiles: 0 } })).toBeUndefined()
  expect(withoutBashEdits(bashEdit('hi'))).toEqual({ stdout: 'hi', stderr: '', interrupted: false })
})

for (const toolOutput of ['full', 'quiet'] as const) {
  test(`shell edits draw the same diff card as the Edit tool, one per changed file (toolOutput ${toolOutput})`, { options: { toolOutput } }, async ($, on) => {
    engine(on)
    mock.env(on, { HOME: '/home/demo' })
    on('session.root', () => ({ value: '/home/demo/app' }))
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount(editResult(surface, 'Bash', bashEdit('', 2)))
      expect((await ui.find({ type: 'Text', text: /^src\/app\.ts $/ }))?.props.color).toBe(t.path)
      expect((await ui.find({ type: 'Text', text: /^\+2$/ }))?.props.color).toBe(t.number)
      expect((await ui.find({ type: 'Text', text: /^−1$/ }))?.props.color).toBe(t.codeFlag)
      expect(await ui.find({ type: 'Text', text: /^−0$/ })).toBeUndefined()
      const row = (text: RegExp) => ui.find({ type: 'Box', text })
      expect((await row(/^6 \+ const c = 4$/))?.props.backgroundColor).toBe(diffTint(t.codeText, t.number))
      expect((await row(/^5 - const b = 2$/))?.props.backgroundColor).toBe(diffTint(t.codeText, t.codeFlag))
      expect((await row(/^2 \+ two$/))?.props.backgroundColor).toBe(diffTint(t.codeText, t.number))
      expect(await ui.find({ type: 'Text', text: /^Created NOTES\.md \(2 lines\)$/ })).toBeDefined()
      expect((await ui.find({ type: 'Text', text: /^NOTES\.md$/ }))?.props.color).toBe(t.path)
      expect((await ui.find({ type: 'Text', text: /^const c = 4$/ }))?.props.color).toBe(t.codeText)
      expect((await ui.find({ type: 'Text', text: /^… \+2 more files$/ }))?.props.dimColor).toBe(true)
      expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeUndefined()
      expect((await ui.findAll({ type: 'Text', text: /^  ⎿  $/ })).length).toBe(1)
      await ui.unmount()
    }
  })
}

test('a shell edit with output keeps the engine output, without the engine diff, above the cards', async ($, on) => {
  const seen: unknown[] = []
  on('ui.render', ($, e) => {
    seen.push(e.props && 'output' in e.props ? e.props.output : undefined)
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    seen.length = 0
    const ui = await $.ui.mount(editResult(surface, 'Bash', bashEdit('patched 2 files')))
    expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\+2$/ })).toBeDefined()
    expect(seen).toEqual([{ stdout: 'patched 2 files', stderr: '', interrupted: false }])
    expect(await ui.find({ type: 'Text', text: /^ {5}$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('toolOutput quiet keeps a shell edit diff under the first lines of its output', { options: { toolOutput: 'quiet' } }, async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(editResult('terminal', 'Bash', bashEdit('patched 2 files')))
  expect(await ui.find({ type: 'Text', text: /^patched 2 files$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\+2$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeUndefined()
  await ui.unmount()
})

test('each shell edit card folds on its own', async ($, on) => {
  engine(on)
  const long = Array.from({ length: 25 }, (_, i) => `+line ${i + 1}`)
  const file = (name: string) => ({ filePath: `/tmp/${name}`, hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 25, lines: long }] })
  const ui = await $.ui.mount(editResult('terminal', 'Bash', { stdout: '', stderr: '', interrupted: false, bashEditDiff: { files: [file('a.txt'), file('b.txt')], moreFiles: 0 } }))
  expect((await ui.findAll({ type: 'Text', text: /^line 21$/ })).length).toBe(0)
  await ui.press({ key: 'fold1' })
  expect((await ui.findAll({ type: 'Text', text: /^line 21$/ })).length).toBe(1)
  expect((await ui.find({ key: 'fold0' }))?.props.label).toBe('+5 more lines')
  expect((await ui.find({ key: 'fold1' }))?.props.label).toBe('show less')
  await ui.unmount()
})

test('failed shell edits, diffs the card cannot read and tool rows off go to the engine', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const [output, isErrored] of [[bashEdit(), true], [{ stdout: '', stderr: '', bashEditDiff: { files: [], moreFiles: 0, unavailable: true } }, false], [{ stdout: '', stderr: '', bashEditDiff: { files: [{ filePath: '/tmp/a', hunks: 'x' }], moreFiles: 0 } }, false]] as const) {
      const ui = await $.ui.mount(editResult(surface, 'Bash', output, isErrored))
      expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
      await ui.unmount()
    }
  }
})

const ts = (n: number) => Array.from({ length: n }, (_, i) => `export const n${i + 1} = ${i + 1}`)
const writeNew = (filePath: string, body: string[]) => ({ type: 'create', filePath, content: body.length ? `${body.join('\n')}\n` : '', structuredPatch: [], originalFile: null })
const held = [
  ['Write', { ...overwrite('/tmp/held.ts', 'held'), staged: true }],
  ['Edit', { ...patch, oldString: 'const b = 2', newString: 'const b = 3', originalFile: 'const b = 2\n', staged: true }],
] as const

for (const toolOutput of ['full', 'quiet'] as const) {
  for (const base of [undefined, '2.1.294'] as const) {
    test(`before Claude Code 2.1.295 a file Write creates goes to the engine, as does a write held for review (toolOutput ${toolOutput}, ${base ?? 'version unknown'})`, { options: { toolOutput } }, async ($, on) => {
      engine(on)
      if (base) claudeAt(on, base)
      for (const surface of ['terminal', 'desktop'] as const) {
        for (const [tool, output] of [['Write', writeNew('/tmp/new.ts', ts(25))], ['Write', writeNew('/tmp/empty.ts', [])], ...held] as const) {
          const ui = await $.ui.mount(editResult(surface, tool, output))
          expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
          expect(await ui.find({ type: 'Text', text: /^\+ $/ })).toBeUndefined()
          await ui.unmount()
        }
      }
    })
  }
}

test('a write held for review goes to the engine on Claude Code 2.1.295 too', async ($, on) => {
  engine(on)
  claudeAt(on, '2.1.295')
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const [tool, output] of held) {
      const ui = await $.ui.mount(editResult(surface, tool, output))
      expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
      await ui.unmount()
    }
  }
})

type DrawnNode = { type?: string; key?: string; props?: Record<string, unknown>; hover?: Record<string, unknown>; children?: unknown[] }
const nodesOf = (node: unknown, out: DrawnNode[] = []): DrawnNode[] => {
  if (node === null || typeof node !== 'object') return out
  out.push(node as DrawnNode)
  for (const child of (node as DrawnNode).children ?? []) nodesOf(child, out)
  return out
}
const hoverOf = (node: DrawnNode) => (node.hover ?? node.props?.hover) as { color?: string; backgroundColor?: string; inverse?: boolean } | undefined
const pressOf = async (ui: { drawn: () => Promise<unknown> }) => nodesOf(await ui.drawn()).find(n => n.type === 'Button' && n.props?.plain === true)
const rowsOf = async (ui: { findAll: (q: { type: string }) => Promise<{ key: string | undefined; text: string }[]> }) => {
  const blocks = (await ui.findAll({ type: 'Text' })).map(r => r.text.split('\n').map(l => l.trimEnd())).filter(lines => lines.every(l => /^ *\d+ ( |[+-] )/.test(l)))
  const written = blocks.reduce<string[]>((a, b) => (b.length > a.length ? b : a), [])
  return [...written, ...(await ui.findAll({ type: 'Box' })).filter(b => /^d\d+$/.test(b.key ?? '')).map(b => b.text)]
}
const numberedRows = (lines: string[], mark?: '+' | '-') => lines.map((l, i) => `${String(i + 1).padStart(String(lines.length).length)}${mark ? ` ${mark} ` : '  '}${l}`)

for (const surface of ['terminal', 'desktop'] as const) {
  test(`from Claude Code 2.1.295 merman draws a file Write creates in theme colors with no diff marks, the first 10 lines numbered, on ${surface}`, async ($, on) => {
    engine(on)
    inDemoApp(on)
    claudeAt(on, '2.1.295')
    if (surface === 'terminal' && !(await takesTextButtons($))) return
    const ui = await $.ui.mount(editResult(surface, 'Write', writeNew('/home/demo/app/new.ts', ts(25))))
    await drewItself(ui)
    expect(await ui.find({ type: 'Text', text: /^Created new\.ts \(25 lines\)$/ })).toBeDefined()
    expect((await paintOf(ui, 'export'))?.color).toBe(t.codeFlag)
    expect(await ui.find({ type: 'Text', text: /^[+-] $/ })).toBeUndefined()
    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    expect(await rowsOf(ui)).toEqual(numberedRows(ts(10)))
    expect((await ui.find({ type: 'Text', text: /^ 1 {2}$/ }))?.props).toMatchObject({ color: t.codeComment, dimColor: true })
    const fold = await ui.find({ key: 'fold' })
    expect([fold?.type, fold?.props.variant, fold?.props.label, fold?.children]).toEqual(['Button', 'secondary', '+15 more lines', []])
    expect((await ui.find({ key: 'fold.rows' }))?.type).toBe(surface === 'terminal' ? 'Button' : undefined)
    await ui.press({ key: 'fold' })
    expect(await rowsOf(ui)).toEqual(numberedRows(ts(25)))
    expect((await ui.find({ key: 'fold' }))?.props.label).toBe('show less')
    await ui.press({ key: surface === 'terminal' ? 'fold.rows' : 'fold' })
    expect(await rowsOf(ui)).toEqual(numberedRows(ts(10)))
    if (surface === 'terminal') {
      await ui.press({ key: 'fold.rows' })
      expect((await rowsOf(ui)).length).toBe(25)
    }
    expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeUndefined()
    await ui.unmount()
  })
}

const DENSE = [
  ['/tmp/big.ts', Array.from({ length: 450 }, (_, i) => `const v${i} = await fetch("/api/${i}", { retries: ${i % 5}, cache: false, tags: ["a", "b"] }) // try ${i}`)],
  ['/tmp/big.json', Array.from({ length: 450 }, (_, i) => `  { "id": ${i}, "name": "n${i}", "on": ${i % 2 === 0}, "tags": ["a", "b"], "size": ${i * 3} },`)],
] as const

test('an opened 450-line new file shows 400 lines, counts the rest and stays well under the node ceiling, strings counted', { timeoutMs: 20000 }, async ($, on) => {
  engine(on)
  claudeAt(on, '2.1.295')
  const pressable = await takesTextButtons($)
  for (const surface of ['terminal', 'desktop'] as const) {
    if (surface === 'terminal' && !pressable) continue
    for (const [path, body] of DENSE) {
      const mounted = editResult(surface, 'Write', writeNew(path, [...body]))
      const ui = await $.ui.mount({ ...mounted, props: { ...mounted.props, tool_use_id: `${path}-${surface}` } })
      await drewItself(ui)
      await ui.press({ key: 'fold' })
      const rows = await rowsOf(ui)
      expect(rows.length).toBe(400)
      expect(rows.at(-1)?.startsWith('400  ')).toBe(true)
      expect(await ui.find({ text: /^… \+50 lines$/ })).toBeDefined()
      expect((await ui.find({ key: 'fold' }))?.props.label).toBe('show less')
      expect(nodeCount(await ui.drawn())).toBeLessThan(10000)
      await ui.unmount()
    }
  }
})

test('the click-anywhere preview of a new file lights a theme band on hover, never inverse, and keeps the gutter dim', async ($, on) => {
  engine(on)
  claudeAt(on, '2.1.295')
  if (!(await takesTextButtons($))) return
  const ui = await $.ui.mount(editResult('terminal', 'Write', writeNew('/tmp/new.ts', ts(25))))
  await drewItself(ui)
  const button = await pressOf(ui)
  const band = previewBand(t, PRESET_BACKGROUNDS['catppuccin-mocha'])!
  expect(hoverOf(button!)).toEqual({ inverse: false, backgroundColor: band })
  expect(hoverOf(nodesOf(button).find(n => n.type === 'Text' && n.children?.[0] === 'Created ')!)).toEqual({ color: onTint(t.codeText, band) })
  const gutters = nodesOf(button).filter(n => n.type === 'Text' && n.props?.dimColor === true && /^ ?\d+ {2}$/.test(String(n.children?.[0])))
  expect(gutters.length).toBe(10)
  expect((await ui.find({ key: 'fold' }))?.props.hover).toBeUndefined()
  await ui.unmount()
})

test('an empty file Write creates says so, with no lines and no button, from Claude Code 2.1.295 on every surface', async ($, on) => {
  engine(on)
  inDemoApp(on)
  claudeAt(on, '2.1.295')
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount(editResult(surface, 'Write', writeNew('/home/demo/app/empty.ts', [])))
    await drewItself(ui)
    expect(await ui.find({ type: 'Text', text: /^Created empty\.ts \(empty\)$/ })).toBeDefined()
    expect(await rowsOf(ui)).toEqual([])
    expect(await ui.find({ type: 'Button' })).toBeUndefined()
    await ui.unmount()
  }
})

test('on mobile a file Write creates opens and folds from its button only, as in the desktop app', async ($, on) => {
  engine(on)
  inDemoApp(on)
  claudeAt(on, '2.1.295')
  const ui = await $.ui.mount(editResult('mobile', 'Write', writeNew('/home/demo/app/new.ts', ts(25))))
  await drewItself(ui)
  expect(await rowsOf(ui)).toEqual(numberedRows(ts(10)))
  expect(await ui.find({ key: 'fold.rows' })).toBeUndefined()
  await ui.press({ key: 'fold' })
  expect(await rowsOf(ui)).toEqual(numberedRows(ts(25)))
  await ui.press({ key: 'fold' })
  expect(await rowsOf(ui)).toEqual(numberedRows(ts(10)))
  await ui.unmount()
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a long line in a new file's preview wraps under its code, not under the line numbers, on ${surface}`, async ($, on) => {
    engine(on)
    claudeAt(on, '2.1.295')
    if (surface === 'terminal' && !(await takesTextButtons($))) return
    const long = Array.from({ length: 12 }, (_, i) => `word${i}`).join(' ')
    const ui = await $.ui.mount({ ...editResult(surface, 'Write', writeNew('/tmp/wrap.txt', [long, ...numbered(11)])), viewport: { columns: 40, rows: 20 } })
    await drewItself(ui)
    const block = (await ui.findAll({ type: 'Text' })).map(n => n.text.split('\n').map(r => r.trimEnd())).find(rows => rows[0] === ' 1  word0 word1 word2 word3 word4')
    expect(block?.slice(0, 4)).toEqual([' 1  word0 word1 word2 word3 word4', '    word5 word6 word7 word8 word9', '    word10 word11', ' 2  line 1'])
    await ui.unmount()
  })
}

test('carriage returns and other control characters never reach a preview or a diff row', async ($, on) => {
  engine(on)
  claudeAt(on, '2.1.295')
  expect(diffLines({ structuredPatch: [{ oldStart: 1, newStart: 1, lines: ['-a\r', '+b\u001b[31m\r'] }] })?.map(r => r.text)).toEqual(['a', 'b'])
  for (const surface of ['terminal', 'desktop'] as const) {
    if (surface === 'terminal' && !(await takesTextButtons($))) continue
    const ui = await $.ui.mount(editResult(surface, 'Write', { ...writeNew('/tmp/crlf.txt', []), content: 'one\r\ntwo\u0007\r\n' }))
    await drewItself(ui)
    expect(await rowsOf(ui)).toEqual(['1  one', '2  two'])
    expect(JSON.stringify(await ui.drawn())).not.toMatch(/\\r|\\u0007/)
    await ui.unmount()
  }
})

test('a clickable long diff with no known width pads no row, so no tint wraps', async ($, on) => {
  engine(on)
  claudeAt(on, '2.1.295')
  if (!(await takesTextButtons($))) return
  const lines = [`+${'x'.repeat(300)}`, ...Array.from({ length: 30 }, (_, i) => `+line ${i}`)]
  const ui = await $.ui.mount(editResult('terminal', 'Edit', { filePath: '/tmp/wide.txt', structuredPatch: [{ oldStart: 1, newStart: 1, lines }] }))
  await drewItself(ui)
  const rows = (await ui.find({ key: 'fold.rows' }))!.text.split('\n').slice(1)
  expect(rows.length).toBe(20)
  expect(rows.filter(r => r !== r.trimEnd())).toEqual([])
  await ui.unmount()
})

const editMade = (filePath: string, body: string[]) => ({
  filePath, oldString: '', newString: `${body.join('\n')}\n`, originalFile: '', userModified: false, replaceAll: false,
  structuredPatch: [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: body.length, lines: body.map(l => `+${l}`) }],
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`an Edit that makes a new file draws its first lines as added diff lines under a Created header before Claude Code 2.1.295 on ${surface}`, async ($, on) => {
    engine(on)
    inDemoApp(on)
    const body = ts(12)
    const ui = await $.ui.mount(editResult(surface, 'Edit', editMade('/home/demo/app/made.ts', body)))
    expect(await ui.find({ type: 'Text', text: /^Created made\.ts \(12 lines\)$/ })).toBeDefined()
    expect(await rowsOf(ui)).toEqual(numberedRows(body.slice(0, 10), '+'))
    expect((await ui.find({ type: 'Box', text: /^ 1 \+ export const n1 = 1$/ }))?.props.backgroundColor).toBe(diffTint(t.codeText, t.diffAdded))
    expect((await ui.findAll({ type: 'Text', text: /^\+ $/ })).map(m => m.props.color)).toEqual(Array(10).fill(t.diffAdded))
    expect(await ui.find({ type: 'Text', text: /^\+12$/ })).toBeUndefined()
    expect(await ui.find({ key: 'fold.rows' })).toBeUndefined()
    expect((await ui.find({ key: 'fold' }))?.props).toMatchObject({ variant: 'secondary', label: '+2 more lines' })
    await ui.press({ key: 'fold' })
    expect((await rowsOf(ui)).length).toBe(12)
    expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeUndefined()
    await ui.unmount()
  })

  test(`an Edit that makes a new file opens from its "+N more lines" button from Claude Code 2.1.295 on ${surface}`, async ($, on) => {
    engine(on)
    inDemoApp(on)
    claudeAt(on, '2.1.295')
    if (surface === 'terminal' && !(await takesTextButtons($))) return
    const ui = await $.ui.mount(editResult(surface, 'Edit', editMade('/home/demo/app/made.ts', ts(12))))
    await drewItself(ui)
    expect((await ui.find({ key: 'fold' }))?.props).toMatchObject({ variant: 'secondary', label: '+2 more lines' })
    expect((await ui.find({ key: 'fold.rows' }))?.type).toBe(surface === 'terminal' ? 'Button' : undefined)
    expect((await ui.find({ key: 'fold.rows' }))?.text.split('\n')[0]).toBe(surface === 'terminal' ? 'Created made.ts (12 lines)' : undefined)
    await ui.press({ key: surface === 'terminal' ? 'fold.rows' : 'fold' })
    expect(await rowsOf(ui)).toEqual(numberedRows(ts(12), '+'))
    expect((await ui.find({ key: 'fold' }))?.props.label).toBe('show less')
    await ui.unmount()
  })
}

test('an Edit that makes a file with no newline at its end is still a new file, not a diff', async ($, on) => {
  engine(on)
  const made = { ...editMade('/tmp/made.ts', ['a', 'b']), newString: 'a\nb' }
  made.structuredPatch[0]!.lines.push('\\ No newline at end of file')
  const ui = await $.ui.mount(editResult('terminal', 'Edit', made))
  expect(await ui.find({ type: 'Text', text: /^Created \/tmp\/made\.ts \(2 lines\)$/ })).toBeDefined()
  expect(await rowsOf(ui)).toEqual(['1 + a', '2 + b'])
  expect(await ui.find({ type: 'Text', text: /^\+2$/ })).toBeUndefined()
  await ui.unmount()
})

test('an Edit into a file that had text stays a diff card, even when it only adds lines', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(editResult('terminal', 'Edit', { ...editMade('/tmp/kept.ts', ['b']), oldString: 'a', originalFile: 'a\n' }))
  expect(await ui.find({ type: 'Text', text: /^\+1$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Created / })).toBeUndefined()
  await ui.unmount()
})

const madeFile = (name: string, body: string[]) =>
  ({ filePath: `/home/demo/app/${name}`, hunks: body.length ? [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: body.length, lines: body.map(l => `+${l}`) }] : [], created: true as const })
const removedFile = (name: string, body: string[]) =>
  ({ filePath: `/home/demo/app/${name}`, hunks: body.length ? [{ oldStart: 1, oldLines: body.length, newStart: 0, newLines: 0, lines: body.map(l => `-${l}`) }] : [], deleted: true as const })
const shellFiles = (...files: unknown[]) => ({ stdout: '', stderr: '', interrupted: false, bashEditDiff: { files, moreFiles: 0 } })
const inDemoApp = (on: On) => {
  mock.env(on, { HOME: '/home/demo' })
  on('session.root', () => ({ value: '/home/demo/app' }))
}
const numbered = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`)
const takesTextButtons = async ($: Parameters<TestBody>[0]): Promise<boolean> => {
  const ui = await $.ui.mount(editResult('terminal', BUTTON_PROBE, {})).catch(() => undefined)
  if (!ui) return false
  const drawn = await ui.find({ type: 'Button' })
  await ui.unmount()
  if (!drawn) throw new Error('the Button probe drew nothing: call engine(on) before any other ui.render hook')
  return true
}
const drewItself = async (ui: { find: (q: { type: string; text: RegExp }) => Promise<unknown> }) => expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeUndefined()

test('shell edits tell new, removed and renamed files apart from changed ones', () => {
  const kinds = (...files: unknown[]) => bashEdits(shellFiles(...files))?.files.map(f => (f.kind === 'renamed' ? `${f.path} → ${f.to}` : `${f.kind} ${f.path}`))
  expect(kinds(removedFile('a.txt', ['one', 'two']), madeFile('b.txt', ['one', 'two']))).toEqual(['/home/demo/app/a.txt → /home/demo/app/b.txt'])
  expect(kinds(madeFile('b.txt', ['one']), removedFile('a.txt', ['one']))).toEqual(['/home/demo/app/a.txt → /home/demo/app/b.txt'])
  expect(kinds(removedFile('a.txt', ['one']), madeFile('b.txt', ['one', 'two']))).toEqual(['deleted /home/demo/app/a.txt', 'created /home/demo/app/b.txt'])
  expect(kinds(removedFile('a.txt', ['one']), madeFile('b.txt', ['one']), madeFile('c.txt', ['one']))).toEqual(['/home/demo/app/a.txt → /home/demo/app/b.txt', 'created /home/demo/app/c.txt'])
  expect(kinds(madeFile('empty.txt', []), { filePath: '/home/demo/app/src/app.ts', hunks: patch.structuredPatch })).toEqual(['created /home/demo/app/empty.txt', 'modified /home/demo/app/src/app.ts'])
  expect(bashEdits(shellFiles(removedFile('old.txt', ['alpha', 'beta'])))?.files).toEqual([{ kind: 'deleted', path: '/home/demo/app/old.txt', lines: ['alpha', 'beta'] }])
  expect(kinds(removedFile('pkg_a/__init__.py', []), madeFile('pkg_b/__init__.py', []))).toEqual(['deleted /home/demo/app/pkg_a/__init__.py', 'created /home/demo/app/pkg_b/__init__.py'])
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a file a shell command creates shows its first 10 lines as added diff lines under a Created header on ${surface}`, async ($, on) => {
    engine(on)
    inDemoApp(on)
    claudeAt(on, '2.1.295')
    const body = numbered(14)
    if (surface === 'terminal' && !(await takesTextButtons($))) return
    const ui = await $.ui.mount(editResult(surface, 'Bash', shellFiles(madeFile('notes.py', body))))
    await drewItself(ui)
    expect(await ui.find({ type: 'Text', text: /^Created notes\.py \(14 lines\)$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\+14$/ })).toBeUndefined()
    expect(await rowsOf(ui)).toEqual(numberedRows(body.slice(0, 10), '+'))
    const tinted = surface === 'terminal' ? await ui.find({ type: 'Text', text: /^\+ $/ }) : await ui.find({ type: 'Box', text: /^ 1 \+ line 1$/ })
    expect(tinted?.props.backgroundColor).toBe(diffTint(t.codeText, t.diffAdded))
    const fold = await ui.find({ key: 'fold0' })
    expect([fold?.type, fold?.props.variant, fold?.props.label]).toEqual(['Button', 'secondary', '+4 more lines'])
    expect((await ui.find({ key: 'fold0.rows' }))?.text.split('\n')[0]).toBe(surface === 'terminal' ? 'Created notes.py (14 lines)' : undefined)
    expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeUndefined()
    await ui.press({ key: 'fold0' })
    expect(await rowsOf(ui)).toEqual(numberedRows(body, '+'))
    expect((await ui.find({ key: 'fold0' }))?.props.label).toBe('show less')
    await ui.press({ key: 'fold0' })
    expect(await rowsOf(ui)).toEqual(numberedRows(body.slice(0, 10), '+'))
    await ui.unmount()
  })

  test(`a short new file shows whole, and an empty one says so, on ${surface}`, async ($, on) => {
    engine(on)
    inDemoApp(on)
    claudeAt(on, '2.1.295')
    const ui = await $.ui.mount(editResult(surface, 'Bash', shellFiles(madeFile('one.txt', ['only']), madeFile('empty.txt', []))))
    expect(await ui.find({ type: 'Text', text: /^Created one\.txt \(1 line\)$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Created empty\.txt \(empty\)$/ })).toBeDefined()
    expect(await rowsOf(ui)).toEqual(['1 + only'])
    expect(await ui.find({ type: 'Button' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeUndefined()
    await ui.unmount()
  })

  test(`a file a shell command removes is one Deleted line that opens on a click to its removed lines on ${surface}`, async ($, on) => {
    engine(on)
    inDemoApp(on)
    claudeAt(on, '2.1.295')
    if (!(await takesTextButtons($))) return
    const ui = await $.ui.mount(editResult(surface, 'Bash', shellFiles(removedFile('old.txt', ['alpha', 'beta', 'gamma']))))
    await drewItself(ui)
    const head = await ui.find({ key: 'fold0' })
    expect([head?.type, head?.props.plain, head?.text, head?.props.label]).toEqual(['Button', true, 'Deleted old.txt (3 lines)', 'show 3 lines'])
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(1)
    expect(await rowsOf(ui)).toEqual([])
    await ui.press({ key: 'fold0' })
    expect(await rowsOf(ui)).toEqual(['1 - alpha', '2 - beta', '3 - gamma'])
    const tinted = surface === 'terminal' ? await ui.find({ type: 'Text', text: /^- $/ }) : await ui.find({ type: 'Box', text: /^1 - alpha$/ })
    expect(tinted?.props.backgroundColor).toBe(diffTint(t.codeText, t.diffRemoved))
    expect((await ui.find({ key: 'fold0' }))?.text).toBe('Deleted old.txt (3 lines)')
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(surface === 'terminal' ? 2 : 1)
    await ui.press({ key: surface === 'terminal' ? 'fold0.rows' : 'fold0' })
    expect(await rowsOf(ui)).toEqual([])
    await ui.unmount()
  })

  test(`removed lines stay plain in a clickable long diff and in a deleted file's opened lines, as in diff cards, from Claude Code 2.1.295 on ${surface}`, async ($, on) => {
    engine(on)
    inDemoApp(on)
    claudeAt(on, '2.1.295')
    const lines = Array.from({ length: 12 }, (_, i) => [`-export const a${i} = ${i}`, `+let b${i} = ${i}`]).flat()
    const keywords = async (ui: { findAll: (q: { type: string; text: RegExp }) => Promise<unknown[]> }, word: RegExp) => (await ui.findAll({ type: 'Text', text: word })).length
    if (!(await takesTextButtons($))) return
    const long = await $.ui.mount(editResult(surface, 'Edit', { filePath: '/tmp/long.ts', structuredPatch: [{ oldStart: 1, newStart: 1, lines }] }))
    await drewItself(long)
    expect(await keywords(long, /^let$/)).toBeGreaterThan(0)
    expect(await keywords(long, /^export$/)).toBe(0)
    await long.unmount()
    const gone = await $.ui.mount(editResult(surface, 'Bash', shellFiles(removedFile('old.ts', ['export const x = 1', 'let y = 2']))))
    await drewItself(gone)
    await gone.press({ key: 'fold0' })
    expect(await rowsOf(gone)).toEqual(['1 - export const x = 1', '2 - let y = 2'])
    expect(await keywords(gone, /^(export|let)$/)).toBe(0)
    await gone.unmount()
  })

  test(`a long diff keeps the ... row between its hunks, untinted, when it opens on a click anywhere from Claude Code 2.1.295 on ${surface}`, async ($, on) => {
    engine(on)
    claudeAt(on, '2.1.295')
    const hunk = (start: number, n: number) => ({ oldStart: start, newStart: start, lines: Array.from({ length: n }, (_, i) => [`-a${start + i}`, `+b${start + i}`]).flat() })
    if (surface === 'terminal' && !(await takesTextButtons($))) return
    const ui = await $.ui.mount(editResult(surface, 'Edit', { filePath: '/tmp/two.txt', structuredPatch: [hunk(1, 6), hunk(40, 6)] }))
    await drewItself(ui)
    const text = surface === 'terminal' ? (await ui.find({ key: 'fold.rows' }))!.text.split('\n').map(l => l.trimEnd()) : (await ui.findAll({})).map(n => n.text)
    expect(text).toContain('...')
    if (surface === 'terminal') {
      expect(text[text.indexOf('...') - 1]).toBe(' 6 + b6')
      expect(text[text.indexOf('...') + 1]).toBe('40 - a40')
      expect((await ui.find({ type: 'Text', text: /^\.\.\.$/ }))?.props.backgroundColor).toBeUndefined()
    }
    await ui.unmount()
  })

  test(`an empty line in a long diff pads to the width of its other rows, so its tint does not wrap onto a row of its own, from Claude Code 2.1.295 on ${surface}`, { options: { diffStyle: 'full' } }, async ($, on) => {
    engine(on)
    claudeAt(on, '2.1.295')
    const lines = ['+a', '+', ...Array.from({ length: 30 }, (_, i) => `+line ${i}`)]
    if (surface === 'terminal' && !(await takesTextButtons($))) return
    const ui = await $.ui.mount({ ...editResult(surface, 'Edit', { filePath: '/tmp/gap.txt', structuredPatch: [{ oldStart: 1, newStart: 1, lines }] }), viewport: { columns: 60, rows: 40 } })
    await drewItself(ui)
    if (surface === 'terminal') {
      const rows = (await ui.find({ key: 'fold.rows' }))!.text.split('\n').slice(1)
      expect(rows[1]).toMatch(/^ 2 \+ +$/)
      expect(new Set(rows.map(r => r.length))).toEqual(new Set([rows[0]!.length]))
    }
    await ui.unmount()
  })

  test(`a long diff opens on a click anywhere in it on the terminal, and from its button, from Claude Code 2.1.295 on ${surface}`, async ($, on) => {
    engine(on)
    claudeAt(on, '2.1.295')
    const body = Array.from({ length: 30 }, (_, i) => [`-old ${i}`, `+new ${i}`]).flat()
    if (surface === 'terminal' && !(await takesTextButtons($))) return
    const ui = await $.ui.mount(editResult(surface, 'Edit', { filePath: '/tmp/long.txt', structuredPatch: [{ oldStart: 1, newStart: 1, lines: body }] }))
    await drewItself(ui)
    expect((await ui.find({ key: 'fold' }))?.props).toMatchObject({ variant: 'secondary', label: '+40 more lines' })
    const rows = await ui.find({ key: 'fold.rows' })
    expect(rows?.text.split('\n')[0]).toBe(surface === 'terminal' ? '+30 −30' : undefined)
    if (surface === 'terminal') expect((await ui.find({ type: 'Text', text: /^- $/ }))?.props.backgroundColor).toBe(diffTint(t.codeText, t.codeFlag))
    await ui.press({ key: surface === 'terminal' ? 'fold.rows' : 'fold' })
    expect(await ui.find({ text: /^new 29$/ })).toBeDefined()
    expect((await ui.find({ key: 'fold' }))?.props.label).toBe('show less')
    await ui.unmount()
  })

  test(`a file moved unchanged draws one Renamed line on ${surface}`, async ($, on) => {
    engine(on)
    inDemoApp(on)
    const ui = await $.ui.mount(editResult(surface, 'Bash', shellFiles(removedFile('move-me.txt', ['one', 'two']), madeFile('moved.txt', ['one', 'two']))))
    expect(await ui.find({ type: 'Text', text: /^Renamed move-me\.txt → moved\.txt$/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^moved\.txt$/ }))?.props.color).toBe(t.path)
    expect(await ui.find({ type: 'Text', text: /^(Created|Deleted) / })).toBeUndefined()
    expect(await rowsOf(ui)).toEqual([])
    expect(await ui.find({ type: 'Button' })).toBeUndefined()
    await ui.unmount()
  })

  test(`a file moved and changed draws as removed and created on ${surface}`, async ($, on) => {
    engine(on)
    inDemoApp(on)
    const ui = await $.ui.mount(editResult(surface, 'Bash', shellFiles(removedFile('move-me.txt', ['one', 'two']), madeFile('moved.txt', ['one', 'three']))))
    expect(await ui.find({ type: 'Text', text: /^Renamed / })).toBeUndefined()
    expect(await ui.find({ text: /^Deleted move-me\.txt \(2 lines\)$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Created moved\.txt \(2 lines\)$/ })).toBeDefined()
    expect(await rowsOf(ui)).toEqual(['1 + one', '2 + three'])
    await ui.unmount()
  })

  test(`new and removed files keep a label button before Claude Code 2.1.295 on ${surface}`, async ($, on) => {
    engine(on)
    inDemoApp(on)
    claudeAt(on, '2.1.294')
    const ui = await $.ui.mount(editResult(surface, 'Bash', shellFiles(madeFile('notes.txt', numbered(14)), removedFile('old.txt', ['alpha', 'beta']))))
    expect((await ui.find({ key: 'fold0' }))?.props.label).toBe('+4 more lines')
    expect((await ui.find({ key: 'fold0' }))?.children).toEqual([])
    expect((await ui.find({ key: 'fold1' }))?.props.label).toBe('show 2 lines')
    expect(await ui.find({ type: 'Text', text: /^Deleted old\.txt \(2 lines\)$/ })).toBeDefined()
    expect((await rowsOf(ui)).length).toBe(10)
    await ui.press({ key: 'fold1' })
    expect((await rowsOf(ui)).slice(10)).toEqual(['1 - alpha', '2 - beta'])
    expect((await ui.find({ key: 'fold1' }))?.props.label).toBe('show less')
    await ui.unmount()
  })
}

const PREVIEW_SAMPLE = [
  '// keeps the old name working',
  'export const greet = (name: string): string => `hi ${name}`',
  'const limit = 42, ok = true',
  "type Item = { id: number; label: 'a' | 'b' }",
  'function size(items: Item[]) { return items.length }',
  'class Store { items: Item[] = [] }',
  'const re = /^[a-z]+$/',
]

for (const name of PRESET_NAMES) {
  test(`every token of a click-anywhere preview reads at 4.5:1 on its hover band, and keeps its theme color at rest, in ${name}`, { options: { theme: name } }, async ($, on) => {
    engine(on)
    claudeAt(on, '2.1.295')
    const theme: Theme = PRESETS[name]
    const band = previewBand(theme, PRESET_BACKGROUNDS[name])
    if (!(await takesTextButtons($))) return
    const ui = await $.ui.mount(editResult('terminal', 'Write', writeNew('/tmp/sample.ts', [...PREVIEW_SAMPLE, ...ts(8)])))
    await drewItself(ui)
    const button = await pressOf(ui)
    expect(hoverOf(button!)).toEqual(band ? { inverse: false, backgroundColor: band } : { inverse: false })
    const inks = nodesOf(button).filter(n => n.type === 'Text' && typeof n.props?.color === 'string')
    const allowed = new Set(Object.values(PRISM_COLORS).map(k => theme[k]).concat(theme.codeText))
    expect(inks.filter(n => !allowed.has(n.props!.color as string)).map(n => n.props!.color)).toEqual([])
    if (band) {
      expect(inks.map(n => hoverOf(n)?.color ?? (n.props!.color as string)).filter(c => contrast(c, band) < 4.5)).toEqual([])
      expect(inks.length).toBeGreaterThan(20)
    } else expect(inks.filter(n => hoverOf(n)).length).toBe(0)
    await ui.unmount()
  })
}

test('changed files beside new ones still draw as diff cards, notes and all', async ($, on) => {
  engine(on)
  inDemoApp(on)
  const ui = await $.ui.mount(editResult('terminal', 'Bash', shellFiles({ filePath: '/home/demo/app/src/app.ts', hunks: patch.structuredPatch }, madeFile('empty.txt', []), removedFile('old.txt', ['x']))))
  expect((await ui.find({ type: 'Text', text: /^src\/app\.ts $/ }))?.props.color).toBe(t.path)
  expect((await ui.find({ type: 'Box', text: /^6 \+ const c = 4$/ }))?.props.backgroundColor).toBe(diffTint(t.codeText, t.number))
  expect(await ui.find({ type: 'Text', text: /^Created empty\.txt \(empty\)$/ })).toBeDefined()
  expect(await ui.find({ text: /^Deleted old\.txt \(1 line\)$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeUndefined()
  await ui.unmount()
})

const HEX_COLOR = /^#[0-9a-f]{6}$/i

const lab = (hex: string): [number, number, number] => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number]
  const f = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116)
  const [x, y, z] = [(0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, 0.2126 * r + 0.7152 * g + 0.0722 * b, (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883].map(f) as [number, number, number]
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

const deltaE = (p: string, q: string): number => {
  const rad = (d: number) => (d * Math.PI) / 180
  const [[l1, a1, b1], [l2, a2, b2]] = [lab(p), lab(q)]
  const cMean = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2
  const g = 0.5 * (1 - Math.sqrt(cMean ** 7 / (cMean ** 7 + 25 ** 7)))
  const [a1p, a2p] = [a1 * (1 + g), a2 * (1 + g)]
  const [c1, c2] = [Math.hypot(a1p, b1), Math.hypot(a2p, b2)]
  const [h1, h2] = [((Math.atan2(b1, a1p) * 180) / Math.PI + 360) % 360, ((Math.atan2(b2, a2p) * 180) / Math.PI + 360) % 360]
  const dh = c1 * c2 === 0 ? 0 : Math.abs(h2 - h1) <= 180 ? h2 - h1 : h2 > h1 ? h2 - h1 - 360 : h2 - h1 + 360
  const [dL, dC, dH] = [l2 - l1, c2 - c1, 2 * Math.sqrt(c1 * c2) * Math.sin(rad(dh / 2))]
  const [lMean, cpMean] = [(l1 + l2) / 2, (c1 + c2) / 2]
  const hMean = c1 * c2 === 0 ? h1 + h2 : Math.abs(h1 - h2) <= 180 ? (h1 + h2) / 2 : h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2
  const tt = 1 - 0.17 * Math.cos(rad(hMean - 30)) + 0.24 * Math.cos(rad(2 * hMean)) + 0.32 * Math.cos(rad(3 * hMean + 6)) - 0.2 * Math.cos(rad(4 * hMean - 63))
  const sl = 1 + (0.015 * (lMean - 50) ** 2) / Math.sqrt(20 + (lMean - 50) ** 2)
  const [sc, sh] = [1 + 0.045 * cpMean, 1 + 0.015 * cpMean * tt]
  const rt = -2 * Math.sqrt(cpMean ** 7 / (cpMean ** 7 + 25 ** 7)) * Math.sin(rad(60 * Math.exp(-(((hMean - 275) / 25) ** 2))))
  return Math.sqrt((dL / sl) ** 2 + (dC / sc) ** 2 + (dH / sh) ** 2 + rt * (dC / sc) * (dH / sh))
}

test('diff tints mix the line color\'s full hue into black on dark themes and white on light ones, keeping code text at 4.5:1', () => {
  expect(fullHue('#a6e3a1')).toBe('#13ff00')
  expect(fullHue('#808080')).toBe('#808080')
  expect(diffTint(t.codeText, t.number)).toBe('#064d00')
  expect(diffTint(t.codeText, t.number)).toBe(tint('#000000', fullHue(t.number), 0.3))
  const latte = PRESETS['catppuccin-latte']
  expect(diffTint(latte.codeText, latte.codeFlag)).toBe('#ffccd7')
  const solarized = PRESETS['solarized-light']
  expect([solarized.diffAdded, solarized.diffRemoved].some(c => diffTint(solarized.codeText, c) !== tint('#ffffff', fullHue(c!), 0.2))).toBe(true)
  expect(diffTint(undefined, t.number)).toBeUndefined()
  expect(diffTint(t.codeText, 'green')).toBeUndefined()
})

test('every color preset has its own diff green and red, readable on their tints and told apart by at least ΔE 13', () => {
  expect(deltaE('#000000', '#000000')).toBe(0)
  expect(Math.abs(deltaE('#ff0000', '#00ff00') - 86.6)).toBeLessThan(0.1)
  for (const [name, theme] of Object.entries(PRESETS) as [string, Theme][]) {
    if (!theme.codeText) continue
    const [added, removed] = [theme.diffAdded!, theme.diffRemoved!]
    const [addTint, removeTint] = [diffTint(theme.codeText, added)!, diffTint(theme.codeText, removed)!]
    expect([name, HEX_COLOR.test(added), HEX_COLOR.test(removed)]).toEqual([name, true, true])
    expect([name, contrast(theme.codeText, addTint) >= 4.5, contrast(theme.codeText, removeTint) >= 4.5, deltaE(addTint, removeTint) >= 13, deltaE(added, removed) >= 13])
      .toEqual([name, true, true, true, true])
  }
})

test('a diff card draws its counts, marks and tints in the theme\'s diff colors', { options: { theme: 'dracula' } }, async ($, on) => {
  engine(on)
  const dracula = PRESETS.dracula
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(editResult(surface, 'Edit', patch))
    expect((await ui.find({ type: 'Text', text: /^\+2$/ }))?.props.color).toBe(dracula.diffAdded)
    expect((await ui.find({ type: 'Text', text: /^−1$/ }))?.props.color).toBe(dracula.diffRemoved)
    expect((await ui.find({ type: 'Text', text: /^\+ $/ }))?.props.color).toBe(dracula.diffAdded)
    expect((await ui.find({ type: 'Text', text: /^- $/ }))?.props.color).toBe(dracula.diffRemoved)
    expect((await ui.find({ type: 'Box', text: /^6 \+ const c = 4$/ }))?.props.backgroundColor).toBe(diffTint(dracula.codeText, dracula.diffAdded))
    expect((await ui.find({ type: 'Box', text: /^5 - const b = 2$/ }))?.props.backgroundColor).toBe(diffTint(dracula.codeText, dracula.diffRemoved))
    await ui.unmount()
  }
})

test('diffAddedColor and diffRemovedColor set the diff colors like any other token', { options: { diffAddedColor: '#22c55e', diffRemovedColor: 'red' } }, async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(editResult('terminal', 'Edit', patch))
  expect((await ui.find({ type: 'Text', text: /^\+ $/ }))?.props.color).toBe('#22c55e')
  expect((await ui.find({ type: 'Box', text: /^6 \+ const c = 4$/ }))?.props.backgroundColor).toBe(diffTint(t.codeText, '#22c55e'))
  expect((await ui.find({ type: 'Text', text: /^- $/ }))?.props.color).toBe('red')
  expect((await ui.find({ type: 'Box', text: /^5 - const b = 2$/ }))?.props.backgroundColor).toBeUndefined()
  await ui.unmount()
})

for (const diffStyle of ['card', 'full', 'marks', 'bar'] as const) {
  test(`diffStyle ${diffStyle} draws edit and shell edit diffs its way`, { options: { diffStyle } }, async ($, on) => {
    engine(on)
    const tinted = diffStyle === 'card' || diffStyle === 'full'
    for (const surface of ['terminal', 'desktop'] as const) {
      for (const [tool, output, changed] of [['Edit', patch, 3], ['Bash', bashEdit(), 5]] as const) {
        const ui = await $.ui.mount(editResult(surface, tool, output))
        const boxes = await ui.findAll({ type: 'Box' })
        const row = (text: RegExp) => ui.find({ type: 'Box', text })
        expect(boxes.some(b => b.props.borderStyle === 'round')).toBe(diffStyle === 'card')
        expect(boxes.some(b => b.props.flexGrow === 1)).toBe(diffStyle === 'full')
        expect(boxes.some(b => b.props.alignItems === 'flex-start')).toBe(diffStyle !== 'full')
        expect((await row(/^(▌ )?6 \+ const c = 4$/))?.props.backgroundColor).toBe(tinted ? diffTint(t.codeText, t.number) : undefined)
        expect((await row(/^(▌ )?5 - const b = 2$/))?.props.backgroundColor).toBe(tinted ? diffTint(t.codeText, t.codeFlag) : undefined)
        expect((await ui.find({ type: 'Text', text: /^const c = 4$/ }))?.props.color).toBe(t.codeText)
        expect((await ui.find({ type: 'Text', text: /^const b = 2$/ }))?.props.color).toBe(t.codeText)
        expect((await ui.findAll({ type: 'Text', text: /^▌ $/ })).length).toBe(diffStyle === 'bar' ? changed : 0)
        expect((await ui.find({ type: 'Text', text: /^\+2$/ }))?.props.color).toBe(t.number)
        expect((await ui.find({ type: 'Text', text: /^- $/ }))?.props.color).toBe(t.codeFlag)
        await ui.unmount()
      }
    }
  })
}

test('an unknown diffStyle draws the card', { options: { diffStyle: 'fancy' } }, async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(editResult('terminal', 'Edit', patch))
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props.borderStyle === 'round')).toBe(true)
  await ui.unmount()
})

const twoHunks = [
  { oldStart: 4, newStart: 4, oldLines: 3, newLines: 3, lines: [' const a = 3', '-const b = 4', '+const b = 5', ' const c = 6'] },
  { oldStart: 50, newStart: 50, oldLines: 3, newLines: 3, lines: [' const x = 50', '-const y = 51', '+const y = 52', ' const z = 52'] },
]

for (const diffStyle of ['card', 'full', 'marks', 'bar'] as const) {
  test(`diffStyle ${diffStyle} parts separate hunks with a dim ... row, in edit and shell edit cards`, { options: { diffStyle } }, async ($, on) => {
    engine(on)
    const bash = { stdout: '', stderr: '', interrupted: false, bashEditDiff: { files: [{ filePath: '/tmp/far.ts', hunks: twoHunks }], moreFiles: 0 } }
    for (const surface of ['terminal', 'desktop'] as const) {
      for (const [tool, output] of [['Edit', { filePath: '/tmp/far.ts', structuredPatch: twoHunks }], ['Bash', bash]] as const) {
        const ui = await $.ui.mount(editResult(surface, tool, output))
        const drawn = (await ui.findAll({})).filter(n => /^d\d+$/.test(n.key ?? '') || (n.type === 'Text' && /^ *\.\.\.$/.test(n.text)))
        expect(drawn.map(n => n.key ?? n.text)).toEqual(['d0', 'd1', 'd2', 'd3', diffStyle === 'bar' ? '  ...' : '...', 'd4', 'd5', 'd6', 'd7'])
        expect(drawn[4]!.props).toEqual({ dimColor: true })
        expect(drawn[5]!.text).toMatch(/^(  )?50   const x = 50$/)
        await ui.unmount()
      }
    }
  })
}

test('one hunk draws no separator', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(editResult(surface, 'Edit', patch))
    expect((await ui.findAll({ type: 'Text', text: /^ *\.\.\.$/ })).length).toBe(0)
    await ui.unmount()
  }
})

const noNewline = { filePath: '/tmp/version.py', structuredPatch: [{ oldStart: 1, newStart: 1, lines: [' NAME = "tank"', '-VERSION = "1.0"', '\\ No newline at end of file', '+VERSION = "1.1"', '\\ No newline at end of file'] }] }

test('a diff keeps the no-newline marker as a row of its own that numbers nothing', () => {
  expect(diffLines(noNewline)?.map(r => `${r.num}${r.mark}${r.text}`)).toEqual(['1 NAME = "tank"', '2-VERSION = "1.0"', '0\\ No newline at end of file', '2+VERSION = "1.1"', '0\\ No newline at end of file'])
})

for (const diffStyle of ['card', 'full', 'marks', 'bar'] as const) {
  test(`diffStyle ${diffStyle} draws the no-newline marker plain and untinted, with no number or mark`, { options: { diffStyle } }, async ($, on) => {
    engine(on)
    const tinted = diffStyle === 'card' || diffStyle === 'full'
    const lead = diffStyle === 'bar' ? '▌ ' : ''
    const blank = diffStyle === 'bar' ? '  ' : ''
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount(editResult(surface, 'Edit', noNewline))
      const rows = (await ui.findAll({ type: 'Box' })).filter(b => /^d\d+$/.test(b.key ?? ''))
      expect(rows.map(r => r.text)).toEqual([`${blank}1   NAME = "tank"`, `${lead}2 - VERSION = "1.0"`, `${blank}     No newline at end of file`, `${lead}2 + VERSION = "1.1"`, `${blank}     No newline at end of file`])
      expect(rows.map(r => r.props.backgroundColor)).toEqual(tinted ? [undefined, diffTint(t.codeText, t.codeFlag), undefined, diffTint(t.codeText, t.number), undefined] : [undefined, undefined, undefined, undefined, undefined])
      const note = await ui.find({ type: 'Text', text: /^ No newline at end of file$/ })
      expect(note?.props.color).toBe(t.codeText)
      expect(note?.props.dimColor).not.toBe(true)
      await ui.unmount()
    }
  })
}

test('no-newline markers do not count as lines toward the fold', async ($, on) => {
  engine(on)
  const marker = '\\ No newline at end of file'
  const added = (n: number) => Array.from({ length: n }, (_, i) => `+line ${i + 1}`)
  for (const surface of ['terminal', 'desktop'] as const) {
    const fits = await $.ui.mount(editResult(surface, 'Edit', { filePath: '/tmp/n.txt', structuredPatch: [{ oldStart: 1, newStart: 1, lines: [...added(20), marker] }] }))
    expect(await fits.find({ key: 'fold' })).toBeUndefined()
    expect(await fits.find({ type: 'Text', text: /^ No newline at end of file$/ })).toBeDefined()
    await fits.unmount()
    const long = await $.ui.mount(editResult(surface, 'Edit', { filePath: '/tmp/n.txt', structuredPatch: [{ oldStart: 1, newStart: 1, lines: [...added(25), marker] }] }))
    expect((await long.find({ key: 'fold' }))?.props.label).toBe('+5 more lines')
    expect(await long.find({ type: 'Text', text: /^line 20$/ })).toBeDefined()
    expect(await long.find({ type: 'Text', text: /^line 21$/ })).toBeUndefined()
    await long.unmount()
  }
})

const [addTint, removeTint] = [diffTint(t.codeText, t.number)!, diffTint(t.codeText, t.codeFlag)!]
type Drawn = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const tokensOf = async (ui: { drawn: () => Promise<unknown> }, line: RegExp) => (await paintTokens(ui, line)).map(r => [r.text, r.paint.color, r.paint.italic === true])
const nodeCount = (n: unknown): number =>
  n == null || n === false ? 0 : Array.isArray(n) ? n.reduce((a: number, c) => a + nodeCount(c), 0) : typeof n !== 'object' ? 1 : 1 + nodeCount((n as Drawn).children)

test('the language of a diff comes from its path, by Prism\'s own names where they match the extension', () => {
  expect(pathLanguage('/repo/src/app.ts')).toBe('ts')
  expect(pathLanguage('C:\\repo\\View.TSX')).toBe('tsx')
  expect(pathLanguage('/repo/tool.py')).toBe('py')
  expect(pathLanguage('/repo/init.lua')).toBe('lua')
  expect(pathLanguage('/repo/types.mts')).toBe('typescript')
  expect(pathLanguage('/repo/lib.rs')).toBe('rust')
  expect(pathLanguage('/repo/main.tf')).toBe('hcl')
  expect(pathLanguage('/repo/Dockerfile')).toBe('dockerfile')
  expect(pathLanguage('/repo/Dockerfile.dev')).toBe('dockerfile')
  expect(pathLanguage('/repo/README.md')).toBeUndefined()
  expect(pathLanguage('/repo/.gitignore')).toBeUndefined()
  expect(pathLanguage('/repo/odd.constructor')).toBeUndefined()
  expect(pathLanguage(undefined)).toBeUndefined()
})

test('an edit to a .ts file highlights its added and context lines, and draws removed lines plain as Claude Code does', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(editResult(surface, 'Edit', patch))
    expect(await tokensOf(ui, /^const a = 1$/)).toEqual([['const', t.codeFlag, false], ['1', t.number, false]])
    expect((await ui.find({ type: 'Text', text: /^const b = 2$/ }))?.children?.[0]).toBe('const b = ')
    expect(await tokensOf(ui, /^const b = 2$/)).toEqual([['2', onTint(t.codeText, wordTint(t.codeText, t.codeFlag)!), false]])
    expect(await tokensOf(ui, /^const c = 4$/)).toEqual([['const', onTint(t.codeFlag, addTint), false], ['4', onTint(t.number, addTint), false]])
    expect((await ui.find({ type: 'Text', text: /^const c = 4$/ }))?.children?.[1]).toBe(' c = ')
    expect((await ui.find({ type: 'Text', text: /^const a = 1$/ }))?.props).toEqual({ color: t.codeText })
    await ui.unmount()
  }
})

test('a comment or string spanning lines keeps its color on every added and context line, removed lines staying plain', async ($, on) => {
  engine(on)
  const comment = [' <!-- opening', '-old note', '+rewritten remark', ' closing -->', ' <p>after</p>']
  const string = [' const x = `one', '-two', '+three', ' four`', ' let y = 2']
  for (const surface of ['terminal', 'desktop'] as const) {
    const page = await $.ui.mount(editResult(surface, 'Edit', { filePath: '/tmp/span.html', structuredPatch: [{ oldStart: 1, newStart: 1, lines: comment }] }))
    expect((await page.find({ type: 'Text', text: /^old note$/ }))?.children).toEqual(['old note'])
    expect(await tokensOf(page, /^rewritten remark$/)).toEqual([['rewritten remark', onTint(t.codeComment, addTint), true]])
    expect(await tokensOf(page, /^closing -->$/)).toEqual([['closing -->', t.codeComment, true]])
    expect((await tokensOf(page, /^<p>after<\/p>$/))[0]?.[1]).toBe(t.link)
    await page.unmount()
    const ui = await $.ui.mount(editResult(surface, 'Edit', { filePath: '/tmp/span.ts', structuredPatch: [{ oldStart: 1, newStart: 1, lines: string }] }))
    expect((await tokensOf(ui, /^const x = `one$/))[0]).toEqual(['const', t.codeFlag, false])
    expect((await ui.find({ type: 'Text', text: /^two$/ }))?.children).toEqual(['two'])
    expect(await tokensOf(ui, /^three$/)).toEqual([['three', onTint(t.codeString, addTint), false]])
    expect(await tokensOf(ui, /^four`$/)).toEqual([['four`', t.codeString, false]])
    expect((await tokensOf(ui, /^let y = 2$/))[0]).toEqual(['let', t.codeFlag, false])
    await ui.unmount()
  }
})

test('separate hunks are highlighted apart, so one hunk\'s open string cannot color the next', async ($, on) => {
  engine(on)
  const structuredPatch = [{ oldStart: 1, newStart: 1, lines: ['+const s = "unclosed'] }, { oldStart: 40, newStart: 41, lines: ['-let n = 1', '+let n = 2'] }]
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(editResult(surface, 'Edit', { filePath: '/tmp/hunks.ts', structuredPatch }))
    expect((await tokensOf(ui, /^let n = 2$/))[0]).toEqual(['let', onTint(t.codeFlag, addTint), false])
    await ui.unmount()
  }
})

test('a diff of a file with no known language draws its lines plain', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const filePath of ['/tmp/app.xyz', '/tmp/Makefile']) {
      const ui = await $.ui.mount(editResult(surface, 'Edit', { ...patch, filePath }))
      expect((await ui.find({ type: 'Text', text: /^const a = 1$/ }))?.children).toEqual(['const a = 1'])
      expect((await ui.find({ type: 'Text', text: /^const c = 4$/ }))?.children).toEqual(['const c = 4'])
      expect((await ui.find({ type: 'Box', text: /^6 \+ const c = 4$/ }))?.props.backgroundColor).toBe(addTint)
      await ui.unmount()
    }
  }
})

for (const diffStyle of ['card', 'full', 'marks', 'bar'] as const) {
  test(`diffStyle ${diffStyle} keeps its tint and marks around highlighted code`, { options: { diffStyle } }, async ($, on) => {
    engine(on)
    const tinted = diffStyle === 'card' || diffStyle === 'full'
    for (const surface of ['terminal', 'desktop'] as const) {
      for (const tool of ['Edit', 'Bash'] as const) {
        const ui = await $.ui.mount(editResult(surface, tool, tool === 'Edit' ? patch : bashEdit()))
        expect((await ui.find({ type: 'Box', text: /^(▌ )?6 \+ const c = 4$/ }))?.props.backgroundColor).toBe(tinted ? addTint : undefined)
        expect((await ui.find({ type: 'Text', text: /^\+ $/ }))?.props.color).toBe(t.number)
        expect((await ui.find({ type: 'Text', text: /^- $/ }))?.props.color).toBe(t.codeFlag)
        expect((await ui.findAll({ type: 'Text', text: /^▌ $/ })).length > 0).toBe(diffStyle === 'bar')
        expect((await tokensOf(ui, /^const a = 1$/))[0]).toEqual(['const', t.codeFlag, false])
        expect((await tokensOf(ui, /^const c = 4$/))[0]).toEqual(['const', tinted ? onTint(t.codeFlag, addTint) : t.codeFlag, false])
        expect((await ui.find({ type: 'Text', text: /^const c = 4$/ }))?.props.color).toBe(t.codeText)
        await ui.unmount()
      }
    }
  })
}

test('every code color reads at 4.5:1 or better on every diff line tint and word tint in every preset', () => {
  const slots = [...new Set(['codeText', ...Object.values(PRISM_COLORS)] as const)]
  const failures: string[] = []
  for (const [name, theme] of Object.entries(PRESETS) as [string, Theme][]) {
    if (!theme.codeText) continue
    for (const line of [theme.diffAdded, theme.diffRemoved]) {
      for (const bg of [diffTint(theme.codeText, line)!, wordTint(theme.codeText, line)!]) {
        for (const slot of slots) {
          const color = onTint(theme[slot], bg)
          if (color && contrast(color, bg) < 4.5) failures.push(`${name}.${slot} on ${bg}`)
        }
      }
    }
  }
  expect(failures).toEqual([])
  expect(onTint(t.codeText, addTint)).toBe(t.codeText)
  expect(onTint('red', addTint)).toBe('red')
  expect(onTint(undefined, addTint)).toBeUndefined()
})

test('word tints deepen their line tint toward the line color, apart from it and from each other in every preset', () => {
  expect(wordTint(t.codeText, t.number)).toBe(tint(addTint, t.number, 0.3))
  expect(wordTint(undefined, t.number)).toBeUndefined()
  expect(wordTint(t.codeText, 'green')).toBeUndefined()
  const failures: string[] = []
  for (const [name, theme] of Object.entries(PRESETS) as [string, Theme][]) {
    if (!theme.codeText) continue
    const [add, remove] = [wordTint(theme.codeText, theme.diffAdded)!, wordTint(theme.codeText, theme.diffRemoved)!]
    if (deltaE(add, remove) < 13) failures.push(`${name} add and remove words ΔE ${deltaE(add, remove).toFixed(1)}`)
    for (const line of [theme.diffAdded, theme.diffRemoved]) {
      const [row, word] = [diffTint(theme.codeText, line)!, wordTint(theme.codeText, line)!]
      if (deltaE(row, word) < 6 || contrast(row, word) < 1.3) failures.push(`${name} ${line} line to word ΔE ${deltaE(row, word).toFixed(1)}, ${contrast(row, word).toFixed(2)}:1`)
    }
  }
  expect(failures).toEqual([])
})

const greetEdit = { filePath: '/tmp/greet.ts', structuredPatch: [{ oldStart: 6, newStart: 6, lines: [' const trimmed = name.trim()', "-return 'hello ' + trimmed", "+return 'hey ' + trimmed"] }] }
const litOf = async (ui: { findAll: (q: object) => Promise<{ text: string; props: Record<string, unknown> }[]> }) =>
  (await ui.findAll({ type: 'Text' })).filter(n => n.props.backgroundColor !== undefined).map(n => [n.text, n.props.backgroundColor, n.props.color])

for (const diffStyle of ['card', 'full', 'marks', 'bar'] as const) {
  test(`diffStyle ${diffStyle} marks exactly the changed word of a changed line, over its highlighting`, { options: { diffStyle } }, async ($, on) => {
    engine(on)
    const tinted = diffStyle === 'card' || diffStyle === 'full'
    const [addWord, removeWord] = tinted ? [wordTint(t.codeText, t.number)!, wordTint(t.codeText, t.codeFlag)!] : [addTint, removeTint]
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount(editResult(surface, 'Edit', greetEdit))
      expect(await litOf(ui)).toEqual([['hello', removeWord, onTint(t.codeText, removeWord)], ['hey', addWord, onTint(t.codeString, addWord)]])
      expect((await ui.find({ type: 'Text', text: /^return 'hello ' \+ trimmed$/ }))?.children?.[0]).toBe("return '")
      expect((await tokensOf(ui, /^return 'hey ' \+ trimmed$/))[0]).toEqual(['return', tinted ? onTint(t.codeFlag, addTint) : t.codeFlag, false])
      expect((await ui.find({ type: 'Box', text: /^(▌ )?7 \+ return 'hey ' \+ trimmed$/ }))?.props.backgroundColor).toBe(tinted ? addTint : undefined)
      await ui.unmount()
    }
  })
}

test('word marks work in files with no known language too', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(editResult(surface, 'Edit', { filePath: '/tmp/NOTES.md', structuredPatch: [{ oldStart: 3, newStart: 3, lines: ['-Reads the level every 30 seconds.', '+Reads the level every 60 seconds.'] }] }))
    expect((await litOf(ui)).map(l => l.slice(0, 2))).toEqual([['30', wordTint(t.codeText, t.codeFlag)], ['60', wordTint(t.codeText, t.number)]])
    await ui.unmount()
  }
})

test('added or removed lines with no partner, and rewritten lines, get no word marks', async ($, on) => {
  engine(on)
  const hunks = [
    [' const a = 1', '+const added = 2'],
    ['-const gone = 2', ' const a = 1'],
    ['-return names.slice(0, LIMIT).map(greet)', '+const picked = names.slice(0, limit)'],
    ['-  "endpoint": "https://example.com/api",', '+  "timeout": 10,', '+  "endpoint": "https://example.com/api/v2",'],
    ['-  indented()', '+      indented()'],
  ]
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const lines of hunks) {
      const ui = await $.ui.mount(editResult(surface, 'Edit', { filePath: '/tmp/x.ts', structuredPatch: [{ oldStart: 1, newStart: 1, lines }] }))
      expect([lines[0], await litOf(ui)]).toEqual([lines[0], []])
      await ui.unmount()
    }
  }
})

test('changed lines on either side of a no-newline marker still pair up for word marks', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(editResult(surface, 'Edit', noNewline))
    expect((await litOf(ui)).map(l => l[0])).toEqual(['0', '1'])
    await ui.unmount()
  }
})

const ROOM_AT_60 = { card: 47, full: 51, marks: 51, bar: 49 } as const

for (const diffStyle of ['card', 'full', 'marks', 'bar'] as const) {
  test(`diffStyle ${diffStyle} wraps a long line into rows that each repeat its mark, bar and tint, numbered once`, { options: { diffStyle } }, async ($, on) => {
    engine(on)
    const tinted = diffStyle === 'card' || diffStyle === 'full'
    const lead = diffStyle === 'bar' ? 6 : 4
    const long = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ')
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...editResult(surface, 'Edit', { filePath: '/tmp/w.txt', structuredPatch: [{ oldStart: 1, newStart: 1, lines: ['-short', `+${long}`] }] }), viewport: { columns: 60, rows: 20 } })
      const rows = (await ui.findAll({ type: 'Box' })).filter(b => /^d1(\.\d+)?$/.test(b.key ?? ''))
      expect(rows.length).toBeGreaterThan(2)
      rows.forEach((row, k) => {
        expect(row.text.startsWith(`${diffStyle === 'bar' ? '▌ ' : ''}${k ? ' ' : '1'} + `)).toBe(true)
        expect(row.props.backgroundColor).toBe(tinted ? addTint : undefined)
        expect(row.text.length - lead).toBeLessThanOrEqual(ROOM_AT_60[diffStyle])
      })
      expect(rows.map(r => r.text.slice(lead)).join('')).toBe(long)
      expect((await ui.findAll({ type: 'Text', text: /^\+ $/ })).length).toBe(rows.length)
      await ui.unmount()
    }
  })

  test(`diffStyle ${diffStyle} fills a wrapped row to its last cell before breaking at a space`, { options: { diffStyle } }, async ($, on) => {
    engine(on)
    const room = ROOM_AT_60[diffStyle]
    const first = `${'a'.repeat(20)} ${'b'.repeat(room - 21)}`
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...editResult(surface, 'Edit', { filePath: '/tmp/w.txt', structuredPatch: [{ oldStart: 1, newStart: 1, lines: [`+${first} ccc`] }] }), viewport: { columns: 60, rows: 20 } })
      const rows = (await ui.findAll({ type: 'Box' })).filter(b => /^d0(\.\d+)?$/.test(b.key ?? ''))
      expect(rows.map(r => r.text.slice(diffStyle === 'bar' ? 6 : 4))).toEqual([first, ' ccc'])
      await ui.unmount()
    }
  })
}

test('a diff line with no room to spare, or no known width, stays one row', async ($, on) => {
  engine(on)
  const long = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ')
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const viewport of [undefined, { columns: 20, rows: 20 }]) {
      const ui = await $.ui.mount({ ...editResult(surface, 'Write', overwrite('/tmp/w.txt', long)), ...(viewport ? { viewport } : {}) })
      expect((await ui.find({ type: 'Text', text: long }))?.props.wrap).toBeUndefined()
      expect((await ui.findAll({ type: 'Text', text: /^\+ $/ })).length).toBe(1)
      await ui.unmount()
    }
  }
})

test('a wrapped line breaks inside a word that is wider than the row, and draws tabs as spaces to the next stop of 8', async ($, on) => {
  engine(on)
  const word = 'x'.repeat(70)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...editResult(surface, 'Edit', { filePath: '/tmp/w.go', structuredPatch: [{ oldStart: 1, newStart: 1, lines: [`+${word}`, '+\tport := 1', '+ab\tc'] }] }), viewport: { columns: 60, rows: 20 } })
    const rows = (await ui.findAll({ type: 'Box' })).filter(b => /^d0(\.\d+)?$/.test(b.key ?? ''))
    expect(rows.map(r => r.text.slice(4))).toEqual([word.slice(0, 47), word.slice(47)])
    expect((await ui.findAll({ type: 'Box' })).find(b => b.key === 'd1')?.text).toBe('2 +         port := 1')
    expect((await ui.findAll({ type: 'Box' })).find(b => b.key === 'd2')?.text).toBe('3 + ab      c')
    await ui.unmount()
  }
})

test('plain code on a tint is lifted to 4.5:1 when the code text color reads under it', { options: { codeTextColor: '#777777' } }, async ($, on) => {
  engine(on)
  const bg = diffTint('#777777', t.number)!
  expect(contrast('#777777', bg)).toBeLessThan(4.5)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(editResult(surface, 'Edit', { ...patch, filePath: '/tmp/app.txt' }))
    const line = await ui.find({ type: 'Text', text: /^const c = 4$/ })
    expect(line?.props.color).toBe(onTint('#777777', bg))
    expect(contrast(String(line?.props.color), bg)).toBeGreaterThanOrEqual(4.5)
    expect((await ui.find({ type: 'Text', text: /^const a = 1$/ }))?.props.color).toBe('#777777')
    await ui.unmount()
  }
})

const dense = (n: number) => Array.from({ length: n }, (_, i) => `+{${Array.from({ length: 12 }, (_, k) => `"k${k}": ${i * 12 + k}`).join(', ')}}`)

test('an opened card of dense lines stays under the engine\'s 20000-node ceiling, drawing the lines past its node allowance plain', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(editResult(surface, 'Edit', { filePath: '/tmp/data.json', structuredPatch: [{ oldStart: 1, newStart: 1, lines: dense(450) }] }))
    await ui.press({ key: 'fold' })
    expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeUndefined()
    expect(nodeCount(await ui.drawn())).toBeLessThan(20000)
    expect((await tokensOf(ui, /^\{"k0": 0, /)).length).toBeGreaterThan(0)
    expect((await ui.find({ type: 'Text', text: /^\{"k0": 4788, / }))?.children).toHaveLength(1)
    await ui.unmount()
  }
})

test('five opened shell edit cards of dense lines share one node allowance and stay under the ceiling', { timeoutMs: 20000 }, async ($, on) => {
  engine(on)
  const short = Array.from({ length: 450 }, (_, i) => `+[${Array.from({ length: 12 }, (_, k) => (i + k) % 10).join(',')}]`)
  const files = Array.from({ length: 5 }, (_, f) => ({ filePath: `/tmp/d${f}.json`, hunks: [{ oldStart: 1, newStart: 1, oldLines: 0, newLines: 450, lines: short }] }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(editResult(surface, 'Bash', { stdout: '', stderr: '', interrupted: false, bashEditDiff: { files, moreFiles: 0 } }))
    for (let f = 0; f < 5; f++) await ui.press({ key: `fold${f}` })
    expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeUndefined()
    expect(nodeCount(await ui.drawn())).toBeLessThan(20000)
    await ui.unmount()
  }
})

test('clickable diff rows, a new file\'s preview, and new and removed files spend the same node allowance and stay under the ceiling', { timeoutMs: 20000 }, async ($, on) => {
  engine(on)
  claudeAt(on, '2.1.295')
  if (!(await takesTextButtons($))) return
  const body = dense(450).map(l => l.slice(1))
  const results = [
    ['Edit', { filePath: '/tmp/data.json', structuredPatch: [{ oldStart: 1, newStart: 1, lines: dense(450) }] }, 'fold'],
    ['Write', writeNew('/tmp/data.json', body), 'fold'],
    ['Bash', shellFiles(madeFile('made.json', body)), 'fold0'],
    ['Bash', shellFiles(removedFile('gone.json', body)), 'fold0'],
  ] as const
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const [n, [tool, output, fold]] of results.entries()) {
      const mounted = editResult(surface, tool, output)
      const ui = await $.ui.mount({ ...mounted, props: { ...mounted.props, tool_use_id: `dense-${n}-${surface}` } })
      await drewItself(ui)
      await ui.press({ key: fold })
      expect([tool, n, nodeCount(await ui.drawn()) < 10000]).toEqual([tool, n, true])
      if (n < 3) expect((await tokensOf(ui, /^\{"k0": 0, /)).length).toBeGreaterThan(0)
      expect((await ui.find({ type: 'Text', text: /^\{"k0": 4788, / }))?.children).toHaveLength(1)
      await ui.unmount()
    }
  }
})

test('an opened new file of long lines past the node allowance keeps each plain line as one row and stays under the ceiling', async ($, on) => {
  engine(on)
  claudeAt(on, '2.1.295')
  if (!(await takesTextButtons($))) return
  const body = Array.from({ length: 400 }, (_, i) => `${i} ${'word '.repeat(600)}`)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...editResult(surface, 'Write', writeNew('/tmp/long.txt', body)), viewport: { columns: 80, rows: 40 } })
    await drewItself(ui)
    await ui.press({ key: 'fold' })
    expect(nodeCount(await ui.drawn())).toBeLessThan(20000)
    await ui.unmount()
  }
})

test('a no-newline marker in a shell edit diff draws harmlessly as its own row', async ($, on) => {
  engine(on)
  const hunks = [{ oldStart: 1, newStart: 1, oldLines: 1, newLines: 1, lines: ['-old', '\\ No newline at end of file', '+new', '\\ No newline at end of file'] }]
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(editResult(surface, 'Bash', { stdout: '', stderr: '', interrupted: false, bashEditDiff: { files: [{ filePath: '/tmp/x.txt', hunks }], moreFiles: 0 } }))
    expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /\+1 −1$/ })).toBeDefined()
    expect((await ui.findAll({ type: 'Text', text: /^ No newline at end of file$/ })).length).toBe(2)
    await ui.unmount()
  }
})

test('a git step that can move the working tree is told apart from other git calls', () => {
  for (const command of ['git checkout main', 'git -C repo switch feature', 'sudo git reset --hard HEAD~1', 'make && git stash pop', 'git -c core.pager=cat pull --rebase', 'FOO=1 git cherry-pick abc123'])
    expect(movesTree(command)).toBe(true)
  for (const command of ['git commit -m "checkout later"', 'git log --oneline', "echo 'git checkout main'", 'sed -i s/a/b/ notes.md', 'git diff --stat'])
    expect(movesTree(command)).toBe(false)
})

const shellEdit = (id: string, output: unknown) =>
  ({ plugin: 'merman', surface: 'terminal' as const, component: 'ToolResult' as const, props: { tool_use_id: id, tool: 'Bash', output, isErrored: false } })
const said = (text: string) => ({ type: 'Text' as const, text: `(${text})` })

test('shell edit cards carry the notes Claude Code gives its own diff', async ($, on) => {
  engine(on)
  const first = await $.ui.mount(shellEdit('n-1', bashEdit()))
  expect((await first.find(said(EDIT_NOTES.first)))?.props.dimColor).toBe(true)
  expect(await first.find(said(EDIT_NOTES.shared))).toBeUndefined()
  expect(await first.find(said(EDIT_NOTES.tree))).toBeUndefined()
  await first.unmount()
  const second = await $.ui.mount(shellEdit('n-2', { ...bashEdit(), bashEditDiff: { ...bashEdit().bashEditDiff, shared: true } }))
  expect(await second.find(said(EDIT_NOTES.first))).toBeUndefined()
  expect((await second.find(said(EDIT_NOTES.shared)))?.props.dimColor).toBe(true)
  await second.unmount()
  const row = await $.ui.mount({ plugin: 'merman', surface: 'terminal', component: 'ToolUse', props: call('Bash', { command: 'git checkout main && sed -i s/b/c/ src/app.ts' }, 'n-3') })
  const third = await $.ui.mount(shellEdit('n-3', bashEdit()))
  expect((await third.find(said(EDIT_NOTES.tree)))?.props.dimColor).toBe(true)
  await third.unmount()
  await row.unmount()
  const again = await $.ui.mount(shellEdit('n-1', bashEdit()))
  expect(await again.find(said(EDIT_NOTES.first))).toBeDefined()
  await again.unmount()
})

test('shell edits keep the engine diff when tool rows are off', { options: { toolRows: false } }, async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(editResult('terminal', 'Bash', bashEdit()))
  expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\+2$/ })).toBeUndefined()
  await ui.unmount()
})

test('a root spelled with another case or separators prints as the dot, but only for drive letters', () => {
  expect(shortTarget({ cwd: 'E:\\projects\\example', home: 'E:\\u' }, 'e:\\projects\\example')).toBe('.')
  expect(shortTarget({ cwd: 'E:\\projects\\example', home: 'E:\\u' }, 'e:/projects/example/')).toBe('.')
  expect(shortTarget({ cwd: '/home/dev/app', home: '/home/dev' }, '/home/dev/app')).toBe('.')
  expect(shortTarget({ cwd: '/home/dev/app', home: '/home/dev' }, '/home/dev/App')).toBe('~/App')
})

test('an expanded shell row whose output is an error string shows that string', async ($, on) => {
  engine(on)
  await expand($, 'exp-err')
  const row = await $.ui.mount({
    plugin: 'merman',
    surface: 'terminal',
    component: 'ToolUse',
    props: { ...call('Bash', { command: 'cat /root/x' }, 'exp-err'), isErrored: true, output: 'Error: permission denied' },
  })
  expect(await row.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
  await row.unmount()
})

const setupRun = ($: Parameters<TestBody>[0], args: string) => $.command.run({ command: 'merman', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })

test('/merman setup walks every step, saves each pick through config, and can restart or jump to a step', async ($, on) => {
  const writes: { key: string; value: unknown }[] = []
  paneStandIn(on, [])
  on('config.set', (_, e) => {
    writes.push({ key: e.key, value: e.value })
    return { value: e.value }
  })
  const steps = setupSteps(PRESET_NAMES)
  expect(steps.map(s => s.key)).toEqual(['theme', 'tableStyle', 'taskStyle', 'headingStyle', 'copyButtonStyle', 'promptStyle', 'clock', 'toolStyle', 'toolOutput', 'diffStyle', 'pieStyle'])
  for (const step of steps.slice(1)) for (const value of step.options) expect(resolveStyle({ [step.key]: value })[step.key]).toBe(value)
  expect(steps[0]!.options).toEqual(PRESET_NAMES)
  expect(steps.find(s => s.key === 'copyButtonStyle')?.note).toContain('`hover` puts a dim ⧉ beside each block instead and shows its buttons only while the pointer is on that ⧉')
  expect((await setupRun($, 'setup')).text).toBe(SETUP_PANE_OPENED)
  expect((await setupRun($, 'setup theme')).text).toBe(setupText(setupParts(PRESET_NAMES, 0)))
  expect((await setupRun($, 'setup theme nord')).text).toBe(`Theme set to nord.\n\n${setupText(setupParts(PRESET_NAMES, 1))}`)
  expect((await setupRun($, 'setup tables 3')).text).toBe(`Tables set to grid.\n\n${setupText(setupParts(PRESET_NAMES, 2))}`)
  expect((await setupRun($, 'setup tasks progress')).text?.startsWith('Tasks set to progress.')).toBe(true)
  expect((await setupRun($, 'setup headings uppercase')).text).toBe(`Headings set to uppercase.\n\n${setupText(setupParts(PRESET_NAMES, 4))}`)
  expect((await setupRun($, 'setup copy hover')).text?.startsWith('Copy buttons set to hover.')).toBe(true)
  expect((await setupRun($, 'setup prompts bar')).text?.startsWith('Your prompts set to bar.')).toBe(true)
  expect((await setupRun($, 'setup clock 24h')).text).toBe(`Times set to 24h.\n\n${setupText(setupParts(PRESET_NAMES, 7))}`)
  expect((await setupRun($, 'setup tools tree-bold')).text).toBe(`Tool rows set to tree-bold.\n\n${setupText(setupParts(PRESET_NAMES, 8))}`)
  expect((await setupRun($, 'setup output 2')).text).toBe(`Tool output set to quiet.\n\n${setupText(setupParts(PRESET_NAMES, 9))}`)
  expect((await setupRun($, 'setup diffs 4')).text).toBe(`Diffs set to bar.\n\n${setupText(setupParts(PRESET_NAMES, 10))}`)
  expect((await setupRun($, 'setup pies bars')).text).toBe(`Pie charts set to bars.\n\n${SETUP_DONE}`)
  expect(writes).toEqual([
    { key: 'merman.theme', value: 'nord' },
    { key: 'merman.tableStyle', value: 'grid' },
    { key: 'merman.taskStyle', value: 'progress' },
    { key: 'merman.headingStyle', value: 'uppercase' },
    { key: 'merman.copyButtonStyle', value: 'hover' },
    { key: 'merman.promptStyle', value: 'bar' },
    { key: 'merman.clock', value: '24h' },
    { key: 'merman.toolStyle', value: 'tree-bold' },
    { key: 'merman.toolOutput', value: 'quiet' },
    { key: 'merman.diffStyle', value: 'bar' },
    { key: 'merman.pieStyle', value: 'bars' },
  ])
  expect((await setupRun($, 'setup tasks')).text).toBe(setupText(setupParts(PRESET_NAMES, 2)))
  expect((await setupRun($, 'setup tables 9')).text?.startsWith('Unknown tables pick "9".')).toBe(true)
  expect((await setupRun($, 'setup colors')).text?.startsWith('Unknown setup step "colors".')).toBe(true)
  expect(writes).toHaveLength(11)
  expect(setupText(setupParts(PRESET_NAMES, 7))).toContain('`tree-bold` or `classic`')
})

const paneStandIn = (on: Parameters<TestBody>[1], log: string[], surfaces: readonly ('terminal' | 'desktop')[] = ['terminal']) => {
  on('session.surfaces', () => ({ value: surfaces }))
  on('ui.open', (_, e) => {
    log.push(`open ${e.id}`)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', (_, e) => {
    log.push(`close ${e.id}`)
    return { value: undefined }
  })
}

const setupPane = ($: Parameters<TestBody>[0], surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'merman', surface, component: 'Pane', requestId: 'merman-setup', props: { title: 'merman setup', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 48 }, view: {} }, viewport: { columns: 180, rows: 50 } })

const WIDE_SEQUENCE = [
  'sequenceDiagram',
  '  actor U as Customer',
  '  participant WEB as Storefront',
  '  participant API as Order Service',
  '  participant DB as Order Database',
  '  participant BUS as Event Bus',
  '  participant PAY as Payment Gateway',
  '  participant INV as Inventory',
  '  participant MAIL as Notifier',
  '  participant WH as Warehouse',
  '  U->>WEB: Place order',
  '  WEB->>API: POST /orders',
  '  API->>DB: OrderCreated',
  '  DB--)BUS: change stream',
  '  BUS->>PAY: charge card',
  '  BUS->>INV: reserve items',
  '  INV->>WH: pick and pack',
  '  MAIL-->>U: Order confirmed',
].join('\n')

const wideReply = ($: Parameters<TestBody>[0], columns: number, surface: 'terminal' | 'desktop' = 'terminal') =>
  $.ui.mount({ plugin: 'merman', component: 'AssistantMessage', props: { text: '```mermaid\n' + WIDE_SEQUENCE + '\n```', isFirstOfReply: true }, viewport: { columns, rows: 40 }, surface })

test('a diagram wider than the window draws full size in place and scrolls sideways by keys, drag and its bar', async $ => {
  const reply = await wideReply($, 100)
  const shown = async () => Number(/ {2}(\d+)–/.exec((await reply.find({ type: 'Text', text: /^◀ /, in: 'view0' }))?.text ?? '')?.[1])
  expect((await reply.find({ type: 'Text', text: /^◀ /, in: 'view0' }))?.text).toMatch(/ ▶ {2}1–\d+ of \d+ · drag, or click then ← →$/)
  expect(await reply.find({ text: /│ Customer │/, in: 'view0' })).toBeTruthy()
  expect(await reply.find({ text: /│ Warehouse │/, in: 'view0' })).toBeUndefined()
  await reply.key({ key: 'end', in: 'view0' })
  expect(await reply.find({ text: /│ Warehouse │/, in: 'view0' })).toBeTruthy()
  expect(await reply.find({ text: /│ Customer │/, in: 'view0' })).toBeUndefined()
  await reply.key({ key: 'home', in: 'view0' })
  expect(await shown()).toBe(1)
  await reply.key({ key: 'right', in: 'view0' })
  const stepped = await shown()
  expect(stepped).toBeGreaterThan(1)
  await reply.pointer({ type: 'down', x: 40, y: 5, button: 'left', in: 'view0' })
  await reply.pointer({ type: 'move', x: 30, y: 5, button: 'left', in: 'view0' })
  await reply.pointer({ type: 'up', x: 30, y: 5, button: 'left', in: 'view0' })
  expect(await shown()).toBe(stepped + 10)
  await reply.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'view0' })
  expect(await shown()).toBeLessThan(stepped + 10)
  await reply.unmount()
})

test('a diagram that fits draws in place with no scroll bar', async $ => {
  const reply = await wideReply($, 240)
  expect(await reply.find({ type: 'Text', text: /^◀ / })).toBeUndefined()
  expect(await reply.find({ text: /│ Warehouse │/ })).toBeTruthy()
  await reply.unmount()
})


test('/merman setup opens a pane in the terminal: arrows move through the styles with a preview of the one in focus, Enter saves it and shows the next step, the last pick closes the pane', async ($, on) => {
  const writes: { key: string; value: unknown }[] = []
  on('config.set', (_, e) => {
    writes.push({ key: e.key, value: e.value })
    return { value: e.value }
  })
  on('ui.focus', () => ({}))
  const panes: string[] = []
  paneStandIn(on, panes)
  expect((await setupRun($, 'setup')).text).toBe(SETUP_PANE_OPENED)
  expect(panes).toEqual(['open merman-setup'])
  const pane = await setupPane($, 'terminal')
  expect(await pane.find({ type: 'Text', text: /Setup 1\/11: Theme/ })).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: new RegExp(SETUP_PANE_KEYS.slice(0, 20)) })).toBeTruthy()
  expect((await pane.findAll({ type: 'Button' })).map(b => b.props.key)).toHaveLength(PRESET_NAMES.length + 1)
  expect(await pane.find({ type: 'Button', key: 'pick:theme:catppuccin-mocha' })).toMatchObject({ props: { autoFocus: true, variant: 'primary' } })
  expect(await pane.find({ type: 'Text', text: /^\d+\. catppuccin-mocha/ })).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: /^\d+\. nord/ })).toBeUndefined()
  await $.ui.focus({ component: 'Pane', requestId: 'merman-setup', element: 'pick:theme:nord', origin: { kind: 'person' } })
  expect(await pane.find({ type: 'Text', text: /^\d+\. nord/ })).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: /^\d+\. catppuccin-mocha/ })).toBeUndefined()
  await pane.press({ key: 'pick:theme:nord' })
  expect(await pane.find({ type: 'Text', text: /Setup 2\/11: Tables/ })).toBeTruthy()
  for (const [step, value] of [['tables', 'grid'], ['tasks', 'progress'], ['headings', 'uppercase'], ['copy', 'hover'], ['prompts', 'bar'], ['clock', '24h'], ['tools', 'tree-bold'], ['output', 'quiet']] as const) await pane.press({ key: `pick:${step}:${value}` })
  expect(await pane.find({ type: 'Text', text: /Setup 10\/11: Diffs/ })).toBeTruthy()
  await pane.press({ key: 'pick:diffs:bar' })
  expect(await pane.find({ type: 'Text', text: /Setup 11\/11: Pie charts/ })).toBeTruthy()
  await pane.press({ key: 'pick:pies:bars' })
  expect(writes.map(w => `${w.key}=${String(w.value)}`)).toEqual(['merman.theme=nord', 'merman.tableStyle=grid', 'merman.taskStyle=progress', 'merman.headingStyle=uppercase', 'merman.copyButtonStyle=hover', 'merman.promptStyle=bar', 'merman.clock=24h', 'merman.toolStyle=tree-bold', 'merman.toolOutput=quiet', 'merman.diffStyle=bar', 'merman.pieStyle=bars'])
  expect(panes).toEqual(['open merman-setup', 'close merman-setup'])
  await pane.unmount()
})

test('/merman setup in a session with no terminal, as the desktop app runs it, walks the steps in the transcript and opens no pane', async ($, on) => {
  const panes: string[] = []
  paneStandIn(on, panes, ['desktop'])
  expect((await setupRun($, 'setup')).text).toBe(setupText(setupParts(PRESET_NAMES, 0)))
  expect(panes).toEqual([])
})

test('/merman setup sent from a Remote Control client to a terminal session walks the steps in the transcript and opens no pane', async ($, on) => {
  const panes: string[] = []
  paneStandIn(on, panes, ['terminal', 'desktop'])
  const run = await $.command.run({ command: 'merman', args: 'setup', origin: { kind: 'bridge' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(run.text).toBe(setupText(setupParts(PRESET_NAMES, 0)))
  expect(panes).toEqual([])
})

test('/merman setup in the pane stays on the step and keeps the pane open when a save is refused', async ($, on) => {
  on('config.set', () => ({ deny: 'managed' }))
  on('ui.focus', () => ({}))
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const panes: string[] = []
  paneStandIn(on, panes)
  await setupRun($, 'setup')
  const pane = await setupPane($, 'terminal')
  await pane.press({ key: 'pick:theme:nord' })
  expect(await pane.find({ type: 'Text', text: /Setup 1\/11: Theme/ })).toBeTruthy()
  expect(await pane.find({ type: 'Button', key: 'pick:theme:nord' })).toMatchObject({ props: { variant: 'primary' } })
  expect(panes).toEqual(['open merman-setup'])
  expect(toasts.at(-1)).toBe('Could not switch theme: managed')
  await pane.unmount()
})

test('/merman setup in the pane takes the arrows for the ring when its list is taller than the pane, and leaves the wheel and the arrow past either end to scroll', async ($, on) => {
  on('ui.focus', () => ({}))
  const scrolled: number[] = []
  on('ui.scroll', (_, e) => {
    scrolled.push(e.by)
    return {}
  })
  paneStandIn(on, [])
  await setupRun($, 'setup')
  const scroll = (by: number, pointer?: { column: number; row: number }) => $.ui.scroll({ component: 'Pane', requestId: 'merman-setup', offset: 1, by, bodyRows: 10, contentRows: 30, origin: { kind: 'person' }, ...(pointer ? { pointer } : {}) })
  await scroll(1)
  expect(scrolled).toEqual([])
  await $.ui.focus({ component: 'Pane', requestId: 'merman-setup', element: 'pick:theme:catppuccin-mocha', origin: { kind: 'person' } })
  await scroll(-1)
  expect(scrolled).toEqual([-1])
  await scroll(1, { column: 4, row: 2 })
  await scroll(10)
  expect(scrolled).toEqual([-1, 1, 10])
})

test('/merman setup in the pane keeps to the rows it is given when the list fits, so the arrows move the ring instead of scrolling', async ($, on) => {
  paneStandIn(on, [])
  await setupRun($, 'setup')
  const mount = (bodyRows: number) => $.ui.mount({ plugin: 'merman', surface: 'terminal', component: 'Pane', requestId: 'merman-setup', props: { title: 'merman setup', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows }, view: {} }, viewport: { columns: 100, rows: 40 } })
  const fits = await mount(26)
  expect((await fits.findAll({ type: 'Box' })).filter(b => b.props.height === 26 && b.props.overflow === 'hidden')).toHaveLength(1)
  await fits.unmount()
  const tight = await mount(20)
  expect((await tight.findAll({ type: 'Box' })).filter(b => b.props.height !== undefined)).toHaveLength(0)
  await tight.unmount()
})

test('/merman setup in the pane opens again on the last step when its save is refused', async ($, on) => {
  on('config.set', (_, e) => (e.key === 'merman.pieStyle' ? { deny: 'managed' } : { value: e.value }))
  on('ui.focus', () => ({}))
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const panes: string[] = []
  paneStandIn(on, panes)
  await setupRun($, 'setup')
  const pane = await setupPane($, 'terminal')
  for (const [step, value] of [['theme', 'nord'], ['tables', 'grid'], ['tasks', 'progress'], ['headings', 'uppercase'], ['copy', 'hover'], ['prompts', 'bar'], ['clock', '24h'], ['tools', 'tree-bold'], ['output', 'quiet'], ['diffs', 'bar'], ['pies', 'bars']] as const) await pane.press({ key: `pick:${step}:${value}` })
  expect(panes).toEqual(['open merman-setup', 'close merman-setup', 'open merman-setup'])
  expect(await pane.find({ type: 'Text', text: /Setup 11\/11: Pie charts/ })).toBeTruthy()
  expect(toasts.at(-1)).toBe('Could not save pieStyle: managed')
  await pane.unmount()
})

test('/merman setup in the pane shows the next step and its toast before the save returns, since a save that changes a value reloads the mod', async ($, on) => {
  on('config.set', () => new Promise(() => undefined))
  on('ui.focus', () => ({}))
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  paneStandIn(on, [])
  await setupRun($, 'setup')
  const pane = await setupPane($, 'terminal')
  await pane.press({ key: 'pick:theme:dracula' })
  expect(await pane.find({ type: 'Text', text: /Setup 2\/11: Tables/ })).toBeTruthy()
  expect(await pane.find({ type: 'Button', key: 'pick:tables:box' })).toMatchObject({ props: { variant: 'primary' } })
  expect(toasts).toEqual(['Theme set to dracula.'])
  await pane.unmount()
})

test('/merman setup walks the steps in the transcript and closes the pane when no surface can place it', async ($, on) => {
  const panes: string[] = []
  on('session.surfaces', () => ({ value: ['terminal' as const] }))
  on('ui.open', (_, e) => {
    panes.push(`open ${e.id}`)
    return { value: { isPlaced: false as const, reason: 'no-surface' } }
  })
  on('ui.close', (_, e) => {
    panes.push(`close ${e.id}`)
    return { value: undefined }
  })
  expect((await setupRun($, 'setup')).text).toBe(setupText(setupParts(PRESET_NAMES, 0)))
  expect(panes).toEqual(['open merman-setup', 'close merman-setup'])
})

test('/merman setup previews the theme random uses now when the ring is on random', { options: { theme: 'random' } }, async ($, on) => {
  on('ui.focus', () => ({}))
  paneStandIn(on, [])
  await setupRun($, 'setup')
  const pane = await setupPane($, 'terminal')
  expect(await pane.find({ type: 'Button', key: 'pick:theme:random' })).toMatchObject({ props: { autoFocus: true, variant: 'primary' } })
  expect(await pane.find({ type: 'Text', text: /Release notes/ })).toBeTruthy()
  await pane.unmount()
})

test('/merman setup stops on a refused save', async ($, on) => {
  on('config.set', () => ({ deny: 'managed' }))
  expect((await setupRun($, 'setup tables box')).text).toBe('Could not save tableStyle: managed')
})

test('/merman setup marks light themes for a light terminal', () => {
  const labels = setupParts(PRESET_NAMES, 0).options.map(o => o.text.split('\n')[0] ?? '')
  expect(labels.filter(l => l.endsWith('(for a light terminal)')).length).toBe(PRESET_NAMES.filter(t => /latte|light|dawn/.test(t)).length)
  expect(labels.find(l => l.includes('mono'))).not.toContain('light terminal')
})

test('/merman setup draws each sample in its own style', async $ => {
  const mount = async (at: number) =>
    $.ui.mount({ plugin: 'merman', surface: 'terminal', component: 'CommandOutput', props: { command: 'merman', args: 'setup', text: `Tables set to box.\n\n${setupText(setupParts(PRESET_NAMES, at))}`, isErrored: false }, viewport: { columns: 100, rows: 40 } })
  const themes = await mount(0)
  for (const name of ['nord', 'dracula']) {
    const heading = await themes.find({ type: 'Text', text: new RegExp(`${name}$`) })
    expect(heading?.props.color).toBe(PRESETS[name as keyof typeof PRESETS].accent)
  }
  await themes.unmount()
  const tasks = await mount(2)
  expect(await tasks.find({ type: 'Text', text: /^✓ $/ })).toBeTruthy()
  expect(await tasks.find({ type: 'Text', text: /\[✓\]/ })).toBeTruthy()
  await tasks.unmount()
  const headings = await mount(3)
  expect(await headings.findAll({ type: 'Text', text: /^RELEASE NOTES$/ })).toHaveLength(1)
  expect(await headings.findAll({ type: 'Text', text: /^━{5}$/ })).toHaveLength(1)
  expect((await headings.findAll({ type: 'Text', text: /^Fixes$/ })).filter(t => t.props.underline)).toHaveLength(1)
  await headings.unmount()
  const copy = await mount(4)
  expect(await copy.findAll({ type: 'Text', text: /^\[ ⧉ md \]$/ })).toHaveLength(2)
  expect((await copy.findAll({ type: 'Box' })).filter(b => b.props.display === 'none').map(b => b.text)).toEqual(['[ ⧉ md ] [ ⧉ art ]'])
  expect((await copy.findAll({ type: 'Text', text: /^⧉$/ })).map(t => t.props.dimColor)).toEqual([true])
  expect(await copy.findAll({ type: 'Text', text: /^Its buttons show only while the pointer is on its ⧉\.$/ })).toHaveLength(1)
  expect(await copy.findAll({ type: 'Button' })).toHaveLength(0)
  await copy.unmount()
  const prompts = await mount(5)
  expect(await prompts.findAll({ type: 'Text', text: /fix the failing test/ })).toHaveLength(5)
  await prompts.unmount()
  const clock = await mount(6)
  expect(await clock.findAll({ type: 'Text', text: /^14:32 ?$/ })).toHaveLength(1)
  expect(await clock.findAll({ type: 'Text', text: /^2:32 PM ?$/ })).toHaveLength(1)
  expect(await clock.findAll({ type: 'Text', text: /fix the failing test/ })).toHaveLength(3)
  await clock.unmount()
  const tools = await mount(7)
  expect(await tools.find({ type: 'Text', text: /⎿/ })).toBeTruthy()
  expect(await tools.findAll({ type: 'Text', text: /^Read$/ })).toHaveLength(4)
  await tools.unmount()
  const output = await mount(8)
  expect(await output.findAll({ type: 'Text', text: /^Build the app · npm/ })).toHaveLength(1)
  expect(await output.findAll({ type: 'Text', text: /Error: Exit code 2/ })).toHaveLength(1)
  expect(await output.findAll({ type: 'Text', text: /error TS2322/ })).toHaveLength(7)
  expect(await output.findAll({ type: 'Text', text: /\+4 lines \(ctrl\+o to expand\)/ })).toHaveLength(1)
  expect(await output.findAll({ type: 'Text', text: /Found 10 errors in the same file/ })).toHaveLength(1)
  expect(await output.findAll({ type: 'Text', text: /On branch main/ })).toHaveLength(1)
  expect(await output.findAll({ type: 'Text', text: /Allowed by auto mode classifier/ })).toHaveLength(1)
  expect(await output.findAll({ type: 'Text', text: /\+3 lines \(ctrl\+o to expand\)/ })).toHaveLength(1)
  await output.unmount()
  const diffs = await mount(9)
  expect(await diffs.findAll({ type: 'Text', text: /^Edited$/ })).toHaveLength(4)
  expect(await diffs.findAll({ type: 'Text', text: /^ {2}retries: 5,$/ })).toHaveLength(4)
  expect((await diffs.findAll({ type: 'Box' })).filter(b => b.props.borderStyle === 'round')).toHaveLength(1)
  expect((await diffs.findAll({ type: 'Box' })).filter(b => b.props.backgroundColor)).toHaveLength(8)
  expect(await diffs.findAll({ type: 'Text', text: /^▌ $/ })).toHaveLength(4)
  await diffs.unmount()
})

const shown = async ($: Parameters<TestBody>[0], args: string, surface: 'terminal' | 'desktop' = 'terminal') => {
  const { text = '' } = await setupRun($, args)
  const ui = await $.ui.mount({ plugin: 'merman', surface, component: 'CommandOutput', props: { command: 'merman', args, text: `merman: ${text}`, isErrored: false }, viewport: { columns: 120, rows: 40 } })
  return { text, ui }
}

test('/merman demo adds a section in the language of LANG, and demo ko picks one', async ($, on) => {
  mock.env(on, { LANG: 'ko_KR.UTF-8' })
  const fromLang = await shown($, 'demo')
  expect(fromLang.text).toBe(KOREAN_DEMO_SHOWN)
  expect(await fromLang.ui.find({ text: /한국어/ })).toBeDefined()
  await fromLang.ui.unmount()
  const asked = await shown($, 'demo ko')
  expect(await asked.ui.find({ text: /이미지 생성 완료/ })).toBeDefined()
  await asked.ui.unmount()
})

test('/merman demo stays English when LANG names no showcase language', async ($, on) => {
  mock.env(on, { LANG: 'en_US.UTF-8' })
  const english = await shown($, 'demo')
  expect(english.text).toBe(DEMO_SHOWN)
  expect(await english.ui.find({ text: /한국어/ })).toBeUndefined()
  await english.ui.unmount()
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`/merman help, demo and demo-rtl leave the model one short line and draw the whole screen on ${surface}`, async ($, on) => {
    mock.env(on, {})
    for (const [args, mark] of [['', /Hebrew right-to-left showcase/], ['help', /Hebrew right-to-left showcase/], ['demo', /Everything it draws/], ['demo-rtl', /us-east/]] as const) {
      const { text, ui } = await shown($, args, surface)
      expect([text.includes('\n'), text.length < 80, mark.test(text)]).toEqual([false, true, false])
      expect(await ui.find({ text: /^merman:$/ })).toBeDefined()
      expect(await ui.find({ text: mark })).toBeDefined()
      await ui.unmount()
    }
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a collapsed tool group says how to expand it only where ctrl+o works (${surface})`, async $ => {
    const ui = await $.ui.mount({ plugin: 'merman', surface, component: 'ToolGroup', props: { calls: [call('Bash', { command: 'ls' }, 'a')], isActive: false, isExpanded: false } })
    const hint = await ui.find({ type: 'Text', text: /^ \(ctrl\+o to expand\)$/ })
    if (surface === 'terminal') expect(hint?.props.dimColor).toBe(true)
    else expect(hint).toBeUndefined()
    await ui.unmount()
  })
}

test('the turn footer is Claude Code\'s own line, so its end time and notes stay', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ plugin: 'merman', surface: 'terminal', component: 'TurnDuration', props: { word: 'Baked', durationMs: 380000 } })
  expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
  await ui.unmount()
})

test('the ctrl+o transcript draws tool rows and quiet results in full', { options: { toolOutput: 'quiet' } }, async ($, on) => {
  engine(on)
  const row = await $.ui.mount({ plugin: 'merman', surface: 'terminal', component: 'ToolUse', props: { ...call('Read', { file_path: '/tmp/x' }, 'r1'), isExpanded: true } })
  expect(await row.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
  await row.unmount()
  const result = await $.ui.mount({ plugin: 'merman', surface: 'terminal', component: 'ToolResult', props: { tool_use_id: 'r1', tool: 'Read', output: 'x', isErrored: false, isExpanded: true } })
  expect(await result.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
  await result.unmount()
})

test('a reply block holding a summary keeps its summary mark', async $ => {
  const ui = await $.ui.mount({ plugin: 'merman', surface: 'terminal', component: 'AssistantMessage', props: { text: 'Read the config and ran the tests.', isFirstOfReply: true, isSummary: true } })
  expect((await ui.find({ type: 'Text', text: /^· summary$/ }))?.props.dimColor).toBe(true)
  await ui.unmount()
})
