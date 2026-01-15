from gymnasium.envs.registration import register

register(
    id="Mancala-v0",
    entry_point="gym_foo.envs:MancalaEnv",
)

register(
    id="MancalaRandomMoves-v0",
    entry_point="gym_foo.envs:MancalaRandomMovesEnv",
)

register(
    id="MancalaMinMax-v0",
    entry_point="gym_foo.envs:MancalaMinMaxEnv",
)

register(
    id="MancalaUser-v0",
    entry_point="gym_foo.envs:MancalaUserEnv",
)
