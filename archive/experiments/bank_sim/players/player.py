from abc import ABC, abstractmethod


class Player(ABC):
    def __init__(self, name):
        self.name = name
    
    @abstractmethod
    def decide(self, stats):
        pass

    @abstractmethod
    def reset(self):
        pass