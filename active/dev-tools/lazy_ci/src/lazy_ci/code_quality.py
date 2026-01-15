"""Code quality checks for lazy-ci."""

import os
import subprocess

from loguru import logger


def run_code_quality(tool_timeout=9999):
    """Run code quality checks"""
    cwd = os.getcwd()
    commands = [
        ["pytest", "-v"],
        ["black", "--check", cwd],
        [
            "pylint",
            "--ignore-paths",
            ".*test.*|.git*|venv/*",
            "--recursive",
            "y",
            ".",
        ],
        ["lizard", "-x", "*/venv/*", "."],
    ]

    # Run commands in parallel
    issues_found = False
    issues_found_with = []
    processes = []
    for command in commands:
        process = subprocess.Popen(  # pylint: disable=consider-using-with
            command, stdout=subprocess.PIPE, stderr=subprocess.PIPE
        )
        processes.append(process)
    for process in processes:
        logger.warning(os.getcwd())
        current_command = " ".join(process.args)
        try:
            stdout, stderr = process.communicate(timeout=tool_timeout)
        except subprocess.TimeoutExpired:
            logger.error(f"Timeout on process: {current_command}")
            process.kill()
            stdout, stderr = process.communicate()
        return_code = process.wait()
        if return_code != 0:
            issues_found_with.append(f"Issue found with command: {current_command}")
            issues_found = True
            try:
                if stderr:
                    logger.error(stderr.decode("utf-8")[10:])
                if stdout:
                    logger.info(stdout.decode("utf-8")[10:])
            except UnicodeDecodeError:
                logger.error("Unicode decode error!")
    if issues_found:
        logger.error("Issues found with the following commands:")
        for issue_found_with in issues_found_with:
            logger.error(issue_found_with)
    else:
        for command in commands:
            logger.info(f"Command {' '.join(command)} passed")
        logger.info("No issues found😎😎😎")

    return not issues_found
