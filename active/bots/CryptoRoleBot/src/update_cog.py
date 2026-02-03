"""Background task cog for assigning/removing roles and channel permissions based on Rally balances."""

import json
import threading

import discord
from discord.ext import commands, tasks
from discord.utils import get

import data
import rally_api
import validation
from base_cog import BaseCog


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


class UpdateTask(BaseCog):
    """Background task for updating role/channel assignments."""

    def __init__(self, bot):
        super().__init__(bot)
        self.update_lock = threading.Lock()
        self.update.start()

    @commands.Cog.listener()
    async def on_ready(self):
        print("We have logged in as {0.user}".format(self.bot))

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
