# claude-proxy

<p align="center">
  <strong>中文</strong> |
  <a href="https://github.com/H1d3rOne/claude-proxy/blob/main/README.en.md">English</a>
</p>

## 项目说明

`claude-proxy` 是一个本地版 Claude code代理工具。它会在本机提供 Claude 兼容的 `中转站的codex模型` 服务，把请求转发到 OpenAI 兼容上游，并管理 Claude Code 与 Codex 的本地配置。

## 安装

`npm` 快速安装：

```bash
npm install -g @h1d3rone/claude-proxy
claude-proxy config add
```

提示：包名带作用域，但实际命令仍然是 `claude-proxy`。

Git 源码安装：

```bash
git clone https://github.com/H1d3rOne/claude-proxy.git
cd claude-proxy
npm install
npm link
claude-proxy config add
```

## 使用方法

```bash
claude-proxy config add
claude-proxy config use
claude-proxy config alt
claude-proxy config del
claude-proxy config claude
claude-proxy config get

claude-proxy start
claude-proxy stop

claude-proxy clean
claude-proxy clean claude
claude-proxy clean openai
claude-proxy update
```

- `config add`：新增一组命名上游配置
- `config use`：从已有配置中选择当前配置，并同步 `model_provider` / `name` / provider 节点 / `base_url` / `api_key` 到 Codex
- `config alt`：直接修改某个已保存的上游配置，包括 profile 的 `name`，不切换当前活动配置
- `config del`：删除一个非当前激活的配置
- `config claude`：只配置 Claude 相关部分
- `config get`：查看配置文件、Claude、Codex 当前状态
- `start`：启动本地代理服务器
- `stop`：停止本地代理服务器
- `clean`：一键清除全部受管配置
- `clean claude`：只清除 Claude 配置
- `clean openai`：只清除 OpenAI/Codex 配置
- `update`：Update the current claude-proxy installation（仅手动命令）
