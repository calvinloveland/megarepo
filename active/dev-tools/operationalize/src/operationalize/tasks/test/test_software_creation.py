from operationalize.tasks.software_creation import SoftwareCreation


def test_software_creation():
    software_creation = SoftwareCreation()
    assert software_creation.name == "Software Creation"
    assert software_creation.get_next_task().name == "Brainstorming"


def test_completing_task():
    software_creation = SoftwareCreation()
    i = 0
    while software_creation.get_next_task() is not None:
        assert i < 100
        next_task = software_creation.get_next_task()
        next_task.complete(output="This is a test")
        i += 1
