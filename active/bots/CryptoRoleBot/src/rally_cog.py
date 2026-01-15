import json

import discord
from discord.ext import commands, tasks
from discord.utils import get

import data
import rally_api
from base_cog import BaseCog


class RallyCommands(BaseCog):
    """Commands for managing Rally ID mappings."""

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
