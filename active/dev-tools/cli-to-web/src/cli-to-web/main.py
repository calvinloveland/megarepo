"""Legacy entrypoint for cli-to-web Flask application."""

from cli_to_web.main import main as run_main  # pylint: disable=import-error


def main():
    """Run the Flask application (delegates to `cli_to_web`)."""
    return run_main()


if __name__ == "__main__":
    main()
