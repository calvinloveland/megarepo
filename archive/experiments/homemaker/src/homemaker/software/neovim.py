import distro
import subprocess


from .software import Software


class Neovim(Software):
    tags = ["neovim", "vim", "text editor", "work"]

    @classmethod
    def apt_packages(cls):
        return ["neovim"]

    @classmethod
    def check_if_installed(cls):
        """Check if neovim is installed."""
        return subprocess.run("nvim --version", shell=True).returncode == 0
