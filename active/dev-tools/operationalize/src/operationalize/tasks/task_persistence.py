"""Module for persisting task DAG state to and from files."""

import json


def save_task_dag_state(task_dag, file_path):
    """
    Save the state of a TaskDAG to a file.

    Args:
        task_dag (TaskDAG): The TaskDAG object to save.
        file_path (str): The path to the file where the TaskDAG state will be saved.
    """
    with open(file_path, "w", encoding="utf-8") as file:
        json.dump(task_dag.__dict__, file, default=lambda o: o.__dict__, indent=4)


def load_task_dag_state(task_dag, file_path):
    """
    Load the state of a TaskDAG from a file.

    Args:
        task_dag (TaskDAG): The TaskDAG object to load the state into.
        file_path (str): The path to the file from which the TaskDAG state will be loaded.
    """
    with open(file_path, "r", encoding="utf-8") as file:
        data = json.load(file)
        task_dag.__dict__.update(data)
