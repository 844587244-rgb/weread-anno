# 微信悦读 · Anno 伴读

本分叉在微信悦读的浏览器扩展中加入 Anno 伴读。改动日期为 2026-11-18。

- 选中微信读书正文，再点「解释」。答案出现在 Chrome 侧栏，可以在同一句下继续追问。
- 在微信悦读的「笔记」面板里，已有原文的划线和想法旁会出现「伴读」。打开后可以回看这句原文，按需解释或提问。
- 侧栏里可关联 Anno 本地书架上的同版书。读到对应原句时，显示已有精读、速读、跳读和难点旁注。点「定位原句」可在当前阅读区域中标出它。
- 侧栏对话保存在当前浏览器。阅读位置由微信读书处理，取决于微信读书原有的多端同步。

## 使用

1. 在 Chrome 打开扩展程序管理页 `chrome://extensions`，开启开发者模式，选择「加载已解压的扩展程序」。目录使用本分叉的根目录，或解压对应扩展包后选择含 `manifest.json` 的目录。
2. 启动本地的 Anno 阅读器。已有新版 Anno 时，扩展会连接它的本地服务。只有需要独立运行解释服务时，才使用下方的轻量服务。
3. 刷新微信读书网页并打开一本书。页面右下角的「Anno 伴读」可单独打开侧栏。也可以直接在正文选一句后点「解释」。
4. 要回看微信读书 App 的划线，使用微信悦读原有的「笔记」功能，按原流程在扩展里配置微信读书官方 Key。只使用正文选句和解释时，可跳过该配置。

## 独立运行解释服务

本机需要 Node.js 22 或更新版本，以及已登录且在命令路径中的 Codex CLI。

```sh
cd local-bridge
npm install
npm start
```

服务只监听当前电脑的 `127.0.0.1:18330`。可以用 `ANNO_LIBRARY` 指向现有 Anno 书架数据目录，用 `ANNO_BOOK_OVERVIEWS` 指向已有全书概览文件，作为可选的原句上下文。服务端会校验概览是否属于当前文本。独立 Anno 阅读器负责打开和管理 PDF、EPUB；本目录提供微信读书扩展所用的接口。

「解释」和「追问」会把选中的引文、必要的上下文和这条讨论提交给本机 Codex CLI，由其生成回答。微信读书的 Key 用于微信悦读原有的读取流程。分叉默认关闭微信悦读的匿名使用统计。

## 来源与许可

- 浏览器扩展基础来自 [chengzilala/weread-enhancer](https://github.com/chengzilala/weread-enhancer)。本分叉及新增适配代码按仓库内 [GPL-3.0](LICENSE) 发布。
- 伴读的结构标注和阅读节奏借鉴李继刚的 [ljg-read](https://github.com/lijigang/ljg-skills/tree/master/skills/ljg-read)。原项目采用 [MIT 许可证](https://github.com/lijigang/ljg-skills/blob/master/LICENSE)。这里用自己的提示和交互实现其方法。
- Anno 原有的独立阅读器来源为 [Shitsuten/anno-mcp](https://github.com/Shitsuten/anno-mcp)。本目录的解释服务和集成可独立查看，发布包中只包含扩展代码、许可证和使用说明。
