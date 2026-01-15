"""Base cog with shared error handling for all CryptoRoleBot cogs."""

import sys
import traceback

import discord
from discord.ext import commands


class BaseCog(commands.Cog):
    """Base cog class with shared error handling.
    
    All cogs should inherit from this to get consistent error handling.
    Override `get_missing_args_message` to customize the MissingRequiredArgument message.
    """

    def __init__(self, bot):
        self.bot = bot

    def get_missing_args_message(self) -> str:
        """Override this to provide a custom message for missing arguments."""
        return "Command missing arguments"

    async def cog_command_error(self, ctx, error):
        """Shared error handler for all cog commands."""
        # This prevents any commands with local handlers being handled here
        if hasattr(ctx.command, "on_error"):
            return

        ignored = (commands.CommandNotFound,)

        # Check for original exceptions raised and sent to CommandInvokeError
        error = getattr(error, "original", error)

        # Anything in ignored will return
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

        elif isinstance(error, commands.BadArgument):
            await ctx.send("Bad argument")

        elif isinstance(error, commands.MissingRequiredArgument):
            await ctx.send(self.get_missing_args_message())

        else:
            # All other Errors not returned come here
            print(
                "Ignoring exception in command {}:".format(ctx.command), file=sys.stderr
            )
            traceback.print_exception(
                type(error), error, error.__traceback__, file=sys.stderr
            )
