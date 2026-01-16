import distro
import subprocess

from .software import Software


class VSCode(Software):
    tags = ["vscode", "code", "text editor", "work"]

    @classmethod
    def pre_pre_apt_packages(cls):
        return ["software-properties-common", "apt-transport-https", "wget"]

    @classmethod
    def pre_apt(cls):
        return [
            "wget -qO- https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > packages.microsoft.gpg",
            "sudo install -D -o root -g root -m 644 packages.microsoft.gpg /etc/apt/keyrings/packages.microsoft.gpg",
            """sudo sh -c 'echo "deb [arch=amd64,arm64,armhf signed-by=/etc/apt/keyrings/packages.microsoft.gpg] https://packages.microsoft.com/repos/code stable main" > /etc/apt/sources.list.d/vscode.list'""",
            "rm -f packages.microsoft.gpg",
        ]

    @classmethod
    def apt_packages(cls):
        return ["code"]

    @classmethod
    def check_if_installed(cls):
        """Check if vscode is installed."""
        return subprocess.run("code --version", shell=True).returncode == 0
