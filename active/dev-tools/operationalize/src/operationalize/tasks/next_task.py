"""Module for selecting the next task in the operationalize project."""

from operationalize.tasks.task_selection import TaskSelection


class NextTaskSelection(TaskSelection):
    """Represents the selection process for the next task in a project."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.name = "Select a task"
        self.description = "Select a task from the list below"
        self.options = kwargs.get("options", None)
        self.workspace = "selection_workspace.html"
