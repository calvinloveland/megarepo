import json
import sys
import traceback
import threading

import discord
from discord.ext import commands, tasks
from discord.utils import get

import data
import rally_api
import validation


async def grant_deny_channel_to_member(channel_mapping, member, balances):
    print("Checking channel")
    rally_id = data.get_rally_id(member.id)
    if rally_id is None:
        return
    matched_channels = [
        channel
        for channel in member.guild.channels
        if channel.name == channel_mapping[data.CHANNEL_NAME_KEY]
    ]
    if len(matched_channels) == 0:
        return
    channel_to_assign = matched_channels[0]
    if channel_to_assign is not None:
        if (
            rally_api.find_balance_of_coin(
                channel_mapping[data.COIN_KIND_KEY], balances
            )
            >= channel_mapping[data.REQUIRED_BALANCE_KEY]
        ):
            perms = channel_to_assign.overwrites_for(member)
            perms.send_messages = True
            perms.read_messages = True
            perms.read_message_history = True
            await channel_to_assign.set_permissions(member, overwrite=perms)
            print("Assigned channel to member")
        else:
            perms = channel_to_assign.overwrites_for(member)
            perms.send_messages = False
            perms.read_messages = False
            perms.read_message_history = False
            await channel_to_assign.set_permissions(member, overwrite=perms)
            print("Removed channel to member")
    else:
        print("Channel not found")


async def grant_deny_role_to_member(role_mapping, member, balances):
    rally_id = data.get_rally_id(member.id)
    if rally_id is None:
        return
    role_to_assign = get(member.guild.roles, name=role_mapping[data.ROLE_NAME_KEY])
    print("Checking for coin " + role_mapping[data.COIN_KIND_KEY])
    print(rally_api.find_balance_of_coin(role_mapping[data.COIN_KIND_KEY], balances))
    if (
        rally_api.find_balance_of_coin(role_mapping[data.COIN_KIND_KEY], balances)
        >= role_mapping[data.REQUIRED_BALANCE_KEY]
    ):
        if role_to_assign is not None:
            await member.add_roles(role_to_assign)
            print("Assigned role to member")
        else:
            print("Can't find role")
            print(role_mapping["role"])
    else:
        if role_to_assign in member.roles:
            await member.remove_roles(role_to_assign)
            print("Removed role to member")


class UpdateTask(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.update_lock = threading.Lock()
        self.update.start()

    @commands.Cog.listener()
    async def on_ready(self):
        print("We have logged in as {0.user}".format(self.bot))

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

    @commands.command(name="update", help="Force an immediate update")
    @validation.owner_or_permissions(administrator=True)
    async def force_update(self, ctx):
        self.update.restart()
        await ctx.send("Updating!")

    @tasks.loop(seconds=600.0)
    async def update(self):
        with self.update_lock:
            print("Updating roles")
            guilds = self.bot.guilds
            guild_count = 0
            member_count = 0
            mapping_count = 0
            for guild in guilds:
                guild_count += 1
                await guild.chunk()
                role_mappings = list(data.get_role_mappings(guild.id))
                channel_mappings = list(data.get_channel_mappings(guild.id))
                mapping_count += len(role_mappings) + len(channel_mappings)
                for member in guild.members:
                    member_count += 1
                    rally_id = data.get_rally_id(member.id)
                    if rally_id is not None:
                        balances = rally_api.get_balances(rally_id)
                        for role_mapping in role_mappings:
                            print(role_mapping)
                            await grant_deny_role_to_member(
                                role_mapping, member, balances
                            )
                        for channel_mapping in channel_mappings:
                            await grant_deny_channel_to_member(
                                channel_mapping, member, balances
                            )
            print(
                "Done! Checked "
                + str(guild_count)
                + " guilds. "
                + str(mapping_count)
                + " mappings. "
                + str(member_count)
                + " members."
            )
