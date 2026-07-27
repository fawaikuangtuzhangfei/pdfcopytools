# PDF 顺手复制（复制即净）

> [English README](./README.en.md)

Chrome 扩展：**接管 PDF 渲染，复制时自动还原段落换行**。在 PDF 里选中文字 → `Ctrl/⌘+C` → 粘贴出来就是段落干净、无 mid-段硬换行的文本，不用再手动重排。

## 为什么需要它

PDF 里没有「段落」这个概念，只有每个字的坐标。从 Chrome 自带阅读器复制时，段落被打散：软折行变硬换行、项目符号和段落边界丢失。而且自带阅读器跑在隔离的 PDFium 上下文里，油猴/内容脚本都注入不进去。**唯一能做到「复制即净」的路线，是用 pdf.js 自建阅读器接管渲染**——我们自己控制文字层和 copy 事件，用坐标重建段落。

## 安装（开发者模式加载）

1. 打开 `chrome://extensions`，右上角开启「开发者模式」。
2. 点「加载已解压的扩展程序」，选择本目录 `pdfcopytools/`。
3. **本地文件（`file://` 打开的 PDF）必做这一步**：在扩展卡片里打开「允许访问文件网址」。否则本地 PDF 不会进入我们的阅读器（在线 PDF 无需此步）。

装好后，打开任意 `*.pdf`（在线或本地）会自动进入我们的阅读器。

> **本地文件的实现说明**：Chrome 的 declarativeNetRequest 不拦截 `file://` 本地导航，所以在线 PDF 走 DNR 重定向，本地 PDF 由 `webNavigation` 监听 + `tabs.update` 重定向。两者都需要「允许访问文件网址」权限，本地文件才生效。

## 使用

- 选中文字 → `Ctrl/⌘+C` → 粘贴即干净，右下角轻提示「已整理换行」。
- **要原始文本**：按住 `Alt` 再复制（可在设置里改成 Shift 或关闭）。
- 工具栏图标弹窗可一键开关；「更多设置」里可调中英空格、连字符拼回、项目符号保留、提示开关等。

## 项目结构

```
manifest.json          MV3 清单（DNR 重定向 / host_permissions / CSP）
background.js          service worker：http(s) 用 DNR、file:// 用 webNavigation，重定向到 viewer.html?file=
src/reflow.js          ★段落重建纯函数（坐标 → 干净文本，无 DOM 依赖）
src/copy-handler.js    在阅读器内 hook copy 事件，取选区几何 → reflow → 写回剪贴板
src/toast.js           右下角轻提示
options/ popup/        设置页与工具栏弹窗
viewer/                vendored pdf.js 官方预构建阅读器（web/ + build/）
  web/viewer.html      注入了 src/copy-handler.js
  web/viewer.mjs       validateFileURL 已改为跳过同源校验（扩展内跨域加载）
tools/generate-icons.mjs  零依赖生成图标
test/reflow.test.js    reflow 单元测试
```

### 段落重建的判断逻辑（src/reflow.js）

按 `y` 聚成视觉行后，用几组几何信号判断相邻两行是「软折行（合并）」还是「段落断（换行）」：

- **换段**：下一行首行缩进 / 行间距明显大于正常行距 / 上一行未排满（两端对齐时）/ 行首是项目符号或编号。
- **拼接**：中文↔中文不加空格；拉丁词↔拉丁词补空格；英文 `-\n` 去连字符拼回单词；中↔英默认不加空格（可配）。

## 开发

```bash
npm test                       # 跑 reflow 单元测试（node --test）
node tools/generate-icons.mjs  # 重新生成 icons/*.png
```

升级 pdf.js：从 https://github.com/mozilla/pdf.js/releases 下载 `pdfjs-<ver>-legacy-dist.zip` 解压到 `viewer/`，然后重新应用两处补丁——
① `viewer/web/viewer.html` 注入 `<script src="../../src/copy-handler.js" type="module">`；
② `viewer/web/viewer.mjs` 的 `validateFileURL` 函数体首行加 `return;`。

## 已知限制（MVP）

- 只按 `.pdf` 后缀重定向；靠 `content-type` 无后缀提供的 PDF 暂回落到 Chrome 原生阅读器。
- 在线 PDF 走 DNR，原始 URL 直接拼进 `?file=` 未做百分号编码，带 `&` 复杂查询参数的签名链接可能失效（本地文件走 `webNavigation`，已做编码，不受此限）。
- 本地文件依赖用户手动开启「允许访问文件网址」，且 `webNavigation` 抢在原生阅读器前重定向时可能有极短暂闪烁。
- 段落重建是启发式，复杂多栏 / 表格 / 公式版面会有误判；MVP 聚焦单栏正文。
- 跨页选择时，页边距会被当作段落断（通常可接受）。

## 验证清单（需在真实 Chrome 手动过一遍）

1. 打开一个在线 PDF 与一个本地 PDF，确认都进入本扩展阅读器且文字可选中。
2. 选中跨行的一段中文 → 复制粘贴：无 mid-段硬换行、无多余空格。
3. 选中英文换行处（含 `-` 连字符）：单词拼回、词间有空格。
4. 选中项目符号列表：各要点各自成段、保留 • 标记。
5. 按住 `Alt` 复制：得到未处理的原始文本。
6. 复制后右下角出现「已整理换行」并约 1 秒淡出。
