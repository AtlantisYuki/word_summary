# 省流总结助手（Chrome 插件）

支持两种总结方式：

- 选中网页中的一段文字，点击「总结选中文本」
- 不选中文本，点击「总结整页内容」
- 快捷键触发：默认 `Alt+S`（选中总结）、`Ctrl+Alt+S`（整页总结）
- 右键菜单触发：支持「总结选中文本」「总结当前网页」

交互增强：

- 选中总结后，原文会加高亮底色，并在末尾生成「省流」气泡，点击气泡弹出摘要框
- 全文总结会显示右侧悬浮总结窗，支持收起/展开与关闭
- 高亮底色可在设置页修改

支持 OpenAI API 兼容供应商配置：

- API Key
- Base URL
- 模型名称
- 选中文本快捷键
- 整页总结快捷键
- 高亮底色

## 文件结构

- `manifest.json`：扩展配置（Manifest V3）
- `content.js`：提取选中文本/整页文本
- `background.js`：调用 OpenAI 兼容接口进行总结
- `popup.html` `popup.css` `popup.js`：弹窗 UI 与交互
- `options.html` `options.js`：配置页面

## 本地使用

1. 打开 Chrome，进入 `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」，选择当前目录
4. 打开扩展的「选项」，填写 Base URL、模型名称、API Key
5. 在任意网页点击扩展图标，测试选中总结或整页总结
6. 可在设置页修改快捷键和高亮颜色，保存后立即生效

## 接口兼容说明

插件请求地址固定为：

- `Base URL + /chat/completions`

请求体采用 OpenAI Chat Completions 风格（`model` + `messages`）。
