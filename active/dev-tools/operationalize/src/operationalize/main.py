"""Main module for the operationalize project web application."""

import os
import random

import flask
from flask import request
from loguru import logger

from operationalize.project import NEW_PROJECT

app = flask.Flask(
    __name__,
    template_folder=os.path.join(os.path.dirname(__file__), "tasks/templates"),
    static_url_path="",
)

projects = [NEW_PROJECT]


@app.route("/")
def index():
    """Render the index page with project and worker ID."""
    request_data = request.args
    project_id = request_data.get("project_id", None)
    worker_id = request_data.get("worker_id", None)
    if worker_id is None:
        worker_id = "HUMAN WORKER " + str(random.randint(0, 1000000))
    return flask.render_template(
        "index.html", project_id=project_id, worker_id=worker_id
    )


@app.route("/next_task/<worker_id>/<project_id>")
def next_task(worker_id, project_id):
    """Assign the next task to the worker based on project ID."""
    task = projects[int(project_id)].get_next_task(worker_id)
    if task is None:
        return flask.render_template("waiting.html", worker_id=worker_id)
    task.assign(worker_id)
    logger.info(f"Giving task {task.name} to worker {worker_id}")
    return flask.render_template(task.workspace, task=task, worker_id=worker_id)


@app.route("/task/<task_id>", methods=["POST", "GET"])
def submit_task(task_id):
    """Process task submission and completion."""
    task = None
    for project in projects:
        task = project.get_task_by_id(task_id)
        if task is not None:
            break
    if task is None:
        return "Task not found", 404
    request_data = request.get_json()
    logger.info(f"Completing task {task.name} with data {request_data}")
    task.complete(**request_data)
    return "Task completed"


@app.route("/save_taskdag/<project_id>", methods=["POST"])
def save_taskdag(project_id):
    """Save the current state of the task DAG for a project."""
    project = projects[int(project_id)]
    if project:
        project.task_dag.save_state(f"{project_id}_taskdag_state.json")
        return "TASKDAG saved successfully", 200
    return "Project not found", 404


@app.route("/load_taskdag/<project_id>", methods=["GET"])
def load_taskdag(project_id):
    """Load the saved state of the task DAG for a project."""
    project = projects[int(project_id)]
    if project:
        project.task_dag.load_state(f"{project_id}_taskdag_state.json")
        return "TASKDAG loaded successfully", 200
    return "Project not found", 404


@logger.catch
def main():
    """Run the Flask web application."""
    app.run(debug=True)


if __name__ == "__main__":
    main()
