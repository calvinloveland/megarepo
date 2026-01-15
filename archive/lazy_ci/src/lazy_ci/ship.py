"""
A module for shipping a Python package to PyPI.
"""

import os
import subprocess

import git
from loguru import logger


def tag(version):
    """Create a git tag"""
    repo = git.Repo.init(".")
    repo.create_tag(version)
    repo.remotes.origin.push(version)
    return True


def is_file_git_ignored(file):
    """Check if a file is git ignored"""
    repo = git.Repo.init(".")
    return file in repo.ignored(file)


def bump_version(should_tag=True):
    """Run bump-my-version or increment the version in a file"""
    result = subprocess.run(["bump-my-version", "bump"], check=False)
    if result.returncode == 0:
        return True
    logger.warning("bump-my-version failed! Attempting file-based version bump")
    # Find the version file
    version_file = None
    possible_version_file_names = [
        "version.py",
        "VERSION.py",
        "version.txt",
        "VERSION.txt",
        "__about__.py",
        "__about__.txt",
    ]
    for root, _dirs, files in os.walk("."):
        for file in files:
            full_path = os.path.join(root, file)
            if file in possible_version_file_names:
                if is_file_git_ignored(full_path):
                    continue
                version_file = full_path
                break
    if version_file is None:
        logger.warning("Could not find a version file!")
        return False
    # Read the version file
    logger.info(f"Found version file at {version_file}")
    with open(version_file, "r", encoding="utf-8") as file:
        version_contents = file.read()
    # Increment the version
    # Must support my favorite format of:
    # VERSION = "1.0.0"
    version = None
    for line in version_contents.splitlines():
        # Check for a file with only a version number
        if line.count(".") == 2 and line.replace(".", "").isdigit():
            version = line
            break
        if line.startswith("VERSION"):
            version = line.split("=")[1].strip().strip('"').strip("'")
            break
        if line.lower().startswith("__version__"):
            version = line.split("=")[1].strip().strip('"').strip("'")
            break
    if version is None:
        logger.warning("Could not find a version in the version file!")
        return False
    version_parts = version.split(".")
    version_parts[-1] = str(int(version_parts[-1]) + 1)
    new_version = ".".join(version_parts)
    logger.info(f"Bumping version from {version} to {new_version}")
    # Write the version file
    with open(version_file, "w", encoding="utf-8") as file:
        file.write(version_contents.replace(version, new_version))
    if should_tag:
        tag(new_version)
    return True


def ship():
    """Ship a Python package to PyPI"""
    if not bump_version():
        logger.critical("Version bump failed!")
        return False
    # Clean up old builds
    subprocess.run(["rm", "-rf", "dist"], check=False)
    # Run python -m build
    subprocess.run(["python", "-m", "build"], check=True)

    # Run twine upload dist/*
    subprocess.run(["twine", "upload", "dist/*"], check=True)
    return True
