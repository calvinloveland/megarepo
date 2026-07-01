"""spotify-liberator — export your Spotify Liked Songs and playlists to open formats."""

__version__ = "0.1.0"

# Spotify Web API constants
SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize"
SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"
SPOTIFY_API_BASE = "https://api.spotify.com/v1"

# Scopes needed for Liked Songs + user playlists
DEFAULT_SCOPES = [
    "user-library-read",     # read Liked Songs
    "playlist-read-private", # read private playlists
    "playlist-read-collaborative",  # read collaborative playlists
]

# Default local callback configuration
DEFAULT_CALLBACK_PORT = 8765
DEFAULT_CALLBACK_HOST = "127.0.0.1"
DEFAULT_REDIRECT_URI = f"http://{DEFAULT_CALLBACK_HOST}:{DEFAULT_CALLBACK_PORT}/callback"

# Default token cache location (XDG-style)
DEFAULT_CONFIG_DIR = "~/.config/spotify-liberator"
DEFAULT_TOKEN_FILE = "token.json"
