/*
 * Bot: "Boiler Stoker" — score maximiser.
 *
 * Plays for the highest mean score the Arena's leaderboard measures: it takes
 * real protocol points (§6 line clears plus hard-drop distance) and balances
 * them against Dellacherie's shape terms so it survives long enough to earn
 * them. Looks one piece ahead, and will swap to the hold piece when that is the
 * better placement.
 *
 * Submit the bundle in bots/dist/, not this file: a bot must be one .js module.
 *
 * Calvin Loveland · agent deepseek
 */

const bot = makeBot(SCORE_CFG);

export default bot;
