from players.player import Player
from decision import Decision

class BankOnRollNOrHigherThan(Player):

    def __init__(self, name, max_rolls, max_score):
        self.name = name
        self.max_rolls = max_rolls
        self.max_score = max_score

    def decide(self, stats):
        if len(stats['dice_history']) >= self.max_rolls or stats['score_history'][-1] >= self.max_score:
            return Decision.BANK
        
        return Decision.CONTINUE
    
    def reset(self):
        pass