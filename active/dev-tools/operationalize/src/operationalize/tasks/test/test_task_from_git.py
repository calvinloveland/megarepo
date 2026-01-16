from unittest.mock import mock_open, patch

import pytest

from operationalize.tasks.task_from_git import TaskFromGit


class TestTaskFromGit:
    @patch("operationalize.tasks.task_from_git.git.Repo.clone_from")
    def test_first_task_selection(self, mock_clone):
        # Mocking the clone_from method to not actually clone a repo
        mock_clone.return_value = None
        # Mocking the existence of a TODO.txt file with predefined tasks
        tasks = ["Task 1", "Task 2", "Task 3"]
        with patch("builtins.open", mock_open(read_data="\n".join(tasks))):
            task_from_git = TaskFromGit(
                url="https://example.com/repo.git", task_selection="first"
            )
            task_from_git.initialize_from_url()
            # Asserting that only the first task is selected and added to the tasks list
            assert task_from_git.tasks == ["Create TODO.txt in this repo"]
