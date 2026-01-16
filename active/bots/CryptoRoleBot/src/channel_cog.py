import json

import discord
from discord.ext import commands, tasks
from discord.utils import get

import data
import rally_api
import update_cog
import validation
from base_cog import BaseCog


class ChannelCommands(BaseCog):
    """Commands for managing channel-to-coin mappings."""

    def get_missing_args_message(self) -> str:
        return (
            "Command missing arguments. Channel commands require coin name, "
            "coin amount, and channel name. Example: set_channel_mapping STANZ 10 private-channel"
        )

    @commands.command(
                type(error), error, error.__traceback__, file=sys.stderr
            )

    @commands.command(
        name="set_channel_mapping",
        help=" <coin name> <coin amount> <channel name> "
        + "Set a mapping between coin and channel. Channel membership will be constantly updated.",
    )
    @validation.owner_or_permissions(administrator=True)
    async def set_coin_for_channel(
        self, ctx, coin_name, coin_amount: int, channel_name
    ):
        if not await validation.is_valid_channel(ctx, channel_name):
            return
        if ctx.guild is None:
            await ctx.send("Please send this command in a server")
            return
        data.add_channel_coin_mapping(
            ctx.guild.id, coin_name, coin_amount, channel_name
        )
        update = self.bot.get_cog("UpdateTask")
        await update.force_update(ctx)
        await ctx.send("Done")

    @commands.command(
        name="one_time_channel_mapping",
        help=" <coin name> <coin amount> <channel name>"
        + " Grant/deny access to a channel instantly.",
    )
    @validation.owner_or_permissions(administrator=True)
    async def one_time_channel_mapping(
        self, ctx, coin_name, coin_amount: int, channel_name
    ):
        if not await validation.is_valid_channel(ctx, channel_name):
            return
        if ctx.guild is None:
            await ctx.send("Please send this command in a server")
            return
        for member in ctx.guild.members:
            rally_id = data.get_rally_id(member.id)
            if rally_id is not None:
                balances = rally_api.get_balances(rally_id)
                await update_cog.grant_deny_channel_to_member(
                    {
                        data.GUILD_ID_KEY: ctx.guild.id,
                        data.COIN_KIND_KEY: coin_name,
                        data.REQUIRED_BALANCE_KEY: coin_amount,
                        data.CHANNEL_NAME_KEY: channel_name,
                    },
                    member,
                    balances,
                )
        update = self.bot.get_cog("UpdateTask")
        await update.force_update(ctx)
        await ctx.send("Done")

    @commands.command(
        name="unset_channel_mapping",
        help=" <coin name> <coin amount> <channel name> "
        + "Unset a mapping between coin and channel",
    )
    @validation.owner_or_permissions(administrator=True)
    async def unset_coin_for_channel(
        self, ctx, coin_name, coin_amount: int, channel_name
    ):
        if ctx.guild is None:
            await ctx.send("Please send this command in a server")
            return
        data.remove_channel_mapping(ctx.guild.id, coin_name, coin_amount, channel_name)
        await ctx.send("Unset")

    @commands.command(name="get_channel_mappings", help="Get channel mappings")
    @validation.owner_or_permissions(administrator=True)
    async def get_channel_mappings(self, ctx):
        await ctx.send(
            json.dumps(
                [
                    json.dumps(mapping)
                    for mapping in data.get_channel_mappings(ctx.guild.id)
                ]
            )
        )
