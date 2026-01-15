import flask
from config_to_ui import config_to_ui
import configargparse

app = flask.Flask(__name__)

def main():
    app.run()

@app.route('/')
def index():
    return config_to_ui('config.yaml')

if __name__ == '__main__':
    main()
