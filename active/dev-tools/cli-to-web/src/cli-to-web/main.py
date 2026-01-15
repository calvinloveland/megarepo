"""Main module for cli-to-web Flask application."""

import flask

from config_to_ui import config_to_ui

app = flask.Flask(__name__)


def main():
    """Run the Flask application."""
    app.run()


@app.route("/")
def index():
    """Render the index page with config UI."""
    return config_to_ui("config.yaml")


if __name__ == "__main__":
    main()
