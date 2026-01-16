import random


ROLL_HISTORY = []


def setRandomSeed(seed):
    random.seed(seed)


def clearHistory():
    global ROLL_HISTORY
    
    ROLL_HISTORY = []


def history():
    global ROLL_HISTORY

    return ROLL_HISTORY


def rollDice(amount = 2):
    global ROLL_HISTORY

    for _ in range(amount):
        ROLL_HISTORY.append(random.randint(1, 6))

    return ROLL_HISTORY[-amount:]