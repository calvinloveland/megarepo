import keras.backend as K
from keras.layers import Activation, Dense, Flatten
from keras.models import Sequential


def build_model(env):
    inputShape = (1,) + env.observation_space.shape
    print("InputShape:")
    print(inputShape)
    model = Sequential()
    model.add(Dense(32, input_shape=inputShape, activation="sigmoid"))
    model.add(Flatten())
    model.add(Dense(64, activation="sigmoid"))
    model.add(Dense(128, activation="sigmoid"))
    model.add(Dense(256, activation="sigmoid"))
    model.add(Dense(512, activation="sigmoid"))
    # model.add(Dense(512, activation='relu'))
    # model.add(Dense(512, activation='relu'))
    # model.add(Dense(512, activation='relu'))
    # model.add(Dense(512, activation='relu'))
    model.add(Dense(env.action_space.n, activation="sigmoid"))
    # model.compile(loss='categorical_crossentropy',
    #               optimizer='sgd',
    #               metrics=['accuracy'])
    print(model.summary())
    return model
