from players.player import Player
from decision import Decision

class BankWhenHigherThan(Player):

    def __init__(self, name, max_score):
        self.name = name
        self.max_score = max_score

    def decide(self, stats):
        if stats['score_history'][-1] >= self.max_score:
            return Decision.BANK
        
        return Decision.CONTINUE
    
    def reset(self):
        pass