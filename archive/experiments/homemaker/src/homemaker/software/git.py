# Setup git
import subprocess

from .software import Software

USER_NAME = "Calvin Loveland"


class Git(Software):
    tags = ["git", "work"]

    def post_apt():
        return [
            "git config --global user.name '" + USER_NAME + "'",
            "git config --global user.email 'calvin@loveland.dev'",
            "git config --global pull.rebase false",
            "git config --global core.editor 'nvim'",
        ]

    def check_if_installed():
        """Check if Git is installed."""
        return subprocess.run(
            "git --version", shell=True
        ).returncode == 0 and USER_NAME in str(
            subprocess.run("git config --list", shell=True)
        )
