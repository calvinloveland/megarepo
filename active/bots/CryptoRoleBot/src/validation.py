from discord.ext import commands
from discord.utils import get

import rally_api


def owner_or_permissions(**perms):
    original = commands.has_permissions(**perms).predicate

    async def extended_check(ctx):
        if ctx.guild is None:
            return False
        return ctx.guild.owner_id == ctx.author.id or await original(ctx)

    return commands.check(extended_check)


async def is_valid_role(ctx, role_name):
    if get(ctx.guild.roles, name=role_name) is None:
        await ctx.send("Role does not exist on this server. Please create it first.")
        return False
    return True


async def is_valid_channel(ctx, channel_name):
    matched_channels = [
        channel for channel in ctx.guild.channels if channel.name == channel_name
    ]
    if len(matched_channels) == 0:
        await ctx.send(
            "Cannot find the channel "
            + channel_name
            + " ensure that the bot has permissions for the channel."
        )
        return False
    return True


async def is_valid_coin(ctx, coin_name):
    valid = rally_api.valid_coin_symbol(coin_name)
    if not valid:
        await ctx.send("Coin " + coin_name + " does not seem to exist")
        return False
    return True
