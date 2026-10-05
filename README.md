# dsh-notify-card

每轮对话跑完（`turn/end`）时，在 Windows 桌面右下角弹出一张卡片，用几句人话说明**这轮对话做了什么**。

```
┌────────────────────────────────────────────┐  ← 顶部色条：绿=正常 黄=有错/取消 红=中断
│ DSH · 对话完成                             │
│ 制作一个 dsh 插件：对话结束弹窗摘要          │  ← 会话标题（session/title）
│ 第 3 轮 · 用时 2 分 13 秒 · 工具调用 42 次   │  ← 轮次 / 用时 / 工具次数 / 文件改动 / 出错次数
│ 已完成插件骨架：监听会话事件流，在该轮结束    │  ← 本轮最后一条助手文字（去掉 Markdown 记号后截断）
│ 时汇总本轮做了什么，并在右下角弹出卡片。      │
│ 工具：pwsh ×20 · read ×8 · write ×3 …       │  ← 本轮工具调用排行
│ 文件：dsh-notify-card\lib\index.js、README.md│  ← 本轮 write/edit/present 动过的文件
│                        点击或按 Esc 关闭 (25s)│  ← 倒计时自动关闭
└────────────────────────────────────────────┘
```

卡片置顶、可拖动、点任意处或按 `Esc` 关闭，默认 25 秒自动消失；出现在**鼠标所在那台显示器**的右下角。显示哪几行、用什么音效，都在 DSH 设置里配（见下）。

> **只在 Windows 上工作**：卡片是 PowerShell + WinForms 画的，宿主半边出图/出声的部分都依赖 Windows（`assets/*.ps1`）。非 Windows 平台上插件仍会加载，但不会弹卡片。

## 安装

三种方式任选其一（装完**重启 DSH** 生效）：

**① GitHub 仓库**（推荐，源码最新）—— 打开 DSH 的 **设置 → 插件 → 添加插件**，在「包名或地址」里填：

```
github:Popsicleee/dsh-notify-card
```

写成完整地址也可以：`git+https://github.com/Popsicleee/dsh-notify-card.git`。

**② 本地目录**（自己改代码时用）：

```powershell
dsh plugin --profile <你的profile> add link:D:\path\to\dsh-notify-card
```

**③ npm 包**（尚未发布，发布后可用）：填包名 `dsh-notify-card`。

安装是否生效：设置里出现「通知卡片配置」那一页，且插件列表里有一行 `dsh-notify-card`（enabled）。

## 在 DSH 设置里配置

设置面板（左下角齿轮）里多出一页 **「通知卡片配置」**：

| 区块 | 可配置项 |
|---|---|
| 总开关 | 启用/停用弹窗；自动关闭秒数（0 = 不自动关）；摘要长度 |
| 弹窗显示内容 | 标题、会话名称、**目标对话标题**、轮次信息、结论摘要、工具调用排行、改动文件列表、底部提示与倒计时 —— 逐项勾选 |
| **需要你操作时提醒** | 会话卡在等你时也弹卡片：总开关 + **工具授权请求** / **需要选择的问题** / **这类卡片不自动关闭** / **点击卡片跳到对应对话**；两个「预览」按钮分别弹一张示例 |
| **弹窗外观** | 主题 **亮色 / 暗色 / 跟随系统**（读 Windows「应用主题」）；背景 **主题底色 / 自定义图片 / 文件夹随机**（上传单图，或指定一个文件夹每轮随机取一张；都能**九宫格 + 滑块调整保留哪一块**，并可调「变暗」0–90%）；带迷你卡片实时预览 |
| **弹出位置与动画** | 位置 **九宫格**（左上/上/右上/左/正中/右/左下/下/右下）+ 水平/垂直边距（px，相对屏幕工作区）；**最大宽度 / 最大高度**；动画开关 + 时长（120–800ms）；带屏幕示意预览 |
| 弹窗音效 | **跟随状态**（正常=提示音、有错/取消=感叹号、中断=关键停止）/ **固定系统音效**（Asterisk、Exclamation、Hand、Question、Beep）/ **自定义音频**（上传 WAV，可多存几个、可删除）/ **静音**；随时「在本机试听」 |
| **发送示例弹窗** | 页面**最下方**的按钮：按当前设置（**含还没保存的草稿**）在运行 DSH 的这台电脑上真弹一张示例卡片，位置、尺寸、主题、背景、动画、音效一次看全 |

- 配置存在 `%USERPROFILE%\.dsh\turn-notify\config.json`（JSON，可手工编辑）。
- 上传的音频存在 `%USERPROFILE%\.dsh\turn-notify\sounds\`，只接受 RIFF/WAVE 的 `.wav`，单个上限 8 MB。
- 「文件夹随机」模式的图片**留在原地**（插件只读、不复制），所以换文件夹、增删图片都不占额外空间，见下文。
- 「试听」是在运行 DSH 的这台电脑上播放（和真弹窗同一条链路），不会改动未保存的配置。

设置页就在**同一个包里**（`lib/client.js`，通过 `dsh.client` + `exports["./client"]` 暴露），所以现在只装一个包、Plugins 面板里也只有一行。

> 历史：设置页曾经单独成包（`dsh-turn-notify-settings`）。原因是 DSH 的 client-modules 会把「包 → 浏览器模块清单」缓存到进程重启，往**已安装**的包里新增 `dsh.client` 不重启不生效，而新包首次激活会被扫描 —— 于是当时把 UI 拆出去，好让它装完即可用。现在已经装好，就把两边合回一个包（代价是这次合并本身需要重启一次 DSH 才会认）。

## 安装状态

已安装到本机 `desktop` profile（也就是当前这个 DeepSeek Harness 桌面应用）：

- profile 依赖：`C:\Users\lxb31\.dsh\profiles\desktop\package.json` →
  `"dsh-notify-card": "link:D:/dsh/tools/dsh-plugins/dsh-notify-card"`
- bundle 选择：`dsh.profile.bundles` 末尾追加本包
- 用户补丁：`profiles\desktop\cordis.patch.yml` 里追加了
  - `- id: dsh-notify-card / disabled: false`（可在 Plugins 面板里开关）
  - `- id: hmr / config.root: ["node_modules/dsh-notify-card"]`（让本包的代码改动热重载）

安装/卸载命令（其它 profile 同理）：

```powershell
# 安装（本地开发用 link:）
dsh plugin --profile desktop add link:D:\dsh\tools\dsh-plugins\dsh-notify-card
# 卸载
dsh plugin --profile desktop remove dsh-notify-card
```

> 注意：`root` 只是把包目录加进 HMR 监听。改 `lib/index.js` / `lib/client.js` 会立刻热替换；
> 但改 `package.json`、换安装路径、装新依赖、以及**新增/移除 `dsh.client` 声明**仍需要重启应用。

## 工作原理

1. 插件挂在 Host 侧，监听会话持久事件流 `ctx.on('session/event', ...)`（`session/event` 是提交后的事件广播，会话日志怎么写，它就看到什么）。
2. 按会话累计事件：`turn/start`（轮次、起始时间）、`session/title`（标题）、`assistant/message`（本步文字 + usage/错误）、`tool/call`（工具名、参数里的文件路径）、`tool/result`（错误标记）。
3. `turn/end` 时读取配置，把这一轮折叠成一段摘要（被关掉的部分直接留空），写成一个 UTF-8 JSON 载荷文件，然后启动
   `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File assets\notify.ps1 -PayloadPath <载荷>`
   画卡片。宿主不被阻塞，弹窗进程独立存活（**不能**用 `detached`：那样 PowerShell 会直接静默退出，卡片根本不出现）。
4. `assets/notify.ps1` 保持**纯 ASCII**：所有中文/emoji 都从 JSON 载荷读入（显式按 UTF-8 解码），
   绕开 Windows PowerShell 5.1 按 ANSI 解码脚本正文导致中文乱码的老问题。
5. `assets/play.ps1` 是「试听」用的：同一套 sound/soundFile 语义，播完才退出。
5. 卡片显示时调用 `[System.Media.SystemSounds]::…::Play()` 播放 **Windows 弹窗音效**
   （走系统「声音方案」，即控制面板 → 声音 → 声音方案里的 Windows 提示音）。

只对**根会话**弹窗；子代理（`delegationDepth > 0`）的 `turn/end` 默认跳过，避免刷屏。
没有文字结论也没有工具调用的空轮次不弹。

## 主题

卡片在**亮色 / 暗色 / 跟随系统**之间切换，默认 `auto`（跟随系统）。

| | 亮色 | 暗色 |
|---|---|---|
| 卡片底色 | `#FFFFFF` + 1px `#E1E4E8` 描边 | `#1E1F22` + 1px `#33363B` |
| 标题 / 正文 / 次要文字 | `#1F2328` / `#3A4048` / `#6B7280` | `#E8EAED` / `#D5D8DC` / `#9AA0A6` |
| 顶部色条（正常/有错/中断） | `#22C55E` / `#F59E0B` / `#EF4444` | `#4ADE80` / `#FBBF24` / `#F87171` |

- 「跟随系统」读的是 Windows 的**应用主题**：`HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize\AppsUseLightTheme`（设置 → 个性化 → 颜色 → 选择模式）。宿主读取后带 30 秒缓存，弹窗载荷里始终是明确的 `light`/`dark`。
- 本机当前 `AppsUseLightTheme = 1`，所以在默认的「跟随系统」下卡片是**亮色**的；想保持原来的深色卡片，在设置页选「暗色」即可。
- 这个主题只影响**弹窗卡片**；DSH 界面自身的主题仍在「设置 → 外观」里管。
- `assets/notify.ps1` 里若拿不到载荷的 `theme`（比如手工运行脚本），自己也会去读同一个注册表值。

## 背景图

「背景」= **自定义图片** 后，上传的图片会这样用：

1. 按卡片当前尺寸等比放大到**刚好覆盖**（取宽高比的较大者），再按**「裁切范围」**取图中一块 —— 不拉伸变形，等价于 CSS 的 `object-fit: cover` + `background-position`；
2. 在图片上盖一层**黑色变暗层**，透明度由「背景变暗」滑块决定（0–90%，默认 45%）—— 这就是你要的"比原图暗"；
3. 变暗层之上再画文字与顶部色条。**用图片时文字固定为浅色**（和暗色主题同一套前景色），因为变暗层保证了底子够暗；此时主题只影响顶部色条的三种状态色。

### 裁切范围（优先显示哪一块）

- 设置页用**九宫格**（左上/上/右上/左/中/右/左下/下/右下）一键定位，再用**水平 / 垂直滑块**（0–100，步长 5）微调；拖动时上方迷你卡片预览**实时**跟着变。
- 语义与 CSS `background-position` 完全一致：`0%` 贴左/上边，`100%` 贴右/下边，`50%` 居中。
- 裁切范围是**这张图片自己的属性**，存在 `backgrounds\index.json` 的 `focusX`/`focusY` 上：给不同图片各调一次即可，切换图片会自动带出它自己的范围。滑块拖动停止 400ms 后自动保存，九宫格点击立即保存。
- 举例：2800×500 的长图放进 460 宽的卡片时只保留约 1292px 宽，`0%` 显示最左边约 2.8 条色带，`100%` 显示最右边的一段 —— 已用六色分带测试图实拍核对过两端。

其他背景图细节：

- 只接受 PNG / JPEG / WebP / GIF / BMP，单文件上限 12 MB，存在 `%USERPROFILE%\.dsh\turn-notify\backgrounds\`。
- 「背景 = 主题底色」时行为和以前完全一样（纯色卡片）。
- 卡片的圆角目前是直角；图片背景在浅色桌面上靠 1px 描边勾轮廓（暗色图片底色则几乎看不出描边）。
- 图片是在**每张卡片自己的进程里**按最终尺寸现裁现压的（`HighQualityBicubic`），所以换显示器缩放/不同文字长度都不会变形。
- 已经打开的卡片会持有图片文件句柄；此时删除该图片，库里的记录会被清掉（文件留着，不影响使用），卡片关闭后即可正常删除文件。

## 背景 = 文件夹随机

不想每次看到同一张图时，选「背景 = **文件夹随机**」：指定一个放图片的文件夹，**每张卡片都从这个文件夹里随机抽一张**，所以每轮对话的弹窗背景都不一样。

- 点「**浏览…**」会在这台电脑上弹出 **Windows 原生的文件夹选择框**（选择框的说明文字是「选择存放背景图片的文件夹」）；也可以直接把路径粘进输入框。
- 「**包含子文件夹**」勾上后会往下最多 4 层；子文件夹里的图片也会进入随机池。
- 路径框下面显示这个池子的大小和前三个文件名：`找到 128 个图片文件（含子文件夹）：IMG_001.jpg、IMG_002.png、…`。
- 「**换一张预览**」在设置页的迷你卡片里换一张随机图；「扫描」重新数一遍。真实的随机发生在**弹窗那一刻**，所以预览图和你即将看到的不一定是同一张。
- 挑到损坏的文件、或者扩展名是 `.png` 其实不是图片的文件，会**自动换下一张**（最多重试 5 次）；整池都不可用时就退回主题底色，不会弹出破图。
- 「裁切范围」和「背景变暗」对文件夹模式同样有效；裁切范围存在配置里的 `background.focusX/focusY`（单图模式是每张图各存一份），所以对池子里**所有**图片生效 —— 随机图尺寸不一，建议先用九宫格选个大致区域。

### 为什么用原生选择框

浏览器读不到本地路径，所以「选文件夹」这件事只能在**运行 DSH 的这台电脑**上做：界面点「浏览…」后，宿主进程会起 `assets/pickfolder.ps1`（`-STA` 单线程单元，`FolderBrowserDialog`），把选中的路径写进一个临时 JSON 再读回来。选择框本身由一个 1×1、全透明、屏幕外、TopMost 的隐藏窗口当 owner，保证它弹在 DSH 窗口前面。

文件夹模式的规则：

- 认扩展名 `.png/.jpg/.jpeg/.webp/.gif/.bmp`，单张不超过 **48 MB**（壁纸通常比上传的图大，单独放宽）。
- 跳过隐藏文件（以 `.` 开头）、空文件、符号链接与联接点（不跟进去，所以不会绕圈）；一个池子最多数 **4000** 个文件。
- 扫描结果缓存 **20 秒**，避免每轮对话都去遍历几万个文件；往文件夹里加图片后最多 20 秒生效。
- 预览接口只会把**它自己随机选中的那张**发回浏览器，调用方只能指定文件夹、不能指定具体文件。

## 弹出位置与动画

- **位置**：九宫格九选一，默认「右下」（老行为）。按**鼠标所在显示器的工作区**计算（自动避开任务栏），再加设置的**水平/垂直边距**。设置页里有一块屏幕示意，点哪个格卡片就停哪。
- **动画**：从卡片贴着的那条屏幕边**滑入**并同时淡入（`ease-out`，15ms 一帧）：

| 锚点 | 从哪滑入 / 关的时候往哪滑出 |
|---|---|
| 左列（左上/左/左下） | **屏幕左侧** |
| 右列（右上/右/右下） | **屏幕右侧** |
| 上中 / 下中 | 上边 / 下边 |
| 正中 | 只淡入淡出，不滑动 |

- 时长 120–800ms（默认 **500ms**），**进场和退场用同一个时长**；可整体关掉，关掉后卡片直接出现在目标位置、也直接消失。
- 动画时钟是**在窗口真正显示出来之后**才开始计时的（`Add_Shown`）：建窗口+加载 WinForms 要 100–300ms，早期版本把这部分算进动画时间里，500ms 以下几乎看不到滑动，看起来就像"直接出现"。
- 进场结束会精确吸附到目标坐标并把不透明度恢复到 100%（动画期间用分层窗口，结束后恢复正常渲染，文字不会被 ClearType 影响）。

### 退场动画（不会再"啪"地消失）

三种关闭方式**都走同一个退场动画**：点卡片、按 `Esc`、倒计时结束。卡片沿着它进来时的那条边**滑回去并同时淡出**（`ease-in`：`t²`，越走越快，正好是进场 `ease-out` 的镜像），放完才真正关闭窗口。

- 动画关掉（或时长 0）时：立刻关闭，没有过渡帧。
- 卡片被**拖动过**、或者在**进场途中**就被点掉时，退场从它**当前所在的位置**开始，不会先跳回原位。
- 退场期间忽略再次点击/再按 Esc（第一个触发的说了算），倒计时也同时停掉。
- 「正中」锚点没有滑入方向，所以它是**原地淡出**。

实测（2560×1440、右下、400ms、2 秒倒计时，每 25ms 采样窗口坐标与分层窗口透明度）：

```
进场  t=587ms  x=2568  alpha=12    ← 屏幕右侧外面，几乎全透明
      t=684ms  x=2306  alpha=141
      t=871ms  x=2092  alpha=247
      t=2643ms x=2099  alpha=243   ← 倒计时到点，退场开始
      t=2797ms x=2255  alpha=162
      t=2953ms x=2561  alpha=3     ← 滑回屏幕右侧外面并淡出，随后窗口销毁
```

其它关闭方式（倒计时关掉、动画 300ms）：

| 关闭方式 | 实测退场 |
|---|---|
| 按 `Esc` | 触发后 93ms 开始滑出：`x 2078 → 2553`，`alpha 248 → 8` |
| 鼠标点击（真实指针输入点到卡片中心） | 触发后 292ms 开始滑出：`x 2076 → 2541`，`alpha 240 → 13` |
| 倒计时 | `x 2085 → 2561`，`alpha 243 → 3`，透明度单调递减，y 一直是 1184（只横着走） |
| 左上锚点 | `x 23 → -431`，`y` 不变 |
| 正中锚点 | `x/y` 完全不动，只淡出 `alpha 233 → 17` |

**嫌不够明显可在设置里把时长调到 600–800ms。**

> 顺带修掉一个老问题：`自动关闭 = 0`（"不自动关闭"）以前是失效的 —— 倒计时定时器无条件启动，`remaining` 第一次就减到 -1，卡片大约 1 秒后自己关掉。现在 0 才真的表示"一直留着，直到点掉或按 Esc"。

## 尺寸上限

设置页里的 **最大宽度**（280–800，默认 460）和 **最大高度**（0–800，默认 0 = 自动跟着内容长）。超出上限时按这个顺序让位：

1. **截短结论摘要**，末尾补 `...`（逐段回退到能放下为止）；
2. 还不够 → **省掉「工具」与「文件」两行**；
3. 还不够 → 摘要压到最小一行；再不行就到此为止。

另外：

- 宽度还会被**屏幕工作区**再收一次（`工作区宽 − 2×边距 − 8`），所以窄屏/小屏不会把卡片顶出屏幕；
- 卡片自身的"骨架"（色条 + 标题 + 会话名 + 轮次行 + 页脚）大约 **130–160px**，高度上限小于这个数时卡片只会缩到骨架那么高；
- 图片背景按最终尺寸现裁，所以改尺寸不会让图变形（只是取景范围跟着变）。

实测（2560×1440，每 100ms 采样窗口矩形）：

| 设置 | 实际窗口 |
|---|---|
| 默认（宽 460 / 高自动） | **460 × 243** |
| 宽 700 / 高自动 | **700 × 224**（更宽 → 行数更少 → 更矮） |
| 宽 380 / 高 220 | **380 × 220**（摘要正好放下，工具/文件两行被省掉） |
| 宽 700 / 高 170 | **700 × 163**（摘要压成一行并以 `...` 结尾） |

## 关闭方式（没有叉号）

卡片是 `FormBorderStyle=None` + `ControlBox=false` 的无边框窗口，**没有标题栏，也就没有右上角的叉号**。关闭方式只有三种，三种都会走同一个**退场动画**（见上文）：

- 点卡片任意位置；
- 按 `Esc`；
- 等到倒计时结束（默认 25 秒，可设 0 表示不自动关）。

所有兜底路径也都是无边框卡片、或干脆静默退出（载荷读不出来时），**不会出现带标题栏叉号的系统对话框**；兜底触发时会在载荷文件旁留下 `<载荷>.fallback` / `<载荷>.unreadable` 标记，方便定位。

## 音效

卡片出现时播放一次声音，具体播什么由设置页的「弹窗音效」决定：

| 模式 | 行为 | 当前机器实际对应的 wav |
|---|---|---|
| 跟随状态（默认） | 正常 → `SystemAsterisk`，有错/取消 → `SystemExclamation`，中断 → `SystemHand` | `…\media\Windows Background.wav` / `Windows Foreground.wav` |
| 固定系统音效 | 始终播所选的那一个 | 同上，按系统「声音方案」指派 |
| 自定义音频 | 播上传的 WAV（`SoundPlayer`，同步播完再退出） | `%USERPROFILE%\.dsh\turn-notify\sounds\<id>.wav` |
| 静音 | 只弹卡片 | — |

声音由系统「声音方案」决定：方案里把该类事件设成「无」就不会响（本机 `SystemQuestion` 就是无声音）。

## 需要你操作时提醒

除了「一轮结束」，会话**卡在等你**的时候也会弹卡片：

| 什么时候 | 卡片标题 | 卡面内容 |
|---|---|---|
| 某个工具要你**授权** | `DSH · 需要授权` | 工具名 + 请求原因（优先用 DSH 给的本地化原因） |
| 模型让你**选一个选项**（`ask_user_question`） | `DSH · 需要你选择` | 问题原文 + 每个问题的选项（最多 3 个问题、每个 5 个选项，多的省略） |

- 这类卡片和普通卡片**共用**主题、背景、位置、尺寸与动画设置，只是顶条是**琥珀色**（`status=warn`）；「跟随状态」音效下播**感叹号**而不是普通提示音。
- **点一下卡片就过去**：在授权/选择卡片上点一下，DSH 窗口会被**抬到前台**，并且浏览器半边会**切到那个对话**（`uiWorkspace.openSession`）—— 多个对话同时在跑时不用自己找是哪一个卡住了。只有"点它"才跳：`Esc`、等它自己关、以及"处理完自动消失"都不会跳。**窗口自己的状态不会被改动**：最大化/全屏保持原样，最小化的窗口会回到最小化之前的样子 —— 不会变成一个缩小的小窗口（`ShowWindow(SW_RESTORE)` 只在窗口**已最小化**时才调用，对最大化窗口调用它会把窗口缩回"还原尺寸"，这是个已经修掉的 bug）。
- **处理完就自己消失**：你在 DSH 里回答完问题、或允许/拒绝了授权之后，宿主会写一个 `<载荷>.close` 标记，卡片（每 250ms 看一次）立刻按**同一个退场动画**离开。也就是说卡片只在你还在被问着的时候占屏幕，不需要手动点掉。三种"结束"都算：`approval/decided`（允许/拒绝/取消）、提问工具调用返回（回答完或提问失败）。
- 顺序上有个体贴的地方：**先答后点也算**。处理完之后的 6 秒内，卡片还在退场（或还没消失）时你点它，同样会把你带到那个对话 —— 宿主这段时间还没停止监听卡片点击。
- **不会闪一下**：卡片延迟 700ms 出场，如果这期间请求就已经有结论了（比如某个策略**自动**拒绝了授权），那张卡片根本不会出现 —— 直接记一行 `awaiting card dropped before it appeared`。
- 默认**不自动关闭**（`timeoutSeconds = 0`）：授权框/选项卡不会自己消失，卡片也不该。万一会话被中断、一直没有结论，卡片会一直留着，点一下或按 `Esc` 即可（设置页里可以关掉这个行为，改回跟普通卡片一样的秒数）。
- **「目标对话标题」**这一行就是它：多个对话（含子代理）同时在跑时，显示**是哪个对话卡住了**；子代理被问到时，这一行显示的是**它所属的那个主对话**。「普通卡片上不会重复显示同一个标题」——如果这一行和「会话名称」本来就是一回事，它就不画。
- 不会和「一轮结束」的卡片重复：这类卡片不走 `turn/end`，而授权/提问都发生在**回合中间**。
- 防刷屏：同一个请求（同一 `callId`）**8 秒内只响一次**；连续多个请求之间至少隔 **1.2 秒**。
- 开关在设置页的「需要你操作时提醒」里（总开关 + 授权 / 问题 / 不自动关闭三个子项），另外两个按钮可以单独预览两张卡片（预览不受开关限制，且不写配置）。

### 它是怎么挂上钩子的

抓的不是"看到工具名猜一下"，而是 DSH 自己记录的两件事：

| 信号 | 类型 | 说明 |
|---|---|---|
| `approval/asked` | **durable session event** | 授权请求被提出时写入会话日志（`{id, toolName, callId?, reason?}`），走 `session/event` 这条 fire-and-forget 的流 |
| `approval/decided` | **durable session event** | 用户允许/拒绝/取消后写入（`{id, outcome}`）—— 用它把对应卡片收掉。它带的是 `id` 而不是 `callId`，所以宿主额外记了一份 `id → 卡片` 的索引 |
| `tool/call`（`name = ask_user_question`） | **durable session event** | 模型提问就是一次工具调用，参数里带着问题与选项；这个调用会**阻塞到用户回答** |
| `tool/result`（同一个 `callId`） | **durable session event** | 提问那次调用返回了（回答完、或被取消/失败）—— 用它把对应卡片收掉 |

点击跳转是一条**三跳**的链路（卡片是独立进程，浏览器里的页面是另一个世界）：

1. 卡片被点击 → 写 `<载荷>.jump`（内容是 `sessionId`），同时用 `SetForegroundWindow` 把 `appMatch`（默认 `DeepSeek`）匹配到的窗口抬到前台；
2. 宿主每 300ms 看一眼自己发出去的卡片有没有这个标记，有就排进 `pendingJump`，并写一行 `awaiting card clicked: jump to <id>`；
3. 浏览器半边每秒（且页面可见时）问一次 `GET /attention.json`，拿到就调 `uiWorkspace.openSession(sessionId)`（**取走即清空**，一跳只送达一次），并写一行 `attention-jump <id>`。

`appMatch` 是"抬哪个窗口"的进程名匹配，默认 `DeepSeek`；换壳/改名的话在 `config.json` 里改 `awaiting.appMatch` 即可。

选 durable 事件而不是 Cordis 的 `approval/request` / `user-questions/request` 瀑布事件，是因为**瀑布里轮不到我们**：驱动 DSH 那个授权框/选项卡的 answerer 会先"认领"请求（决定权在它），在它之后注册的监听器根本不会被调用 —— 实测确实如此（根 ctx 上的监听器一次都没触发，日志里没有对应行）。所以：

- **主路径**是上面两个 durable 事件：不参与任何决策，天然不可能干扰授权或提问；
- 瀑布监听器仍然注册着（`approval/request`、`user-questions/request`，全局 + 每个 agent 作用域各一份），作为其它部署形态下的兜底。它们只做「看一眼 → 弹卡片 → `next()` 交还决定权」，所以**永远不会**替你允许或拒绝什么，渲染失败也不会卡住授权链。这条链的安全性有专门的回归测试：伪造一条 Cordis 形状的瀑布链，验证真正的 answerer 仍被调用、它的返回值原样传回、payload 构造抛异常时结果不受影响。

## 设置页（浏览器半边）

设置页和宿主在**同一个包**里：`lib/client.js`，通过 `dsh.client { platform: 'web' }` + `exports["./client"]` 暴露；手写成 client-modules 要求的 `window.__ModuleLoader__.load({ id, factory })` 形式，`id` 就是包名 `dsh-notify-card`，`require('react')` 取平台内置的 React，`apply(ctx)` 里用 `ctx.slots.register` 注册到 `settings.section` 插槽。

页面上所有数据都走本包宿主的 HTTP 路由（`/dsh-notify-card/config.json`、`/sounds.json`、`/preview.json`、`/folders/pick.json`、`/attention.json` …）：

- 「发送示例弹窗」把**当前页面上的配置（含未保存的草稿）** POST 给宿主，由宿主用同一套 `buildPayload` 弹卡片 —— 看到的效果就是保存后的效果，且不写 `config.json`；
- 「需要你操作时提醒」里的两个预览按钮走 `POST /awaiting-sample.json`，同样按草稿渲染，而且**不受该功能总开关限制**（否则开启前没法先看长什么样）；
- 「文件夹随机」这一块全部由宿主代劳：`POST /folders/pick.json` 弹原生选择框、`POST /backgrounds/folder.json` 数池子（停止输入 500ms 防抖）、`GET /background-folder.img?folder=&recursive=&rev=` 取一张随机图给迷你卡片（宿主自己随机挑，调用方指定不了具体文件）；九宫格/滑块在文件夹模式下改的是配置里的 `background.focusX/focusY`，随「保存」写盘；
- 点击跳转：每秒（且页面可见时）问一次 `GET /attention.json`，拿到就 `ctx.get('uiWorkspace').openSession(sessionId)`。没有 `uiWorkspace` 时记一行 `attention-jump-unavailable` 而不抛错；路由不可用时只记一行 `attention-poll-failed`，不刷屏。

### 客户端日志面包屑（排错入口）

先建一个空的 `%USERPROFILE%\.dsh\logs\turn-notify.trace`（不建则不记录），再看 `logs\turn-notify-client.log`：

```
module-evaluated   # 浏览器模块被求值（bundle 已下发）
applied            # cordis 挂载了这个客户端插件
slot-registered    # 已注册到 settings.section
page-mounted       # 设置页已渲染；detail 里带实测卡片底色，如 card=rgb(35,35,36) sheet=yes
config-loaded      # 成功从宿主读到配置（路由与鉴权都通）
style-late-check   # 热重载 1.5 秒后复查样式表还在不在
style-reinjected   # 只在样式表真被弄丢、又补回来时出现
folder-scan        # 文件夹背景：数到了多少张
attention-polling  # 开始监听卡片点击
attention-jump     # 真正切换了对话（detail 是会话 id）
theme-probe        # 主题令牌在根/宿主元素上的实际取值
style-probe        # 各控件实际解析出的 前景/背景 色
config-error / attention-poll-failed / theme-probe-failed / style-probe-failed
```

缺哪一行，问题就出在那一步：没有 `module-evaluated` 说明模块没下发（查插件 row 是否 enabled、`dsh.client` 是否被读到 —— **新增/移除 `dsh.client` 声明必须重启 DSH**）；有 `applied` 没有 `slot-registered` 说明 `settings.section` 插槽没等到（查 ui-settings-general 在不在组合里）；有 `slot-registered` 没有 `page-mounted` 说明你还没在设置面板里点开这一页。

### 样式表为什么不能挂在 `ctx.effect` 的清理函数里

页面出现过一次「UI 丢失」：卡片框、间距、radio 说明全没了，只剩光秃秃的文字。原因是最早写成 `document.head.appendChild(style)` + `ctx.effect(() => () => style.remove())`：**热重载时上一个实例的清理函数会在新实例 `apply` 之后才跑**，于是刚插进去的样式表被上一个实例的 disposer 删掉了；而已经挂载的 React 树不会因此重渲染（那次重载后日志里没有新的 `page-mounted`），页面就一直裸着，直到手动刷新。

现在两层都留着：

1. **页面自带一份样式表**：`STYLE_TAG` 是页面根节点 `<div class="dtn-page">` 的第一个子节点 —— 样式生命周期跟着 React 树走，与插件上下文的 disposer 无关；
2. **head 里那份永不删除**（`ensureStyle()`，按 `id="dsh-notify-card-styles"` 幂等复用）：它是给隐藏配色探针用的，也顺手兜住"当前已挂载的旧树"。没人用的样式表是惰性的，而误删它就会重现上面那个 bug；
3. 每次挂载（`Wrapped`）都 `ensureStyle()` 一次，`apply` 后 1.5 秒再复查一遍，丢了就补并写 `style-reinjected`。

回归验证：把这三处换回旧写法跑同一套渲染测试，`a stale disposer cannot remove the live stylesheet` 会以 `head has 0 element(s)` 失败，`re-applying does not stack stylesheets` 也会因为旧写法每次重载都插一份而失败（`2`）。

### 配色约定（改设置页之前先看）

DSH 把别名令牌声明在设置宿主元素上（不是 `:root`），而且 **`--dsw-alias-brand-primary` 是"对比色表面"**：亮色主题里近黑（`#0f1115`）、暗色主题里近白（`#f9fafb`）。所以：

- 画在 `brand-primary` 上的文字/图元必须用 `--dsw-alias-bg-base`（本包包成 `--dtn-on-brand`）—— 早期版本写了 `color:#fff`，暗色主题下就是"白底白字"，部分按钮文字看不见；
- 其余令牌都带暗色兜底值（`var(--token, 兜底)`），令牌缺失也不会退回浏览器默认的浅色控件；
- 状态色（成功/错误）用 `color-mix` 向 `label-primary` 混合，亮暗两种主题下都保持 ≥5:1 对比度。

## 配置

首选在**设置页**里改（存 `%USERPROFILE%\.dsh\turn-notify\config.json`）。下面这些环境变量只在配置文件里没有对应值时生效，适合无界面/脚本场景：

| 变量 | 默认 | 作用 |
|---|---|---|
| `DSH_TURN_NOTIFY` | 开 | `0/false/off` 关闭弹窗（等于停用插件） |
| `DSH_TURN_NOTIFY_SUBAGENTS` | 关 | `1` 时子代理会话结束也弹 |
| `DSH_TURN_NOTIFY_TIMEOUT` | `25` | 自动关闭秒数，`0` = 不自动关 |
| `DSH_TURN_NOTIFY_SUMMARY_CHARS` | `420` | 摘要截断长度 |
| `DSH_TURN_NOTIFY_POWERSHELL` | `powershell.exe` | 换用其它 PowerShell（如 `pwsh.exe`） |
| `DSH_TURN_NOTIFY_SOUND` | `auto` | `auto` / `none` / `asterisk` / `exclamation` / `hand` / `question` / `beep` / `.wav` 绝对路径 |
| `DSH_TURN_NOTIFY_DEBUG` | 关 | `1` 时写 `$DSH_HOME/logs/turn-notify.log` |

调试开关也可以用一个空文件打开：`C:\Users\lxb31\.dsh\logs\turn-notify.trace`
（每次调用都会重新检查该文件，删掉即静默）。日志长这样：

```
2026-10-02T00:56:16.951Z loaded v0.3.0 pid=3820 platform=win32 enabled=true
2026-10-02T00:41:02.113Z notified turn 4 of session-0ccf… (completed, sound=asterisk): 第 4 轮 · 用时 1 分 8 秒 · 工具调用 12 次
```

## HTTP 路由（浏览器半边用）

全部套 DSH 的信任栅栏（`connection.requestRejection`），只允许同源/已鉴权请求：

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/dsh-notify-card/state.json` | 版本、平台、可用系统音效名 |
| GET/PUT | `/dsh-notify-card/config.json` | 读/写偏好（PUT 会做校验与归一化） |
| GET/POST | `/dsh-notify-card/sounds.json?name=` | 列出 / 上传自定义音频（body 为原始字节） |
| POST | `/dsh-notify-card/sounds/delete.json` | 删除一个音频（`{id}`） |
| GET | `/dsh-notify-card/sound.wav?id=` | 取回音频字节（浏览器内试听用） |
| GET/POST | `/dsh-notify-card/backgrounds.json?name=` | 列出 / 上传背景图（body 为原始字节） |
| POST | `/dsh-notify-card/backgrounds/delete.json` | 删除一张背景图（`{id}`） |
| POST | `/dsh-notify-card/backgrounds/focus.json` | 设置某张图的裁切范围（`{id, focusX, focusY}`，0–100） |
| GET | `/dsh-notify-card/background.img?id=` | 取回背景图字节（设置页预览用） |
| POST | `/dsh-notify-card/folders/pick.json` | 弹出**原生文件夹选择框**并返回 `{path, cancelled}`（`initial` 为初始目录；同时只允许一个） |
| GET/POST | `/dsh-notify-card/backgrounds/folder.json` | 数一个文件夹里有几个图片文件（草稿也能查，不写配置） |
| GET | `/dsh-notify-card/background-folder.img?folder=&recursive=&rev=` | 从该文件夹里**随机**取一张图的字节（404 = 没有可用图片） |
| POST | `/dsh-notify-card/preview.json` | 在本机试听（不写配置） |
| POST | `/dsh-notify-card/sample.json` | 用请求里带的配置（页面草稿）弹一张示例卡片，**不写配置** |
| GET | `/dsh-notify-card/attention.json` | 浏览器半边每秒问一次「用户点了哪张卡片」，返回 `{jump:{sessionId,at}}` 并**取走即清空**（没有则 `jump:null`） |
| POST | `/dsh-notify-card/awaiting-sample.json` | 同上，但弹的是「需要授权」/「需要选择」示例卡片（`{kind: 'approval'\|'question'}`；**忽略总开关**，方便预览） |
| POST | `/dsh-notify-card/client-log.json` | 浏览器半边打面包屑，落到 `logs\turn-notify-client.log` |

`GET /dsh-notify-card/config.json` 除了当前配置与默认值，还会返回 `sounds`（自定义音频列表）、`backgrounds`（背景图列表）、`backgroundFolder`（当前文件夹的 `{exists, count, sample, error}`）和 `systemTheme`（当前 Windows 应用主题），供设置页做预览。

## 文件结构

```
dsh-notify-card/                     # 一个包，两半
├─ package.json                      # dsh.bundle.patch → cordis.patch.yml；dsh.client(platform=web) + exports ./client
├─ cordis.patch.yml                  # bundle 补丁：insert 一行 id=dsh-notify-card
├─ lib/index.js                      # 宿主：事件折叠 + 摘要 + 弹窗进程 + HTTP 路由
├─ lib/config.js                     # 宿主：偏好读写、WAV/图片校验、音效与背景解析、文件夹随机取图
├─ lib/client.js                     # 浏览器：settings.section 页面（React，手写 bundle 形式）
└─ assets/
   ├─ notify.ps1                     # 纯 ASCII 的 WinForms 卡片渲染器
   ├─ pickfolder.ps1                 # 原生「选择文件夹」对话框（纯 ASCII，结果写成 JSON）
   └─ play.ps1                       # 「试听」用的一次性播放器
```

## 排错

| 现象 | 原因 / 处理 |
|---|---|
| 完全没有弹窗 | 建 `%USERPROFILE%\.dsh\logs\turn-notify.trace`，看 `turn-notify.log` 有没有 `notified turn …` 行；没有就是宿主没跑到 `turn/end`，或插件被停用（Plugins 面板 / `cordis.patch.yml`） |
| 有日志但屏幕上看不到卡片 | 检查是不是又被加回了 `detached: true`——DETACHED_PROCESS 的 PowerShell 会以退出码 0 立刻退出，卡片不显示 |
| 有弹窗但没声音 | 设置页里是不是选了「静音」；再看控制面板 → 声音 → 声音方案里 `Windows 提示音 / 感叹号 / 关键停止` 是否被设成「无」 |
| 设置里没有「通知卡片配置」这一页，或页面配色不对 | 先建一个空的 `%USERPROFILE%\.dsh\logs\turn-notify.trace`（不建则不记录），再看 `logs\turn-notify-client.log`：里面既有面包屑（`module-evaluated` → `applied` → `slot-registered` → `page-mounted` → `config-loaded`），也有 `theme-probe`/`style-probe` —— 后者直接打印各个控件在浏览器里**实际解析出的前景/背景色**，配色问题一眼可见 |
| 提示脚本被禁止运行 | 脚本用 `-ExecutionPolicy Bypass` 启动，正常不受组策略影响；若被 AppLocker 拦，改用 `DSH_TURN_NOTIFY_POWERSHELL` 指向放行版本 |
| 中文变成方块 | 卡片字体用 `Microsoft YaHei UI`，缺字体时回退 `Segoe UI`；可在 `assets/notify.ps1` 的 `New-UiFont` 调用处换字体 |
| 弹窗出现在另一块屏 | 这是设计：跟随鼠标所在显示器；想固定主屏可把 `Screen::FromPoint` 改成 `Screen::PrimaryScreen` |
| 弹窗"啪"地消失、看不到退场 | 设置页的「弹出动画」是不是被关掉了（关掉就是直接出现/直接消失）；时长太短（<200ms）也会看着像瞬移。退场是从卡片**贴着的那条边**滑回去，如果锚点在右下，它是往**右**滑出屏幕而不是淡在原地 |
| 卡片不自动关 | 这是「自动关闭 = 0」的正确行为（留到你点掉或按 Esc）；想让它自己走就填个秒数 |
| 背景选了「文件夹随机」但卡片还是纯色 | 看设置页路径框下面的提示：`这个文件夹不存在或无法访问` / `没有可用的图片`。文件夹里得有 `.png/.jpg/.jpeg/.webp/.gif/.bmp` 且不是空文件；刚放进去的图片最多等 20 秒（扫描缓存），或点一下「扫描」 |
| 点「浏览…」没反应 / 选择框一闪而过 | 宿主日志里应有 `folder picker: <路径>` 或 `folder picker: cancelled`；若报 `缺少 assets/pickfolder.ps1` 说明文件没随包带上；同时点两次只有一个选择框（第二次会提示「已经有一个文件夹选择框打开了」） |
| 被要求授权/提问时没弹卡片 | 宿主日志里应有 `awaiting card (approval): …` 或 `awaiting card (question): …`；没有的话：设置页「需要你操作时提醒」总开关/子项是不是关了、同一请求 8 秒内只响一次、两次请求间隔不足 1.2 秒会被吞掉。日志里出现 `awaiting card failed (…)` 则是造卡时出错（错误原因就在同一行） |
| 授权/提问的卡片一直不消失 | 先看宿主日志有没有 `awaiting card closed by decision: …`；有的话说明卡片已经收到"收工"信号（它自己会走退场动画）。没有的话通常是这次请求**一直没有结论**（会话被中断、提问被挂住）—— 点一下卡片或按 `Esc` 即可。默认「这类卡片不自动关闭」，想改成按秒数自动关就去设置页取消那个勾 |
| 被要求授权时卡片一闪而过 / 根本没出现 | 说明这次请求在 700ms 内就有结论了（多半是被策略**自动**允许/拒绝，压根没问你），日志里会有 `awaiting card dropped before it appeared`。这是故意的：不问你就不该打扰你 |
| 点卡片后窗口变成小窗口（丢掉了最大化/全屏） | 已修：那是"抬窗口"里无条件调 `ShowWindow(SW_RESTORE)` 造成的（对最大化窗口等于把它还原成还原尺寸）。现在只有窗口**已最小化**时才调用它，并保留窗口原本的状态。若你要改抬哪个窗口，调 `awaiting.appMatch`（进程名匹配，默认 `DeepSeek`） |
| 点了卡片没跳到对话 | 宿主日志应有 `awaiting card clicked: jump to <会话 id>`，客户端日志应有 `attention-jump <会话 id>`。只有前者 = 页面没在轮询（看 `attention-polling` 那行在不在）或拿不到 `uiWorkspace`（会出现 `attention-jump-unavailable`）；两者都没有 = 那次是被 `Esc`/自动消失关掉的，或者点的时候已经超过"处理完 6 秒"的窗口 |
| 卡片上多了一行我不认识的字 | 那是**「目标对话标题」**（`show.target`）：显示是哪个对话卡住了；子代理被问到时显示它所属的主对话。不想要就在「弹窗显示内容」里取消勾选 |
| 卡片上「目标对话标题」看着没生效 | 它刻意**不重复**：当它就是「会话名称」那一行本来就有的标题时会被省略；子代理会话、以及授权/提问卡片上才会有独立的一行 |
| 改了代码不生效 | 确认 profile 补丁里 `hmr.config.root` 含对应包目录；客户端模块若没自动重载，把插件关掉再打开或刷新页面 |
