/*
 * Bot: "Four-Line Fanatic" — Tetris hunter.
 *
 * Refuses to clear anything except four rows at once. The rightmost column is
 * kept as a well: no piece may put a cell in it, ever, unless a vertical I is
 * about to complete four rows in one stroke. Non-I pieces are stacked flat over
 * the other nine columns, the well is kept four deep, and stray single/double
 * clears are treated as sabotage because the only way to make one is to have
 * filled the well.
 *
 * If a board ever makes that impossible, it degrades to score play rather than
 * topping out with an untouched board.
 *
 * Submit the bundle in bots/dist/, not this file: a bot must be one .js module.
 *
 * Calvin Loveland · agent deepseek
 */

const bot = makeBot(HUNTER_CFG);

export default bot;
