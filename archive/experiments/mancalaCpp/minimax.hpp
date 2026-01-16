#include "board.hpp"
#include <iostream>
#include <vector>

inline std::vector<int> Minimax(Board &b, int depth, bool player) {
  // b.print();
  if (depth == 0 || b.m_gameOver)
    return {b.score(player, depth), -1};
  if (player == b.m_player2Turn) {
    std::vector<int> v = {-10000, -1};
    int bestScore = -10000;
    for (int i = 0; i < 6; i++) {
      Board newBoard = b;
      newBoard.executeTurn(i);
      std::vector<int> result = Minimax(newBoard, depth - 1, player);
      v[0] = v[0] > result[0] ? v[0] : result[0];
    std::cout << "Best " << bestScore << " depth-" << depth << " move " << v[1] << " score " << v[0] << std::endl;
      if (v[0] > bestScore) {
        bestScore = v[0];
        v[1] = i;
      }
    }
    return v;
  } else {
    std::vector<int> v = {10000, -1};
    for (int i = 0; i < 6; i++) {
      Board newBoard = b;
      newBoard.executeTurn(i);
      std::vector<int> result = Minimax(newBoard, depth - 1, player);
      v[0] = v[0] < result[0] ? v[0] : result[0];
    }
    return v;
  }
}
