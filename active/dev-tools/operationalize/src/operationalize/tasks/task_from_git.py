"""Module for creating tasks from a Git repository."""

import os
import random

import git
from loguru import logger

from operationalize.tasks.task import TaskDAG
from operationalize.tasks.task_selection import TaskSelection


class TaskFromGit(TaskDAG):
    """Represents a task created from a Git repository."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.type = "GIT"
        self.url = kwargs.get("url", None)
        self.name = self.url.split("/")[-1].replace(".git", "")
        self.task_selection = kwargs.get("task_selection", "select")
        self.tasks = (
            []
        )  # Initialize tasks to address attribute-defined-outside-init issue
        if self.task_selection == "select":
            self.append_node(
                TaskSelection(
                    name="Select a task",
                    description="Select a task from the list below",
                    options=self.tasks,
                )
            )
        elif self.task_selection == "first":
            # Implementing 'first' task selection strategy
            pass
        elif self.task_selection == "random":
            # Implementing 'random' task selection strategy
            if self.tasks:

                self.tasks = [random.choice(self.tasks)]

    def initialize_from_url(self):
        """Clones the Git repository and initializes tasks from TODO.txt."""
        to_path = os.path.join(os.path.join(os.getcwd(), "repos"), self.name)
        git.Repo.clone_from(self.url, to_path)
        todo_path = os.path.join(to_path, "TODO.txt")
        if os.path.exists(todo_path):
            with open(todo_path, "r", encoding="utf-8") as file:
                for line in file.readlines():
                    self.tasks.append(line.strip())
            # Implementing 'first' task selection strategy
            if self.task_selection == "first" and self.tasks:
                self.tasks = [self.tasks[0]]
        else:
            logger.error(f"Could not find TODO.txt in {to_path}")
            self.tasks.append("Create TODO.txt in this repo")
