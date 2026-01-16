from players.player import Player
from decision import Decision

class BankOnRollN(Player):

    def __init__(self, name, max_rolls):
        self.name = name
        self.max_rolls = max_rolls

    def decide(self, stats):
        if len(stats['dice_history']) >= self.max_rolls:
            return Decision.BANK
        
        return Decision.CONTINUE
    
    def reset(self):
        pass