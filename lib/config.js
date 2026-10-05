/**
 * Durable plugin preferences for dsh-notify-card.
 *
 * The settings page in the DSH client edits these values through the plugin's
 * own web routes; the popup pipeline reads them back. They live in
 * `$DSH_HOME/turn-notify/config.json` rather than the profile patch so that a
 * custom sound library (binary files) and the toggles stay together, survive
 * profile edits, and never rewrite the user's Cordis patch layer.
 */
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const SOUND_MODES = ['auto', 'system', 'none', 'file']
export const SOUND_KINDS = ['asterisk', 'exclamation', 'hand', 'question', 'beep']
export const SHOW_KEYS = ['title', 'session', 'target', 'headline', 'summary', 'tools', 'files', 'footer']
/** The two things that make a running session wait for the user. */
export const AWAITING_KEYS = ['approval', 'question']
export const THEME_MODES = ['auto', 'light', 'dark']
export const BACKGROUND_MODES = ['theme', 'image', 'folder']
/** Card anchors on the work area: top/center/bottom row + left/center/right column. */
export const POSITIONS = ['tl', 'tc', 'tr', 'cl', 'cc', 'cr', 'bl', 'bc', 'br']
export const MAX_SOUND_BYTES = 8 * 1024 * 1024
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024
/** Extensions a folder background may pick from; the file itself is re-checked by magic bytes. */
const FOLDER_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])
/** A wall-paper folder usually holds photographs far bigger than an upload. */
const MAX_FOLDER_IMAGE_BYTES = 48 * 1024 * 1024
/** Caps so a mistakenly chosen folder (C:\Windows, a network share) cannot stall a turn. */
const MAX_FOLDER_FILES = 4000
const MAX_FOLDER_DEPTH = 4
const FOLDER_CACHE_MS = 20000

export function homeDir() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

export function dataDir() {
  return path.join(homeDir(), 'turn-notify')
}

export function configPath() {
  return path.join(dataDir(), 'config.json')
}

export function soundsDir() {
  return path.join(dataDir(), 'sounds')
}

function soundIndexPath() {
  return path.join(soundsDir(), 'index.json')
}

export function backgroundsDir() {
  return path.join(dataDir(), 'backgrounds')
}

function backgroundIndexPath() {
  return path.join(backgroundsDir(), 'index.json')
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function oneOf(value, allowed, fallback) {
  const text = String(value ?? '').trim()
  return allowed.includes(text) ? text : fallback
}

function bool(value, fallback) {
  if (typeof value === 'boolean') return value
  if (value === undefined || value === null || value === '') return fallback
  const text = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(text)) return true
  if (['0', 'false', 'no', 'off'].includes(text)) return false
  return fallback
}

/**
 * The preference set, with every field normalized so a hand-edited or older
 * config file can never make the popup pipeline throw.
 * @param overrides - environment-derived defaults.
 * @returns a complete, valid configuration object.
 */
export function defaultConfig(overrides = {}) {
  const show = {}
  for (const key of SHOW_KEYS) show[key] = true
  return {
    enabled: overrides.enabled !== undefined ? overrides.enabled : true,
    timeoutSeconds: overrides.timeoutSeconds !== undefined ? overrides.timeoutSeconds : 25,
    summaryChars: overrides.summaryChars !== undefined ? overrides.summaryChars : 420,
    theme: 'auto',
    sound: {
      mode: 'auto',
      system: oneOf(overrides.soundKind, SOUND_KINDS, 'asterisk'),
      file: '',
    },
    background: {
      mode: 'theme',
      image: '',
      folder: '',
      recursive: false,
      dim: 45,
      focusX: 50,
      focusY: 50,
    },
    position: {
      anchor: 'br',
      marginX: 24,
      marginY: 24,
    },
    size: {
      maxWidth: 460,
      maxHeight: 0,
    },
    animation: {
      enabled: true,
      durationMs: 500,
    },
    // Cards popped while the session is blocked on the user: a tool asking for
    // permission, or a question with options waiting for an answer.
    awaiting: {
      enabled: true,
      approval: true,
      question: true,
      // These cards stay until the user deals with them: an approval prompt does
      // not go away on its own, so neither should the card that announces it.
      stay: true,
      // Clicking one takes the user to the conversation that is waiting.
      jump: true,
      // Process-name match for the window to raise when jumping.
      appMatch: 'DeepSeek',
    },
    show,
  }
}

let systemThemeCache = { at: 0, value: 'dark' }

/**
 * The Windows application theme the popup follows in `auto` mode, read from the
 * same registry value the Settings app writes (`AppsUseLightTheme`). Cached for
 * half a minute: it is consulted on every finished turn.
 * @returns 'light' or 'dark', defaulting to dark when the value is unreadable.
 */
export function systemTheme() {
  const now = Date.now()
  if (now - systemThemeCache.at < 30000) return systemThemeCache.value
  let value = systemThemeCache.value
  try {
    const output = execFileSync(
      'reg.exe',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', '/v', 'AppsUseLightTheme'],
      { encoding: 'utf8', timeout: 3000, windowsHide: true },
    )
    const match = /AppsUseLightTheme\s+REG_DWORD\s+0x([0-9a-fA-F]+)/.exec(output)
    if (match) value = Number.parseInt(match[1], 16) === 1 ? 'light' : 'dark'
  } catch {}
  systemThemeCache = { at: now, value }
  return value
}

/**
 * Fold an arbitrary candidate over the defaults.
 * @param candidate - parsed JSON (or anything) from the settings page.
 * @param overrides - environment-derived defaults.
 * @returns a complete, valid configuration object.
 */
export function normalizeConfig(candidate, overrides = {}) {
  const base = defaultConfig(overrides)
  if (!candidate || typeof candidate !== 'object') return base
  const sound = candidate.sound && typeof candidate.sound === 'object' ? candidate.sound : {}
  const background = candidate.background && typeof candidate.background === 'object' ? candidate.background : {}
  const position = candidate.position && typeof candidate.position === 'object' ? candidate.position : {}
  const size = candidate.size && typeof candidate.size === 'object' ? candidate.size : {}
  const animation = candidate.animation && typeof candidate.animation === 'object' ? candidate.animation : {}
  const awaiting = candidate.awaiting && typeof candidate.awaiting === 'object' ? candidate.awaiting : {}
  const show = candidate.show && typeof candidate.show === 'object' ? candidate.show : {}
  const next = {
    enabled: bool(candidate.enabled, base.enabled),
    timeoutSeconds: clampInt(candidate.timeoutSeconds, base.timeoutSeconds, 0, 3600),
    summaryChars: clampInt(candidate.summaryChars, base.summaryChars, 60, 4000),
    theme: oneOf(candidate.theme, THEME_MODES, base.theme),
    sound: {
      mode: oneOf(sound.mode, SOUND_MODES, base.sound.mode),
      system: oneOf(sound.system, SOUND_KINDS, base.sound.system),
      file: typeof sound.file === 'string' ? sound.file.trim() : base.sound.file,
    },
    background: {
      mode: oneOf(background.mode, BACKGROUND_MODES, base.background.mode),
      image: typeof background.image === 'string' ? background.image.trim() : base.background.image,
      folder: typeof background.folder === 'string' ? background.folder.trim().slice(0, 400) : base.background.folder,
      recursive: bool(background.recursive, base.background.recursive),
      dim: clampInt(background.dim, base.background.dim, 0, 90),
      focusX: clampInt(background.focusX, base.background.focusX, 0, 100),
      focusY: clampInt(background.focusY, base.background.focusY, 0, 100),
    },
    position: {
      anchor: oneOf(position.anchor, POSITIONS, base.position.anchor),
      marginX: clampInt(position.marginX, base.position.marginX, 0, 400),
      marginY: clampInt(position.marginY, base.position.marginY, 0, 400),
    },
    size: {
      maxWidth: clampInt(size.maxWidth, base.size.maxWidth, 240, 1200),
      maxHeight: clampInt(size.maxHeight, base.size.maxHeight, 0, 1600),
    },
    animation: {
      enabled: bool(animation.enabled, base.animation.enabled),
      durationMs: clampInt(animation.durationMs, base.animation.durationMs, 0, 1500),
    },
    awaiting: {
      enabled: bool(awaiting.enabled, base.awaiting.enabled),
      approval: bool(awaiting.approval, base.awaiting.approval),
      question: bool(awaiting.question, base.awaiting.question),
      stay: bool(awaiting.stay, base.awaiting.stay),
      jump: bool(awaiting.jump, base.awaiting.jump),
      appMatch: typeof awaiting.appMatch === 'string' && awaiting.appMatch.trim() ? awaiting.appMatch.trim().slice(0, 60) : base.awaiting.appMatch,
    },
    show: {},
  }
  for (const key of SHOW_KEYS) next.show[key] = bool(show[key], base.show[key])
  return next
}

/**
 * Read the stored configuration, falling back to the defaults.
 * @param overrides - environment-derived defaults.
 * @returns a complete, valid configuration object.
 */
export function readConfig(overrides = {}) {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8')
    return normalizeConfig(JSON.parse(raw), overrides)
  } catch {
    return defaultConfig(overrides)
  }
}

/**
 * Persist a configuration atomically (temp file + rename).
 * @param config - the configuration to store.
 * @returns the normalized configuration that was written.
 */
export function writeConfig(config, overrides = {}) {
  const normalized = normalizeConfig(config, overrides)
  const dir = dataDir()
  fs.mkdirSync(dir, { recursive: true })
  const target = configPath()
  const temp = `${target}.${process.pid}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
  fs.renameSync(temp, target)
  return normalized
}

function readSoundIndex() {
  try {
    const parsed = JSON.parse(fs.readFileSync(soundIndexPath(), 'utf8'))
    return Array.isArray(parsed) ? parsed.filter((row) => row && typeof row.id === 'string') : []
  } catch {
    return []
  }
}

function writeSoundIndex(rows) {
  fs.mkdirSync(soundsDir(), { recursive: true })
  const target = soundIndexPath()
  const temp = `${target}.${process.pid}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(rows, null, 2)}\n`, 'utf8')
  fs.renameSync(temp, target)
}

/** @returns the uploaded custom sounds, newest first. */
export function listSounds() {
  return readSoundIndex()
    .map((row) => ({ id: row.id, name: row.name, size: row.size, addedAt: row.addedAt, path: soundPath(row.id) }))
    .filter((row) => row.path && fs.existsSync(row.path))
    .sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)))
}

/** @returns the absolute path of one stored sound, or undefined. */
export function soundPath(id) {
  const safe = String(id ?? '').replace(/[^a-zA-Z0-9_-]/g, '')
  if (!safe) return undefined
  return path.join(soundsDir(), `${safe}.wav`)
}

/**
 * Store one uploaded WAV.
 * @param name - the client-supplied file name (display only).
 * @param bytes - the uploaded body.
 * @returns the stored sound row.
 * @throws when the body is not a readable RIFF/WAVE file.
 */
export function addSound(name, bytes) {
  if (!bytes || bytes.length < 44) throw new Error('文件太小，不是有效的 WAV')
  if (bytes.length > MAX_SOUND_BYTES) throw new Error('文件超过 8 MB 上限')
  const magic = bytes.subarray(0, 4).toString('ascii')
  const format = bytes.subarray(8, 12).toString('ascii')
  if (magic !== 'RIFF' || format !== 'WAVE') throw new Error('只支持 WAV（RIFF/WAVE）格式的音频')
  const id = crypto.randomBytes(8).toString('hex')
  fs.mkdirSync(soundsDir(), { recursive: true })
  fs.writeFileSync(soundPath(id), bytes)
  const rows = readSoundIndex()
  const row = {
    id,
    name: String(name ?? '').trim().slice(0, 120) || 'custom.wav',
    size: bytes.length,
    addedAt: new Date().toISOString(),
  }
  rows.push(row)
  writeSoundIndex(rows)
  return row
}

/**
 * Remove one stored sound.
 * @param id - the sound id.
 * @returns whether a file was removed.
 */
export function removeSound(id) {
  const file = soundPath(id)
  if (!file) return false
  let removed = false
  try {
    fs.rmSync(file, { force: true })
    removed = true
  } catch {}
  writeSoundIndex(readSoundIndex().filter((row) => row.id !== id))
  return removed
}

/**
 * Resolve the sound a card should play.
 * @param config - the active configuration.
 * @param status - the card's status (`ok` | `warn` | `error`).
 * @returns `{ sound, soundFile }` payload fields.
 */
export function resolveSound(config, status) {
  const sound = config.sound || {}
  if (sound.mode === 'none') return { sound: 'none', soundFile: '' }
  if (sound.mode === 'file') {
    const file = sound.file ? soundPath(sound.file) : undefined
    if (file && fs.existsSync(file)) return { sound: '', soundFile: file }
    return { sound: 'none', soundFile: '' }
  }
  if (sound.mode === 'system') return { sound: oneOf(sound.system, SOUND_KINDS, 'asterisk'), soundFile: '' }
  if (status === 'error') return { sound: 'hand', soundFile: '' }
  if (status === 'warn') return { sound: 'exclamation', soundFile: '' }
  return { sound: 'asterisk', soundFile: '' }
}

/** Identify an uploaded background by its magic bytes. */
function imageKind(bytes) {
  const ascii = (from, to) => (bytes.length >= to ? bytes.toString('ascii', from, to) : '')
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { ext: 'png', mime: 'image/png' }
  }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' }
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp' }
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return { ext: 'gif', mime: 'image/gif' }
  if (ascii(0, 2) === 'BM') return { ext: 'bmp', mime: 'image/bmp' }
  return undefined
}

function readBackgroundIndex() {
  try {
    const parsed = JSON.parse(fs.readFileSync(backgroundIndexPath(), 'utf8'))
    return Array.isArray(parsed) ? parsed.filter((row) => row && typeof row.id === 'string' && typeof row.ext === 'string') : []
  } catch {
    return []
  }
}

function writeBackgroundIndex(rows) {
  fs.mkdirSync(backgroundsDir(), { recursive: true })
  const target = backgroundIndexPath()
  const temp = `${target}.${process.pid}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(rows, null, 2)}\n`, 'utf8')
  fs.renameSync(temp, target)
}

function safeId(value) {
  return String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '')
}

/** @returns the uploaded background images, newest first. */
export function listBackgrounds() {
  return readBackgroundIndex()
    .map((row) => ({
      id: row.id,
      name: row.name,
      size: row.size,
      addedAt: row.addedAt,
      mime: row.mime,
      focusX: Number.isFinite(row.focusX) ? row.focusX : 50,
      focusY: Number.isFinite(row.focusY) ? row.focusY : 50,
      path: backgroundPath(row.id),
    }))
    .filter((row) => row.path && fs.existsSync(row.path))
    .sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)))
}

/** One stored row, focus included. */
function backgroundRow(id) {
  const safe = safeId(id)
  if (!safe) return undefined
  return readBackgroundIndex().find((entry) => entry.id === safe)
}

/**
 * Remember which part of one image the cover crop should favour. `0` anchors the
 * left/top edge, `100` the right/bottom, `50` centres — the same percentage
 * semantics as CSS `background-position`.
 * @param id - the image id.
 * @param focusX - horizontal priority, 0-100.
 * @param focusY - vertical priority, 0-100.
 * @returns the updated background list, or undefined for an unknown id.
 */
export function setBackgroundFocus(id, focusX, focusY) {
  const rows = readBackgroundIndex()
  const row = rows.find((entry) => entry.id === safeId(id))
  if (!row) return undefined
  row.focusX = clampInt(focusX, 50, 0, 100)
  row.focusY = clampInt(focusY, 50, 0, 100)
  writeBackgroundIndex(rows)
  return listBackgrounds()
}

/** @returns the absolute path of one stored background image, or undefined. */
export function backgroundPath(id) {
  const safe = safeId(id)
  if (!safe) return undefined
  const row = readBackgroundIndex().find((entry) => entry.id === safe)
  if (!row) return undefined
  return path.join(backgroundsDir(), `${safe}.${row.ext}`)
}

/**
 * Store one uploaded background image.
 * @param name - the client-supplied file name (display only).
 * @param bytes - the uploaded body.
 * @returns the stored row.
 * @throws when the body is not a supported image.
 */
export function addBackground(name, bytes) {
  if (!bytes || bytes.length < 16) throw new Error('文件太小，不是有效的图片')
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('文件超过 12 MB 上限')
  const kind = imageKind(bytes)
  if (!kind) throw new Error('只支持 PNG / JPEG / WebP / GIF / BMP 图片')
  const id = crypto.randomBytes(8).toString('hex')
  fs.mkdirSync(backgroundsDir(), { recursive: true })
  fs.writeFileSync(path.join(backgroundsDir(), `${id}.${kind.ext}`), bytes)
  const rows = readBackgroundIndex()
  const row = {
    id,
    name: String(name ?? '').trim().slice(0, 120) || `background.${kind.ext}`,
    ext: kind.ext,
    mime: kind.mime,
    size: bytes.length,
    addedAt: new Date().toISOString(),
    focusX: 50,
    focusY: 50,
  }
  rows.push(row)
  writeBackgroundIndex(rows)
  return row
}

/**
 * Remove one stored background image.
 * @param id - the image id.
 * @returns whether a file was removed.
 */
export function removeBackground(id) {
  const file = backgroundPath(id)
  let removed = false
  if (file) {
    try {
      fs.rmSync(file, { force: true })
      removed = true
    } catch {}
  }
  writeBackgroundIndex(readBackgroundIndex().filter((row) => row.id !== safeId(id)))
  return removed
}

/** Read the first bytes of a file, or undefined when it cannot be opened. */
function firstBytes(file, length = 16) {
  let handle
  try {
    handle = fs.openSync(file, 'r')
    const buffer = Buffer.alloc(length)
    const read = fs.readSync(handle, buffer, 0, length, 0)
    return buffer.subarray(0, read)
  } catch {
    return undefined
  } finally {
    if (handle !== undefined) {
      try {
        fs.closeSync(handle)
      } catch {}
    }
  }
}

/** List one directory level, appending image candidates to `files`. */
function collectImages(dir, recursive, depth, files) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (files.length >= MAX_FOLDER_FILES) return
    const name = entry.name
    if (!name || name.startsWith('.')) continue
    const full = path.join(dir, name)
    // Symlinks are never followed: `isDirectory()` is false for them, which also
    // makes a looped link (or a junction back to a parent) impossible.
    if (entry.isDirectory()) {
      if (recursive && depth < MAX_FOLDER_DEPTH) collectImages(full, recursive, depth + 1, files)
      continue
    }
    if (!entry.isFile()) continue
    if (!FOLDER_IMAGE_EXTS.has(path.extname(name).toLowerCase())) continue
    let size = 0
    try {
      size = fs.statSync(full).size
    } catch {
      continue
    }
    if (size <= 0 || size > MAX_FOLDER_IMAGE_BYTES) continue
    files.push(full)
  }
}

const folderCache = new Map()

/**
 * The image files a folder background may choose from.
 * @param folder - a directory path.
 * @param recursive - also walk sub-directories (up to a small depth).
 * @returns absolute paths, sorted, empty when the folder is missing or empty.
 */
export function folderImagePaths(folder, recursive = false) {
  const dir = typeof folder === 'string' ? folder.trim() : ''
  if (!dir) return []
  try {
    if (!fs.statSync(dir).isDirectory()) return []
  } catch {
    return []
  }
  const key = `${dir}\u0000${recursive ? 1 : 0}`
  const now = Date.now()
  const cached = folderCache.get(key)
  if (cached && now - cached.at < FOLDER_CACHE_MS) return cached.files
  const files = []
  collectImages(dir, !!recursive, 0, files)
  files.sort()
  folderCache.set(key, { at: now, files })
  if (folderCache.size > 8) folderCache.delete(folderCache.keys().next().value)
  return files
}

/**
 * What the settings page shows next to the folder field.
 * @param folder - the candidate directory path.
 * @param recursive - include sub-directories.
 * @returns `{ folder, exists, isDir, count, recursive, sample, error }`.
 */
export function folderStats(folder, recursive = false) {
  const dir = typeof folder === 'string' ? folder.trim() : ''
  const base = { folder: dir, exists: false, isDir: false, count: 0, recursive: !!recursive, sample: [], error: '' }
  if (!dir) return base
  let stat
  try {
    stat = fs.statSync(dir)
  } catch {
    return Object.assign({}, base, { error: '这个文件夹不存在或无法访问' })
  }
  if (!stat.isDirectory()) return Object.assign({}, base, { exists: true, error: '这个路径不是文件夹' })
  const files = folderImagePaths(dir, recursive)
  return Object.assign({}, base, {
    exists: true,
    isDir: true,
    count: files.length,
    sample: files.slice(0, 3).map((file) => path.basename(file)),
  })
}

/**
 * Pick one random, verified image out of a folder.
 * @param folder - the configured directory.
 * @param recursive - include sub-directories.
 * @returns an absolute path, or '' when nothing usable was found.
 */
export function pickFolderImage(folder, recursive = false) {
  const pool = folderImagePaths(folder, recursive)
  for (let attempt = 0; attempt < 5 && pool.length; attempt++) {
    const index = crypto.randomInt(pool.length)
    const candidate = pool[index]
    const bytes = firstBytes(candidate)
    if (bytes && imageKind(bytes)) return candidate
    // Named .png but not a PNG: drop it so the next attempt tries something else.
    pool.splice(index, 1)
  }
  return ''
}

/** The MIME type of a background file, read from its magic bytes. */
export function imageMime(file) {
  const bytes = firstBytes(file)
  const kind = bytes ? imageKind(bytes) : undefined
  return kind ? kind.mime : 'application/octet-stream'
}

/**
 * Resolve the card background for a configuration.
 *
 * A folder background picks a fresh random image for every card, so the desktop
 * shows a different picture each turn; a file that is not really an image (a
 * mislabelled download, a truncated file) is skipped instead of producing a
 * broken card.
 * @param config - the active configuration.
 * @returns `{ backgroundImage, dim, focusX, focusY }` payload fields.
 */
export function resolveBackground(config) {
  const background = config.background || {}
  const dim = background.dim
  const focusX = clampInt(background.focusX, 50, 0, 100)
  const focusY = clampInt(background.focusY, 50, 0, 100)
  if (background.mode === 'folder') {
    const file = background.folder ? pickFolderImage(background.folder, background.recursive) : ''
    return { backgroundImage: file || '', dim, focusX, focusY }
  }
  if (background.mode !== 'image') return { backgroundImage: '', dim, focusX: 50, focusY: 50 }
  const row = background.image ? backgroundRow(background.image) : undefined
  const file = row ? backgroundPath(row.id) : undefined
  if (!row || !file || !fs.existsSync(file)) return { backgroundImage: '', dim, focusX: 50, focusY: 50 }
  return {
    backgroundImage: file,
    dim: background.dim,
    focusX: Number.isFinite(row.focusX) ? row.focusX : 50,
    focusY: Number.isFinite(row.focusY) ? row.focusY : 50,
  }
}
