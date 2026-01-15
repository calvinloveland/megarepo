import yaml
import flask

def config_to_ui(config_file_path):
    with open(config_file_path, 'r') as f:
        config = yaml.safe_load(f)
    return flask.render_template('index.html', config=config)
    