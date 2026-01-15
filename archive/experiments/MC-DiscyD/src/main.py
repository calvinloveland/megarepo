import discord
import config
import command_cog


if __name__ == "__main__":
    config.parse_args()
    bot = discord.ext.commands.Bot(command_prefix=config.CONFIG.command_prefix)
    bot.add_cog(command_cog.Commands(bot))
    bot.run(config.CONFIG.secret_token)
