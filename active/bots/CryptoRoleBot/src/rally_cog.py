import json
import sys
import traceback

import discord
from discord.ext import commands, tasks
from discord.utils import get

import data
import rally_api


class RallyCommands(commands.Cog):
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
            await ctx.send("Command missing arguments")

        else:
            # All other Errors not returned come here. And we can just print the default TraceBack.
            print(
                "Ignoring exception in command {}:".format(ctx.command), file=sys.stderr
            )
            traceback.print_exception(
                type(error), error, error.__traceback__, file=sys.stderr
            )

    @commands.command(name="set_rally_id", help="Set your rally id")
    async def set_rally_id(self, ctx, rally_id=None):
        if ctx.guild is None:
            if rally_id is not None:
                data.add_discord_rally_mapping(ctx.author.id, rally_id)
                await ctx.send("Set!")
            else:
                await ctx.send("You must include your rally id")
        else:
            if rally_id is not None:
                data.add_discord_rally_mapping(ctx.author.id, rally_id)
                await ctx.send("Set!")
            else:
                await ctx.author.send(
                    "Set your rally id by responding with $set_rally_id <your_rally_id>"
                )
                await ctx.send("DM sent")
