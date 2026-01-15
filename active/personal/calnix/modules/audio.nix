{
  config,
  pkgs,
  ...
}:

{
  # Minimal audio configuration with PipeWire
  # Simple setup for desktop hosts (thinker and 1337book)

  # Audio packages - just the essentials
  environment.systemPackages = with pkgs; [
    pavucontrol # PulseAudio Volume Control GUI
    pulsemixer # Terminal-based mixer
    wireplumber # Explicit wireplumber package
  ];

  # Basic PipeWire setup
  services.pipewire = {
    enable = true;
    pulse.enable = true;
    alsa.enable = true;
    alsa.support32Bit = true;
    jack.enable = true;
    wireplumber.enable = true; # Explicit wireplumber enablement
  };

  # Enable low-latency audio
  security.rtkit.enable = true;

  # Ensure user has audio permissions
  users.groups.audio.members = [ "calvin" ];
}
