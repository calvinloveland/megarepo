#!/bin/bash

import argparse
import json
import dice
from players.bankOnRollN import BankOnRollN
from players.bankWhenHigherThan import BankWhenHigherThan
from players.bankOnRollNOrHigherThan import BankOnRollNOrHigherThan
from players.NOverLeader import NOverLeader
from decision import Decision

DEFAULT_ROUNDS = 10

def readCommandLine():
    parser = argparse.ArgumentParser("Bank Simulator: A game of chance")
    parser.add_argument('-g', '--games', help="Number of games to play", type=int, required=True)
    parser.add_argument('-r', '--rounds', help=f"How many rounds per game (default = {DEFAULT_ROUNDS})", type=int, default=DEFAULT_ROUNDS)
    parser.add_argument('-o', '--output', help=f"output json file", default='results.json')
    parser.add_argument('-s', '--seed', help=f"random seed", default=10)

    return parser.parse_args()


def updateScore(currentScore, roll1, roll2, isFirstThree = False):
    if isFirstThree:
        if roll1 + roll2 == 7:
            return currentScore + 70
        else:
            return currentScore + roll1 + roll2
    else:
        if roll1 == roll2:
            return currentScore * 2
        elif roll1 + roll2 == 7:
            return 0
        else:
            return currentScore + roll1 + roll2


def playRound(players, stats):
    currentScore = 0

    roundStats = {
        'players': {},
        'dice_history': [],
        'score_history': []
    }

    for player in players:
        player.reset()
        roundStats['players'][player.name] = {
            'name': player.name,
            'score': 0,
            'score_history': [],
            'has_banked': False
        }

    # First three rolls are protected
    protectedRoll1 = dice.rollDice()
    roundStats['dice_history'].extend([protectedRoll1])
    currentScore = updateScore(currentScore, protectedRoll1[0], protectedRoll1[1], True)
    roundStats['score_history'].append(currentScore)

    protectedRoll2 = dice.rollDice()
    roundStats['dice_history'].extend([protectedRoll2])
    currentScore = updateScore(currentScore, protectedRoll2[0], protectedRoll2[1], True)
    roundStats['score_history'].append(currentScore)

    protectedRoll3 = dice.rollDice()
    roundStats['dice_history'].extend([protectedRoll3])
    currentScore = updateScore(currentScore, protectedRoll3[0], protectedRoll3[1], True)
    roundStats['score_history'].append(currentScore)
    
    remainingPlayers = players.copy()
    while len(remainingPlayers) > 0:

        # Check if we got a seven
        if currentScore == 0:
            for player in remainingPlayers:
                roundStats['players'][player.name]['score_history'].append(0)
            remainingPlayers = []
            continue
        else:
            # Check if any players bank
            bankedPlayers = []
            for player in remainingPlayers:
                result = player.decide(roundStats)
                if result == Decision.BANK:
                    roundStats['players'][player.name]['score'] += currentScore
                    roundStats['players'][player.name]['score_history'].append(currentScore)
                    roundStats['players'][player.name]['has_banked'] = True
                    bankedPlayers.append(player)

            remainingPlayers = [p for p in remainingPlayers if p not in bankedPlayers]

            while len(bankedPlayers) > 0:
                bankedPlayers = []
                for player in remainingPlayers:
                    result = player.decide(roundStats)
                    if result == Decision.BANK:
                        roundStats['players'][player.name]['score'] += currentScore
                        roundStats['players'][player.name]['score_history'].append(currentScore)
                        bankedPlayers.append(player)
                remainingPlayers = [p for p in remainingPlayers if p not in bankedPlayers]
            
        # roll dice
        diceRoll = dice.rollDice()
        roundStats['dice_history'].extend([diceRoll])
        currentScore = updateScore(currentScore, diceRoll[0], diceRoll[1], False)
        roundStats['score_history'].append(currentScore)

    stats['rounds'].append(roundStats)

    
    


def playGame(players, rounds, multiGameStats):
    gameStats = {
        'num_rounds': rounds,
        'rounds': [],
    }

    dice.clearHistory()
    for i in range(rounds):
        playRound(players, gameStats)
    
    multiGameStats['games'].append(gameStats)


def findWinner(game):
    finalScores = {}
    for round in game['rounds']:
            for playerName in round['players']:
                if not playerName in finalScores:
                    finalScores[playerName] = 0
                finalScores[playerName] += round['players'][playerName]['score']
    totals = []
    for playerName in finalScores:
        totals.append({
            'name': playerName,
            'total': finalScores[playerName],
        })

    totals = sorted(totals, key=lambda x: x['total'], reverse=True)

    return totals[0]


def calculateStatistics(stats):
    finalScores = {}
    gamesWon = {}
    for game in stats['games']:
        for round in game['rounds']:
            for playerName in round['players']:
                if not playerName in finalScores:
                    finalScores[playerName] = 0
                    gamesWon[playerName] = 0

                finalScores[playerName] += round['players'][playerName]['score']
        gameWinner = findWinner(game)
        gamesWon[gameWinner['name']] += 1

    # Need to calculate # of games won!

    stats['totals'] = []
    for playerName in finalScores:
        stats['totals'].append({
            'name': playerName,
            'average': finalScores[playerName] / stats['games_count'],
            'wins': gamesWon[playerName],
            'win_percent': gamesWon[playerName] / stats['games_count'] * 100
        })

    stats['totals'] = sorted(stats['totals'], key=lambda x: (x['win_percent'], x['average']), reverse=True)


# Print iterations progress
def printProgressBar (iteration, total, prefix = '', suffix = '', decimals = 1, length = 100, fill = '█', printEnd = "\r"):
    """
    Call in a loop to create terminal progress bar
    @params:
        iteration   - Required  : current iteration (Int)
        total       - Required  : total iterations (Int)
        prefix      - Optional  : prefix string (Str)
        suffix      - Optional  : suffix string (Str)
        decimals    - Optional  : positive number of decimals in percent complete (Int)
        length      - Optional  : character length of bar (Int)
        fill        - Optional  : bar fill character (Str)
        printEnd    - Optional  : end character (e.g. "\r", "\r\n") (Str)
    """
    percent = ("{0:." + str(decimals) + "f}").format(100 * (iteration / float(total)))
    filledLength = int(length * iteration // total)
    bar = fill * filledLength + '-' * (length - filledLength)
    print(f'\r{prefix} |{bar}| {percent}% {suffix}', end = printEnd)
    # Print New Line on Complete
    if iteration == total: 
        print()


def main():
    args = readCommandLine()

    dice.setRandomSeed(args.seed)

    players = []
    for i in range(3, 25):
        players.append(BankOnRollN(f'bank on roll {i}', i))
        for j in range(1, 12):        
            players.append(BankOnRollNOrHigherThan(f'bank when higher than {j * 100} or on roll {i}', i, j * 100))
    for j in range(1, 12):    
        players.append(BankWhenHigherThan(f'bank when higher than {j * 100}', j * 100))
        players.append(NOverLeader(f'{j} over leader', j))

    # Initially empty stats
    stats = {
        'games': [],
        'games_count': args.games
    }
    printProgressBar(0, args.games, prefix = 'Progress:', suffix = 'Complete', length = 50)
    for i in range(1, args.games + 1):
        playGame(players, args.rounds, stats)
        printProgressBar(i, args.games, prefix = 'Progress:', suffix = 'Complete', length = 50)

    calculateStatistics(stats)

    with open(args.output, 'w') as f:
        #  Full Stats -- Warning this can be very large
        # f.write(json.dumps(stats, indent=2))
        #  Just the player totals
        f.write(json.dumps(stats['totals'], indent=2))


if __name__ == "__main__":
    main()