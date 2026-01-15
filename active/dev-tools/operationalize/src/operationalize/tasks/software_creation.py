"""Module for software creation tasks in the operationalize project."""

from operationalize.tasks.split_work import SplitWork
from operationalize.tasks.task import TaskDAG

## Software Creation
## -----------------
##
## 1. Brainstorming for something to create
## 2. Split work into tasks
## 2.1 Continue splitting work until tasks are small enough
## 3. Create tests for each task
## 4. Create code for each task
## 5. Integrate code for each task
## 6. Test integrated code
## 7. Present integrated code
##
## 1. -> 2.
## 2. -> 2.1,2.2
## 2.1 -> 2.1.1,2.1.2
## 2.2 -> 2.2.1,2.2.2
## 2.1.1 -> 2.1.1.1, 2.1.1.2
## 2.1.2 -> 2.1.2.1, 2.1.2.2
## 2.2.1 -> so on and so forth

code = TaskDAG(
    name="Code",
    type="Code",
    description="Create code for each task",
    requirements=["Write code to pass this unit test"],
    workspace="text_workspace.html",
    time_limit=180,
    output="Code for each task",
    dependents=[],
    completion_text="The code is:",
)
tests = TaskDAG(
    name="Tests",
    type="Tests",
    description="Create tests for each task",
    requirements=["Create a unit test for this task"],
    workspace="text_workspace.html",
    time_limit=120,
    output="Tests for each task",
    dependents=[code],
    completion_text="The tests are:\n",
)

split_work = SplitWork(
    name="Split Work",
    type="Split Work",
    description="Split work into tasks",
    workspace="split_text_workspace.html",
    time_limit=120,
    output="Tasks",
    depth=3,
    work_chain=tests,
)


class Brainstorming(TaskDAG):  # pylint: disable=too-many-instance-attributes
    """Represents the brainstorming phase in software creation."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.name = "Brainstorming"
        self.type = "Brainstorming"
        self.description = "Brainstorming for something to create"
        self.requirements = [
            "Come up with a great idea for the human workers to create"
        ]

        self.workspace = "text_workspace.html"
        self.time_limit = 120
        self.output = "Brainstorming"
        self.dependents = [split_work]
        self.completion_text = "The idea is:"


class SoftwareCreation(TaskDAG):
    """Represents the entire software creation process."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.name = "Software Creation"
        self.workspace = "text_workspace.html"

        brainstorming = Brainstorming()

        self.append_node(brainstorming)
        presentation = TaskDAG(
            name="Presentation",
            type="Presentation",
            description="Present integrated code",
            requirements=["Integrate Code"],
            workspace="text_workspace.html",
            time_limit=300,
            output="Presentation",
        )
        self.append_node(presentation)
        self.completed = True
