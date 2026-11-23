"""Install the rule bundle and its command entry points for the current user."""

import argparse
import contextlib
import fcntl
import hashlib
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile


SOURCE = Path(__file__).resolve().parent
COMMANDS = ("git", "code-flow-lint")
HOOKS = (
    "pre-commit", "prepare-commit-msg", "commit-msg", "post-commit",
    "post-rewrite", "reference-transaction", "post-index-change",
)
JAR_URL = (
    "https://github.com/checkstyle/checkstyle/releases/download/"
    "checkstyle-10.26.1/checkstyle-10.26.1-all.jar"
)
JAR_SHA256 = "e41c24433723ba310a30e41da4f449c105ad47cab2ae9e6be5e06606a647dbca"


def command_path(name, directory, entry):
    for folder in os.get_exec_path():
        executable = Path(folder, name).absolute()
        if executable.parent == directory or executable.resolve() == entry.resolve():
            continue
        if executable.is_file() and os.access(executable, os.X_OK):
            return executable
    raise RuntimeError(f"找不到命令 {name}")


def build_release(release, bin_dir, active):
    """Prepare and validate the runtime before activating a new installation."""
    runtime = release / "runtime"
    runtime.mkdir()
    for name in ("bin", "hooks", "rules"):
        shutil.copytree(SOURCE / name, release / name)
    for name in ("package.json", "package-lock.json"):
        shutil.copy2(SOURCE / name, release / name)
    for name in HOOKS:
        (release / "hooks" / name).symlink_to("dispatch")
    for name in ("git", "java"):
        path = command_path(name, bin_dir, active / "bin" / name)
        (runtime / f"{name}-path").write_text(str(path) + "\n")
    subprocess.run(["npm", "ci", "--engine-strict", "--omit=dev", "--ignore-scripts",
                    "--no-audit", "--no-fund", "--registry=https://registry.npmjs.org/"],
                   cwd=release, check=True)
    jar = runtime / "checkstyle.jar"
    subprocess.run(["curl", "--fail", "--silent", "--show-error", "--location", "--retry", "2",
                    "--connect-timeout", "15", "--max-time", "180", "--output", jar, JAR_URL], check=True)
    if hashlib.sha256(jar.read_bytes()).hexdigest() != JAR_SHA256:
        raise RuntimeError("Checkstyle SHA-256 校验失败")
    java = (runtime / "java-path").read_text().strip()
    subprocess.run([java, "-jar", jar, "--version"], check=True)
    subprocess.run([release / "bin" / "git", "--version"], check=True)
    subprocess.run([release / "bin" / "code-flow-lint", "--help"], check=True)


def shell_files():
    name = Path(os.environ.get("SHELL", "")).name
    if name == "zsh":
        directory = Path(os.environ.get("ZDOTDIR") or Path.home())
        return [directory / ".zshenv", directory / ".zprofile"]
    if name == "bash":
        home = Path.home()
        login = next(
            (home / file for file in (".bash_profile", ".bash_login", ".profile")
             if (home / file).is_file()),
            home / ".bash_profile",
        )
        return [home / ".bashrc", login]
    return []


def configure_shell(bin_dir):
    quoted = shlex.quote(str(bin_dir))
    marker = f"# code-flow-lint PATH {quoted}"
    statement = f'case "$PATH" in {quoted}|{quoted}:*) ;; *) export PATH={quoted}:"$PATH" ;; esac'
    for file in shell_files():
        old = file.read_bytes() if file.exists() else b""
        if marker.encode() in old.splitlines():
            continue
        with file.open("ab") as handle:
            handle.write(f"\n{marker}\n{statement}\n".encode())


def install(prefix):
    """Activate a complete release and preserve existing unrelated commands."""
    directory = prefix / "share" / "code-flow-lint"
    bin_dir = prefix / "bin"
    active = directory / "current"
    directory.mkdir(parents=True, exist_ok=True)
    bin_dir.mkdir(parents=True, exist_ok=True)
    with (directory / ".install.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        for name in COMMANDS:
            link = bin_dir / name
            if os.path.lexists(link) and not (
                link.is_symlink() and Path(os.readlink(link)) == active / "bin" / name
            ):
                raise RuntimeError(f"{link} 已存在，请先移开或使用 --prefix 指定安装位置")
        release = Path(tempfile.mkdtemp(prefix="release-", dir=directory))
        pending = directory / ".current-next"
        try:
            build_release(release, bin_dir, active)
            pending.unlink(missing_ok=True)
            pending.symlink_to(release.name)
            pending.replace(active)
        except BaseException:
            pending.unlink(missing_ok=True)
            shutil.rmtree(release)
            raise
        for name in COMMANDS:
            with contextlib.suppress(FileExistsError):
                (bin_dir / name).symlink_to(active / "bin" / name)


def main():
    parser = argparse.ArgumentParser(description="安装 Code Flow Lint")
    parser.add_argument("--prefix", type=Path, default=Path.home() / ".local")
    parser.add_argument("--no-shell-config", action="store_true")
    options = parser.parse_args()
    prefix = options.prefix.expanduser().resolve()
    install(prefix)
    if not options.no_shell_config:
        configure_shell(prefix / "bin")
    print(f'安装完成。在当前终端启用  export PATH={shlex.quote(str(prefix / "bin"))}:"$PATH"')


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        sys.exit(f"安装失败  {error}")
