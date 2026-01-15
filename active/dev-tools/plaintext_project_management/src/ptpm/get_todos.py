import os

from git import Repo


def find_git_path_or_none():
    project_root = os.path.dirname(os.getcwd())
    git_path = os.path.join(project_root, ".git")
    if os.path.exists(git_path):
        return git_path
    return None


def find_relavent_files(search_path):
    file_types = [".py", ".html", ".js", ".css", ".md", ".txt"]
    git_path = find_git_path_or_none()
    print(f"Searching {search_path} for TODOs")

    files_to_search = []
    for root, _dirs, files in os.walk(search_path):
        for file in files:
            if file not in files_to_search:
                if any(file.endswith(file_type) for file_type in file_types):
                    files_to_search.append(os.path.join(root, file))

    if git_path:
        ignored_files = Repo(git_path).ignored(files_to_search)
        files_to_search = filter(lambda x: x not in ignored_files, files_to_search)
    return files_to_search


def get_todos():
    todos = []
    search_path = os.path.dirname(os.getcwd())
    files_to_search = find_relavent_files(search_path)

    for file in files_to_search:
        with open(os.path.join(file), "r", encoding="utf-8") as f:
            lines = f.readlines()
        i = 0
        for line in lines:
            i += 1
            if "TODO (" in line:
                todo_string = line[line.find("TODO") + 4 :].strip()
                todos.append(f"{todo_string} location:{file} line_number:{i}")
            if "TODO" in file:
                todos.append(line.strip())

    def custom_sorted(todos):
        return sorted(todos, key=lambda todo: todo.replace(")", "~"))

    todos = custom_sorted(todos)
    return todos


def print_todos():
    todos = get_todos()
    for todo in todos:
        print(todo)


def coallate_todos():
    todos = get_todos()
    project_root = os.path.dirname(os.getcwd())
    todo_file = None
    # Find any existing TODO files
    for root, _dirs, files in os.walk(os.path.join(project_root, "src")):
        for file in files:
            if file == "TODO.txt":
                todo_file = os.path.join(root, file)
                break
    # If no TODO file exists, create one
    if not todo_file:
        todo_file = os.path.join(project_root, "TODO.txt")
    with open(todo_file, "w", encoding="utf-8") as f:
        for todo in todos:
            f.write(todo + "\n")
