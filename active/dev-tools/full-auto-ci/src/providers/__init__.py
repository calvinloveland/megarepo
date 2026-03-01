"""Integration provider registry for Full Auto CI."""

# Import built-in providers to trigger registration side effects.
from . import (
    bamboo,
    github,
    gitlab,
    jenkins,
)
from .base import BaseProvider, ProviderConfigError
from .registry import ProviderRegistrationError, ProviderRegistry, registry

_BUILTIN_PROVIDERS = (bamboo, github, gitlab, jenkins)

__all__ = [
    "BaseProvider",
    "ProviderConfigError",
    "ProviderRegistry",
    "ProviderRegistrationError",
    "registry",
]
