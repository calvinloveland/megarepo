"""
The Project class is a container for a set of tasks that make up a project.
The Project class is responsible for managing the tasks that are part of the project.
"""

from operationalize.tasks.task import TaskDAG


class Project:
    """
    Represents a project with a set of tasks.

    Attributes:
        name (str): The name of the project.
        task_dag (TaskDAG): The task DAG associated with the project.
    """

    def __init__(self, **kwargs):
        self.name = kwargs.get("name", "Untitled Project")
        self.task_dag = kwargs.get("task_dag", None)

    @classmethod
    def configuration_options(cls):
        """
        Provides configuration options for the project.

        Returns:
            dict: A dictionary of configuration options with their types and default values.
        """
        return {
            "name": {"type": "text", "default": "Untitled Project"},
            "competitive": {"type": "boolean", "default": False},
            "allow_rework": {"type": "boolean", "default": True},
        }

    def get_task_by_id(self, task_id):
        """
        Finds a task by its ID within the project's task DAG.

        Args:
            task_id (str): The ID of the task to find.

        Returns:
            TaskDAG: The task with the specified ID, or None if not found.
        """
        return self.task_dag.get_task_by_id(task_id)

    def add_task(self, task):
        """
        Adds a new task to the project's task DAG.

        Args:
            task (TaskDAG): The task to add.
        """
        self.task_dag.append_node(task)


NEW_PROJECT = Project(
    name="New Project",
    task_dag=TaskDAG(
        name="New Project",
        description="Create a new project",
        workspace="new_project_workspace.html",
    ),
)
