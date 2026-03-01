"""Model builder for MancalaAI neural networks."""

import importlib


def _load_keras_layers():
    keras_layers = importlib.import_module("keras.layers")
    keras_models = importlib.import_module("keras.models")
    return (
        getattr(keras_models, "Sequential"),
        getattr(keras_layers, "Dense"),
        getattr(keras_layers, "Flatten"),
    )


def build_model(env):
    """Build the dense neural network used by RL agents."""
    sequential_cls, dense_cls, flatten_cls = _load_keras_layers()
    input_shape = (1,) + env.observation_space.shape
    print("InputShape:")
    print(input_shape)
    model = sequential_cls()
    model.add(dense_cls(32, input_shape=input_shape, activation="sigmoid"))
    model.add(flatten_cls())
    model.add(dense_cls(64, activation="sigmoid"))
    model.add(dense_cls(128, activation="sigmoid"))
    model.add(dense_cls(256, activation="sigmoid"))
    model.add(dense_cls(512, activation="sigmoid"))
    model.add(dense_cls(env.action_space.n, activation="sigmoid"))
    print(model.summary())
    return model
