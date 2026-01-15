import json
import sys
import traceback

import discord
from discord.ext import commands, tasks
from discord.utils import get

import data
import rally_api
import update_cog
import validation


class RoleCommands(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def cog_command_error(self, ctx, error):
        # This prevents any commands with local handlers being handled here in on_command_error.
        if hasattr(ctx.command, "on_error"):
            return

        ignored = (commands.CommandNotFound,)

        # Allows us to check for original exceptions raised and sent to CommandInvokeError.
        # If nothing is found. We keep the exception passed to on_command_error.
        error = getattr(error, "original", error)

        # Anything in ignored will return and prevent anything happening.
        if isinstance(error, ignored):
            return

        if isinstance(error, commands.DisabledCommand):
            await ctx.send(f"{ctx.command} has been disabled.")

        elif isinstance(error, commands.NoPrivateMessage):
            try:
                await ctx.author.send(
                    f"{ctx.command} can not be used in Private Messages."
                )
            except discord.HTTPException:
                pass

        # For this error example we check to see where it came from...
        elif isinstance(error, commands.BadArgument):
            await ctx.send("Bad argument")

        elif isinstance(error, commands.MissingRequiredArgument):
            await ctx.send(
                "Command missing arguments. Role commands require coin name, coin amount, and role name. Example: set_role_mapping STANZ 10 Role1"
            )

        else:
            # All other Errors not returned come here. And we can just print the default TraceBack.
            print(
                "Ignoring exception in command {}:".format(ctx.command), file=sys.stderr
            )
            traceback.print_exception(
                type(error), error, error.__traceback__, file=sys.stderr
            )

    @commands.command(
        name="set_role_mapping",
        help=" <coin name> <coin amount> <role name> "
        + "Set a mapping between coin and role. Roles will be constantly updated.",
    )
    @validation.owner_or_permissions(administrator=True)
    async def set_coin_for_role(self, ctx, coin_name, coin_amount: int, role_name):
        if not await validation.is_valid_role(ctx, role_name):
            return
        if ctx.guild is None:
            await ctx.send("Please send this command in a server.")
            return
        data.add_role_coin_mapping(ctx.guild.id, coin_name, coin_amount, role_name)
        update = self.bot.get_cog("UpdateTask")
        await update.force_update(ctx)
        await ctx.send("Set")

    @commands.command(
        name="one_time_role_mapping",
        help=" <coin name> <coin amount> <role name>"
        + " Set a mapping to be applied once instantly.",
    )
    @validation.owner_or_permissions(administrator=True)
    async def one_time_role_mapping(self, ctx, coin_name, coin_amount: int, role_name):
        if not await validation.is_valid_role(ctx, role_name):
            return
        if ctx.guild is None:
            ctx.send("Please send this command in a server.")
            return
        for member in ctx.guild.members:
            rally_id = data.get_rally_id(member.id)
            if rally_id is not None:
                balances = rally_api.get_balances(rally_id)
                await update_cog.grant_deny_role_to_member(
                    {
                        data.GUILD_ID_KEY: ctx.guild.id,
                        data.COIN_KIND_KEY: coin_name,
                        data.REQUIRED_BALANCE_KEY: coin_amount,
                        data.ROLE_NAME_KEY: role_name,
                    },
                    member,
                    balances,
                )
        update = self.bot.get_cog("UpdateTask")
        await update.force_update(ctx)
        await ctx.send("Done")

    @commands.command(
        name="unset_role_mapping",
        help=" <coin name> <coin amount> <role name> "
        + "Unset a mapping between coin and role",
    )
    @validation.owner_or_permissions(administrator=True)
    async def unset_coin_for_role(self, ctx, coin_name, coin_amount: int, role_name):
        if ctx.guild is None:
            await ctx.send("Please send this command in a server")
            return
        data.remove_role_mapping(ctx.guild.id, coin_name, coin_amount, role_name)
        await ctx.send("Unset")

    @commands.command(name="get_role_mappings", help="Get role mappings")
    @validation.owner_or_permissions(administrator=True)
    async def get_role_mappings(self, ctx):
        await ctx.send(
            json.dumps(
                [
                    json.dumps(mapping)
                    for mapping in data.get_role_mappings(ctx.guild.id)
                ]
            )
        )
