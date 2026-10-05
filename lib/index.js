/**
 * dsh-notify-card — pop a Windows card when one conversation turn finishes.
 *
 * The plugin observes the durable session event feed (`session/event`), folds the
 * events of the turn that is closing into a short human summary, and hands that
 * summary to `assets/notify.ps1`, which draws an always-on-top Windows card in
 * the bottom-right corner of the monitor under the mouse.
 *
 * Everything user visible is composed here; the PowerShell renderer stays ASCII
 * only and receives its text as a UTF-8 JSON payload file, so Chinese (or any
 * other non-ASCII) text survives Windows PowerShell 5.1's ANSI script decoding.
 *
 * Preferences (which sections show, the sound, the auto-close delay) are stored
 * in `$DSH_HOME/turn-notify/config.json` and edited from the DSH settings page
 * this package contributes (`settings.section`, served from `lib/client.js`)
 * through the routes registered below.
 *
 * Environment variables supply the defaults / a headless override:
 *   DSH_TURN_NOTIFY=0                 disable notifications entirely
 *   DSH_TURN_NOTIFY_SUBAGENTS=1       also notify for subagent/fork sessions
 *   DSH_TURN_NOTIFY_TIMEOUT=25        auto-close seconds (0 = stay open)
 *   DSH_TURN_NOTIFY_SUMMARY_CHARS=420 summary truncation budget
 *   DSH_TURN_NOTIFY_POWERSHELL=...    powershell executable override
 *   DSH_TURN_NOTIFY_SOUND=auto        auto | none | asterisk | exclamation |
 *                                     hand | question | beep | <absolute .wav>
 *   DSH_TURN_NOTIFY_DEBUG=1           write $DSH_HOME/logs/turn-notify.log
 *   ($DSH_HOME/logs/turn-notify.trace, an empty file, does the same)
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  SOUND_KINDS,
  addBackground,
  addSound,
  defaultConfig,
  folderStats,
  imageMime,
  listBackgrounds,
  listSounds,
  normalizeConfig,
  pickFolderImage,
  readConfig,
  removeBackground,
  removeSound,
  resolveBackground,
  resolveSound,
  setBackgroundFocus,
  soundPath,
  systemTheme,
  writeConfig,
} from './config.js'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT_PATH = path.join(PACKAGE_ROOT, 'assets', 'notify.ps1')
const PREVIEW_SCRIPT_PATH = path.join(PACKAGE_ROOT, 'assets', 'play.ps1')
const FOLDER_SCRIPT_PATH = path.join(PACKAGE_ROOT, 'assets', 'pickfolder.ps1')

/** How long a native folder dialog may stay open before the host gives up. */
const FOLDER_PICK_TIMEOUT_MS = 300000

const VERSION = '0.7.4'
const MAX_TOOL_NAMES = 6
const MAX_FILE_NAMES = 4
const MAX_BODY_BYTES = 9 * 1024 * 1024

/** Tools whose call means a file (or a presented artifact) changed. */const MUTATING_TOOLS = new Set([
  'write',
  'edit',
  'present',
  'str_replace',
  'str_replace_editor',
  'str_replace_based_edit_tool',
  'notebook_edit',
])

/** The model-visible tool that puts a question (with options) in front of the user. */
const ASK_TOOL_NAME = 'ask_user_question'

/** The `questions` array out of an ask-the-user tool call. */
function questionsFromArguments(text) {
  try {
    const parsed = JSON.parse(typeof text === 'string' && text ? text : '{}')
    return Array.isArray(parsed && parsed.questions) ? parsed.questions : []
  } catch {
    return []
  }
}

function flag(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  const text = String(value).trim().toLowerCase()
  return !(text === '0' || text === 'false' || text === 'no' || text === 'off')
}

function intFromEnv(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

/** Environment-derived defaults, folded under the stored configuration. */
function envOptions() {
  const sound = String(process.env.DSH_TURN_NOTIFY_SOUND ?? '').trim()
  const lower = sound.toLowerCase()
  let soundKind = 'asterisk'
  if (SOUND_KINDS.includes(lower)) soundKind = lower
  return {
    enabled: flag(process.env.DSH_TURN_NOTIFY, true),
    debug: flag(process.env.DSH_TURN_NOTIFY_DEBUG, false),
    subagents: flag(process.env.DSH_TURN_NOTIFY_SUBAGENTS, false),
    timeoutSeconds: intFromEnv(process.env.DSH_TURN_NOTIFY_TIMEOUT, 25),
    summaryChars: intFromEnv(process.env.DSH_TURN_NOTIFY_SUMMARY_CHARS, 420),
    powershell: process.env.DSH_TURN_NOTIFY_POWERSHELL || 'powershell.exe',
    soundKind,
    soundMode: lower === 'none' || lower === '0' || lower === 'off' ? 'none' : undefined,
    soundFile: lower.endsWith('.wav') ? sound : undefined,
  }
}

/** The stored configuration with the environment folded under it. */
function storedConfig(options) {
  const config = readConfig(options)
  // The environment can only express the *initial* preference: a value the user
  // saved in the settings page always wins.
  if (options.soundMode === 'none' && config.sound.mode === 'auto') config.sound.mode = 'none'
  if (options.soundFile && config.sound.mode === 'auto') {
    config.sound.mode = 'file'
    config.sound.file = options.soundFile
  }
  return config
}

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

/** Opt-in trace ($DSH_HOME/logs/turn-notify.log) for diagnosing a silent popup.
 *  Enabled by `DSH_TURN_NOTIFY_DEBUG=1`, or by an empty `turn-notify.trace`
 *  marker file beside the log — the marker is re-checked on every call. */
function traceOn(options) {
  if (options.debug) return true
  try {
    return fs.existsSync(path.join(dshHome(), 'logs', 'turn-notify.trace'))
  } catch {
    return false
  }
}

function trace(options, message) {
  if (!traceOn(options)) return
  try {
    const dir = path.join(dshHome(), 'logs')
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(path.join(dir, 'turn-notify.log'), `${new Date().toISOString()} ${message}\n`, 'utf8')
  } catch {}
}

function squash(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function oneLine(text) {
  return squash(text).replace(/\s*\n\s*/g, ' ').trim()
}

/** Strip the markdown scaffolding a model reply carries, keeping the words. */
function plainText(text) {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;!?]|$)/g, '$1$2')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/^\s{0,3}\d+[.)]\s+/gm, '')
    .replace(/^\s*\|.*\|\s*$/gm, (line) => line.replace(/\|/g, ' ').trim())
    .replace(/^\s*[-:|\s]{3,}\s*$/gm, ' ')
    .replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, '$1')
}

function truncate(text, budget) {
  const value = String(text ?? '')
  if (value.length <= budget) return value
  const cut = value.slice(0, Math.max(0, budget - 1))
  const boundary = Math.max(
    cut.lastIndexOf('\n'),
    cut.lastIndexOf('。'),
    cut.lastIndexOf('！'),
    cut.lastIndexOf('？'),
    cut.lastIndexOf('. '),
    cut.lastIndexOf('; '),
  )
  const head = boundary > budget * 0.5 ? cut.slice(0, boundary + 1) : cut
  return `${head.trimEnd()}…`
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '未知'
  const total = Math.round(ms / 1000)
  if (total < 60) return `${total} 秒`
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes < 60) return seconds === 0 ? `${minutes} 分` : `${minutes} 分 ${seconds} 秒`
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`
}

function textBlocks(message) {
  const content = message && Array.isArray(message.content) ? message.content : []
  const parts = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) parts.push(block.text)
  }
  return parts.join('\n').trim()
}

function messageFailed(message) {
  if (!message || typeof message !== 'object') return false
  if (message.isError === true) return true
  const content = Array.isArray(message.content) ? message.content : []
  return content.some((block) => block && typeof block === 'object' && block.isError === true)
}

function filePathOf(argumentsJson) {
  if (typeof argumentsJson !== 'string' || !argumentsJson.trim()) return undefined
  let parsed
  try {
    parsed = JSON.parse(argumentsJson)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object') return undefined
  for (const key of ['file_path', 'filePath', 'path', 'target', 'notebook_path']) {
    const value = parsed[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function shortPath(value) {
  const parts = String(value).split(/[\\/]+/).filter(Boolean)
  if (parts.length <= 2) return parts.join('\\')
  return `…\\${parts.slice(-2).join('\\')}`
}

function displayTitle(title, sessionId) {
  const text = oneLine(title)
  if (text) return text
  return `会话 ${String(sessionId ?? '').slice(-6) || '未知'}`
}

function buildPayload(state, reason, endedAt, config) {
  const show = config.show || {}
  const turn = state.turn
  const elapsed = Number.isFinite(state.startedAt) ? endedAt - state.startedAt : undefined
  const toolTotal = [...state.tools.values()].reduce((sum, count) => sum + count, 0)

  const headline = [`第 ${turn} 轮`]
  if (Number.isFinite(elapsed)) headline.push(`用时 ${formatDuration(elapsed)}`)
  if (toolTotal > 0) headline.push(`工具调用 ${toolTotal} 次`)
  if (state.files.size > 0) headline.push(`文件改动 ${state.files.size} 个`)
  if (state.errors > 0) headline.push(`出错 ${state.errors} 次`)

  const rankedTools = [...state.tools.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const shownTools = rankedTools.slice(0, MAX_TOOL_NAMES).map(([name, count]) => (count > 1 ? `${name} ×${count}` : name))
  if (rankedTools.length > MAX_TOOL_NAMES) shownTools.push(`等 ${rankedTools.length} 种`)
  const toolsLine = shownTools.length ? `工具：${shownTools.join(' · ')}` : ''

  const fileNames = [...state.files.keys()]
  const shownFiles = fileNames.slice(0, MAX_FILE_NAMES).map(shortPath)
  if (fileNames.length > MAX_FILE_NAMES) shownFiles.push(`等 ${fileNames.length} 个`)
  const filesLine = shownFiles.length ? `文件：${shownFiles.join('、')}` : ''

  let summary = oneLine(plainText(state.lastText)) || oneLine(plainText(state.summary))
  if (!summary) {
    summary = toolTotal > 0 ? `本轮调用了 ${toolTotal} 次工具，没有文字结论。` : '本轮没有产生文字结论。'
  } else {
    summary = truncate(summary, config.summaryChars)
  }

  let status = 'ok'
  let title = 'DSH · 对话完成'
  if (reason === 'cancelled') {
    status = 'warn'
    title = 'DSH · 对话已取消'
  } else if (reason !== 'completed') {
    status = 'error'
    title = 'DSH · 对话中断'
  }
  if (state.errors > 0 && status === 'ok') {
    status = 'warn'
    title = 'DSH · 对话完成（有错误）'
  }

  const sound = resolveSound(config, status)
  const background = resolveBackground(config)
  // The conversation this card belongs to, when that is not simply the session
  // line: for a delegated session the target is the conversation that sent it,
  // and printing the same title twice would be noise.
  const sessionLine = show.session === false ? '' : displayTitle(state.title, state.sessionId)
  const conversation = show.target === false ? '' : oneLine(state.conversationTitle)

  return {
    title: show.title === false ? '' : title,
    session: sessionLine,
    target: conversation && conversation !== sessionLine ? conversation : '',
    headline: show.headline === false ? '' : headline.join(' · '),
    summary: show.summary === false ? '' : summary,
    tools: show.tools === false ? '' : toolsLine,
    files: show.files === false ? '' : filesLine,
    footer: show.footer === false ? '' : '点击或按 Esc 关闭',
    status,
    theme: config.theme === 'auto' ? systemTheme() : config.theme,
    backgroundImage: background.backgroundImage,
    dim: background.dim,
    focusX: background.focusX,
    focusY: background.focusY,
    anchor: config.position.anchor,
    marginX: config.position.marginX,
    marginY: config.position.marginY,
    maxWidth: config.size.maxWidth,
    maxHeight: config.size.maxHeight,
    animate: config.animation.enabled && config.animation.durationMs > 0,
    animationMs: config.animation.durationMs,
    sound: sound.sound,
    soundFile: sound.soundFile,
    timeoutSeconds: config.timeoutSeconds,
  }
}

/**
 * One fixed, realistic turn for the settings page's "send a sample" button. It
 * runs through the same `buildPayload` as a real turn, so the card the user sees
 * is shaped by exactly the preferences on screen (unsaved drafts included).
 * @param config - the configuration to render the sample with.
 * @returns the payload for `assets/notify.ps1`.
 */
function samplePayload(config) {
  const now = Date.now()
  return buildPayload(
    {
      sessionId: 'sample',
      title: '示例会话：给登录接口补测试',
      turn: 3,
      startedAt: now - 132000,
      tools: new Map([
        ['pytest', 6],
        ['read', 4],
        ['edit', 2],
        ['grep', 1],
      ]),
      files: new Map([
        ['D:\\demo\\tests\\test_login.py', 1],
        ['D:\\demo\\app\\auth.py', 1],
      ]),
      errors: 0,
      lastText:
        '已完成：给 `POST /login` 补了 6 个用例（成功、密码错误、账号锁定、超大请求体、并发两次、记住我），'
        + '并修掉了锁定计数在 Redis 里没有设置过期时间的问题。全部用例通过，覆盖率 71% → 84%。',
      summary: '',
    },
    'completed',
    now,
    config,
  )
}

/** How long a card is held back, so an instantly-decided request never flashes. */
const AWAITING_HOLD_MS = 700
/** After the user answers, a click on the card still jumps for this long. */
const AWAITING_LATE_CLICK_MS = 6000
/** Two identical requests inside this window only ring once. */
const AWAITING_DEDUPE_MS = 8000
/** A burst of approvals must not stack a pile of cards on the desktop. */
const AWAITING_MIN_GAP_MS = 1200

/**
 * The human-readable reason for an approval, preferring a localized string when
 * the request carries one (`displayReason: { en, zh, … }`).
 */
function approvalReason(req) {
  const entries = req && req.displayReason && typeof req.displayReason === 'object' ? req.displayReason : null
  if (entries) {
    for (const key of ['zh', 'zh-CN', 'zh-Hans', 'en']) {
      const value = entries[key]
      if (typeof value === 'string' && value.trim()) return oneLine(value)
    }
  }
  if (typeof req.reason === 'string' && req.reason.trim()) return oneLine(req.reason)
  return ''
}

/** What the card says when a tool asks for permission. */
function approvalText(req) {
  const tool = req && typeof req.toolName === 'string' && req.toolName.trim() ? req.toolName.trim() : '某个工具'
  return {
    headline: `需要你确认：${tool}`,
    summary: approvalReason(req) || '这一步需要你在 DSH 里允许或拒绝之后才能继续。',
    footer: '在 DSH 窗口里点「允许」或「拒绝」',
  }
}

/**
 * What the card says when the model asks the user to choose. Long option lists
 * are cut down here because the card trims to its own size anyway; the full text
 * is always on the real prompt in DSH.
 */
function questionText(request) {
  const items = Array.isArray(request && request.questions)
    ? request.questions.filter((item) => item && typeof item.question === 'string' && item.question.trim())
    : []
  if (!items.length) {
    return { headline: '有事情需要你确认', summary: 'DSH 正在等你回答。', footer: '在 DSH 窗口里作答' }
  }
  const lines = []
  items.slice(0, 3).forEach((item, index) => {
    lines.push(`${items.length > 1 ? `${index + 1}. ` : ''}${oneLine(item.question)}`)
    const options = Array.isArray(item.options)
      ? item.options.filter((option) => option && typeof option.label === 'string' && option.label.trim()).map((option) => oneLine(option.label))
      : []
    if (options.length) {
      lines.push(`    选项：${options.slice(0, 5).join(' / ')}${options.length > 5 ? ' …' : ''}${item.multiSelect ? '（可多选）' : ''}`)
    } else if (item.multiSelect) {
      lines.push('    （可多选）')
    }
  })
  if (items.length > 3) lines.push(`    …还有 ${items.length - 3} 个问题`)
  const header = items.length === 1 && typeof items[0].header === 'string' ? oneLine(items[0].header) : ''
  return {
    headline: items.length === 1 ? header || '1 个问题在等你回答' : `${items.length} 个问题在等你回答`,
    summary: lines.join('\r\n'),
    footer: '在 DSH 窗口里选择即可',
  }
}

/**
 * The payload for a card that says the session is blocked on the user.
 *
 * These cards reuse the ordinary card renderer, so they honour the same theme,
 * background, position, size and animation settings; only the text differs and
 * the status is `warn`, which is what makes the accent bar amber and (in `auto`
 * sound mode) plays the exclamation cue instead of the neutral one.
 * @param config - the active configuration.
 * @param input - `{ kind, session, headline, summary, footer }`.
 * @returns the payload handed to notify.ps1.
 */
function awaitingPayload(config, input) {
  const background = resolveBackground(config)
  const sound = resolveSound(config, 'warn')
  return {
    title: input.kind === 'approval' ? 'DSH · 需要授权' : 'DSH · 需要你选择',
    // The conversation that is waiting belongs in the target line, not the session
    // line: on these cards that title *is* the point, and printing it twice would
    // be noise.
    session: '',
    target: config.show.target === false ? '' : input.target || '',
    headline: input.headline,
    summary: input.summary,
    tools: '',
    files: '',
    footer: config.show.footer === false ? '' : input.footer,
    status: 'warn',
    theme: config.theme === 'auto' ? systemTheme() : config.theme,
    backgroundImage: background.backgroundImage,
    dim: background.dim,
    focusX: background.focusX,
    focusY: background.focusY,
    anchor: config.position.anchor,
    marginX: config.position.marginX,
    marginY: config.position.marginY,
    maxWidth: config.size.maxWidth,
    maxHeight: config.size.maxHeight,
    animate: config.animation.enabled && config.animation.durationMs > 0,
    animationMs: config.animation.durationMs,
    sound: sound.sound,
    soundFile: sound.soundFile,
    // 0 = never close on its own: the prompt it announces is still waiting.
    timeoutSeconds: config.awaiting.stay ? 0 : config.timeoutSeconds,
    // Clicking the card takes the user to that conversation (see the attention
    // route): the browser half performs the navigation, the card raises the app.
    sessionId: input.sessionId || '',
    jump: config.awaiting.jump !== false,
    appMatch: config.awaiting.appMatch || 'DeepSeek',
  }
}

/**
 * One fixed request of each kind, for the settings page's preview buttons. It
 * goes through `awaitingPayload`, so the preview is shaped by the same settings
 * as the real card.
 */
function sampleAwaiting(kind) {
  if (kind === 'question') {
    return {
      kind: 'question',
      target: '示例会话：给登录接口补测试',
      sessionId: 'sample',
      headline: '2 个问题在等你回答',
      summary:
        '1. 锁定计数放在 Redis 还是数据库？\n   选项：Redis（和现有一致） / 数据库（更稳）\n'
        + '2. 要不要顺便加上「记住我」的过期时间？\n   选项：加上（推荐） / 先不动',
      footer: '在 DSH 窗口里选择即可',
    }
  }
  return {
    kind: 'approval',
    target: '示例会话：给登录接口补测试',
    sessionId: 'sample',
    headline: '需要你确认：run_command',
    summary: '要执行 pytest -q tests/test_login.py 并写入 tests/ 目录，需要你的许可。',
    footer: '在 DSH 窗口里点「允许」或「拒绝」',
  }
}

/**
 * Render one card in its own PowerShell process.
 * @returns the payload path, which is this card's handle: writing
 * `<payload>.close` later asks the card to leave, and '' means nothing spawned.
 */
function spawnPowerShell(options, scriptPath, payload, trace_, label) {
  if (process.platform !== 'win32') return ''
  let payloadPath
  try {
    if (!fs.existsSync(scriptPath)) return ''
    payloadPath = path.join(os.tmpdir(), `dsh-notify-card-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`)
    fs.writeFileSync(payloadPath, JSON.stringify(payload), 'utf8')
    const child = spawn(
      options.powershell,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath, '-PayloadPath', payloadPath],
      // `detached: true` is deliberately avoided: a DETACHED_PROCESS Windows
      // PowerShell never renders the WinForms card — it exits immediately with
      // code 0, no window and no sound. `unref()` already keeps the host's event
      // loop free, and Windows does not kill children when their parent exits.
      { detached: false, stdio: 'ignore', windowsHide: true },
    )
    child.on('error', (error) => {
      try {
        fs.rmSync(payloadPath, { force: true })
      } catch {}
      trace_(`${label} spawn failed: ${error && error.message ? error.message : error}`)
    })
    child.unref()
    return payloadPath
  } catch {
    if (payloadPath) {
      try {
        fs.rmSync(payloadPath, { force: true })
      } catch {}
    }
    return ''
  }
}

/**
 * Show the native Windows folder picker and wait for the user's answer.
 *
 * The browser cannot read a local path, so the choice has to be made by a
 * process on this machine: `pickfolder.ps1` shows the dialog and writes the
 * result to a JSON file, which is the only thing this function trusts.
 * @param options - resolved environment options (the PowerShell executable).
 * @param initial - the folder the dialog should open at, when it still exists.
 * @returns a promise for `{ path, cancelled }`; rejects on timeout or spawn failure.
 */
function pickFolder(options, initial) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') return reject(new Error('系统文件夹选择框只在 Windows 上可用'))
    if (!fs.existsSync(FOLDER_SCRIPT_PATH)) return reject(new Error('缺少 assets/pickfolder.ps1'))
    const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const payloadPath = path.join(os.tmpdir(), `dsh-notify-card-pick-${stamp}.json`)
    const outputPath = path.join(os.tmpdir(), `dsh-notify-card-pick-${stamp}.out.json`)
    const cleanup = () => {
      for (const file of [payloadPath, outputPath]) {
        try {
          fs.rmSync(file, { force: true })
        } catch {}
      }
    }
    try {
      fs.writeFileSync(payloadPath, JSON.stringify({ output: outputPath, initial: initial || '', description: '选择存放背景图片的文件夹' }), 'utf8')
    } catch (error) {
      cleanup()
      return reject(error)
    }
    let settled = false
    let child
    try {
      // `-STA` because a FolderBrowserDialog on an MTA thread throws; both
      // powershell.exe and pwsh.exe accept the switch.
      child = spawn(
        options.powershell,
        ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', FOLDER_SCRIPT_PATH, '-PayloadPath', payloadPath],
        { detached: false, stdio: 'ignore', windowsHide: true },
      )
    } catch (error) {
      cleanup()
      return reject(error)
    }
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      cleanup()
      if (error) reject(error)
      else resolve(value)
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {}
      finish(new Error('等待选择文件夹超时'))
    }, FOLDER_PICK_TIMEOUT_MS)
    child.on('error', (error) => finish(error))
    child.on('exit', (code) => {
      let chosen = ''
      let cancelled = true
      try {
        const parsed = JSON.parse(fs.readFileSync(outputPath, 'utf8'))
        chosen = typeof parsed.path === 'string' ? parsed.path.trim() : ''
        cancelled = !chosen
      } catch {
        cancelled = true
      }
      if (code !== 0 && !chosen) return finish(new Error(`文件夹选择框异常退出（退出码 ${code}）`))
      finish(null, { path: chosen, cancelled })
    })
  })
}

function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        try {
          req.destroy()
        } catch {}
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function json(res, body, status = 200) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': String(Buffer.byteLength(text)),
  })
  res.end(text)
}

export default {
  name: 'dsh-notify-card',
  apply(ctx) {
    const options = envOptions()
    const say = (message) => trace(options, message)
    /** @type {Map<string, any>} */
    const states = new Map()
    let warned = false

    say(`loaded v${VERSION} pid=${process.pid} platform=${process.platform} enabled=${options.enabled}`)
    if (!options.enabled || process.platform !== 'win32') return

    function stateFor(sessionId) {
      let state = states.get(sessionId)
      if (!state) {
        state = {
          sessionId,
          title: '',
          turn: 0,
          startedAt: Number.NaN,
          tools: new Map(),
          files: new Map(),
          errors: 0,
          lastText: '',
          summary: '',
          notifiedTurn: -1,
        }
        states.set(sessionId, state)
      }
      return state
    }

    function isRootSession(session) {
      if (options.subagents) return true
      const depth = session && session.header ? session.header.delegationDepth : undefined
      return depth === undefined || depth === 0
    }

    function onEvent(session, event) {
      if (!session || !event || typeof event !== 'object') return
      const sessionId = session.id
      if (!sessionId) return
      const data = event.data && typeof event.data === 'object' ? event.data : {}
      // Remember where a delegated session came from, so a card can name the
      // conversation the user actually sees (and not print the same title twice).
      const parent = session.header && session.header.parentSession ? String(session.header.parentSession) : ''
      if (parent) stateFor(sessionId).parent = parent

      switch (event.type) {
        case 'session/title': {
          if (typeof data.title === 'string' && data.title.trim()) stateFor(sessionId).title = data.title.trim()
          return
        }
        case 'turn/start': {
          const state = stateFor(sessionId)
          state.turn = Number.isFinite(Number(data.turn)) ? Number(data.turn) : state.turn + 1
          state.startedAt = Number.isFinite(Number(event.time)) ? Number(event.time) : Date.now()
          state.tools = new Map()
          state.files = new Map()
          state.errors = 0
          state.lastText = ''
          state.summary = ''
          return
        }
        case 'assistant/message': {
          const state = stateFor(sessionId)
          const text = textBlocks(data.message)
          if (text) state.lastText = text
          if (messageFailed(data.message)) state.errors += 1
          return
        }
        case 'tool/call': {
          const state = stateFor(sessionId)
          const name = typeof data.name === 'string' && data.name ? data.name : 'unknown'
          state.tools.set(name, (state.tools.get(name) || 0) + 1)
          if (MUTATING_TOOLS.has(name)) {
            const file = filePathOf(data.arguments)
            if (file) state.files.set(file, (state.files.get(file) || 0) + 1)
          }
          // The model asking the user to choose is an ordinary tool call, and it
          // blocks until the user answers - so this is the reliable moment to say
          // so. It comes over the durable feed, which cannot interfere with the
          // question itself.
          if (name === ASK_TOOL_NAME) notifyQuestionToolCall(sessionId, data)
          return
        }
        // A tool is waiting for the user's permission. This one is durable, so it
        // is the hook that actually fires: the live `approval/request` waterfall is
        // claimed by the answerer that drives the DSH prompt before a later
        // listener on the same chain would ever see it.
        case 'approval/asked': {
          notifyAwaiting('approval', () => {
            const key = data.callId ? String(data.callId) : data.id ? String(data.id) : String(data.toolName || 'approval')
            const conversation = conversationOf(sessionId)
            return Object.assign({ key, kind: 'approval', approvalId: data.id ? String(data.id) : '', target: conversation.title, sessionId: conversation.id }, approvalText(data))
          })
          return
        }
        // The user allowed or rejected it: the card has done its job. The decided
        // event carries the approval id, not the callId the ask did, hence the
        // little id index kept by notifyAwaiting.
        case 'approval/decided': {
          const approvalId = String(data.id || '')
          const key = approvalId ? pendingApprovalIds.get(approvalId) : undefined
          if (key) {
            pendingApprovalIds.delete(approvalId)
            resolveAwaiting(key)
          }
          return
        }
        case 'tool/result': {
          if (messageFailed(data.message)) stateFor(sessionId).errors += 1
          // Same idea for a question: the ask tool call returns once the user has
          // answered (or the ask failed), and that is when the card should go.
          const answered = data.message && data.message.toolCallId ? String(data.message.toolCallId) : ''
          if (answered) resolveAwaiting(`question:${answered}`)
          return
        }
        case 'turn/end': {
          const state = stateFor(sessionId)
          const turn = Number.isFinite(Number(data.turn)) ? Number(data.turn) : state.turn
          if (state.notifiedTurn === turn) return
          const toolTotal = [...state.tools.values()].reduce((sum, count) => sum + count, 0)
          if (!state.lastText && !oneLine(state.summary) && toolTotal === 0) {
            say(`skip turn ${turn} of ${sessionId}: nothing to report`)
            return
          }
          if (!isRootSession(session)) {
            say(`skip turn ${turn} of ${sessionId}: subagent session`)
            return
          }
          state.notifiedTurn = turn
          state.turn = turn
          const reason = data.reason && typeof data.reason.kind === 'string' ? data.reason.kind : 'completed'
          const endedAt = Number.isFinite(Number(event.time)) ? Number(event.time) : Date.now()
          try {
            const config = storedConfig(options)
            // Which conversation this turn belongs to, for the target line: the
            // root of the delegation chain (a subagent's card then names the
            // conversation it was sent from), and nothing when it is the same
            // conversation the session line already shows.
            const conversation = conversationOf(sessionId)
            state.conversationTitle = conversation.title
            state.conversationId = conversation.id
            const payload = buildPayload(state, reason, endedAt, config)
            spawnPowerShell(options, SCRIPT_PATH, payload, say, 'card')
            say(`notified turn ${turn} of ${sessionId} (${reason}, sound=${payload.sound || payload.soundFile || 'none'}): ${payload.headline || payload.summary}`)
          } catch (error) {
            const message = error && error.message ? error.message : String(error)
            say(`notify failed for turn ${turn} of ${sessionId}: ${message}`)
            if (!warned) {
              warned = true
              ctx.logger?.warn?.(`[turn-notify] 弹窗失败：${message}`)
            }
          }
          return
        }
        default:
          return
      }
    }

    ctx.on('session/event', onEvent)
    ctx.on('session/disposed', (session) => {
      if (session && session.id) states.delete(session.id)
    })

    /** Recent awaiting requests, so one decision cannot ring twice. */
    const recentAwaiting = new Map()
    let lastAwaitingAt = 0
    /**
     * Cards currently on screen for a request that is still pending, keyed by the
     * same dedupe key, plus the approval-id index the `approval/decided` event
     * needs (it does not carry the callId the ask did).
     */
    const pendingAwaiting = new Map()
    const pendingApprovalIds = new Map()
    /**
     * The conversation the user asked to be taken to by clicking a card. Consumed
     * by exactly one poll of `/attention.json` (see the browser half).
     */
    let pendingJump = null
    let jumpWatch = null

    /**
     * Cards are separate processes, so a click reaches the host as a marker file
     * next to the payload. Watching for it here keeps that out of the card's way:
     * the card only writes a file and closes itself, exactly like any dismissal.
     */
    function ensureJumpWatch() {
      if (jumpWatch) return
      jumpWatch = setInterval(() => {
        try {
          if (pendingAwaiting.size === 0) {
            clearInterval(jumpWatch)
            jumpWatch = null
            return
          }
          for (const entry of pendingAwaiting.values()) {
            if (!entry.payloadPath) continue
            const marker = `${entry.payloadPath}.jump`
            if (!fs.existsSync(marker)) continue
            let wanted = entry.sessionId || ''
            try {
              const text = fs.readFileSync(marker, 'utf8').trim()
              if (text) wanted = text
              fs.rmSync(marker, { force: true })
            } catch {}
            if (wanted) {
              pendingJump = { sessionId: wanted, at: Date.now() }
              say(`awaiting card clicked: jump to ${wanted}`)
            }
          }
        } catch (error) {
          say(`jump watch failed: ${error && error.message ? error.message : error}`)
        }
      }, 300)
      if (jumpWatch && typeof jumpWatch.unref === 'function') jumpWatch.unref()
    }

    /**
     * Close the card for a request the user has just handled: answering the
     * question, or allowing/rejecting the approval.
     *
     * A request that is decided before its card even appeared (a policy that
     * auto-rejects does exactly that) is simply dropped - the hold below is what
     * keeps those from flashing on the desktop.
     */
    function resolveAwaiting(key) {
      const entry = key ? pendingAwaiting.get(key) : undefined
      if (!entry) return false
      if (entry.timer) {
        clearTimeout(entry.timer)
        pendingAwaiting.delete(key)
        say(`awaiting card dropped before it appeared: ${key}`)
        return true
      }
      entry.resolved = true
      if (entry.payloadPath) {
        try {
          fs.writeFileSync(`${entry.payloadPath}.close`, 'decided', 'utf8')
          say(`awaiting card closed by decision: ${key}`)
          // The card removes its own files on the way out; this is only a safety
          // net for the race where it was already gone (clicked first) and nobody
          // would ever clean up the marker again.
          const sweep = setTimeout(() => {
            for (const file of [entry.payloadPath, `${entry.payloadPath}.close`]) {
              try {
                fs.rmSync(file, { force: true })
              } catch {}
            }
          }, 10000)
          if (sweep && typeof sweep.unref === 'function') sweep.unref()
        } catch (error) {
          say(`closing awaiting card failed: ${error && error.message ? error.message : error}`)
        }
      }
      // Kept a little longer on purpose: people often click the card right after
      // answering it, and that click should still take them to the conversation.
      const drop = setTimeout(() => {
        if (pendingAwaiting.get(key) === entry) pendingAwaiting.delete(key)
      }, AWAITING_LATE_CLICK_MS)
      if (drop && typeof drop.unref === 'function') drop.unref()
      return true
    }

    /** Drop bookkeeping for cards that are long gone. */
    function pruneAwaiting() {
      const now = Date.now()
      for (const [key, entry] of pendingAwaiting) {
        if (now - entry.at > AWAITING_DEDUPE_MS * 30) {
          if (entry.timer) clearTimeout(entry.timer)
          pendingAwaiting.delete(key)
        }
      }
      if (pendingApprovalIds.size > 40) pendingApprovalIds.clear()
    }

    /**
     * Pop a card for a request that blocks the session on the user.
     *
     * `build` runs inside the caller's guard: everything here is synchronous and
     * best effort, because the two live events this serves are Cordis *waterfall*
     * events whose chain must always continue to the answerer that owns the real
     * prompt.
     */
    function notifyAwaiting(kind, build) {
      try {
        const config = storedConfig(options)
        if (!config.awaiting.enabled) return
        if (kind === 'approval' ? !config.awaiting.approval : !config.awaiting.question) return
        const input = build(config)
        if (!input) return
        const now = Date.now()
        const key = `${kind}:${input.key}`
        const seen = recentAwaiting.get(key)
        if (seen !== undefined && now - seen < AWAITING_DEDUPE_MS) return
        if (now - lastAwaitingAt < AWAITING_MIN_GAP_MS) return
        lastAwaitingAt = now
        recentAwaiting.set(key, now)
        if (recentAwaiting.size > 40) {
          for (const [oldKey, at] of recentAwaiting) {
            if (now - at > AWAITING_DEDUPE_MS) recentAwaiting.delete(oldKey)
          }
        }
        if (input.approvalId) pendingApprovalIds.set(String(input.approvalId), key)
        const entry = { at: now, kind, sessionId: input.sessionId || '', timer: null, payloadPath: '' }
        // Held briefly: an approval a policy decides by itself (or a question
        // answered in the same breath) must not flash a card that then has to be
        // taken away again.
        entry.timer = setTimeout(() => {
          entry.timer = null
          try {
            if (pendingAwaiting.get(key) !== entry) return
            const payload = awaitingPayload(storedConfig(options), input)
            entry.payloadPath = spawnPowerShell(options, SCRIPT_PATH, payload, say, 'awaiting')
            say(`awaiting card (${kind}): ${input.headline}`)
            ensureJumpWatch()
          } catch (error) {
            say(`awaiting card failed (${kind}): ${error && error.message ? error.message : error}`)
          }
        }, AWAITING_HOLD_MS)
        if (entry.timer && typeof entry.timer.unref === 'function') entry.timer.unref()
        pendingAwaiting.set(key, entry)
        pruneAwaiting()
      } catch (error) {
        say(`awaiting card failed (${kind}): ${error && error.message ? error.message : error}`)
      }
    }

    /**
     * The conversation a session belongs to, for the target line: a subagent's
     * session is delegated from a parent, and that parent is the conversation the
     * user sees. Walks up to the root, bounded and cycle-safe; falls back to the
     * session itself when there is no parent information.
     */
    function conversationOf(sessionId) {
      let current = sessionId
      for (let hop = 0; hop < 8; hop++) {
        const state = current ? states.get(current) : undefined
        if (!state || !state.parent || state.parent === current) break
        current = state.parent
      }
      const state = current ? states.get(current) : undefined
      return { id: current, title: oneLine(state ? state.title : '') }
    }

    /** A pending question seen on the durable feed, via the ask tool call. */
    function notifyQuestionToolCall(sessionId, data) {
      notifyAwaiting('question', () => {
        const questions = questionsFromArguments(data && data.arguments)
        if (!questions.length) return null
        const key = data && data.callId ? String(data.callId) : String(questions[0].id || 'question')
        const conversation = conversationOf(sessionId)
        return Object.assign({ key, kind: 'question', toolCallId: data && data.callId ? String(data.callId) : '', target: conversation.title, sessionId: conversation.id }, questionText({ questions }))
      })
    }

    // A tool is asking for permission, or the model is asking the user to choose.
    //
    // Both are Cordis *waterfall* events: this listener only reads the request,
    // pops a card, and then ALWAYS delegates with next(). The decision itself
    // stays with the answerer that owns the real prompt (the DSH window), so a
    // failure to render our card can never stall or answer an approval on the
    // user's behalf.
    //
    // Registration is scope-filtered, and the answerer that drives the GUI claims
    // the request: a single listener on the plugin's own (root) context turned out
    // never to run, because the claim happened first. The hooks are therefore
    // attached to each agent's scope as well, which is the scope the request is
    // dispatched from - the root registration stays as a fallback for events that
    // arrive without an agent.
    function registerAwaitingHooks(target) {
      if (!target || typeof target.on !== 'function') return
      target.on('approval/request', (req, next) => {
        notifyAwaiting('approval', () => {
          const sessionId = req && req.agent && req.agent.id ? String(req.agent.id) : ''
          const key = req && req.callId ? String(req.callId) : (req && req.toolName) || 'approval'
          const conversation = conversationOf(sessionId)
          return Object.assign({ key, kind: 'approval', target: conversation.title, sessionId: conversation.id }, approvalText(req))
        })
        return next()
      })
      target.on('user-questions/request', (request, next) => {
        notifyAwaiting('question', () => {
          const sessionId = request && request.agent && request.agent.id ? String(request.agent.id) : ''
          const wait = request && request.wait && request.wait.callId ? String(request.wait.callId) : ''
          const first = Array.isArray(request && request.questions) && request.questions[0] && request.questions[0].id
            ? String(request.questions[0].id)
            : ''
          const conversation = conversationOf(sessionId)
          return Object.assign({ key: wait || first || 'question', kind: 'question', target: conversation.title, sessionId: conversation.id }, questionText(request))
        })
        return next()
      })
    }

    registerAwaitingHooks(ctx)
    ctx.on('agent/created', function (payload) {
      try {
        const agent = payload && payload.agent
        const scope = this
        if (!agent || !agent.id || !scope || scope === ctx) return
        registerAwaitingHooks(scope)
        say(`awaiting hooks attached to agent ${String(agent.id).slice(-8)}`)
      } catch (error) {
        say(`awaiting hook attach failed: ${error && error.message ? error.message : error}`)
      }
    })
    say('awaiting hooks registered (approval/request, user-questions/request)')

    // Settings / sound-library API for the browser half. Registered only where a
    // web server exists, so a headless profile keeps the popups and loses only
    // the settings page.
    ctx.inject(['webServer', 'connection'], (scope) => {
      /** Same trust fence every custom route needs: reject forged or unauthenticated requests. */
      function rejected(req, res) {
        try {
          const conn = scope.connection
          if (!conn || typeof conn.requestRejection !== 'function') return false
          const code = conn.requestRejection(req)
          if (code === undefined || code === null || code === false) return false
          res.writeHead(typeof code === 'number' ? code : 403)
          res.end()
          return true
        } catch {
          return false
        }
      }

      function route(kind, routePath, handler) {
        return scope.webServer.register({
          kind: 'exact',
          path: routePath,
          handler: async (req, res) => {
            if (rejected(req, res)) return
            try {
              await handler(req, res)
            } catch (error) {
              json(res, { ok: false, error: error && error.message ? error.message : String(error) }, 200)
            }
          },
        })
      }

      const disposers = []
      // One native dialog at a time: a second request would otherwise stack a
      // second window behind the first with no way to tell them apart.
      let pickInFlight = false
      disposers.push(
        route('exact', '/dsh-notify-card/state.json', async (req, res) => {
          json(res, { ok: true, version: VERSION, platform: process.platform, kinds: SOUND_KINDS })
        }),
      )
      disposers.push(
        route('exact', '/dsh-notify-card/config.json', async (req, res) => {
          if (req.method === 'GET') {
            const config = storedConfig(options)
            return json(res, {
              ok: true,
              config,
              defaults: defaultConfig(options),
              sounds: listSounds(),
              backgrounds: listBackgrounds(),
              backgroundFolder: folderStats(config.background.folder, config.background.recursive),
              systemTheme: systemTheme(),
            })
          }
          if (req.method === 'PUT' || req.method === 'POST') {
            const body = await readBody(req)
            const saved = writeConfig(JSON.parse(body.toString('utf8') || '{}'), options)
            say(`settings saved: sound=${saved.sound.mode}/${saved.sound.system}${saved.sound.file ? ` (${saved.sound.file})` : ''} timeout=${saved.timeoutSeconds}s show=${Object.entries(saved.show).filter(([, v]) => v).map(([k]) => k).join(',')}`)
            return json(res, { ok: true, config: saved })
          }
          return json(res, { ok: false, error: '不支持的请求方法' }, 405)
        }),
      )
      disposers.push(
        route('exact', '/dsh-notify-card/sounds.json', async (req, res) => {
          if (req.method === 'GET') return json(res, { ok: true, sounds: listSounds() })
          if (req.method === 'POST' || req.method === 'PUT') {
            const url = new URL(req.url || '/', 'http://localhost')
            const name = url.searchParams.get('name') || 'custom.wav'
            const bytes = await readBody(req)
            const row = addSound(name, bytes)
            const config = storedConfig(options)
            config.sound.mode = 'file'
            config.sound.file = row.id
            writeConfig(config, options)
            say(`sound uploaded: ${row.name} (${row.size} bytes) -> ${row.id}`)
            return json(res, { ok: true, sound: row, sounds: listSounds(), config })
          }
          return json(res, { ok: false, error: '不支持的请求方法' }, 405)
        }),
      )
      disposers.push(
        route('exact', '/dsh-notify-card/sounds/delete.json', async (req, res) => {
          if (req.method !== 'POST') return json(res, { ok: false, error: '不支持的请求方法' }, 405)
          const body = await readBody(req)
          const parsed = JSON.parse(body.toString('utf8') || '{}')
          const id = String(parsed.id ?? '')
          removeSound(id)
          const config = storedConfig(options)
          if (config.sound.file === id) {
            config.sound.mode = 'auto'
            config.sound.file = ''
            writeConfig(config, options)
          }
          say(`sound removed: ${id}`)
          return json(res, { ok: true, sounds: listSounds(), config: storedConfig(options) })
        }),
      )
      disposers.push(
        route('exact', '/dsh-notify-card/sound.wav', async (req, res) => {
          const url = new URL(req.url || '/', 'http://localhost')
          const file = soundPath(url.searchParams.get('id') || '')
          if (!file || !fs.existsSync(file)) {
            res.writeHead(404)
            return res.end()
          }
          const bytes = fs.readFileSync(file)
          res.writeHead(200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', 'Content-Length': String(bytes.length) })
          res.end(bytes)
        }),
      )
      disposers.push(
        route('exact', '/dsh-notify-card/backgrounds.json', async (req, res) => {
          if (req.method === 'GET') return json(res, { ok: true, backgrounds: listBackgrounds() })
          if (req.method === 'POST' || req.method === 'PUT') {
            const url = new URL(req.url || '/', 'http://localhost')
            const name = url.searchParams.get('name') || 'background.png'
            const bytes = await readBody(req)
            const row = addBackground(name, bytes)
            const config = storedConfig(options)
            config.background.mode = 'image'
            config.background.image = row.id
            writeConfig(config, options)
            say(`background uploaded: ${row.name} (${row.size} bytes, ${row.mime}) -> ${row.id}`)
            return json(res, { ok: true, background: row, backgrounds: listBackgrounds(), config })
          }
          return json(res, { ok: false, error: '不支持的请求方法' }, 405)
        }),
      )
      disposers.push(
        route('exact', '/dsh-notify-card/backgrounds/delete.json', async (req, res) => {
          if (req.method !== 'POST') return json(res, { ok: false, error: '不支持的请求方法' }, 405)
          const body = await readBody(req)
          const parsed = JSON.parse(body.toString('utf8') || '{}')
          const id = String(parsed.id ?? '')
          removeBackground(id)
          const config = storedConfig(options)
          if (config.background.image === id) {
            config.background.mode = 'theme'
            config.background.image = ''
            writeConfig(config, options)
          }
          say(`background removed: ${id}`)
          return json(res, { ok: true, backgrounds: listBackgrounds(), config: storedConfig(options) })
        }),
      )
      disposers.push(
        route('exact', '/dsh-notify-card/backgrounds/focus.json', async (req, res) => {
          if (req.method !== 'POST') return json(res, { ok: false, error: '不支持的请求方法' }, 405)
          const body = await readBody(req)
          const parsed = JSON.parse(body.toString('utf8') || '{}')
          const backgrounds = setBackgroundFocus(String(parsed.id ?? ''), parsed.focusX, parsed.focusY)
          if (!backgrounds) return json(res, { ok: false, error: '找不到这张背景图' })
          say(`background focus: ${parsed.id} -> ${JSON.stringify(backgrounds.find((row) => row.id === parsed.id) || null)}`)
          return json(res, { ok: true, backgrounds })
        }),
      )
      disposers.push(
        route('exact', '/dsh-notify-card/background.img', async (req, res) => {
          const url = new URL(req.url || '/', 'http://localhost')
          const id = url.searchParams.get('id') || ''
          const row = listBackgrounds().find((entry) => entry.id === id)
          if (!row) {
            res.writeHead(404)
            return res.end()
          }
          const bytes = fs.readFileSync(row.path)
          res.writeHead(200, {
            'Content-Type': row.mime || 'application/octet-stream',
            'Cache-Control': 'no-store',
            'Content-Length': String(bytes.length),
          })
          res.end(bytes)
        }),
      )
      disposers.push(
        route('exact', '/dsh-notify-card/background-folder.img', async (req, res) => {
          // Preview only, and the file is always chosen by the host: the caller
          // can point at a folder, never at a single path. Hands back 404 when
          // the folder holds nothing usable, which the page renders as "no
          // preview" instead of a broken image.
          const url = new URL(req.url || '/', 'http://localhost')
          const saved = storedConfig(options).background
          const folder = (url.searchParams.get('folder') || saved.folder || '').trim()
          const recursive = url.searchParams.has('recursive') ? url.searchParams.get('recursive') === '1' : !!saved.recursive
          const file = folder ? pickFolderImage(folder, recursive) : ''
          if (!file) {
            res.writeHead(404)
            return res.end()
          }
          const bytes = fs.readFileSync(file)
          res.writeHead(200, {
            'Content-Type': imageMime(file),
            'Cache-Control': 'no-store',
            'Content-Length': String(bytes.length),
          })
          res.end(bytes)
        }),
      )
      disposers.push(
        route('exact', '/dsh-notify-card/backgrounds/folder.json', async (req, res) => {
          if (req.method !== 'POST' && req.method !== 'GET') return json(res, { ok: false, error: '不支持的请求方法' }, 405)
          let folder = ''
          let recursive = false
          if (req.method === 'GET') {
            const url = new URL(req.url || '/', 'http://localhost')
            const saved = storedConfig(options).background
            folder = url.searchParams.get('folder') || saved.folder || ''
            recursive = url.searchParams.has('recursive') ? url.searchParams.get('recursive') === '1' : !!saved.recursive
          } else {
            const body = await readBody(req)
            const parsed = JSON.parse(body.toString('utf8') || '{}')
            folder = typeof parsed.folder === 'string' ? parsed.folder : ''
            recursive = !!parsed.recursive
          }
          const stats = folderStats(folder, recursive)
          // Report the pool size only; the page needs nothing else until the
          // user asks for a preview.
          return json(res, { ok: true, stats })
        }),
      )
      disposers.push(
        route('exact', '/dsh-notify-card/folders/pick.json', async (req, res) => {
          if (req.method !== 'POST') return json(res, { ok: false, error: '不支持的请求方法' }, 405)
          if (pickInFlight) return json(res, { ok: false, error: '已经有一个文件夹选择框打开了' })
          const body = await readBody(req)
          const parsed = JSON.parse(body.toString('utf8') || '{}')
          let initial = typeof parsed.initial === 'string' && parsed.initial.trim()
            ? parsed.initial.trim()
            : storedConfig(options).background.folder
          if (initial && !fs.existsSync(initial)) initial = ''
          pickInFlight = true
          try {
            const result = await pickFolder(options, initial)
            say(`folder picker: ${result.cancelled ? 'cancelled' : result.path}`)
            return json(res, { ok: true, path: result.path, cancelled: result.cancelled })
          } finally {
            pickInFlight = false
          }
        }),
      )
      disposers.push(
        route('exact', '/dsh-notify-card/attention.json', async (req, res) => {
          // The browser half asks about once a second while the page is visible.
          // Return-and-clear: a jump is meant to be acted on once.
          const jump = pendingJump
          pendingJump = null
          return json(res, { ok: true, jump })
        }),
      )
      disposers.push(
        route('exact', '/dsh-notify-card/awaiting-sample.json', async (req, res) => {
          if (req.method !== 'POST') return json(res, { ok: false, error: '不支持的请求方法' }, 405)
          const body = await readBody(req)
          const parsed = JSON.parse(body.toString('utf8') || '{}')
          // Never persists, and deliberately ignores the master switch: the point
          // of the button is to see what the card looks like before enabling it.
          const config = normalizeConfig(parsed.config ?? storedConfig(options), options)
          const kind = parsed.kind === 'question' ? 'question' : 'approval'
          const payload = awaitingPayload(config, sampleAwaiting(kind))
          spawnPowerShell(options, SCRIPT_PATH, payload, say, 'awaiting-sample')
          say(`awaiting sample card sent (${kind}, anchor=${payload.anchor}, sound=${payload.sound || payload.soundFile || 'none'})`)
          return json(res, { ok: true, kind })
        }),
      )
      disposers.push(
        route('exact', '/dsh-notify-card/client-log.json', async (req, res) => {
          if (req.method !== 'POST') return json(res, { ok: false, error: '不支持的请求方法' }, 405)
          const body = await readBody(req, 64 * 1024)
          const parsed = JSON.parse(body.toString('utf8') || '{}')
          const line = JSON.stringify({
            time: new Date().toISOString(),
            event: String(parsed.event ?? '').slice(0, 80),
            detail: String(parsed.detail ?? '').slice(0, 800),
          })
          // Browser breadcrumbs follow the same opt-in switch as the host trace,
          // and the file is restarted once it grows past 256 KiB.
          if (traceOn(options)) {
            try {
              const dir = path.join(dshHome(), 'logs')
              fs.mkdirSync(dir, { recursive: true })
              const file = path.join(dir, 'turn-notify-client.log')
              try {
                if (fs.statSync(file).size > 262144) fs.rmSync(file, { force: true })
              } catch {}
              fs.appendFileSync(file, `${line}\n`, 'utf8')
            } catch {}
          }
          return json(res, { ok: true })
        }),
      )
      disposers.push(
        route('exact', '/dsh-notify-card/sample.json', async (req, res) => {
          if (req.method !== 'POST') return json(res, { ok: false, error: '不支持的请求方法' }, 405)
          const body = await readBody(req)
          const parsed = JSON.parse(body.toString('utf8') || '{}')
          // Never persists: the sample renders the draft the page currently shows.
          const config = normalizeConfig(parsed.config ?? storedConfig(options), options)
          const payload = samplePayload(config)
          spawnPowerShell(options, SCRIPT_PATH, payload, say, 'sample')
          say(
            `sample card sent (anchor=${payload.anchor}, ${payload.maxWidth}x${payload.maxHeight || 'auto'}, `
            + `animate=${payload.animate}/${payload.animationMs}ms, theme=${payload.theme}, background=${payload.backgroundImage ? 'image' : 'theme'})`,
          )
          return json(res, { ok: true })
        }),
      )
      disposers.push(
        route('exact', '/dsh-notify-card/preview.json', async (req, res) => {
          if (req.method !== 'POST') return json(res, { ok: false, error: '不支持的请求方法' }, 405)
          const body = await readBody(req)
          const parsed = JSON.parse(body.toString('utf8') || '{}')
          // A preview never persists: it plays exactly what the page currently shows.
          const config = normalizeConfig(parsed.config ?? storedConfig(options), options)
          const sound = resolveSound(config, 'ok')
          spawnPowerShell(options, PREVIEW_SCRIPT_PATH, sound, say, 'preview')
          say(`preview played: ${sound.sound || sound.soundFile || 'none'}`)
          return json(res, { ok: true, sound })
        }),
      )

      ctx.effect(() => () => {
        for (const dispose of disposers) {
          try {
            dispose()
          } catch {}
        }
      })
    })

    ctx.effect(() => () => {
      states.clear()
    })
  },
}
