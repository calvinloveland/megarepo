import pytest

from operationalize.tasks.split_work import SplitWork
from operationalize.tasks.task import TaskDAG


@pytest.fixture
def work_chain():
    first_task = TaskDAG(completion_text="Output from first task:")
    second_task = TaskDAG(completion_text="Output from second task:")
    first_task.append_node(second_task)
    return first_task


def test_split_work(work_chain):
    split_work = SplitWork(work_chain=work_chain)
    output = ["This is a test1", "This is a test2"]
    split_work.complete(output=output)
    assert split_work.output == output
    assert split_work.count_open_tasks() == 2
