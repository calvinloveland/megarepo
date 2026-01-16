import subprocess

from .software import Software


class Discord(Software):
    tags = ["discord", "chat", "messaging", "voice", "video", "games"]

    def apt_packages():
        # "libc++1 libc++abi1 libssl1.0.0 libssl-dev"
        return ["libc++1", "libc++abi1", "libssl1.0.0", "libssl-dev"]

    def post_apt():
        return [
            "wget -O discord.deb https://discordapp.com/api/download?platform=linux&format=deb",
            "sudo dpkg -i discord.deb",
        ]

    def check_if_installed():
        """Check if Discord is installed."""
        return subprocess.run("dpkg -s discord", shell=True).returncode == 0
