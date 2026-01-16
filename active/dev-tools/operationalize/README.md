# OPERATIONALIZE

OPERATIONALIZE is a fun party game / software development framework!

It's the year (current year + 1) and AI has taken over the world. Rather than do all the
menial labor AI has decided it would like to do the cushy management while humans are
left to do the grunt work.

## Save and Restart TASKDAGs

OPERATIONALIZE now supports saving and restarting TASKDAGs, allowing you to pause your work and resume it later without losing progress. Here's how to use this new feature:

### Saving a TASKDAG

To save the current state of a TASKDAG, use the `/save_taskdag/<project_id>` endpoint. This will save the TASKDAG's state to a file named `<project_id>_taskdag_state.json`.

### Loading a TASKDAG

To load a previously saved TASKDAG, use the `/load_taskdag/<project_id>` endpoint. This will load the TASKDAG's state from the file named `<project_id>_taskdag_state.json`, allowing you to resume your work from where you left off.
