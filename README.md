# Code Flow Lint

把 Git 操作规则和 Java、JavaScript、TypeScript 检查安装到当前用户。在任意项目中通过 `PATH` 使用安装后的 `git`，合并和提交会自动接受相同检查，无需逐个仓库配置。

## 安装

适用于 macOS 和 Linux。需要 Git 2.31+、Python 3.9+、JDK 17+、curl，以及 Node.js 20.19.x、22.13 及以上的 22.x，或 24+ 和 npm。

```sh
git clone https://github.com/FlyAboveGrass/code-flow-lint.git
cd code-flow-lint
./install.sh
export PATH="$HOME/.local/bin:$PATH"
command -v git
```

默认入口在 `~/.local/bin`。安装脚本会为 zsh 和 Bash 设置后续会话的 `PATH`。Codex 等独立启动的客户端也需要在其执行环境中解析到这个 `git`。可用 `./install.sh --prefix <目录> --no-shell-config` 安装到指定位置并自行管理 `PATH`。

更新规则时，在本仓库拉取更新后重跑 `./install.sh`。安装会先验证新版本，再切换到该版本。如果安装位置已有旧版独立 Git 检查脚本，先移开原入口再运行安装。

## 规则目录

| 位置 | 运行时检查 |
| --- | --- |
| `rules/git/merge-policy.json` | `dev/*`、`feature/*`、`fix/*` 上的 `git merge` 和 `git pull` 只接受 `release` 或 `release/*`，分支根名称忽略大小写。同名上游同步只允许快进。 |
| `rules/java/checkstyle.xml` | 未使用和冗余的导入，以及表达式中以 `java`、`javax` 或 `jakarta` 开头的常见全限定类名。 |
| `rules/javascript/eslint.mjs` | `.js`、`.jsx`、`.mjs`、`.cjs` 中的 `debugger`、重复对象键和不可达代码。 |
| `rules/typescript/eslint.mjs` | `.ts`、`.tsx`、`.mts`、`.cts` 中的同类问题和数组空项。 |

新增规则时，把规则加到对应语言的配置。新的 ESLint 配置模块由 `rules/eslint.config.mjs` 载入。Git 操作入口在 `bin/git`，语言检查入口在 `bin/code-flow-lint`，`hooks/dispatch` 负责在提交时运行检查和已有 hooks。

## 日常使用

```sh
git merge origin/release
code-flow-lint --staged
code-flow-lint src/main.ts src/App.java
```

`git commit` 检查本次提交实际使用的暂存区，覆盖 `git commit -a` 和按路径提交。已有提交 hooks 会继续运行。`--no-verify` 仍遵循 Git 对项目 hooks 的语义，全局语言检查在准备提交信息时运行。

自动检查覆盖经安装入口执行的直接 `git merge`、`git pull` 和 `git commit`。Git 别名调用内部命令、直接调用原始 Git、图形客户端自带 Git，以及 `rebase`、`cherry-pick` 等操作处于该入口的检查范围之外。

卸载时移除 `~/.local/bin/git` 和 `~/.local/bin/code-flow-lint` 两个安装链接，再移除 `~/.local/share/code-flow-lint` 和 shell 启动文件中标有 `# code-flow-lint PATH` 的两行。自定义前缀请使用对应目录。
