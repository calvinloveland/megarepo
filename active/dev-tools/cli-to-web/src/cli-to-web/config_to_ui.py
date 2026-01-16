"""Module for converting config files to UI elements."""

import flask
import yaml


def config_to_ui(config_file_path):
    """Convert a YAML config file to a Flask-rendered UI.
    
    Args:
        config_file_path: Path to the YAML configuration file.
        
    Returns:
        Rendered HTML template with config data.
    """
    with open(config_file_path, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)
    return flask.render_template("index.html", config=config)
