#include "board.hpp"
#include "minimax.hpp"
#include <iostream>

int main(){
    Board board;
    board.print();
    while (!board.m_gameOver){ 
    	int move = Minimax(board,3,board.m_player2Turn)[1]; 
	//std::cin >> move;
	std::cout << move << std::endl;
	board.executeTurn(move);
	board.print();
	std::cout << board.m_player2Turn << std::endl;
    }
}
