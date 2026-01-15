import sys
import traceback
import discord
from discord.ext import commands
import tts
import time


class Commands(commands.Cog):
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
                "Command missing arguments. Channel commands require coin name, coin amount, and channel name. Example: set_role_mapping STANZ 10 private-channel"
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
        name="say",
        help="Make the bot say something.",
    )
    async def say(self, ctx, *, msg: str):
        channel = ctx.author.voice.channel
        if channel is not None:
            try:
                vc = await channel.connect()
                file = tts.generate_mp3_from_string(msg)
                vc.play(discord.FFmpegPCMAudio(file))
                time.sleep(len(msg))
            finally:
                await vc.disconnect()
        else:
            await ctx.send("You must be in a voice channel to use this command.")
