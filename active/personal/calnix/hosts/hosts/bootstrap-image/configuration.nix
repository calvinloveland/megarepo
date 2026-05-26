{
  config,
  pkgs,
  lib,
  ...
}:
{
  imports = [
    ../../modules/bootstrap-connectivity.nix
    ../../modules/bootstrap-ssh.nix
    ../../modules/bootstrap-agent.nix
  ];

  calnix.bootstrap.connectivity.enable = true;
  calnix.bootstrap.ssh.enable = true;
  calnix.bootstrap.ssh.controllerPubkey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDwix44A6TqqGOokU/gIpaf3shN0Pad+S08M36flhBZv calvin@loveland.dev";
  calnix.bootstrap.agent.enable = true;

  # Hostname for the live image
  networking.hostName = "calnix-bootstrap";

  # ISO label used when burning to USB
  image.baseName = lib.mkForce "calnix-bootstrap";

  # Make the ISO bootable from USB (both BIOS and UEFI)
  isoImage.makeUsbBootable = true;
  isoImage.makeEfiBootable = true;

  # Make volume ID shorter/cleaner for USB
  isoImage.volumeID = "CALNIX_BOOT";

  # Minimal but functional
  system.stateVersion = "25.05";

  # Enable firmware for broad hardware compatibility
  hardware.enableAllFirmware = true;

  # Allow unfree firmware (many Wi-Fi chipsets need it)
  nixpkgs.config.allowUnfree = true;

  # Basic packages for the live environment
  environment.systemPackages = with pkgs; [
    # Core tools
    vim
    htop
    tmux
    fish
    rsync
    curl
    wget
    gitMinimal

    # Diagnostics
    smartmontools
    pciutils
    usbutils
    dmidecode
    lshw

    # Storage tools
    parted
    gptfdisk
    btrfs-progs
    e2fsprogs
    xfsprogs
    ntfs3g
    dosfstools
    mdadm
    lvm2

    # Networking
    iw
    nmap
    tcpdump
    mtr
    dnsutils
    inetutils
    openssl

    # Nix-specific tools for remote install
    nixos-anywhere
    disko
    ssh-to-age
    sops
    age

    # Shell enhancements
    starship
  ];

  # Set fish as default shell for interactive logins
  programs.fish.enable = true;

  # No swap needed on live image
  swapDevices = [ ];

  # Keep the image small — no doc artifacts
  documentation.doc.enable = false;
  documentation.info.enable = false;
  documentation.man.enable = false;

  # Disable services that don't make sense on a live ISO
  services.fstrim.enable = false;

  # Auto-mount removable media
  services.udisks2.enable = true;
  services.devmon.enable = true;

  # Auto-login on tty1 so the bootstrap user sees the status console immediately
  services.getty.autologinUser = "bootstrap";

  # Remove the default password requirement for sudo on live image
  security.sudo.wheelNeedsPassword = false;
}
