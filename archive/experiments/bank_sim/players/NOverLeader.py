from players.player import Player
from decision import Decision

class NOverLeader(Player):

    def __init__(self, name, over_rolls):
        self.name = name
        self.over_rolls = over_rolls
        self.max_rolls = 999

    def decide(self, stats):

        if len(stats['dice_history']) >= self.max_rolls:
            return Decision.BANK

        topPlayer = None
        for playerName in stats['players']:
            if topPlayer == None or (stats['players'][playerName]['score'] > topPlayer['score']):
                topPlayer = stats['players'][playerName]

        if topPlayer['has_banked']:
            self.max_rolls = len(stats['dice_history']) + self.over_rolls
        
        return Decision.CONTINUE
    
    def reset(self):
        self.max_rolls = 999