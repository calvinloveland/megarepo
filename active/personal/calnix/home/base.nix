{ config, pkgs, lib, ... }:
{
  # Ensure GUI apps (VS Code, etc.) see Docker rootless socket
  home.sessionVariables = {
    DOCKER_HOST = "unix:///run/user/1000/docker.sock";
  };

  # Allow unfree packages for this user
  nixpkgs.config.allowUnfree = true;

  # Set Home Manager state version
  home.stateVersion = "23.11";

  # Set default applications
  xdg.mimeApps = {
    enable = true;
    defaultApplications = {
      "text/html" = "google-chrome.desktop";
      "x-scheme-handler/http" = "google-chrome.desktop";
      "x-scheme-handler/https" = "google-chrome.desktop";
      "x-scheme-handler/about" = "google-chrome.desktop";
      "x-scheme-handler/unknown" = "google-chrome.desktop";
    };
  };

  programs.fish = {
    enable = true;
    interactiveShellInit = ''
      # Import colorscheme from 'wal' asynchronously
      if test -f ~/.cache/wal/sequences
        cat ~/.cache/wal/sequences
      end

      # For TTY support, check if we're in a Linux console and apply colors
      if test "$TERM" = "linux"
        if test -f ~/.cache/wal/colors-tty.sh
          # Convert the bash script to fish-compatible commands
          grep "printf" ~/.cache/wal/colors-tty.sh | sed 's/printf/printf/' | source
        end
      end
    '';
  };

  programs.bash = {
    enable = true;
  };

  programs.git = {
    enable = true;
    settings = {
      user = {
        name = "Calvin Loveland";
        email = "calvinloveland@gmail.com";
      };
      safe.directory = "*";
    };
  };

  programs.neovim = {
    enable = true;
    vimAlias = true;
    viAlias = true;
  };

  # VS Code settings are not managed here to allow in-application edits.

  programs.swaylock.enable = true;
}
