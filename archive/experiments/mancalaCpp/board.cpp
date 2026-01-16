#include "board.hpp"
#include <algorithm>
#include <iostream>
#include <numeric>
#include <experimental/iterator>

Board::Board() {}

Board::Board(const Board &board) {
  m_board = board.m_board;
  m_mancala = board.m_mancala;
}

void Board::executeTurn(int move) {
  bool currentSide = m_player2Turn;

  int currentSpace = move + 1;
  int movingMarbles = m_board[m_player2Turn][move];

  bool switchTurns = true;

  m_board[m_player2Turn][move] = 0;

  if (movingMarbles == 0) {
    m_gameOver = true;
    m_mancala[m_player2Turn] = -1;
    return;
  }

  while (movingMarbles > 0) {
    if (currentSpace > 5) {
      m_mancala[currentSide] += 1;
      currentSpace = 0;
      currentSide = !currentSide;
      if (movingMarbles == 1)
        switchTurns = false;
    } else {
      m_board[currentSide][currentSpace] += 1;
      currentSpace += 1;
    }
    movingMarbles -= 1;
  }
  currentSpace -= 1;
  if (currentSpace < 6 && currentSpace >= 0 &&
      m_board[currentSide][currentSpace] == 1 && currentSide == m_player2Turn &&
      m_board[not currentSide][5 - currentSpace] > 0) {
    m_mancala[currentSide] += m_board[not currentSide][5 - currentSpace] + 1;
    m_board[not currentSide][5 - currentSpace] = 0;
    m_board[currentSide][currentSpace] = 0;
  }

  if (std::accumulate(m_board[0].begin(), m_board[0].end(), 0) == 0) {
    m_gameOver = true;
    m_mancala[1] += std::accumulate(m_board[0].begin(), m_board[0].end(), 0);
  }

  if (std::accumulate(m_board[1].begin(), m_board[1].end(), 0) == 0) {
    m_gameOver = true;
    m_mancala[0] += std::accumulate(m_board[1].begin(), m_board[1].end(), 0);
  }
  if (switchTurns)
	  m_player2Turn = !m_player2Turn;
}

void Board::print(){
	std::copy(m_board[0].begin(), m_board[0].end(), std::experimental::make_ostream_joiner(std::cout, " "));
	std::cout << std::endl;
  std::cout << m_mancala[0] << "        " << m_mancala[1] << std::endl;
	std::copy(m_board[1].begin(), m_board[1].end(), std::experimental::make_ostream_joiner(std::cout, " "));
	std::cout << std::endl;
}

int Board::score(bool player,int depth){
	if (m_gameOver && m_mancala[player] > m_mancala[! player])
		return 500 + depth;
	else if (m_gameOver)
		return -500 - depth;
	return m_mancala[player] - m_mancala[! player] + 
    std::accumulate(m_board[player].begin(), m_board[player].end(), 0) -
    std::accumulate(m_board[! player].begin(), m_board[! player].end(), 0);
}
