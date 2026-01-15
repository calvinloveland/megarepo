"""Module for defining and managing tasks within a project."""

import copy
import json
import uuid  # Added for unique task_id generation

from loguru import logger


class TaskDAG:  # pylint: disable=too-many-instance-attributes
    """Represents a directed acyclic graph (DAG) of tasks within a project."""

    def __init__(self, **kwargs):
        self.dependents = kwargs.get("dependents", [])
        assert self.dependents is not None
        self.dependencies = kwargs.get("dependencies", [])
        self.name = kwargs.get("name", "TASK WITH NO NAME")
        self.type = kwargs.get("type", "TASK WITH NO TYPE")
        self.description = kwargs.get("description", "TASK WITH NO DESCRIPTION")
        self.workspace = kwargs.get("workspace", "text_workspace.html")
        self.time_limit = kwargs.get("time_limit", 120)
        self.requirements = kwargs.get("requirements", [])
        self.task_id = kwargs.get(
            "id", uuid.uuid4()
        )  # Initialize task_id with a unique identifier
        self.completion_text = kwargs.get("completion_text", None)
        self.completed = False
        self.assigned_to = None
        self.printed = False
        self.output = None

    def __deepcopy__(self, memo):
        cls = self.__class__
        new_task = cls.__new__(cls)
        memo[id(self)] = new_task
        for k, value in self.__dict__.items():
            setattr(new_task, k, copy.deepcopy(value, memo))
        new_task.task_id = (
            uuid.uuid4()
        )  # Generate a new unique task_id for the deepcopy
        return new_task

    def to_mermaid_flowchart(self, prepend="flowchart TD\n"):
        """Generates a Mermaid flowchart representation of the task DAG."""
        chart = prepend
        for dependent in self.dependents:
            chart += (
                str(self.name).replace(" ", "")
                + str(self.task_id)
                + " --> "
                + str(dependent.name).replace(" ", "")
                + str(dependent.task_id)
                + "\n"
            )
            chart += dependent.to_mermaid_flowchart(prepend="")
        return chart

    def update_dependencies(self):
        """Updates the dependencies for each task in the DAG."""
        for dependent in self.dependents:
            if self not in dependent.dependencies:
                dependent.dependencies.append(self)
            dependent.update_dependencies()

    def get_expected_completion_time(self):
        """Calculates the expected completion time for the task DAG."""
        if len(self.dependents) == 0:
            return self.time_limit
        dependent_time = max(d.get_expected_completion_time() for d in self.dependents)
        return self.time_limit + dependent_time

    def get_final(self):
        """Returns the final task in the DAG."""
        if len(self.dependents) == 0:
            return self
        return self.dependents[0].get_final()

    def get_open_tasks(self):
        """Returns a set of open tasks that are ready to be worked on."""
        if self.task_is_ready():
            return set([self])
        tasks = set()
        for task in self.dependents:
            if task.get_open_tasks() is not None:
                for task in task.get_open_tasks():
                    tasks.add(task)
        return tasks

    def count_open_tasks(self):
        """Counts the number of open tasks in the DAG."""
        return len(self.get_open_tasks())

    def assign(self, worker_id):
        """Assigns a task to a worker."""
        self.assigned_to = worker_id

    def task_is_ready(self, worker_id=None):
        """Checks if a task is ready to be worked on."""
        return (
            not self.completed
            and (self.assigned_to is None or self.assigned_to == worker_id)
            and all(d.completed for d in self.dependencies)
        )

    def get_next_task(self, worker_id=None):
        """Gets the next task that is ready to be worked on by a worker."""
        self.update_dependencies()
        logger.info(f"Getting next task for worker {worker_id}")
        if self.task_is_ready(worker_id):
            return self
        if not self.completed:
            logger.info(f"Task {self.name} is not ready")
            return None
        for task in self.dependents:
            next_task = task.get_next_task(worker_id)
            if next_task is not None:
                return next_task
        return None

    def append_node(self, node):
        """Appends a node to the DAG."""
        if node == self:
            logger.warning(f"Node is already at the end of graph: {node.name}")
            return
        if len(self.dependents) == 0:
            self.dependents = [node]
        else:
            for dependent in self.dependents:
                if dependent is not None:
                    assert dependent != self
                    dependent.append_node(node)

    def print_graph(self, indent=0):
        """Prints the graph structure of the DAG."""
        if not self.printed:
            logger.info(" " * indent + self.name)
            self.printed = True
        for dependent in self.dependents:
            assert dependent != self
            dependent.print_graph(indent + 2)
        self.printed = False

    def complete(self, output):
        """Marks a task as completed and updates dependent tasks."""

        def pretty_print(output):
            if isinstance(output, list):
                return "\n".join([str(obj) for obj in output])
            return str(output)

        self.completed = True
        self.output = output
        if self.completion_text is not None:
            for dependent in self.dependents:
                logger.info(f"Adding completion text to {dependent.name}")
                dependent.requirements.append(
                    self.completion_text + " " + pretty_print(output)
                )
        else:
            logger.warning(f"No completion text for {self.name}")

    def get_task_by_id(self, task_id):
        """Finds a task by its ID within the DAG."""
        logger.info(f"Looking for task {task_id} in {self.name}")
        if str(self.task_id) == str(task_id):
            logger.info(f"Found task {self.name}")
            return self
        for dependent in self.dependents:
            task = dependent.get_task_by_id(task_id)
            if task is not None:
                return task
        return None

    def save_state(self, file_path):
        """Saves the current state of the TaskDAG to a file."""
        with open(file_path, "w", encoding="utf-8") as file:
            json.dump(self.__dict__, file, default=default_serializer, indent=4)

    def load_state(self, file_path):
        """Loads the TaskDAG state from a file."""
        with open(file_path, "r", encoding="utf-8") as file:
            data = json.load(file)
            self.__dict__.update(data)


def default_serializer(obj):
    """Default serializer for objects not serializable by default json code."""
    if isinstance(obj, uuid.UUID):
        return str(obj)
    return obj.__dict__
