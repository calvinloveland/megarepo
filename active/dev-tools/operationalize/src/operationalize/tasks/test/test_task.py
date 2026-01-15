import sys
from copy import deepcopy

from loguru import logger

from operationalize.tasks.task import TaskDAG

# Set logging level stdout to DEBUG
logger.remove()
logger.add(sys.stdout, level="DEBUG")


def test_task_dag():
    task_dag = TaskDAG()
    assert task_dag.name == "TASK WITH NO NAME"
    assert task_dag.get_next_task() == task_dag


def test_task_deep_copy():
    task_dag = TaskDAG()
    new_task_dag = deepcopy(task_dag)
    assert new_task_dag.name == task_dag.name
    assert new_task_dag.task_id != task_dag.task_id


def test_task_dag_to_mermaid_chart():
    task_dag = TaskDAG()
    task_dag.to_mermaid_flowchart()
    assert True


def test_task_dag_to_mermaid_chart_with_dependents():
    task_dag = TaskDAG()
    task_dag.append_node(TaskDAG())
    task_dag.to_mermaid_flowchart()
    assert True


def test_task_dag_update_dependencies():
    task_dag = TaskDAG()
    task_dag.append_node(TaskDAG())
    task_dag.update_dependencies()
    assert True


def test_task_dag_get_expected_completion_time():
    task_dag = TaskDAG()
    task_dag.append_node(TaskDAG())
    task_dag.update_dependencies()
    assert task_dag.get_expected_completion_time() == 240


def test_task_dag_get_final():
    task_dag = TaskDAG()
    another_task_dag = TaskDAG()
    task_dag.append_node(another_task_dag)
    assert task_dag.get_final() == another_task_dag


def test_task_dag_get_open_tasks():
    task_dag = TaskDAG()
    task_dag.append_node(TaskDAG())
    task_dag.update_dependencies()
    assert len(task_dag.get_open_tasks()) == 1


def test_task_dag_count_open_tasks():
    task_dag = TaskDAG()
    task_dag.append_node(TaskDAG())
    task_dag.update_dependencies()
    assert task_dag.count_open_tasks() == 1


def test_task_dag_assign():
    task_dag = TaskDAG()
    task_dag.assign("worker_id")
    assert task_dag.assigned_to == "worker_id"


def test_task_dag_task_is_ready():
    task_dag = TaskDAG()
    another_task_dag = TaskDAG()
    task_dag.append_node(another_task_dag)
    task_dag.update_dependencies()
    assert task_dag.task_is_ready() is True
    assert not another_task_dag.task_is_ready()


def test_task_completion_with_completion_text():
    task_dag = TaskDAG(completion_text="This is a test")
    subsequent_task_dag = TaskDAG()
    task_dag.append_node(subsequent_task_dag)
    task_dag.complete(output="This is a test")
    assert task_dag.completed is True
    assert task_dag.output == "This is a test"
    assert subsequent_task_dag.task_is_ready() is True
    assert "This is a test" in subsequent_task_dag.requirements[0]


def test_task_dag_get_task_by_id():
    task_dag = TaskDAG()
    another_task_dag = TaskDAG()
    task_dag.append_node(another_task_dag)
    task_dag.update_dependencies()
    assert task_dag.get_task_by_id(another_task_dag.task_id) == another_task_dag


def test_no_open_task():
    task_dag = TaskDAG()
    assert task_dag.get_next_task() is task_dag
    task_dag.complete(output="This is a test")
    assert task_dag.get_next_task() is None
    assert task_dag.count_open_tasks() == 0


def test_get_task_by_id_miss():
    task_dag = TaskDAG()
    assert task_dag.get_task_by_id("MISS") is None


def test_print_graph():
    task_dag = TaskDAG()
    task_dag.append_node(TaskDAG())
    task_dag.print_graph()
    assert True


# Tests for save and load functionality of TASKDAGs
def test_save_state():
    task_dag = TaskDAG(name="Test Save")
    file_path = "test_save_state.json"
    task_dag.save_state(file_path)
    with open(file_path, "r") as file:
        data = file.read()
        assert "Test Save" in data


def test_load_state():
    task_dag = TaskDAG(name="Test Load")
    file_path = "test_load_state.json"
    task_dag.save_state(file_path)
    new_task_dag = TaskDAG()
    new_task_dag.load_state(file_path)
    assert new_task_dag.name == "Test Load"
