/**
 * dsh-notify-card — browser half.
 *
 * Contributes one page to the DSH settings panel (`settings.section`) where the
 * popup's sound and the card's visible sections are configured. The page talks
 * to this package's host routes (`/dsh-notify-card/*`), which own the durable
 * `$DSH_HOME/turn-notify/config.json` and the uploaded-sound library.
 *
 * Hand-written in the bundle form the client module system serves: the shell
 * registers the factory, React arrives from the seeded platform table, and the
 * module's exported `apply`/`inject` are what the Cordis client tree mounts.
 */
window.__ModuleLoader__.load({
  id: 'dsh-notify-card',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    const API = '/dsh-notify-card'

    const SHOW_FIELDS = [
      ['title', '标题（DSH · 对话完成）'],
      ['session', '会话名称'],
      ['target', '目标对话标题（哪个对话在等你）'],
      ['headline', '轮次信息（第 N 轮 · 用时 · 工具次数）'],
      ['summary', '结论摘要'],
      ['tools', '工具调用排行'],
      ['files', '改动文件列表'],
      ['footer', '底部提示与倒计时'],
    ]

    const SOUND_MODES = [
      ['auto', '跟随状态', '正常=提示音，有错/取消=感叹号，中断=关键停止'],
      ['system', '固定系统音效', '无论结果都播放同一个 Windows 声音'],
      ['file', '自定义音频', '播放上传的 WAV 文件'],
      ['none', '静音', '只弹卡片，不发声'],
    ]

    const SOUND_KINDS = [
      ['asterisk', '提示音 Asterisk'],
      ['exclamation', '感叹号 Exclamation'],
      ['hand', '关键停止 Hand'],
      ['question', '问号 Question（部分系统未指派声音）'],
      ['beep', '蜂鸣 Beep'],
    ]

    const THEMES = [
      ['light', '亮色', '始终使用白底卡片'],
      ['dark', '暗色', '始终使用深色卡片'],
      ['auto', '跟随系统', '读 Windows 的「应用主题」设置（个性化 → 颜色）'],
    ]

    const BACKGROUND_MODES = [
      ['theme', '主题底色', '用上面所选主题的底色'],
      ['image', '自定义图片', '铺满卡片：按比例放大到刚好覆盖，再按下面的「裁切范围」取一块'],
      ['folder', '文件夹随机', '每次弹窗从这个文件夹里随机挑一张图片，每轮换一张'],
    ]

    /** Crop anchors: [focusX, focusY, tooltip] on a 3x3 grid. */
    const ANCHORS = [
      [0, 0, '左上'],
      [50, 0, '上'],
      [100, 0, '右上'],
      [0, 50, '左'],
      [50, 50, '中'],
      [100, 50, '右'],
      [0, 100, '左下'],
      [50, 100, '下'],
      [100, 100, '右下'],
    ]

    /** Where the card parks on the screen: top/center/bottom row, left/center/right column. */
    const POSITIONS = [
      ['tl', '左上'],
      ['tc', '上'],
      ['tr', '右上'],
      ['cl', '左'],
      ['cc', '正中'],
      ['cr', '右'],
      ['bl', '左下'],
      ['bc', '下'],
      ['br', '右下'],
    ]

    /** Same palettes the PowerShell renderer uses, for the live preview. */
    const PREVIEW_PALETTES = {
      light: { bg: '#FFFFFF', border: '#E1E4E8', title: '#1F2328', sub: '#6B7280', body: '#3A4048', accent: '#22C55E' },
      dark: { bg: '#1E1F22', border: '#33363B', title: '#E8EAED', sub: '#9AA0A6', body: '#D5D8DC', accent: '#4ADE80' },
    }

    const CSS = `
/* The settings surface declares its tokens on a host element rather than :root,
   so every read carries a dark-theme fallback. NOTE: --dsw-alias-brand-primary is
   the *contrast* surface (near-black in light, near-white in dark), so anything
   drawn on top of it must use --dsw-alias-bg-base; that pair is what the
   --dtn-on-brand variable below resolves to. Direct backticks are avoided inside
   this template literal. */
.dtn-page{--dtn-on-brand:var(--dsw-alias-bg-base,#151517);display:flex;flex-direction:column;gap:18px;padding:2px 2px 28px;color:var(--dsw-alias-label-primary,#f9fafb);font-size:13px;line-height:1.6}
.dtn-card{display:flex;flex-direction:column;gap:12px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l1,#ffffff1f);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#232324)}
.dtn-card>h3{margin:0;font-size:13px;font-weight:600}
.dtn-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dtn-row.dtn-top{align-items:flex-start}
.dtn-label{min-width:86px;color:var(--dsw-alias-label-secondary,#cfd3d6);font-size:12px}
.dtn-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 16px}
.dtn-check{display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none}
.dtn-check input{accent-color:var(--dsw-alias-brand-primary,#f9fafb);cursor:pointer}
.dtn-radio{display:grid;grid-template-columns:auto 1fr;gap:2px 8px;align-items:center;cursor:pointer;user-select:none}
.dtn-radio input{accent-color:var(--dsw-alias-brand-primary,#f9fafb)}
.dtn-radio small{grid-column:2;color:var(--dsw-alias-label-secondary,#cfd3d6);font-size:11px}
.dtn-select,.dtn-input{height:28px;min-width:180px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1,#ffffff1f);border-radius:6px;background:var(--dsw-alias-bg-base,#151517);color:var(--dsw-alias-label-primary,#f9fafb);font-size:12px}
.dtn-input{width:72px;min-width:72px}
.dtn-select option{background:var(--dsw-alias-bg-overlay,#232324);color:var(--dsw-alias-label-primary,#f9fafb)}
.dtn-btn{height:28px;padding:0 12px;border:1px solid var(--dsw-alias-border-l1,#ffffff1f);border-radius:6px;background:var(--dsw-alias-bg-layer-2,#2c2c2e);color:var(--dsw-alias-label-primary,#f9fafb);font-size:12px;cursor:pointer}
.dtn-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l2,#ffffff29)}
.dtn-btn:disabled{opacity:.5;cursor:default}
.dtn-btn.dtn-primary{background:var(--dsw-alias-brand-primary,#f9fafb);border-color:transparent;color:var(--dtn-on-brand);font-weight:600}
.dtn-btn.dtn-danger{color:color-mix(in srgb, var(--dsw-alias-state-error-primary,#f25a5a) 55%, var(--dsw-alias-label-primary,#f9fafb))}
.dtn-foot{display:flex;align-items:center;gap:12px}
.dtn-actions{display:flex;align-items:center;gap:10px;padding-top:14px;border-top:1px solid var(--dsw-alias-border-l1,#ffffff1f)}
.dtn-note{font-size:12px;color:var(--dsw-alias-label-secondary,#cfd3d6)}
/* Mixing the state color toward the label color keeps these readable on both a
   near-black and a near-white page. */
.dtn-ok{color:color-mix(in srgb, var(--dsw-alias-state-success-primary,#22c55e) 60%, var(--dsw-alias-label-primary,#f9fafb))}
.dtn-err{color:color-mix(in srgb, var(--dsw-alias-state-error-primary,#f25a5a) 55%, var(--dsw-alias-label-primary,#f9fafb))}
.dtn-muted{opacity:.65}
`

    /** Id of the one stylesheet this plugin keeps in the document. */
    const STYLE_ID = 'dsh-notify-card-styles'

    /**
     * Make sure this plugin's stylesheet is in the document, and return it.
     * Idempotent, so repeated calls (apply, every mount) cannot stack copies.
     * @returns the style element, or null when the document refuses it.
     */
    function ensureStyle() {
      try {
        const existing = document.getElementById(STYLE_ID)
        if (existing) {
          if (existing.textContent !== CSS) existing.textContent = CSS
          return existing
        }
        const style = document.createElement('style')
        style.id = STYLE_ID
        style.textContent = CSS
        document.head.appendChild(style)
        return style
      } catch {
        return null
      }
    }

    /**
     * Is the page actually styled right now? Renders a hidden `.dtn-card`
     * inside the real settings surface and reads back what the browser
     * resolved, which is the only honest answer from inside the page.
     * @returns a one-line report for the client log.
     */
    function stylesheetState() {
      try {
        const host =
          document.querySelector('[data-slot="settings.section"]') ||
          document.querySelector('[data-slot="sidebar.settings"]') ||
          document.body
        const probe = document.createElement('div')
        probe.className = 'dtn-card'
        probe.setAttribute('style', 'position:fixed;left:-9999px;top:0;width:120px;height:20px')
        host.appendChild(probe)
        const background = getComputedStyle(probe).backgroundColor
        probe.remove()
        const styled = background && background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent'
        return `card=${styled ? background : 'MISSING'} sheet=${document.getElementById(STYLE_ID) ? 'yes' : 'no'}`
      } catch (error) {
        return `card=unknown (${error && error.message ? error.message : error})`
      }
    }

    /** Fetch one of this plugin's host routes. */
    async function request(path, init) {
      const res = await fetch(API + path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, init))
      const text = await res.text()
      let data
      try {
        data = JSON.parse(text)
      } catch {
        throw new Error(res.ok ? '响应不是 JSON' : `HTTP ${res.status}`)
      }
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`)
      return data
    }

    /**
     * Best-effort breadcrumb to the host half, appended to
     * `$DSH_HOME/logs/turn-notify-client.log`. A settings page that silently
     * fails to arrive leaves nothing else to inspect from outside the browser.
     */
    function report(event, detail) {
      try {
        const text = detail ? String(detail && detail.message ? detail.message : detail).slice(0, 600) : ''
        fetch(`${API}/client-log.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event, detail: text }),
        }).catch(() => {})
      } catch {}
    }

    report('module-evaluated', `href=${location.pathname}${location.search ? '?…' : ''}`)

    function Check(props) {
      return h(
        'label',
        { className: 'dtn-check' },
        h('input', { type: 'checkbox', checked: props.checked, disabled: props.disabled, onChange: (e) => props.onChange(e.target.checked) }),
        h('span', null, props.label),
      )
    }

    function Radio(props) {
      return h(
        'label',
        { className: 'dtn-radio' },
        h('input', { type: 'radio', name: props.name, checked: props.checked, onChange: () => props.onChange() }),
        h('span', null, props.label),
        props.hint ? h('small', null, props.hint) : null,
      )
    }

    /** A miniature of the real card, drawn with the renderer's own palette. */
    function ThemePreview(props) {
      const url = props.backgroundUrl
      const useImage = Boolean(url)
      const resolved = useImage ? 'dark' : props.mode === 'auto' ? props.systemTheme || 'dark' : props.mode
      const palette = PREVIEW_PALETTES[resolved] || PREVIEW_PALETTES.dark
      const layer = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }
      return h(
        'div',
        {
          style: {
            position: 'relative',
            overflow: 'hidden',
            background: palette.bg,
            border: `1px solid ${palette.border}`,
            borderRadius: 8,
            padding: '10px 12px',
            maxWidth: 320,
          },
        },
        useImage
          ? h('div', {
              style: Object.assign({}, layer, {
                backgroundImage: `url("${url}")`,
                backgroundSize: 'cover',
                backgroundPosition: `${props.focusX === undefined ? 50 : props.focusX}% ${props.focusY === undefined ? 50 : props.focusY}%`,
              }),
            })
          : null,
        useImage && props.dim > 0
          ? h('div', { style: Object.assign({}, layer, { background: `rgba(0, 0, 0, ${props.dim / 100})` }) })
          : null,
        h('div', { style: { position: 'relative' } },
          h('div', { style: { height: 3, borderRadius: 2, background: palette.accent, marginBottom: 8 } }),
          h('div', { style: { color: palette.title, fontSize: 13, fontWeight: 600 } }, 'DSH · 对话完成'),
          h('div', { style: { color: palette.sub, fontSize: 11, marginTop: 3 } }, '会话标题会显示在这里'),
          h('div', { style: { color: palette.sub, fontSize: 10.5, marginTop: 2 } }, '第 3 轮 · 用时 2 分 13 秒 · 工具调用 42 次'),
          h('div', { style: { color: palette.body, fontSize: 11.5, marginTop: 6 } }, '这一段是结论摘要的示例文字，用来预览卡片外观。'),
        ),
      )
    }

    /** A miniature of the work area with the card parked at the chosen anchor. */
    function PositionPreview(props) {
      const column = props.anchor.charAt(1)
      const row = props.anchor.charAt(0)
      const cardStyle = {
        position: 'absolute',
        width: 62,
        height: 26,
        borderRadius: 4,
        background: 'var(--dsw-alias-brand-primary, #f9fafb)',
        color: 'var(--dtn-on-brand)',
        fontSize: 9,
        textAlign: 'center',
        lineHeight: '26px',
      }
      const shifts = []
      const gap = 7
      if (column === 'l') cardStyle.left = gap
      else if (column === 'r') cardStyle.right = gap
      else {
        cardStyle.left = '50%'
        shifts.push('translateX(-50%)')
      }
      if (row === 't') cardStyle.top = gap
      else if (row === 'b') cardStyle.bottom = gap
      else {
        cardStyle.top = '50%'
        shifts.push('translateY(-50%)')
      }
      if (shifts.length) cardStyle.transform = shifts.join(' ')
      return h(
        'div',
        {
          style: {
            position: 'relative',
            width: 210,
            height: 116,
            borderRadius: 8,
            border: '1px dashed var(--dsw-alias-border-l2)',
            background: 'var(--dsw-alias-bg-base)',
            flex: 'none',
          },
        },
        h('span', { style: { position: 'absolute', left: 7, top: 3, fontSize: 9, color: 'var(--dsw-alias-label-secondary)' } }, '屏幕工作区'),
        h('div', { style: cardStyle }, '卡片'),
      )
    }

    /**
     * The page carries its own copy of the stylesheet: styling then lives and
     * dies with the tree that needs it, independent of anything registered on
     * the plugin context.
     */
    const STYLE_TAG = h('style', { key: 'dtn-css' }, CSS)

    function Page() {
      const [config, setConfig] = React.useState(null)
      const [defaults, setDefaults] = React.useState(null)
      const [sounds, setSounds] = React.useState([])
      const [backgrounds, setBackgrounds] = React.useState([])
      const [systemTheme, setSystemTheme] = React.useState('')
      const [dirty, setDirty] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState('')
      const [error, setError] = React.useState('')
      const fileRef = React.useRef(null)
      const imageRef = React.useRef(null)
      const focusTimer = React.useRef(null)
      const folderTimer = React.useRef(null)
      const [focus, setFocus] = React.useState({ x: 50, y: 50 })
      const [folderInfo, setFolderInfo] = React.useState(null)
      const [folderRev, setFolderRev] = React.useState(0)

      const load = React.useCallback(async () => {
        try {
          const data = await request('/config.json')
          setConfig(data.config)
          setDefaults(data.defaults)
          setSounds(data.sounds || [])
          setBackgrounds(data.backgrounds || [])
          setFolderInfo(data.backgroundFolder || null)
          setSystemTheme(data.systemTheme || '')
          setError('')
          report('config-loaded', `sounds=${(data.sounds || []).length} images=${(data.backgrounds || []).length} mode=${data.config.sound.mode}`)
        } catch (err) {
          setError(`无法读取配置：${err.message || err}`)
          report('config-error', err)
        }
      }, [])

      React.useEffect(() => {
        load()
      }, [load])

      // The crop window belongs to the image, so it always mirrors the selected one.
      const selectedImageId = config && config.background ? config.background.image : ''
      React.useEffect(() => {
        const row = backgrounds.find((entry) => entry.id === selectedImageId)
        if (row) setFocus({ x: row.focusX === undefined ? 50 : row.focusX, y: row.focusY === undefined ? 50 : row.focusY })
      }, [backgrounds, selectedImageId])

      // A folder background keeps its crop window in the config itself (there is
      // no per-file row to store it in), so it is loaded when that mode is picked.
      const backgroundMode = config && config.background ? config.background.mode : ''
      React.useEffect(() => {
        if (backgroundMode !== 'folder') return
        setFocus({
          x: config.background.focusX === undefined ? 50 : config.background.focusX,
          y: config.background.focusY === undefined ? 50 : config.background.focusY,
        })
      }, [backgroundMode])

      const patch = (change) => {
        setConfig((current) => Object.assign({}, current, change))
        setDirty(true)
        setNote('')
      }
      const patchSound = (change) => patch({ sound: Object.assign({}, config.sound, change) })
      const patchShow = (key, value) => patch({ show: Object.assign({}, config.show, { [key]: value }) })

      async function save() {
        setBusy(true)
        try {
          const data = await request('/config.json', { method: 'PUT', body: JSON.stringify(config) })
          setConfig(data.config)
          setDirty(false)
          setNote('已保存')
          setError('')
        } catch (err) {
          setError(`保存失败：${err.message || err}`)
        } finally {
          setBusy(false)
        }
      }

      async function sendSample() {
        setBusy(true)
        try {
          await request('/sample.json', { method: 'POST', body: JSON.stringify({ config }) })
          setNote('已发送示例弹窗 —— 看运行 DSH 的这台电脑的屏幕')
          setError('')
          report('sample-sent', `anchor=${config.position.anchor}`)
        } catch (err) {
          setError(`发送示例失败：${err.message || err}`)
        } finally {
          setBusy(false)
        }
      }

      async function preview() {
        setBusy(true)
        try {
          const data = await request('/preview.json', { method: 'POST', body: JSON.stringify({ config }) })
          setNote(data.sound && data.sound.sound === 'none' && !data.sound.soundFile ? '当前设置为静音' : '已在本机播放试听')
          setError('')
        } catch (err) {
          setError(`试听失败：${err.message || err}`)
        } finally {
          setBusy(false)
        }
      }

      async function upload(event) {
        const file = event.target.files && event.target.files[0]
        if (!file) return
        setBusy(true)
        try {
          const buffer = await file.arrayBuffer()
          const res = await fetch(`${API}/sounds.json?name=${encodeURIComponent(file.name)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: buffer,
          })
          const data = await res.json()
          if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`)
          setSounds(data.sounds || [])
          setConfig(data.config)
          setDirty(false)
          setNote(`已上传并启用：${file.name}`)
          setError('')
        } catch (err) {
          setError(`上传失败：${err.message || err}`)
        } finally {
          setBusy(false)
          if (fileRef.current) fileRef.current.value = ''
        }
      }

      async function removeSound() {
        const id = config.sound.file
        if (!id) return
        setBusy(true)
        try {
          const data = await request('/sounds/delete.json', { method: 'POST', body: JSON.stringify({ id }) })
          setSounds(data.sounds || [])
          setConfig(data.config)
          setDirty(false)
          setNote('已删除')
          setError('')
        } catch (err) {
          setError(`删除失败：${err.message || err}`)
        } finally {
          setBusy(false)
        }
      }

      async function uploadImage(event) {
        const file = event.target.files && event.target.files[0]
        if (!file) return
        setBusy(true)
        try {
          const buffer = await file.arrayBuffer()
          const res = await fetch(`${API}/backgrounds.json?name=${encodeURIComponent(file.name)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: buffer,
          })
          const data = await res.json()
          if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`)
          setBackgrounds(data.backgrounds || [])
          setConfig(data.config)
          setDirty(false)
          setNote(`已上传并启用背景：${file.name}`)
          setError('')
        } catch (err) {
          setError(`上传失败：${err.message || err}`)
        } finally {
          setBusy(false)
          if (imageRef.current) imageRef.current.value = ''
        }
      }

      async function removeImage() {
        const id = config.background.image
        if (!id) return
        setBusy(true)
        try {
          const data = await request('/backgrounds/delete.json', { method: 'POST', body: JSON.stringify({ id }) })
          setBackgrounds(data.backgrounds || [])
          setConfig(data.config)
          setDirty(false)
          setNote('已删除背景图')
          setError('')
        } catch (err) {
          setError(`删除失败：${err.message || err}`)
        } finally {
          setBusy(false)
        }
      }

      /**
       * Preview one of the "session is waiting for you" cards. Like the other
       * previews it renders the current draft and never writes the config, and it
       * deliberately works even while the feature is switched off.
       */
      async function previewAwaiting(kind) {
        setBusy(true)
        try {
          await request('/awaiting-sample.json', { method: 'POST', body: JSON.stringify({ kind, config }) })
          setNote(kind === 'approval' ? '已发送授权示例卡片' : '已发送问题示例卡片')
          setError('')
          report('awaiting-sample-sent', kind)
        } catch (err) {
          setError(`发送示例失败：${err.message || err}`)
        } finally {
          setBusy(false)
        }
      }

      /**
       * Ask the host what is inside one folder. The browser cannot read a local
       * directory, so the pool size and the file names always come from here.
       */
      async function scanFolder(folder, recursive) {
        try {
          const data = await request('/backgrounds/folder.json', { method: 'POST', body: JSON.stringify({ folder, recursive }) })
          setFolderInfo(data.stats)
          report('folder-scan', `count=${data.stats.count}${data.stats.error ? ` error=${data.stats.error}` : ''}`)
          return data.stats
        } catch (err) {
          setError(`检查文件夹失败：${err.message || err}`)
          return null
        }
      }

      /** The same check, but only once typing has stopped for half a second. */
      function scheduleScanFolder(folder, recursive) {
        if (folderTimer.current) clearTimeout(folderTimer.current)
        setFolderInfo(null)
        folderTimer.current = setTimeout(() => {
          scanFolder(folder, recursive)
        }, 500)
      }

      /**
       * Open the native Windows folder picker. The dialog runs on the machine
       * that shows the cards; this page only receives the chosen path.
       */
      async function browseFolder() {
        setBusy(true)
        try {
          const data = await request('/folders/pick.json', { method: 'POST', body: JSON.stringify({ initial: config.background.folder }) })
          if (data.path) {
            const next = Object.assign({}, config.background, { mode: 'folder', folder: data.path })
            patch({ background: next })
            setFolderRev((count) => count + 1)
            await scanFolder(next.folder, next.recursive)
            setNote(`已选择文件夹：${data.path}`)
          } else {
            setNote('已取消选择文件夹')
          }
          setError('')
        } catch (err) {
          setError(`打开文件夹选择框失败：${err.message || err}`)
        } finally {
          setBusy(false)
        }
      }

      /**
       * Move the crop window. Dragging a slider updates the preview immediately
       * and saves 400 ms after the last move; picking an anchor saves at once.
       */
      function applyFocus(x, y, immediate) {
        const next = { x: Math.max(0, Math.min(100, Math.round(x))), y: Math.max(0, Math.min(100, Math.round(y))) }
        setFocus(next)
        // A folder background has no per-file row: its crop window is part of the
        // configuration and is written by the normal save button.
        if (config.background.mode === 'folder') {
          patch({ background: Object.assign({}, config.background, { focusX: next.x, focusY: next.y }) })
          return
        }
        const id = config.background.image
        if (!id) return
        if (focusTimer.current) clearTimeout(focusTimer.current)
        const send = () => {
          request('/backgrounds/focus.json', { method: 'POST', body: JSON.stringify({ id, focusX: next.x, focusY: next.y }) })
            .then((data) => {
              setBackgrounds(data.backgrounds || [])
              setNote(`裁切范围已保存（${next.x}% / ${next.y}%）`)
              report('focus-saved', `${next.x},${next.y}`)
            })
            .catch((err) => setError(`保存裁切范围失败：${err.message || err}`))
        }
        if (immediate) send()
        else focusTimer.current = setTimeout(send, 400)
      }

      if (!config) {
        return h('div', { className: 'dtn-page' }, STYLE_TAG, h('div', { className: error ? 'dtn-err' : 'dtn-note' }, error || '正在读取配置…'))
      }

      const sound = config.sound
      const selected = sounds.find((row) => row.id === sound.file)
      const background = config.background
      const position = config.position
      const size = config.size
      const animation = config.animation
      const selectedImage = backgrounds.find((row) => row.id === background.image)
      const focused = background.mode !== 'theme'
      const focusDisabled = busy || (background.mode === 'image' ? !background.image : !background.folder)
      const backgroundUrl =
        background.mode === 'image' && background.image
          ? `${API}/background.img?id=${encodeURIComponent(background.image)}`
          : background.mode === 'folder' && background.folder && folderRev > 0
            ? `${API}/background-folder.img?folder=${encodeURIComponent(background.folder)}&recursive=${
                background.recursive ? 1 : 0
              }&rev=${folderRev}`
            : ''
      const folderNote = !background.folder
        ? '还没选择文件夹；点「浏览…」挑一个，或直接把路径粘进来。'
        : folderInfo
          ? folderInfo.error
            ? folderInfo.error
            : folderInfo.count
              ? `找到 ${folderInfo.count} 个图片文件${folderInfo.recursive ? '（含子文件夹）' : ''}：${folderInfo.sample.join('、')}${
                  folderInfo.count > folderInfo.sample.length ? ' …' : ''
                }。每次弹窗随机挑一张；挑到损坏或其实不是图片的文件会自动换下一张。`
              : '这个文件夹（含子文件夹时）没有可用的图片：支持 PNG / JPEG / WebP / GIF / BMP，单张不超过 48 MB。'
          : '正在检查文件夹…'

      return h(
        'div',
        { className: 'dtn-page' },
        STYLE_TAG,

        error ? h('div', { className: 'dtn-err' }, error) : null,

        h(
          'div',
          { className: 'dtn-card' },
          h('h3', null, '总开关'),
          h(Check, { checked: config.enabled, label: '启用通知卡片', onChange: (v) => patch({ enabled: v }) }),
          h(
            'div',
            { className: 'dtn-row' },
            h('span', { className: 'dtn-label' }, '自动关闭'),
            h('input', {
              className: 'dtn-input',
              type: 'number',
              min: 0,
              max: 3600,
              value: config.timeoutSeconds,
              onChange: (e) => patch({ timeoutSeconds: Number(e.target.value) }),
            }),
            h('span', { className: 'dtn-note' }, '秒（0 = 不自动关闭，需手动点掉卡片）'),
          ),
          h(
            'div',
            { className: 'dtn-row' },
            h('span', { className: 'dtn-label' }, '摘要长度'),
            h('input', {
              className: 'dtn-input',
              type: 'number',
              min: 60,
              max: 4000,
              value: config.summaryChars,
              onChange: (e) => patch({ summaryChars: Number(e.target.value) }),
            }),
            h('span', { className: 'dtn-note' }, '字（超出后截断，建议 300–600）'),
          ),
        ),

        h(
          'div',
          { className: 'dtn-card' },
          h('h3', null, '弹窗显示内容'),
          h(
            'div',
            { className: 'dtn-grid' },
            ...SHOW_FIELDS.map(([key, label]) =>
              h(Check, { key, checked: config.show[key] !== false, label, onChange: (v) => patchShow(key, v) }),
            ),
          ),
          h('div', { className: 'dtn-note' }, '取消勾选的部分不会出现在卡片上；全部取消会只剩一张空卡片。'),
        ),

        h(
          'div',
          { className: 'dtn-card' },
          h('h3', null, '需要你操作时提醒'),
          h(Check, {
            checked: config.awaiting.enabled !== false,
            label: '对话需要授权或回答时，也弹一张卡片',
            onChange: (v) => patch({ awaiting: Object.assign({}, config.awaiting, { enabled: v }) }),
          }),
          h(
            'div',
            { style: { display: 'grid', gap: '8px', paddingLeft: 22 } },
            h(Check, {
              checked: config.awaiting.approval !== false,
              disabled: !config.awaiting.enabled,
              label: '工具授权请求（某个命令/工具要你允许或拒绝）',
              onChange: (v) => patch({ awaiting: Object.assign({}, config.awaiting, { approval: v }) }),
            }),
            h(Check, {
              checked: config.awaiting.question !== false,
              disabled: !config.awaiting.enabled,
              label: '需要选择的问题（模型让你在几个选项里挑）',
              onChange: (v) => patch({ awaiting: Object.assign({}, config.awaiting, { question: v }) }),
            }),
            h(Check, {
              checked: config.awaiting.stay !== false,
              disabled: !config.awaiting.enabled,
              label: '这类卡片不自动关闭（一直留到你处理完，点一下或按 Esc 才消失）',
              onChange: (v) => patch({ awaiting: Object.assign({}, config.awaiting, { stay: v }) }),
            }),
            h(Check, {
              checked: config.awaiting.jump !== false,
              disabled: !config.awaiting.enabled,
              label: '点击卡片跳到对应对话（顺便把 DSH 窗口切到前台）',
              onChange: (v) => patch({ awaiting: Object.assign({}, config.awaiting, { jump: v }) }),
            }),
          ),
          h(
            'div',
            { className: 'dtn-row' },
            h('button', { className: 'dtn-btn', disabled: busy, onClick: () => previewAwaiting('approval') }, '预览授权卡片'),
            h('button', { className: 'dtn-btn', disabled: busy, onClick: () => previewAwaiting('question') }, '预览问题卡片'),
          ),
        ),

        h(
          'div',
          { className: 'dtn-card' },
          h('h3', null, '弹窗外观'),
          h(
            'div',
            { style: { display: 'grid', gap: '8px' } },
            ...THEMES.map(([value, label, hint]) =>
              h(Radio, { key: value, name: 'dtn-theme', label, hint, checked: config.theme === value, onChange: () => patch({ theme: value }) }),
            ),
          ),
          h(
            'div',
            { className: 'dtn-row' },
            h('span', { className: 'dtn-label' }, '背景'),
            h(
              'div',
              { style: { display: 'grid', gap: '6px' } },
              ...BACKGROUND_MODES.map(([value, label, hint]) =>
                h(Radio, {
                  key: value,
                  name: 'dtn-background-mode',
                  label,
                  hint,
                  checked: background.mode === value,
                  onChange: () => patch({ background: Object.assign({}, background, { mode: value }) }),
                }),
              ),
            ),
          ),
          background.mode === 'image'
            ? h(
                'div',
                { className: 'dtn-row' },
                h('span', { className: 'dtn-label' }, '背景图'),
                h(
                  'select',
                  {
                    className: 'dtn-select',
                    value: background.image,
                    onChange: (e) => patch({ background: Object.assign({}, background, { image: e.target.value }) }),
                  },
                  h('option', { value: '' }, backgrounds.length ? '请选择…' : '还没有上传图片'),
                  ...backgrounds.map((row) =>
                    h('option', { key: row.id, value: row.id }, `${row.name}（${Math.round(row.size / 1024)} KB）`),
                  ),
                ),
                h('button', { className: 'dtn-btn', disabled: busy, onClick: () => imageRef.current && imageRef.current.click() }, '上传图片'),
                h('button', { className: 'dtn-btn dtn-danger', disabled: busy || !selectedImage, onClick: removeImage }, '删除'),
                h('input', { ref: imageRef, type: 'file', accept: 'image/*', style: { display: 'none' }, onChange: uploadImage }),
              )
            : null,
          background.mode === 'folder'
            ? h(
                'div',
                { className: 'dtn-row dtn-top' },
                h('span', { className: 'dtn-label' }, '图片文件夹'),
                h(
                  'div',
                  { style: { display: 'grid', gap: 8, maxWidth: 560 } },
                  h(
                    'div',
                    { className: 'dtn-row' },
                    h('input', {
                      className: 'dtn-input',
                      type: 'text',
                      style: { flex: 1, minWidth: 240 },
                      placeholder: '例如 D:\\Pictures\\wallpapers',
                      value: background.folder,
                      onChange: (e) => {
                        const next = Object.assign({}, background, { folder: e.target.value })
                        patch({ background: next })
                        scheduleScanFolder(next.folder, next.recursive)
                      },
                    }),
                    h('button', { className: 'dtn-btn dtn-primary', disabled: busy, onClick: browseFolder }, '浏览…'),
                    h(
                      'button',
                      {
                        className: 'dtn-btn',
                        disabled: busy || !background.folder,
                        onClick: () => {
                          setFolderRev((count) => count + 1)
                          scanFolder(background.folder, background.recursive)
                        },
                      },
                      '扫描',
                    ),
                  ),
                  h(
                    'div',
                    { className: 'dtn-row' },
                    h(Check, {
                      checked: background.recursive,
                      label: '包含子文件夹',
                      onChange: (value) => {
                        const next = Object.assign({}, background, { recursive: value })
                        patch({ background: next })
                        scanFolder(next.folder, value)
                      },
                    }),
                    h(
                      'button',
                      {
                        className: 'dtn-btn',
                        disabled: busy || !background.folder,
                        onClick: () => setFolderRev((count) => count + 1),
                      },
                      '换一张预览',
                    ),
                  ),
                  h('div', { className: folderInfo && (folderInfo.error || !folderInfo.count) ? 'dtn-err' : 'dtn-note' }, folderNote),
                ),
              )
            : null,
          focused
            ? h(
                'div',
                { className: 'dtn-row dtn-top' },
                h('span', { className: 'dtn-label' }, '裁切范围'),
                h(
                  'div',
                  { style: { display: 'grid', gap: 8 } },
                  h(
                    'div',
                    { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 24px)', gap: 4 } },
                    ...ANCHORS.map(([x, y, label]) => {
                      const active = focus.x === x && focus.y === y
                      return h(
                        'button',
                        {
                          key: label,
                          type: 'button',
                          title: label,
                          disabled: focusDisabled,
                          onClick: () => applyFocus(x, y, true),
                          style: {
                            width: 24,
                            height: 24,
                            padding: 0,
                            cursor: 'pointer',
                            borderRadius: 5,
                            border: `1px solid ${active ? 'var(--dsw-alias-brand-primary, #f9fafb)' : 'var(--dsw-alias-border-l1, #ffffff1f)'}`,
                            background: active ? 'var(--dsw-alias-brand-primary, #f9fafb)' : 'var(--dsw-alias-bg-base, #151517)',
                          },
                        },
                        h('span', {
                          style: {
                            display: 'block',
                            width: 6,
                            height: 6,
                            margin: 'auto',
                            borderRadius: '50%',
                            background: active ? 'var(--dtn-on-brand)' : 'var(--dsw-alias-label-secondary, #cfd3d6)',
                          },
                        }),
                      )
                    }),
                  ),
                  h(
                    'div',
                    { className: 'dtn-row' },
                    h('span', { className: 'dtn-note', style: { minWidth: 34 } }, '水平'),
                    h('input', {
                      type: 'range',
                      min: 0,
                      max: 100,
                      step: 5,
                      value: focus.x,
                      disabled: focusDisabled,
                      style: { width: 150, accentColor: 'var(--dsw-alias-brand-primary)' },
                      onChange: (e) => applyFocus(Number(e.target.value), focus.y, false),
                    }),
                    h('span', { className: 'dtn-note', style: { minWidth: 34 } }, '垂直'),
                    h('input', {
                      type: 'range',
                      min: 0,
                      max: 100,
                      step: 5,
                      value: focus.y,
                      disabled: focusDisabled,
                      style: { width: 150, accentColor: 'var(--dsw-alias-brand-primary)' },
                      onChange: (e) => applyFocus(focus.x, Number(e.target.value), false),
                    }),
                  ),
                  h(
                    'div',
                    { className: 'dtn-note' },
                    `左上角=0%、右下角=100%、中点=50%（当前 ${focus.x}% / ${focus.y}%）。缩放后只保留这块区域，拖动滑块上方预览会实时跟着变。`,
                  ),
                ),
              )
            : null,
          focused
            ? h(
                'div',
                { className: 'dtn-row' },
                h('span', { className: 'dtn-label' }, '背景变暗'),
                h('input', {
                  type: 'range',
                  min: 0,
                  max: 90,
                  step: 5,
                  value: background.dim,
                  style: { width: 180, accentColor: 'var(--dsw-alias-brand-primary)' },
                  onChange: (e) => patch({ background: Object.assign({}, background, { dim: Number(e.target.value) }) }),
                }),
                h('span', { className: 'dtn-note' }, `${background.dim}%（图片越花越要调高，文字始终是浅色）`),
              )
            : null,
          h(ThemePreview, {
            mode: config.theme,
            systemTheme,
            backgroundUrl,
            dim: background.dim,
            focusX: focus.x,
            focusY: focus.y,
          }),
          h(
            'div',
            { className: 'dtn-note' },
            systemTheme
              ? `系统当前是${systemTheme === 'light' ? '亮色' : '暗色'}应用主题${
                  config.theme === 'auto' && background.mode === 'theme' ? '（弹窗正按它显示）' : ''
                }`
              : '系统主题读取失败；跟随系统时会退回暗色',
          ),
        ),

        h(
          'div',
          { className: 'dtn-card' },
          h('h3', null, '弹出位置、尺寸与动画'),
          h(
            'div',
            { className: 'dtn-row dtn-top' },
            h('span', { className: 'dtn-label' }, '位置'),
            h(
              'div',
              { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 56px)', gap: 4 } },
              ...POSITIONS.map(([value, label]) =>
                h(
                  'button',
                  {
                    key: value,
                    type: 'button',
                    title: label,
                    onClick: () => patch({ position: Object.assign({}, position, { anchor: value }) }),
                    style: {
                      height: 24,
                      fontSize: 11,
                      cursor: 'pointer',
                      borderRadius: 5,
                      border: `1px solid ${position.anchor === value ? 'var(--dsw-alias-brand-primary, #f9fafb)' : 'var(--dsw-alias-border-l1, #ffffff1f)'}`,
                      background: position.anchor === value ? 'var(--dsw-alias-brand-primary, #f9fafb)' : 'var(--dsw-alias-bg-base, #151517)',
                      color: position.anchor === value ? 'var(--dtn-on-brand)' : 'var(--dsw-alias-label-primary, #f9fafb)',
                    },
                  },
                  label,
                ),
              ),
            ),
            h(PositionPreview, { anchor: position.anchor }),
          ),
          h(
            'div',
            { className: 'dtn-row' },
            h('span', { className: 'dtn-label' }, '边距'),
            h('span', { className: 'dtn-note' }, '水平'),
            h('input', {
              className: 'dtn-input',
              type: 'number',
              min: 0,
              max: 400,
              value: position.marginX,
              onChange: (e) => patch({ position: Object.assign({}, position, { marginX: Number(e.target.value) }) }),
            }),
            h('span', { className: 'dtn-note' }, '垂直'),
            h('input', {
              className: 'dtn-input',
              type: 'number',
              min: 0,
              max: 400,
              value: position.marginY,
              onChange: (e) => patch({ position: Object.assign({}, position, { marginY: Number(e.target.value) }) }),
            }),
            h('span', { className: 'dtn-note' }, 'px（相对屏幕工作区，避开任务栏）'),
          ),
          h(
            'div',
            { className: 'dtn-row' },
            h('span', { className: 'dtn-label' }, '最大宽度'),
            h('input', {
              type: 'range',
              min: 280,
              max: 800,
              step: 20,
              value: size.maxWidth,
              style: { width: 180, accentColor: 'var(--dsw-alias-brand-primary, #f9fafb)' },
              onChange: (e) => patch({ size: Object.assign({}, size, { maxWidth: Number(e.target.value) }) }),
            }),
            h('span', { className: 'dtn-note' }, `${size.maxWidth} px（窄屏时会被屏幕工作区再收一次）`),
          ),
          h(
            'div',
            { className: 'dtn-row' },
            h('span', { className: 'dtn-label' }, '最大高度'),
            h('input', {
              type: 'range',
              min: 0,
              max: 800,
              step: 20,
              value: size.maxHeight,
              style: { width: 180, accentColor: 'var(--dsw-alias-brand-primary, #f9fafb)' },
              onChange: (e) => patch({ size: Object.assign({}, size, { maxHeight: Number(e.target.value) }) }),
            }),
            h('span', { className: 'dtn-note' }, size.maxHeight === 0 ? '自动（跟着内容长）' : `${size.maxHeight} px`),
          ),
          h(
            'div',
            { className: 'dtn-note' },
            '超过上限时：先把结论摘要截短并以 … 结尾，还不够就省掉工具/文件那两行，最后才动标题与轮次行。',
          ),
          h(Check, {
            checked: animation.enabled,
            label: '弹出动画：从贴着的那条屏幕边滑入并淡入',
            onChange: (v) => patch({ animation: Object.assign({}, animation, { enabled: v }) }),
          }),
          animation.enabled
            ? h(
                'div',
                { className: 'dtn-row' },
                h('span', { className: 'dtn-label' }, '动画时长'),
                h('input', {
                  type: 'range',
                  min: 120,
                  max: 800,
                  step: 20,
                  value: animation.durationMs,
                  style: { width: 180, accentColor: 'var(--dsw-alias-brand-primary, #f9fafb)' },
                  onChange: (e) => patch({ animation: Object.assign({}, animation, { durationMs: Number(e.target.value) }) }),
                }),
                h('span', { className: 'dtn-note' }, `${animation.durationMs} 毫秒（进场滑入、退场滑出都用它；300–500 比较明显，太短会像"直接出现"）`),
              )
            : null,
          h(
            'div',
            { className: 'dtn-note' },
            '位置按「鼠标所在显示器」的工作区算：贴左边就从左侧滑入、贴右边就从右侧滑入，上/下同理，正中只淡入。卡片没有标题栏，右上角不会有叉号 —— 点卡片任意处、按 Esc、或等倒计时结束即可关闭。',
          ),
        ),

        h(
          'div',
          { className: 'dtn-card' },
          h('h3', null, '弹窗音效'),
          h(
            'div',
            { style: { display: 'grid', gap: '8px' } },
            ...SOUND_MODES.map(([value, label, hint]) =>
              h(Radio, { key: value, name: 'dtn-sound-mode', label, hint, checked: sound.mode === value, onChange: () => patchSound({ mode: value }) }),
            ),
          ),
          sound.mode === 'system'
            ? h(
                'div',
                { className: 'dtn-row' },
                h('span', { className: 'dtn-label' }, '系统音效'),
                h(
                  'select',
                  { className: 'dtn-select', value: sound.system, onChange: (e) => patchSound({ system: e.target.value }) },
                  ...SOUND_KINDS.map(([value, label]) => h('option', { key: value, value }, label)),
                ),
              )
            : null,
          sound.mode === 'file'
            ? h(
                'div',
                { className: 'dtn-row' },
                h('span', { className: 'dtn-label' }, '音频文件'),
                h(
                  'select',
                  { className: 'dtn-select', value: sound.file, onChange: (e) => patchSound({ file: e.target.value }) },
                  h('option', { value: '' }, sounds.length ? '请选择…' : '还没有上传音频'),
                  ...sounds.map((row) => h('option', { key: row.id, value: row.id }, `${row.name}（${Math.round(row.size / 1024)} KB）`)),
                ),
                h('button', { className: 'dtn-btn', disabled: busy, onClick: () => fileRef.current && fileRef.current.click() }, '上传 WAV'),
                h('button', { className: 'dtn-btn dtn-danger', disabled: busy || !selected, onClick: removeSound }, '删除'),
                h('input', { ref: fileRef, type: 'file', accept: '.wav,audio/wav,audio/x-wav', style: { display: 'none' }, onChange: upload }),
              )
            : null,
          h(
            'div',
            { className: 'dtn-row' },
            h('button', { className: 'dtn-btn', disabled: busy, onClick: preview }, '在本机试听'),
            h('span', { className: 'dtn-note' }, '试听会在运行 DSH 的这台电脑上播放，走系统「声音方案」'),
          ),
        ),

        h(
          'div',
          { className: 'dtn-foot' },
          h('button', { className: 'dtn-btn dtn-primary', disabled: busy || !dirty, onClick: save }, dirty ? '保存' : '已保存'),
          h(
            'button',
            { className: 'dtn-btn', disabled: busy || !defaults, onClick: () => { setConfig(defaults); setDirty(true); setNote('已载入默认值，点「保存」生效') } },
            '恢复默认',
          ),
          dirty ? h('span', { className: 'dtn-note dtn-muted' }, '有未保存的修改') : null,
          !dirty && note ? h('span', { className: 'dtn-ok' }, note) : null,
        ),

        h(
          'div',
          { className: 'dtn-actions' },
          h('button', { className: 'dtn-btn dtn-primary', disabled: busy, onClick: sendSample }, '发送示例弹窗'),
        ),
      )
    }

    const inject = ['slots']

    function apply(ctx) {
      report('applied')
      // Probe what the settings surface actually inherits: whether the theme
      // tokens exist at all, and what native controls would fall back to.
      try {
        const host =
          document.querySelector('[data-slot="settings.section"]') ||
          document.querySelector('[data-slot="sidebar.settings"]') ||
          document.body
        const rootStyle = getComputedStyle(document.documentElement)
        const hostStyle = getComputedStyle(host)
        const tokens = [
          '--dsw-alias-bg-base',
          '--dsw-alias-bg-layer-1',
          '--dsw-alias-bg-layer-2',
          '--dsw-alias-label-primary',
          '--dsw-alias-label-secondary',
          '--dsw-alias-border-l1',
          '--dsw-alias-brand-primary',
          '--dsw-alias-state-success-primary',
          '--dsw-alias-state-error-primary',
        ]
          .map((name) => {
            const atRoot = rootStyle.getPropertyValue(name).trim()
            const atHost = hostStyle.getPropertyValue(name).trim()
            return `${name}[${atHost || atRoot || 'MISSING'}]`
          })
          .join(' ')
        report(
          'theme-probe',
          `rootColorScheme=${rootStyle.colorScheme} hostTag=${host.tagName} hostColor=${hostStyle.color} hostBg=${hostStyle.backgroundColor} ${tokens}`,
        )
      } catch (error) {
        report('theme-probe-failed', error)
      }
      // The sheet is deliberately never removed on disposal. A hot reload can run
      // the previous application's disposers *after* the new one has applied, and
      // since both share this one element id a stale disposer would take the live
      // stylesheet away — which left the already-rendered page with no styling at
      // all (no card boxes, no spacing) until it happened to re-render. An unused
      // stylesheet is inert, and the page's own copy covers the tree-is-gone case.
      ensureStyle()
      // Report the stylesheet's state once the reload has settled, so that class
      // of failure is visible in the log instead of only on screen, and put the
      // sheet back if it did get taken away.
      try {
        const late = setTimeout(() => {
          const state = stylesheetState()
          report('style-late-check', state)
          if (state.includes('MISSING')) {
            ensureStyle()
            report('style-reinjected', stylesheetState())
          }
        }, 1500)
        ctx.effect(() => () => clearTimeout(late), 'turn-notify: style check')
      } catch {}

      // Render one invisible sample of every styled control inside the real
      // settings surface and report the colors the browser actually resolved,
      // so a theme-contrast mistake is visible as a breadcrumb instead of a
      // button nobody can read.
      try {
        const host =
          document.querySelector('[data-slot="settings.section"]') ||
          document.querySelector('[data-slot="sidebar.settings"]') ||
          document.body
        const probe = document.createElement('div')
        probe.className = 'dtn-page'
        probe.setAttribute('style', 'position:fixed;left:-9999px;top:0;width:420px')
        probe.innerHTML =
          '<div class="dtn-card">' +
          '<button class="dtn-btn dtn-primary">save</button>' +
          '<button class="dtn-btn">plain</button>' +
          '<input class="dtn-input">' +
          '<select class="dtn-select"><option>opt</option></select>' +
          '<span class="dtn-ok">ok</span>' +
          '<span class="dtn-err">err</span>' +
          '<span class="dtn-note">note</span>' +
          '<button style="height:24px;width:56px;border:1px solid var(--dsw-alias-brand-primary,#f9fafb);' +
          'background:var(--dsw-alias-brand-primary,#f9fafb);color:var(--dtn-on-brand)">sel</button>' +
          '</div>'
        host.appendChild(probe)
        const read = (selector) => {
          const element = probe.querySelector(selector)
          const computed = getComputedStyle(element)
          return `${selector}{fg=${computed.color}|bg=${computed.backgroundColor}}`
        }
        const card = getComputedStyle(probe.querySelector('.dtn-card'))
        report(
          'style-probe',
          [
            `card{bg=${card.backgroundColor}}`,
            read('.dtn-primary'),
            read('.dtn-btn:not(.dtn-primary)'),
            read('.dtn-input'),
            read('.dtn-select'),
            read('.dtn-ok'),
            read('.dtn-err'),
            read('.dtn-note'),
            read('button[style]'),
          ].join(' '),
        )
        probe.remove()
      } catch (error) {
        report('style-probe-failed', error)
      }

      // Confirm the page can reach the host half's routes before the user ever
      // opens the settings page, and leave a breadcrumb when it cannot.
      request('/config.json')
        .then((data) => report('host-reachable', `sounds=${(data.sounds || []).length} mode=${data.config.sound.mode}`))
        .catch((error) => report('host-unreachable', error))

      // A card for a pending approval/question is a separate process, so the only
      // way it can say "the user clicked me, take them there" is through the host:
      // the host turns the card's marker file into a jump, and this poll picks that
      // up and selects the conversation. A tiny local route once a second, and only
      // while the page is actually visible.
      let attentionTimer = null
      let attentionFailures = 0
      let attentionAnnounced = false
      const pollAttention = async () => {
        try {
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          const data = await request('/attention.json')
          attentionFailures = 0
          if (!attentionAnnounced) {
            attentionAnnounced = true
            report('attention-polling', 'watching for card clicks')
          }
          const jump = data && data.jump
          if (!jump || !jump.sessionId) return
          let workspace
          try {
            workspace = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined
          } catch {
            workspace = undefined
          }
          if (!workspace || typeof workspace.openSession !== 'function') {
            report('attention-jump-unavailable', String(jump.sessionId))
            return
          }
          workspace.openSession(jump.sessionId)
          report('attention-jump', String(jump.sessionId))
          try {
            window.focus()
          } catch {}
        } catch (error) {
          attentionFailures += 1
          // The route is local and normally always there, so one line is enough and
          // then only an occasional reminder instead of a breadcrumb storm.
          if (attentionFailures === 1 || attentionFailures % 60 === 0) report('attention-poll-failed', error)
        }
      }
      try {
        attentionTimer = setInterval(pollAttention, 1000)
        ctx.effect(
          () => () => {
            if (attentionTimer) clearInterval(attentionTimer)
            attentionTimer = null
          },
          'turn-notify: attention',
        )
      } catch {}
      ctx.effect(
        () =>
          ctx.slots.inject('settings.section', () => {
            report('slot-registered')
            return ctx.slots.register(
              {
                name: 'settings.section',
                id: 'turn-notify',
                order: 60,
                label: () => '通知卡片配置',
              },
              function Wrapped() {
                // Re-assert the document copy on every mount/render: cheap, and it
                // heals a page that was rendered while the sheet was missing.
                ensureStyle()
                report('page-mounted', stylesheetState())
                return h(Page, null)
              },
            )
          }),
        'turn-notify: settings page',
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
