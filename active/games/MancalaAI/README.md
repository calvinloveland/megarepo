# MancalaAI

A program for training and testing networks to play Mancala

## Running MancalaAI

Dependencies:

	Python 3.5 or greater
	OpenAI Gym
	Keras-RL
	Theano

The easiest way to get these dependencies is to simply run:

```
pip install -r requirements.txt
```

Then edit $HOME/.keras/keras.json to use theano as a backend

I've tested MancalaAI on Windows and Ubuntu 16.04 on Ubuntu I also had to install python3-dev

```
sudo apt install python3-dev
```

Once you have the dependencies you can run unit tests or main:

```
python3 __main__.py
python3 unit_tests.py
```

## Deliverables

I did train networks to play Mancala but they are really really
bad at it. You can play Mancala against any network you chose.
Additionally the OpenAI Gym I've created can be used with any
other reinforcement learning system that supports Gym. More 
information below.

### Networks
I've technically delivered everything promised here.
I've trained lots of networks to play Mancala. The only problem
is that every single network is absolutely terrible. For some reason
not a single network can avoid making invalid moves let alone choose the moves
of a decent Mancala player. You can see this when playing against
the network. You may be able to get a few moves in but very quickly
the network will make an invalid move and lose. I'm not sure whe I was
unable to get a network to train properly. It was not for a lack of trying.
I tried a number of different network architectures (You can see the models
when testing the networks). I also tried many different 
optimizers, reward functions, learning rates, decay rates, and action policies.
Overall I would estimate my i7-4770 CPU spent 72 hours solid training 
 5 networks at a time
at 100% utilization. I trained most networks for between 10,000 and
100,000 steps. 

### Play Against MancalaAI
You can currently play against the best network but it will not 
be a very hard game. The game against a user is a Gym just like
the training board. This means it would be possible to train
a network against user input. However I really just did it this
way because it was easier.

### Mancala Gym
For the Mancala Gym I only implement the random input and user input
version. I was planning on creating one using a MinMax algorithm
but since the networks could not beat
the Gym making random moves I didn't see the point of creating
a harder challenge. 

## Resources

https://github.com/plaidml/plaidml PlaidML - The original backend I tried
to use in the hopes I could train networks using my GPU. I couldn't
get it working with Keras-RL

https://gym.openai.com OpenAI Gym - Provides an easy way
to create a reinforcement learning environment.

https://github.com/keras-rl/keras-rl Keras-RL - An old research
project that is supposed to provide an easy reinforcement 
learning library. This hasn't had much support in about a year
and the documentation is very sparse. If I had to start over I'd 
probably choose a different library

https://github.com/openai/gym-soccer Soccer Gym - An easy to follow
example of creating a custom Gym. Covers a lot of information
that the Gym documentation misses.
