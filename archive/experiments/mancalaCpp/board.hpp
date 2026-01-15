#pragma once

#include <vector>

class Board{
	public:
      std::vector<std::vector<int>> m_board = {{4,4,4,4,4,4},{4,4,4,4,4,4}};
      std::vector<int> m_mancala = {0,0};
      bool m_gameOver = false;
      bool m_player2Turn = true;
      Board();
      Board(const Board &board);
      void executeTurn(const int move);
      void print();
      int score(bool player, int depth);
};
